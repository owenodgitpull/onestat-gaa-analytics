"""
Replay the 5-minute LIVE insights over a tagged match (every period incl. extra time) and STORE them on the match (live_insights, trigger_context "Replayed ..."), for the Match Result "Live agent reads" section. Run on the Fly machine: MATCH_ID=<id> python store_live_insight_replay.py. Re-running replaces the earlier replay.

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
from app.services.ai.live_brief import build_live_brief  # noqa: E402
from app.services.live_insights_service import LiveInsightsService  # noqa: E402
from app.services.match_event_service import MatchEventService  # noqa: E402

MATCH_ID = os.environ['MATCH_ID']
THROUGH = int(os.environ.get('THROUGH', '35'))
STEP = int(os.environ.get('STEP', '5'))
HALF_TIME = os.environ.get('HALF_TIME', '1') == '1'
FULL_MATCH = True   # walk both halves in the order they were played
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

        # A "first half" replay must be the first half only. Minutes alone cannot tell the halves apart (the second half
        # starts back at the half length, so 30'-34' exist in both), so keep only half-1 events, and drop possession /
        # carries that were recorded after the first second-half event was tagged.
        if os.environ.get('HALF', '1') == '1' and not FULL_MATCH:
            h2 = [e for e in events if getattr(e, 'half', None) == 2]
            cutoff = min((e.created_at for e in h2), default=None)
            events = [e for e in events if getattr(e, 'half', None) in (None, 1)]
            if cutoff is not None:
                poss = [p for p in poss if p.created_at is not None and p.created_at < cutoff]
                segs = [g for g in segs if getattr(g, 'half', None) in (None, 1)]

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
        hdm = src.half_duration_mins or 30

        def _half(r):
            return getattr(r, 'half', None) or (1 if (r.minute or 0) <= hdm else 2)

        halves = sorted({_half(e) for e in events if e.minute is not None})
        schedule = []
        for h in halves:
            mins = [e.minute for e in events if e.minute is not None and _half(e) == h]
            lo, hi = min(mins), max(mins)
            start = STEP if h == 1 else ((lo // STEP) + 1) * STEP
            marks = list(range(start, hi + 1, STEP))
            if h != 1 and hi % STEP:
                marks.append(hi)
            schedule += [(h, m, 'interval') for m in marks]
            if h < max(halves):
                schedule.append((h, hi, 'half_time'))     # the read at the end of each period, as at half time live
        def _seen(r, h, m):
            mn = r.minute if r.minute is not None else 0
            return ((_half(r), mn) <= (h, m)) if FULL_MATCH else (mn <= m)

        for cut_half, minute, trigger in schedule:
            # reveal everything recorded up to this point of the match
            for e in events:
                if e.id not in inserted_ev and e.minute is not None and _seen(e, cut_half, minute):
                    db.add(MatchEvent(**{**clone_values(e), 'match_id': sid}))
                    inserted_ev.add(e.id)
            for p in poss:
                if p.id not in inserted_poss and p.minute is not None and _seen(p, cut_half, minute):
                    db.add(PossessionEvent(**{**clone_values(p), 'match_id': sid}))
                    inserted_poss.add(p.id)
            for sg in segs:
                if sg.id not in inserted_seg and _seen(sg, cut_half, minute):
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

            brief_text = await build_live_brief(db, sid, minute, club_id)
            started = time.time()
            insight_text = await ma.MatchAgent.live_insight(
                db, sid, recent, trigger=trigger, previous_insights=previous, already_flagged_note=note, minute=minute,
            )
            took = time.time() - started

            flagged = LiveInsightsService._mark_flagged_concerns(insight_text, snap)
            db.add(LiveInsight(match_id=sid, minute=minute, half=cut_half, trigger=trigger, insight=insight_text,
                               trigger_context=f"{minute}' replay", flagged_concerns=flagged or None))
            await db.flush()

            score_line = next((ln.strip() for ln in stats_text.splitlines() if ln.strip().startswith('SCORE:')), '')
            results.append({
                'minute': minute, 'half': cut_half, 'trigger': trigger, 'score': score_line, 'insight': insight_text.strip(),
                'seconds': round(took, 1), 'events_visible': len(inserted_ev), 'recent_events': recent,
                'fact_check': dict(ma.LAST_FACT_CHECK), 'snapshot': stats_text, 'tactical_brief': brief_text, 'already_flagged_note': note,
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

    async with async_session_maker() as db:
        await db.execute(text("delete from live_insights where match_id = :m and trigger_context like 'Replayed%'"), {"m": MATCH_ID})
        base = datetime.utcnow()
        from datetime import timedelta
        for i, r in enumerate(results):
            db.add(LiveInsight(match_id=MATCH_ID, minute=r['minute'], half=r['half'], trigger=r['trigger'], insight=r['insight'],
                               trigger_context=f"Replayed from the tagged events at {r['minute']}'", created_at=base + timedelta(seconds=i)))
        await db.commit()
    print(f"STORED {len(results)} insights for {opponent} {MATCH_ID}", flush=True)
    emit(f'live-replay-{MATCH_ID}.json', json.dumps({'model': ma.LIVE_MODEL, 'match_id': MATCH_ID, 'opponent': opponent, 'results': results}, indent=1, default=str))


asyncio.run(main())
