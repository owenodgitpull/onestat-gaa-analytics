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
from app.services.ai.report_extras import build_extras
from app.services.ai import jim_phases as J
from app.services.ai.phase_facts import SCORE_TYPES as _SCORE_TYPES, points_for as _points_for, when_label, period_bounds, PERIOD_WORDS
from app.utils.names import their_player_label
from app.services.ai.phase_facts import (
    GROUPS, MAX_TRUSTED_SECONDS, MIN_N, SCORE_TYPES, group_stats, normalise, order_key, possessions,
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
    "contests_won": (PHASES["contest"], "breaking balls we won (not one of the eight phases)"),
    "contests_lost": (PHASES["contest"], "breaking balls we lost — THEIR possession (not one of the eight phases)"),
    "all_ours": (PHASES["attack"], "all our tracked possessions"),
    "all_theirs": (PHASES["defence"], "all their tracked possessions"),
}

ORIGIN_TEXT = {
    "own_ko_kept": "our kickout, kept", "own_ko_lost": "our kickout, lost", "opp_ko_won": "their kickout, we won it",
    "opp_ko_kept": "their kickout, they kept it", "turnover_won": "turnover won", "turnover_won_forced": "forced turnover won",
    "turnover_lost": "turnover lost", "turnover_lost_unforced": "unforced error", "contest_won": "breaking ball won",
    "contest_lost": "breaking ball lost", "free_won": "free won",
}
def origin_text(origin: str, owner_is_own: bool) -> str:
    """The same origin read from the right side: the other team's unforced error is OUR turnover won."""
    if origin == "turnover_lost_unforced":
        return ("their unforced error (counted as a turnover we won)" if owner_is_own
                else "our unforced error (counted as a turnover we lost)")
    if origin == "turnover_lost":
        return "turnover we won" if owner_is_own else "turnover we lost"
    if origin == "turnover_won_forced":
        return "forced turnover we won" if owner_is_own else "forced turnover they won"
    if origin == "turnover_won":
        return "turnover we won" if owner_is_own else "turnover we lost"
    return ORIGIN_TEXT.get(origin, origin)


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
    if d.get("shots_over_two_minutes"):
        row["shots_after_over_two_minutes_not_in_median"] = d["shots_over_two_minutes"]
    return row


SCORECARD_ORDER = ["own_ko_kept", "own_ko_lost", "opp_ko_won", "opp_ko_kept", "turnovers_won", "turnovers_lost",
                   "contests_won", "contests_lost", "all_ours", "all_theirs"]
SCORECARD_NAME = {
    "own_ko_kept": "Our kickouts we kept", "own_ko_lost": "Our kickouts we lost (their ball)",
    "opp_ko_won": "Their kickouts we won", "opp_ko_kept": "Their kickouts they kept (their ball)",
    "turnovers_won": "Turnovers we won", "turnovers_lost": "Turnovers we lost (their ball)",
    "contests_won": "Breaking balls we won", "contests_lost": "Breaking balls we lost (their ball)",
    "all_ours": "All our tracked possessions", "all_theirs": "All their tracked possessions",
}


def _half_cell(r: dict) -> str:
    if not r or not r.get("possessions"):
        return "-"
    return f"{r['became_a_shot']}/{r['finished']} shots, {r['scored']} scored"


def scorecard_table(phases: dict) -> str:
    """One scannable table of what each way of getting the ball became. Every cell is copied from the rows already
    computed (never re-derived), so the report can paste it unchanged."""
    et = any(p.get("extra_time") for p in phases.values())   # extra-time column only when the match went to extra time
    lines = ["| Phase | Possessions | Finished | Became a shot | Scored | Points | 1st half | 2nd half |" + (" Extra time |" if et else ""),
             "|---|---|---|---|---|---|---|---|" + ("---|" if et else "")]
    for g in SCORECARD_ORDER:
        p = phases.get(g)
        if not p:
            continue
        m = p["match"]
        lines.append(f"| {SCORECARD_NAME[g]} | {m['possessions']} | {m['finished']} | {m['became_a_shot']} | "
                     f"{m['scored']} | {m['points']} | {_half_cell(p['first_half'])} | {_half_cell(p['second_half'])} |"
                     + (f" {_half_cell(p.get('extra_time') or {})} |" if et else ""))
    return "\n".join(lines)


