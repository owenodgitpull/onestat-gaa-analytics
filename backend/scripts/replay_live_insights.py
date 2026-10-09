"""
Replay the 5-minute LIVE insights over a recorded match, as the agent would have produced them live.

For each interval (5', 10', 15' ...) the agent sees ONLY the data recorded up to that minute, plus the insights it
already gave earlier in the replay (so its repeat-suppression behaves as it does live). Nothing is saved: the replay
runs inside one database transaction against a scratch copy of the match that is rolled back at the end.

Run it against production (it needs the production DB and the Anthropic key) with `run_replay_on_fly.ps1`
(or see docs/live-insight-replay.md). Settings come from environment variables:

  MATCH_ID   the match to replay                         (required)
  THROUGH    last minute to replay up to                  (default 35)
  STEP       minutes between insights                     (default 5)
  HALF_TIME  "1" to add a half-time read at the end       (default 1)
  LABEL      text added to the output file names          (default "run")

It prints the result files as `@@FILE@@name@@base64` lines; the runner decodes them into docs/insight-replays/.
"""
import asyncio
import base64
import hashlib
import json
import logging
import os
import sys
import time
from datetime import datetime

logging.disable(logging.CRITICAL)
sys.path.insert(0, '/app')

from sqlalchemy import select, text  # noqa: E402

from app.database import async_session_maker  # noqa: E402
from app.models.ball_carrier_segment import BallCarrierSegment  # noqa: E402
from app.models.live_insight import LiveInsight  # noqa: E402
from app.models.match import Match  # noqa: E402
from app.models.match_event import MatchEvent  # noqa: E402
from app.models.match_lineup import MatchLineup  # noqa: E402
from app.models.possession_event import PossessionEvent  # noqa: E402
from app.services.ai import match_agent as ma  # noqa: E402
from app.services.ai._shared import execute_tool  # noqa: E402
from app.services.live_insights_service import LiveInsightsService  # noqa: E402
from app.services.match_event_service import MatchEventService  # noqa: E402

MATCH_ID = os.environ['MATCH_ID']
THROUGH = int(os.environ.get('THROUGH', '35'))
STEP = int(os.environ.get('STEP', '5'))
HALF_TIME = os.environ.get('HALF_TIME', '1') == '1'
LABEL = os.environ.get('LABEL', 'run')


def emit(name: str, content: str) -> None:
    print('@@FILE@@' + name + '@@' + base64.b64encode(content.encode('utf-8')).decode(), flush=True)


def clone_values(row, skip=('id', 'client_event_id')):
    return {c.name: getattr(row, c.name) for c in row.__table__.columns if c.name not in skip}


