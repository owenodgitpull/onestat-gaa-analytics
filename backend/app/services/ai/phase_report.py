"""
Phase tools for the post-match report and the season agent — the SAME computed facts the live brief uses
(phase_facts + insight_findings), served as tool results so every agent reasons from one engine.

  get_phase_summary(match_id)            what each way of getting the ball became, by half, plus the ranked findings
  get_phase_sequences(match_id, phase)   the actual possessions behind it (origin -> ending, minute, player)
  get_season_phase_profile(last_n)       the same phase rates pooled across the club's recent matches

Pure maths lives in phase_facts / insight_findings; this module only loads rows and shapes JSON. Read-only, scoped to
the club, nothing is cached or written.
"""
import json
import logging
from typing import Optional

from sqlalchemy import select

from app.models.match import Match
from app.models.match_event import MatchEvent
from app.models.player import Player
from app.services.ai.insight_findings import (
    PHASES, build_findings, margin, margin_phrase, tally, top_findings,
)
from app.services.ai.phase_facts import (
    GROUPS, MIN_N, SCORE_TYPES, group_stats, normalise, order_key, possessions,
)

logger = logging.getLogger(__name__)

# group -> (phase name, how to read it)
GROUP_LABELS = {
    "own_ko_kept": (PHASES["own_ko"], "our kickouts we kept"),
    "own_ko_lost": (PHASES["own_ko"], "our kickouts we lost — THEIR possession"),
    "opp_ko_won": (PHASES["opp_ko"], "their kickouts we won"),
    "opp_ko_kept": (PHASES["opp_ko"], "their kickouts they kept — THEIR possession"),
    "turnovers_won": (PHASES["trans_att"], "turnovers we won"),
    "turnovers_lost": (PHASES["trans_def"], "turnovers we lost — THEIR possession"),
    "contests_won": (PHASES["contest"], "breaking balls we won"),
    "contests_lost": (PHASES["contest"], "breaking balls we lost — THEIR possession"),
    "all_ours": (PHASES["attack"], "all our tracked possessions"),
    "all_theirs": (PHASES["defence"], "all their tracked possessions"),
}

ORIGIN_TEXT = {
    "own_ko_kept": "our kickout, kept", "own_ko_lost": "our kickout, lost", "opp_ko_won": "their kickout, we won it",
    "opp_ko_kept": "their kickout, they kept it", "turnover_won": "turnover won", "turnover_won_forced": "forced turnover won",
    "turnover_lost": "turnover lost", "turnover_lost_unforced": "unforced error", "contest_won": "breaking ball won",
    "contest_lost": "breaking ball lost", "free_won": "free won",
}
ENDING_TEXT = {"score": "ended in a score", "miss": "ended in a shot that missed", "lost": "was lost without a shot",
               "foul": "ended in a foul", "half_end": "ran to the end of the half", "open": "was still open at the end",
               "unknown": "ended unclear"}


def _stats_row(ps: list) -> dict:
    d = group_stats(ps)
    row = {"possessions": d["n"], "finished": d["finished"], "became_a_shot": d["shots"], "scored": d["scores"],
           "points": d["points"], "ended_without_a_shot": d["died"], "still_open": d["open"]}
    if d["finished"] >= MIN_N:
        row["shot_rate_pct"] = d["shot_rate"]
        row["score_rate_pct"] = d["score_rate"]
    else:
        row["note"] = f"only {d['finished']} finished — describe, do not conclude"
    if d["median_seconds_to_shot"] is not None:
        row["median_seconds_to_shot"] = d["median_seconds_to_shot"]
    return row


async def _load(db, match_id, club_id):
    """(match, ordered source rows, normalised events) or None when the match is not this club's."""
    q = select(Match).where(Match.id == match_id)
    if club_id is not None:
        q = q.where(Match.club_id == club_id)
    match = (await db.execute(q)).scalar_one_or_none()
    if match is None:
        return None
    rows = (await db.execute(select(MatchEvent).where(MatchEvent.match_id == match.id))).scalars().all()
    hdm = getattr(match, "half_duration_mins", None) or 30
    rows = sorted([r for r in rows if r.minute is not None], key=lambda r: order_key(r, hdm))
    return match, rows, normalise(rows, hdm)