def jim_rows(ps: list, cls: dict) -> list:
    """(phase, row name, possessions) in the order of Jim's eight phases. Rows are views of the same possessions, not a split:
    a turnover we won can also be a build-up, so never add rows across phases."""
    def by(g):
        return [p for p in ps if GROUPS[g](p)]
    return [
        (J.PHASE_NAMES["transition"], "Turnovers won, direct to their 45", cls["quick"]),
        (J.PHASE_NAMES["established"], "All our other possessions", cls["established"]),
        (J.PHASE_NAMES["kickouts"], "Ours we kept", by("own_ko_kept")),
        (J.PHASE_NAMES["kickouts"], "Ours we lost (their ball)", by("own_ko_lost")),
        (J.PHASE_NAMES["kickouts"], "Theirs we won", by("opp_ko_won")),
        (J.PHASE_NAMES["kickouts"], "Theirs they kept (their ball)", by("opp_ko_kept")),
        (J.PHASE_NAMES["turnovers"], "Won", by("turnovers_won")),
        (J.PHASE_NAMES["turnovers"], "Lost (their ball)", by("turnovers_lost")),
        (J.PHASE_NAMES["buildup"], "Won in our own third", cls["buildup"]),
        (J.PHASE_NAMES["buildup"], "... and crossed their 45", cls["buildup_crossed"]),
        (J.PHASE_NAMES["tracked"], "All ours", by("all_ours")),
        (J.PHASE_NAMES["tracked"], "All theirs", by("all_theirs")),
    ]


def jim_table(rows_: list, restarts_text: str) -> str:
    """The Phase Analysis table, in Jim's order. Same columns and computed cells as before; restarts (no possession chain)
    are the line under it."""
    et = any(p.half and p.half >= 3 for _, _, sel in rows_ for p in sel)
    lines = ["| Phase | Possessions | Finished | Became a shot | Scored | Points | Shot rate | Conversion | Pts / poss | 1st half | 2nd half |" + (" Extra time |" if et else ""),
             "|---|---|---|---|---|---|---|---|---|---|---|" + ("---|" if et else "")]

    def pct(num, den):
        # Plain facts only: the share, plus a bar the app draws from {bar:N}. No colour judgement. Under 5 = "-".
        if den < 5:
            return "-"
        v = round(100 * num / den)
        return f"{v}% {{{{bar:{v}}}}}"

    for phase, name, sel in rows_:
        if not sel:
            continue
        m = _stats_row(sel)
        h1 = _stats_row([p for p in sel if p.half == 1])
        h2 = _stats_row([p for p in sel if p.half == 2])
        e3 = _stats_row([p for p in sel if (p.half or 0) >= 3])
        fin = m["finished"]
        ppp = f"{m['points'] / fin:.2f}" if fin >= 5 else "-"
        lines.append(f"| {phase}: {name} | {m['possessions']} | {fin} | {m['became_a_shot']} | {m['scored']} | {m['points']} | "
                     f"{pct(m['became_a_shot'], fin)} | {pct(m['scored'], m['became_a_shot'])} | {ppp} | "
                     f"{_half_cell(h1)} | {_half_cell(h2)} |" + (f" {_half_cell(e3)} |" if et else ""))
    return "\n".join(lines) + (f"\n\n{restarts_text}" if restarts_text else "")