async def main():
    async with async_session_maker() as db:
        src = (await db.execute(select(Match).where(Match.id == MATCH_ID))).scalar_one()
        events = (await db.execute(
            select(MatchEvent).where(MatchEvent.match_id == MATCH_ID).order_by(MatchEvent.minute, MatchEvent.created_at)
        )).scalars().all()
        poss = (await db.execute(select(PossessionEvent).where(PossessionEvent.match_id == MATCH_ID))).scalars().all()
        segs = (await db.execute(select(BallCarrierSegment).where(BallCarrierSegment.match_id == MATCH_ID))).scalars().all()
        lineups = (await db.execute(select(MatchLineup).where(MatchLineup.match_id == MATCH_ID))).scalars().all()
        club_id = src.club_id
        opponent = src.opponent

        # Scratch copy of the match — never committed
        vals = clone_values(src)
        vals['opponent'] = '[REPLAY] ' + (opponent or '')
        vals['video_tagging_in_progress'] = True
        scratch = Match(**vals)
        db.add(scratch)
        await db.flush()
        sid = scratch.id
        for lu in lineups:
            db.add(MatchLineup(**{**clone_values(lu), 'match_id': sid}))
        await db.flush()

        inserted_ev = set()
        inserted_poss = set()
        inserted_seg = set()
        results = []
        fingerprint = None
        schedule = [(m, 'interval') for m in range(STEP, THROUGH + 1, STEP)]
        if HALF_TIME:
            schedule.append((THROUGH, 'half_time'))

        for minute, trigger in schedule:
            # reveal everything recorded up to this minute
            for e in events:
                if e.id not in inserted_ev and e.minute is not None and e.minute <= minute:
                    db.add(MatchEvent(**{**clone_values(e), 'match_id': sid}))
                    inserted_ev.add(e.id)
            for p in poss:
                if p.id not in inserted_poss and p.minute is not None and p.minute <= minute:
                    db.add(PossessionEvent(**{**clone_values(p), 'match_id': sid}))
                    inserted_poss.add(p.id)
            for sg in segs:
                if sg.id not in inserted_seg and (sg.minute or 0) <= minute:
                    db.add(BallCarrierSegment(**{**clone_values(sg), 'match_id': sid}))
                    inserted_seg.add(sg.id)
            await db.flush()
            await MatchEventService._recalculate_match_scores(db, sid)
            await db.flush()

            recent_rows = await LiveInsightsService._get_recent_events(db, sid, minutes=10)
            recent = [{
                "minute": e.minute,
                "type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                "team": e.team.value if hasattr(e.team, 'value') else (str(e.team) if e.team else None),
            } for e in recent_rows[:10]]

            prior = (await db.execute(
                select(LiveInsight.insight).where(LiveInsight.match_id == sid).order_by(LiveInsight.created_at.desc()).limit(2)
            )).all()
            previous = [t for (t,) in prior if t and not t.startswith('[Analysis pending')]
            snap = await LiveInsightsService._compute_concern_snapshot(db, sid)
            note = await LiveInsightsService._build_already_flagged_note(db, sid, snap)

            # what the agent's first tool call returns at this moment (kept for the record)
            stats_text = await execute_tool('get_live_match_stats', {'match_id': str(sid)}, db, club_id=club_id)

            started = time.time()
            insight_text = await ma.MatchAgent.live_insight(
                db, sid, recent, trigger=trigger, previous_insights=previous, already_flagged_note=note,
            )
            took = time.time() - started

            flagged = LiveInsightsService._mark_flagged_concerns(insight_text, snap)
            db.add(LiveInsight(match_id=sid, minute=minute, half=1, trigger=trigger, insight=insight_text,
                               trigger_context=f"{minute}' replay", flagged_concerns=flagged or None))
            await db.flush()

            score_line = next((ln.strip() for ln in stats_text.splitlines() if ln.strip().startswith('SCORE:')), '')
            results.append({
                'minute': minute, 'trigger': trigger, 'score': score_line, 'insight': insight_text.strip(),
                'seconds': round(took, 1), 'events_visible': len(inserted_ev), 'recent_events': recent,
                'snapshot': stats_text, 'already_flagged_note': note,
            })

        model = ma.LIVE_MODEL
        # fingerprint of the prompt text (so two runs can be told apart: did the prompt change?)
        try:
            import inspect
            fingerprint = hashlib.sha256(inspect.getsource(ma.MatchAgent.live_insight).encode()).hexdigest()[:10]
        except Exception:
            fingerprint = 'n/a'

        await db.rollback()   # the scratch match, copies and replay insights are discarded
        # belt and braces: nothing named [REPLAY] may remain
        await db.execute(text("delete from matches where opponent like '[REPLAY]%'"))
        await db.commit()

    # ── readable file, laid out like the live insights panel: one block per time ──
    lines = [
        f"# Live insight replay — Dungloe v {opponent}",
        '',
        f"- Replayed: first half, every {STEP} minutes up to {THROUGH}'" + (", plus a half-time read" if HALF_TIME else ''),
        f"- Model: `{model}`   |   live-insight code fingerprint: `{fingerprint}`   |   label: `{LABEL}`",
        f"- Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC",
        "- At each time the agent saw only the data recorded up to that minute, plus its own earlier insights in this run.",
        "- Interval insights only (the live scoring-run / drought / turnover triggers are event-driven and are not replayed).",
        '',
    ]
    for r in results:
        title = "HALF TIME" if r['trigger'] == 'half_time' else f"{r['minute']}'"
        kind = 'half-time read' if r['trigger'] == 'half_time' else 'interval insight'
        lines += [f"## {title} — {kind}", f"_{r['score']}_  ·  {r['events_visible']} events recorded so far  ·  {r['seconds']}s", '', r['insight'], '', '---', '']
    emit(f'insights-replay-{LABEL}.md', '\n'.join(lines))
    emit(f'insights-replay-{LABEL}.json', json.dumps({'model': model, 'fingerprint': fingerprint, 'label': LABEL, 'match_id': MATCH_ID,
                                                       'opponent': opponent, 'results': results}, indent=2, default=str))


asyncio.run(main())