async def get_phase_summary(db, match_id: str, club_id=None) -> str:
    loaded = await _load(db, match_id, club_id)
    if loaded is None:
        return json.dumps({"error": "match not found"})
    match, rows, evs = loaded
    if not evs:
        return json.dumps({"phases": {}, "note": "no events recorded"})
    ps = possessions(evs)
    now = max(e.minute for e in evs)
    us, them = tally(evs, True), tally(evs, False)

    phases = {}
    for g, pred in GROUPS.items():
        if g not in GROUP_LABELS:
            continue
        sel = [p for p in ps if pred(p)]
        if not sel:
            continue
        name, meaning = GROUP_LABELS[g]
        phases[g] = {"phase": name, "meaning": meaning, "match": _stats_row(sel),
                     "first_half": _stats_row([p for p in sel if p.half == 1]),
                     "second_half": _stats_row([p for p in sel if p.half == 2])}

    # margin movement per 10-minute block (computed so the report never has to add scores up itself)
    blocks = []
    edge = 0
    while edge < now:
        nxt = edge + 10
        inside = [e for e in evs if edge < e.minute <= nxt]
        if inside:
            blocks.append({"minutes": f"{edge + 1}-{min(nxt, now)}", "us": tally(inside, True).line(),
                           "them": tally(inside, False).line(),
                           "margin_at_end": margin_phrase(margin([e for e in evs if e.minute <= nxt]))})
        edge = nxt

    findings = top_findings(build_findings(evs, now, window=max(now, 5), possession_list=ps), limit=5)
    return json.dumps({
        "how_to_read": ("Possessions are followed in event ORDER from the event that gave a team the ball until a score, a missed shot, "
                        "the ball lost, a foul or the half ending. Every origin is in its own denominator, so rates are honest; "
                        "possessions still open are excluded. Rates on fewer than 3 finished possessions carry a note — "
                        "describe those, never conclude from them. 'THEIR possession' groups are what the opposition made of the "
                        "ball we gave them. median_seconds_to_shot only appears where the match clock was recorded."),
        "final_score": {"us": us.line(), "them": them.line(), "margin": margin_phrase(margin(evs))},
        "phases": phases,
        "margin_by_ten_minutes": blocks,
        "ranked_findings": [{"theme": f.theme, "phase": PHASES.get(f.phase, f.phase), "text": f.text, "n": f.n,
                             "direction": f.direction} for f in findings],
    }, default=str)


async def get_phase_sequences(db, match_id: str, club_id=None, phase: Optional[str] = None, limit: int = 12) -> str:
    """The possessions behind the rates: only those that ended in a shot (score or miss), newest last."""
    loaded = await _load(db, match_id, club_id)
    if loaded is None:
        return json.dumps({"error": "match not found"})
    match, rows, evs = loaded
    ps = [p for p in possessions(evs) if p.shot]
    if phase and phase in GROUPS:
        ps = [p for p in ps if GROUPS[phase](p)]
    limit = max(1, min(int(limit or 12), 30))
    ps = ps[-limit:] if len(ps) > limit else ps

    pids = {rows[p.end_idx].player_id for p in ps if p.end_idx >= 0 and getattr(rows[p.end_idx], "player_id", None)}
    names = {}
    if pids:
        for pid, nm in (await db.execute(select(Player.id, Player.name).where(Player.id.in_(list(pids))))).all():
            names[pid] = (nm or "").strip().split(" ")[-1]

    out = []
    for p in ps:
        end = rows[p.end_idx] if p.end_idx >= 0 else None
        who = ""
        if end is not None:
            who = names.get(getattr(end, "player_id", None)) or (getattr(end, "opponent_player_name", None) or "").strip()
        et = p.end_type or ""
        out.append({
            "minute": p.minute, "half": p.half,
            "possession": "ours" if p.owner_is_own else "theirs",
            "began": ORIGIN_TEXT.get(p.origin, p.origin),
            "ended": ENDING_TEXT.get(p.outcome, p.outcome),
            "shot": et or None,
            "points": p.points,
            "by": who or None,
            **({"seconds": p.seconds} if p.seconds is not None else {}),
        })
    return json.dumps({"sequences": out, "count": len(out),
                       "note": "Shots only. Each row is one possession followed in event order; 'seconds' appears only where the clock was recorded."},
                      default=str)


async def get_season_phase_profile(db, club_id, last_n: int = 10) -> str:
    """Phase rates pooled over the club's most recent completed matches (possessions built per match, then pooled)."""
    last_n = max(1, min(int(last_n or 10), 30))
    matches = (await db.execute(
        select(Match).where(Match.club_id == club_id).order_by(Match.match_date.desc()).limit(last_n)
    )).scalars().all()
    if not matches:
        return json.dumps({"error": "no matches"})
    ids = [m.id for m in matches]
    all_rows = (await db.execute(select(MatchEvent).where(MatchEvent.match_id.in_(ids)))).scalars().all()
    by_match: dict = {}
    for r in all_rows:
        if r.minute is not None:
            by_match.setdefault(r.match_id, []).append(r)

    pooled: list = []
    used = 0
    for m in matches:
        rows = by_match.get(m.id)
        if not rows or len(rows) < 20:      # a match with almost nothing logged adds noise, not signal
            continue
        hdm = getattr(m, "half_duration_mins", None) or 30
        pooled.extend(possessions(normalise(sorted(rows, key=lambda r: order_key(r, hdm)), hdm)))
        used += 1
    if not used:
        return json.dumps({"error": "no matches with enough events"})
    phases = {}
    for g, pred in GROUPS.items():
        if g not in GROUP_LABELS:
            continue
        sel = [p for p in pooled if pred(p)]
        if sel:
            name, meaning = GROUP_LABELS[g]
            phases[g] = {"phase": name, "meaning": meaning, **_stats_row(sel)}
    return json.dumps({
        "matches_used": used,
        "how_to_read": ("Pooled over the club's most recent matches with enough events logged. Same definitions as get_phase_summary. "
                        "Compare a single match's phase rates with these to say what was unusual for this team."),
        "phases": phases,
    }, default=str)