async def _restarts(db, match, rows) -> dict:
    """Throw-ins (video tagging: who won them) and sideline balls (match tags: whose throw it was), as tagged."""
    out = {"throw_ins": {"won_by_us": 0, "won_by_them": 0}, "sideline_balls": {"ours": 0, "theirs": 0}}
    try:
        from app.models.video_event import VideoEvent as VE
        for e in (await db.execute(select(VE).where(VE.match_id == match.id, VE.event_type == "THROW_IN"))).scalars().all():
            out["throw_ins"]["won_by_us" if e.team == "team_a" else "won_by_them"] += 1
    except Exception:
        pass
    for r_ in rows:
        et = getattr(r_, "event_type", None)
        et = et.value if hasattr(et, "value") else str(et)
        if et == "sideline_ball":
            tm = getattr(r_, "team", None)
            tm = tm.value if hasattr(tm, "value") else str(tm)
            out["sideline_balls"]["ours" if tm.lower() == "own" else "theirs"] += 1
    return out


def restarts_line(rs: dict) -> str:
    t, sb = rs["throw_ins"], rs["sideline_balls"]
    parts = []
    if t["won_by_us"] + t["won_by_them"]:
        parts.append(f"throw-ins: we won {t['won_by_us']}, they won {t['won_by_them']}")
    if sb["ours"] + sb["theirs"]:
        parts.append(f"sideline balls: ours {sb['ours']}, theirs {sb['theirs']}")
    return ("**Restarts** (counted as tagged, no possession chain follows them): " + "; ".join(parts) + ".") if parts else ""


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
        et_sel = [p for p in sel if (p.half or 0) >= 3]
        if et_sel:
            phases[g]["extra_time"] = _stats_row(et_sel)   # both periods of extra time together; first+second+extra = match

    # margin movement per 10-minute block, period by period (stoppage time stays in its own period's last block), with the
    # running score at the end of each block - the block's own scores and the running margin side by side were misread as one
    # ("4 points up (1-02 to 0-02)")
    hdm_b = getattr(match, "half_duration_mins", None) or 30
    blocks = []
    for h in (1, 2, 3, 4):
        he = [e for e in evs if (e.half or 1) == h]
        if not he:
            continue
        start, end = period_bounds(h, hdm_b)
        edge = start
        while edge < end:
            nxt = min(edge + 10, end)
            last = nxt == end
            inside = [e for e in he if (edge < e.minute <= nxt) or (last and e.minute > end) or (edge == start and e.minute <= start)]
            upto = [e for e in evs if (e.half or 1) < h or ((e.half or 1) == h and (e.minute <= nxt or last))]
            top = max([e.minute for e in inside] + [nxt]) if last else nxt
            blocks.append({"period": PERIOD_WORDS[h],
                           "minutes": f"{edge if any(e.minute <= edge for e in inside) else edge + 1}-{nxt}" + (f"+{top - end}" if top > end else ""),
                           "scored_in_block": {"us": tally(inside, True).line(), "them": tally(inside, False).line()},
                           "score_at_end_of_block": {"us": tally(upto, True).line(), "them": tally(upto, False).line()},
                           "margin_at_end": margin_phrase(margin(upto))})
            edge = nxt

    findings = top_findings(build_findings(evs, now, window=max(now, 5), possession_list=ps), limit=5)

    # Reconciliation, so the report never has to add things up itself: the score at the end of each half and how long
    # each half ran (first-half added time included), how many shots the phase counts cover, and where scores came from.
    halves = []
    for h in (1, 2, 3, 4):
        he = [e for e in evs if (e.half or 1) == h]
        if not he:
            continue
        up_to = [e for e in evs if (e.half or 1) <= h]
        won = margin(he)
        halves.append({
            "half": h, "period": PERIOD_WORDS[h],
            "this_period_won_by": ("us by " if won > 0 else "them by ") + f"{abs(won)} point{'s' if abs(won) != 1 else ''}" if won else "level (drawn period)",
            "played_minutes": max(e.minute for e in he) - period_bounds(h, hdm_b)[0],
            "score_at_end": {"us": tally(up_to, True).line(), "them": tally(up_to, False).line(),
                             "margin": margin_phrase(margin(up_to))},
            "scored_in_this_half": {"us": tally(he, True).line(), "them": tally(he, False).line()},
        })
    all_shots = us.shots + them.shots
    traced_shots = sum(1 for p in ps if p.shot)
    origins = {"ours": {}, "theirs": {}}
    for p in ps:
        if p.outcome != "score":
            continue
        side = origins["ours" if p.owner_is_own else "theirs"]
        row = side.setdefault(origin_text(p.origin, p.owner_is_own), {"scores": 0, "points": 0})
        row["scores"] += 1
        row["points"] += p.points

    hdm = getattr(match, "half_duration_mins", None) or 30
    _pids = {getattr(r, "player_id", None) for r, e in ((rows[x.idx], x) for x in evs) if e.type == "saved" or e.type in _SCORE_TYPES}
    _pids.discard(None)
    _full = {}
    if _pids:
        for pid, nm in (await db.execute(select(Player.id, Player.name).where(Player.id.in_(list(_pids))))).all():
            _full[pid] = (nm or "").strip()

    def _shooter(r):
        return _full.get(getattr(r, "player_id", None)) or their_player_label(
            getattr(r, "opponent_player_name", None), _full.values())

    # every score that levelled the match or changed who led: the moments a "how did it come back" story needs
    turning, m_run = [], 0
    for e in evs:
        if e.type not in _SCORE_TYPES:
            continue
        before = m_run
        m_run += _points_for(e.type) if e.own else -_points_for(e.type)
        if m_run == 0 or (before <= 0 < m_run) or (before >= 0 > m_run):
            turning.append({
                "when": when_label(e.half, e.minute, hdm),
                "team": "us" if e.own else "them", "score": e.type.replace("_", " "), "by": _shooter(rows[e.idx]),
                "what_it_did": "levelled it" if m_run == 0 else ("put us ahead" if m_run > 0 else "put them ahead"),
                "margin_after": margin_phrase(m_run)})

    extras = build_extras(rows, evs, getattr(match, "attacking_right_first_half", None), hdm,
                          getattr(match, "pitch_length_m", None), getattr(match, "pitch_width_m", None), _shooter)

    # what the scorecard does and does not cover, stated under the table
    n_long = sum(1 for p in ps if p.shot and p.seconds is not None and p.seconds > MAX_TRUSTED_SECONDS)
    our_traced = sum(1 for p in ps if p.shot and p.owner_is_own)
    their_traced = traced_shots - our_traced
    footnote = (f"*The phase counts cover {our_traced} of our {us.shots} shots and {their_traced} of their {them.shots} "
                f"(possessions the event order could trace). The possession chains elsewhere in the report are built from the tagged "
                f"carries instead, so their totals differ from this table."
                + (f" {n_long} shot{'s' if n_long != 1 else ''} followed a possession timed at over two minutes and "
                   f"{'is' if n_long == 1 else 'are'} left out of the median seconds." if n_long else "")
                + "*")
    cls = J.classify(rows, evs, ps, getattr(match, "attacking_right_first_half", None), hdm)
    jrows = jim_rows(ps, cls)
    rs = await _restarts(db, match, rows)
    scorecard_md = jim_table(jrows, restarts_line(rs)) + "\n\n" + footnote
    jim = {"phases": [{"phase": ph, "row": nm, **_stats_row(sel)} for ph, nm, sel in jrows if sel],
           "restarts": rs, "definitions": J.DEFINITIONS,
           "possessions_without_clock": cls["no_clock"]}

    return json.dumps({
        "how_to_read": ("Possessions are followed in event ORDER from the event that gave a team the ball until a score, a missed shot, "
                        "the ball lost, a foul or the half ending. Every origin is in its own denominator, so rates are honest; "
                        "possessions still open are excluded. Rates on fewer than 3 finished possessions carry a note — "
                        "describe those, never conclude from them. 'THEIR possession' groups are what the opposition made of the "
                        "ball we gave them. median_seconds_to_shot only appears where the match clock was recorded."),
        "final_score": {"us": us.line(), "them": them.line(), "margin": margin_phrase(margin(evs))},
        "halves": halves,
        "coverage": {
            "shots_logged": all_shots,
            "shots_inside_traced_possessions": traced_shots,
            "note": ("The phase counts only cover shots that sit inside a possession the event order could trace. "
                     "Quote the match totals from the score line and halves. The scorecard footnote already states this "
                     "coverage, so do not repeat it in the written analysis and never quote a coverage figure that adds both teams' shots together."),
        },
        "scores_by_origin": {
            **origins,
            "scores_traced": {
                "ours": {"in_this_list": sum(v["scores"] for v in origins["ours"].values()),
                         "scores_in_match": us.goals + us.point_scores},
                "theirs": {"in_this_list": sum(v["scores"] for v in origins["theirs"].values()),
                           "scores_in_match": them.goals + them.point_scores},
            },
            "note": ("Scores split by how the possession that produced them began, for both teams (traced possessions only). "
                     "scores_traced says how many of the match's scores this list covers - say so when it is fewer. A score from "
                     "'their unforced error' is also counted as a turnover we won in the phase table."),
        },
        "phases": phases,
        "scorecard_table_markdown": scorecard_md,
        "jim_eight_phases": jim,
        **extras,
        "margin_by_ten_minutes": blocks,
        "turning_scores": {"scores": turning, "note": "Every score that levelled the match or changed who led, in order. When the "
                           "margin moved and came back, name the score(s) that brought it back from here."},
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
            who = names.get(getattr(end, "player_id", None)) or their_player_label(
                getattr(end, "opponent_player_name", None), names.values())
        et = p.end_type or ""
        # the shot's own minute and half are the ones to quote (a possession can begin a minute earlier, before a substitute
        # came on, and second-half minutes start at the half length so 30'-34' exist in both halves)
        end_minute = getattr(end, "minute", None) if end is not None else p.minute
        end_half = (getattr(end, "half", None) if end is not None else None) or p.half
        out.append({
            "when": when_label(end_half, end_minute, getattr(match, "half_duration_mins", None)),
            "minute": end_minute, "half": end_half,
            "began_at_minute": p.minute,
            "possession": "ours" if p.owner_is_own else "theirs",
            "began": origin_text(p.origin, p.owner_is_own),
            "ended": ENDING_TEXT.get(p.outcome, p.outcome),
            "shot": et or None,
            "points": p.points,
            "by": who or None,
            **({"seconds": p.seconds} if p.seconds is not None else {}),
        })
    return json.dumps({"sequences": out, "count": len(out),
                       "note": "Shots only. Each row is one possession followed in event order; 'seconds' appears only where the clock was recorded."},
                      default=str)


async def get_season_phase_profile(db, club_id, last_n: int = 10, exclude_match_id=None) -> str:
    """Phase rates pooled over the club's most recent completed matches (possessions built per match, then pooled)."""
    last_n = max(1, min(int(last_n or 10), 30))
    q = select(Match).where(Match.club_id == club_id)
    if exclude_match_id:
        q = q.where(Match.id != exclude_match_id)
    matches = (await db.execute(q.order_by(Match.match_date.desc()).limit(last_n))).scalars().all()
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
        "scope": (f"the club's last {used} match{'es' if used != 1 else ''} with enough events logged"
                  + (", not counting this one" if exclude_match_id else "")),
        "how_to_read": ("These rates are the club's own average over its last matches (see scope). Same definitions as "
                        "get_phase_summary. Compare a single match's phase rates with them to say what was unusual for this team. "
                        "When you quote them say 'over our last N matches' with the real number - never 'the pool' or "
                        "'the recent pool'."),
        "phases": phases,
    }, default=str)
