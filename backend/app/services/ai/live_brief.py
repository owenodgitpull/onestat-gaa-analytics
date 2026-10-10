"""
Live tactical brief — the spatial + pattern + "last five minutes" picture handed to the live insight agent.

The old live snapshot was counts only (score, turnovers, kickout %, per-player errors), so the agent could not say
WHERE anything was happening. This builds a compact, deterministic brief from the tagged events, the possession log
and the ball-carry data. Everything is expressed in OUR attacking frame (we attack towards x = 100; "our left" is
y < 33), using the shared attack-direction helpers, so it is correct in both halves and for either direction.

No LLM is involved here: the numbers are computed, so the agent can quote them but cannot make them up.
"""
import json
import logging
from typing import Optional

from sqlalchemy import select, func

from app.models.match import Match
from app.models.man_marking_assignment import ManMarkingAssignment
from app.models.player import Player
from app.models.match_event import MatchEvent, Team
from app.models.possession_event import PossessionEvent
from app.utils.attack_direction import own_attacks_right, to_attack_frame
from app.services.ai.insight_findings import (
    Finding, PHASES, build_findings, early_read_note, margin, margin_phrase, tally, top_findings,
)
from app.services.ai.phase_facts import normalise, order_key, possessions, summarise
from app.utils.pitch_calibration import (
    along_m, lateral_m, distance_to_goal_m, arc_phrase, DEFAULT_LENGTH_M, DEFAULT_WIDTH_M,
)

logger = logging.getLogger(__name__)

PITCH_LEN_M = 145.0

SCORE_TYPES = {"goal", "point", "two_point", "point_free", "two_point_free", "forty_five", "penalty_goal"}
MISS_TYPES = {"wide", "wide_free", "short", "saved", "hit_post", "forty_five_missed", "penalty_miss"}
SHOT_TYPES = SCORE_TYPES | MISS_TYPES
TO_LOST_TYPES = {"turnover_lost", "unforced_error"}
TO_WON_TYPES = {"turnover_won", "interception", "tackle_won", "block"}
OWN_KO_RETAINED = {"own_kickout_won", "own_kickout_won_break"}
OWN_KO_LOST = {"own_kickout_opposition_won", "own_kickout_opposition_won_break", "own_kickout_sideline"}
OPP_KO_WON_BY_US = {"opp_kickout_won", "opp_kickout_won_break"}
OPP_KO_RETAINED = {"opp_kickout_opposition_won", "opp_kickout_opposition_won_break"}
FOUL_TYPES = {"foul_committed"}


def _t(e) -> str:
    return e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type)


def _is_own(e) -> bool:
    return (e.team.value if hasattr(e.team, "value") else str(e.team)).lower() == "own"


def _third(fx: float) -> str:
    return "our defensive third" if fx <= 31 else ("the middle third" if fx <= 69 else "the attacking third")


def _channel(fy: float) -> str:
    return "our left" if fy < 33 else ("our right" if fy > 67 else "the centre")


def _tally(items: list, key) -> str:
    out: dict[str, int] = {}
    for it in items:
        k = key(it)
        out[k] = out.get(k, 0) + 1
    return ", ".join(f"{n} {k}" for k, n in sorted(out.items(), key=lambda kv: -kv[1]))


LABELS = {
    "goal": "goal", "point": "point", "two_point": "two-pointer", "point_free": "free (point)", "two_point_free": "free (two-pointer)",
    "forty_five": "45 (scored)", "penalty_goal": "penalty goal", "wide": "wide", "wide_free": "free (wide)", "short": "short",
    "saved": "saved", "hit_post": "hit the post", "forty_five_missed": "45 (missed)", "penalty_miss": "penalty (missed)",
    "turnover_lost": "turnover lost", "unforced_error": "unforced error",
}


def _exact(fx: float, fy: float, goal: str, shot: bool = True,
           length_m: float = DEFAULT_LENGTH_M, width_m: float = DEFAULT_WIDTH_M) -> str:
    """Exact position in REAL metres (calibrated to the drawn marked lines — see utils/pitch_calibration.py).
    goal = 'their' (the goal WE attack) or 'our' (the goal we defend). Accurate to about 1-3m.
    'left/right' are as WE face the opposition goal."""
    toward_their = goal == "their"
    d = along_m((100.0 - fx) if toward_their else fx, length_m)
    lat = lateral_m(fy, width_m)
    side = "our left" if fy < 50.0 else "our right"
    centre = "on the centre line" if lat < 2.0 else f"{round(lat)}m {side} of centre"
    where = f"{round(d)}m from {'their' if toward_their else 'our'} goal line, {centre}"
    if not shot:  # turnovers / kickouts: just where on the pitch
        return where
    straight = distance_to_goal_m(fx, fy, toward_their, length_m, width_m)
    return f"{where} (about {round(straight)}m from goal, {arc_phrase(straight)})"


async def _previous_insight_minute(db, match_id, now: int) -> Optional[int]:
    """Minute of the most recent insight BEFORE this one (None for the first)."""
    try:
        from app.models.live_insight import LiveInsight
        row = (await db.execute(
            select(LiveInsight.minute).where(LiveInsight.match_id == match_id, LiveInsight.minute < now)
            .order_by(LiveInsight.minute.desc()).limit(1)
        )).first()
        return row[0] if row else None
    except Exception:
        return None


def _avg_actions(ce: dict) -> str:
    """'average 4.5 actions before a score vs 3.7 before a turnover' — but never a '0.0' from zero cases."""
    sc, tu = ce.get("scoring_chains", 0), ce.get("turnover_chains", 0)
    a = f"average {ce.get('avg_chain_length_scores')} actions before a score" if sc else "no scoring chains yet (not enough data for an average)"
    b = f"{ce.get('avg_chain_length_turnovers')} before a turnover" if tu else "no turnover chains yet"
    return f"{a}; {b}"


def _phase_lines(s: dict, window: int) -> str:
    """The seven phases as quotable facts: what each way of getting the ball turned into (event ORDER, n everywhere)."""
    def one(g: str) -> Optional[str]:
        d = s[g]["to_date"]
        if not d["n"]:
            return None
        w = s[g]["window"]
        txt = f"{d['n']} to date"
        if w["n"]:
            txt += f" ({w['n']} in the last {window} min)"
        if d["finished"] < 3:
            return txt + f" — only {d['finished']} finished: describe, do not conclude"
        txt += f": {d['shots']} became a shot ({d['scores']} a score, {d['points']} pts), {d['died']} ended without one"
        if d["open"]:
            txt += f"; {d['open']} still open"
        if d["median_seconds_to_shot"] is not None:
            txt += f"; median {d['median_seconds_to_shot']}s to the shot"
        return txt

    rows = [
        ("Own Kick-Out — kickouts we kept", "own_ko_kept"),
        ("Own Kick-Out — kickouts we lost (THEIR possession)", "own_ko_lost"),
        ("Opposition Kick-Out — we won it", "opp_ko_won"),
        ("Opposition Kick-Out — they kept it (THEIR possession)", "opp_ko_kept"),
        ("Transition to Attack — turnovers we won", "turnovers_won"),
        ("Transition to Defence — turnovers we lost (THEIR possession)", "turnovers_lost"),
        ("Possession/Attack — all our tracked possessions", "all_ours"),
        ("Defensive Phase — all their tracked possessions", "all_theirs"),
    ]
    lines = []
    for label, g in rows:
        t = one(g)
        if t:
            lines.append(f"  {label}: {t}")
    if not lines:
        return ""
    return ("PHASES (what each way of getting the ball became — counted from event ORDER, so no 'within N seconds' claims "
            "unless a median-seconds figure is shown; possessions still open are excluded from the rates):\n" + "\n".join(lines))


async def build_live_brief(db, match_id, minute: Optional[int] = None, club_id=None, window: int = 5) -> str:
    """Return the brief as plain text. Never raises — a failure just yields an empty brief."""
    try:
        return await _build(db, match_id, minute, club_id, window)
    except Exception as exc:  # the insight must still work without the brief
        logger.warning("live brief failed for %s: %s: %s", match_id, type(exc).__name__, exc)
        return ""


async def _build(db, match_id, minute, club_id, window) -> str:
    match = (await db.execute(select(Match).where(Match.id == match_id))).scalar_one_or_none()
    if match is None:
        return ""
    atk_first = getattr(match, "attacking_right_first_half", None)
    hdm = getattr(match, "half_duration_mins", None) or 30
    LEN = getattr(match, "pitch_length_m", None) or DEFAULT_LENGTH_M
    WID = getattr(match, "pitch_width_m", None) or DEFAULT_WIDTH_M

    events = (await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_id).order_by(MatchEvent.minute, MatchEvent.created_at)
    )).scalars().all()
    events = [e for e in events if e.minute is not None]
    if not events:
        return ""
    now = minute if minute is not None else max(e.minute for e in events)

    def framed(e, x=None, y=None):
        x = e.pitch_x if x is None else x
        y = e.pitch_y if y is None else y
        if x is None or y is None:
            return None
        return to_attack_frame(float(x), float(y), own_attacks_right(atk_first, getattr(e, "half", None), e.minute, hdm))

    # Half-aware: first-half added time (e.g. 34' of a 30-minute half) must not leak into a second-half window
    def ev_half(e) -> int:
        return getattr(e, "half", None) or (1 if e.minute <= hdm else 2)

    half_now = max([ev_half(e) for e in events if e.minute <= now] or [1])
    visible = [e for e in events if ev_half(e) < half_now or (ev_half(e) == half_now and e.minute <= now)]
    last = [e for e in visible if ev_half(e) == half_now and e.minute > now - window]

    def counts(evs):
        own = [e for e in evs if _is_own(e)]
        opp = [e for e in evs if not _is_own(e)]
        return {
            "own_scores": [e for e in own if _t(e) in SCORE_TYPES],
            "opp_scores": [e for e in opp if _t(e) in SCORE_TYPES],
            "own_wides": [e for e in own if _t(e) in MISS_TYPES],
            "to_lost": [e for e in own if _t(e) in TO_LOST_TYPES],
            # a turnover/error LOST by them is a turnover WON by us
            "to_won": [e for e in own if _t(e) in TO_WON_TYPES] + [e for e in opp if _t(e) in TO_LOST_TYPES],
            "ko_ret": [e for e in evs if _t(e) in OWN_KO_RETAINED],
            "ko_lost": [e for e in evs if _t(e) in OWN_KO_LOST],
            "their_ko_won": [e for e in evs if _t(e) in OPP_KO_WON_BY_US],
            "their_ko_ret": [e for e in evs if _t(e) in OPP_KO_RETAINED],
            "fouls": [e for e in evs if _t(e) in FOUL_TYPES and _is_own(e)],
        }

    def pts(evs):
        total = 0
        for e in evs:
            ty = _t(e)
            total += 3 if ty in ("goal", "penalty_goal") else 2 if ty in ("two_point", "two_point_free") else 1
        return total

    w = counts(last)
    a = counts(visible)

    to_go = (hdm - now) if half_now == 1 else (2 * hdm - now)
    if to_go >= 0:
        clock = f"{to_go} min to {'half time' if half_now == 1 else 'full time'}"
    else:
        clock = f"{-to_go} min of added time at the end of the {'first' if half_now == 1 else 'second'} half"

    L = []
    L.append(f"=== LIVE TACTICAL BRIEF — {now}' (half {half_now}, {clock}; a half is {hdm} min) ===")
    L.append("All locations below are in OUR attacking frame: we attack towards the far goal; 'our defensive third' is nearest our own goal; "
             "'our left/right' is as we face the opposition goal.")

    # ── computed findings: the few things that matter right now, ranked, with exact arithmetic ──
    try:
        ordered = normalise(sorted(visible, key=lambda e: order_key(e, hdm)), hdm)
        prev_minute = await _previous_insight_minute(db, match_id, now)
        recent_keys: set[str] = set()
        if prev_minute is not None:   # what the manager was last told = the top of the ranking one insight ago
            before_prev = [x for x in ordered if x.minute <= prev_minute]
            recent_keys = {f.key for f in top_findings(build_findings(before_prev, prev_minute, window))[:2]}
        poss = possessions(ordered)
        findings = build_findings(ordered, now, window, recent_keys, poss)
        top = top_findings(findings)

        us, them = tally(ordered, True), tally(ordered, False)
        L.append(f"\nSCORE NOW: us {us.line()} v them {them.line()} — {margin_phrase(margin(ordered))}. "
                 f"(A goal is 3 points; \"scores\" counts goals and points, \"pts\" is the points total.)")
        note = early_read_note(len(ordered), now)
        if note:
            L.append(note)
        if top:
            L.append("TOP SIGNALS (computed and ranked — lead with the first; quote these numbers exactly; do not repeat a theme "
                     "the manager has just been told unless it has moved):")
            for i, f in enumerate(top, 1):
                L.append(f"  {i}. [{PHASES.get(f.phase, f.phase)} · {f.direction}] {f.text}")
        else:
            L.append("TOP SIGNALS: nothing stands out yet on enough observations — say what is happening in plain terms, no conclusions.")
        if prev_minute is not None and prev_minute < now:
            since = [x for x in ordered if x.minute > prev_minute]
            s_us, s_them = tally(since, True), tally(since, False)
            before_m = margin([x for x in ordered if x.minute <= prev_minute])
            L.append(f"SINCE THE LAST INSIGHT ({prev_minute}'): us {s_us.line()}, them {s_them.line()}; margin moved from "
                     f"{margin_phrase(before_m)} to {margin_phrase(margin(ordered))}.")
        L.append(_phase_lines(summarise(poss, now, window), window))
    except Exception as exc:   # the brief must never fail because the engine did
        logger.warning("findings engine failed for %s: %s: %s", match_id, type(exc).__name__, exc)

    # ── the pre-match plan: manager's tactical notes + man-marking set up in Match Prep ──
    notes = (getattr(match, "tactical_notes", None) or "").strip()
    try:
        marks = (await db.execute(select(ManMarkingAssignment).where(ManMarkingAssignment.match_id == match_id))).scalars().all()
    except Exception:
        marks = []
    if notes or marks:
        L.append("\nPRE-MATCH PLAN (set up in Match Prep — judge whether it is working):")
        if notes:
            L.append("  Manager's notes: " + notes[:600].replace("\n", " "))
        for m_ in marks:
            who = getattr(getattr(m_, "player", None), "name", None) or "our player"
            opp_name = (m_.opponent_player_name or "").strip()
            key = opp_name.lower()
            theirs = [e for e in visible if not _is_own(e) and _t(e) in SHOT_TYPES
                      and key and key in (getattr(e, "opponent_player_name", None) or "").lower()]
            sc = [e for e in theirs if _t(e) in SCORE_TYPES]
            line = f"  {who} is marking {opp_name}" + (f" ({m_.notes.strip()})" if (m_.notes or "").strip() else "")
            if theirs:
                line += f" — {opp_name} has {len(sc)} score(s) ({pts(sc)} pts) from {len(theirs)} shot(s) so far"
            else:
                line += f" — no shots logged by {opp_name} yet (their scorers are only named when the name was entered)"
            L.append(line)

    # ── the last five minutes ─────────────────────────────────────────────
    L.append(f"\nLAST {window} MINUTES ({now - window + 1}'–{now}'):")
    L.append(f"  Scores: us {pts(w['own_scores'])} pts ({len(w['own_scores'])} scores), them {pts(w['opp_scores'])} pts ({len(w['opp_scores'])} scores)")
    L.append(f"  Turnovers: won {len(w['to_won'])}, lost {len(w['to_lost'])}; wides/misses by us {len(w['own_wides'])}; our fouls {len(w['fouls'])}")
    ko_n = len(w['ko_ret']) + len(w['ko_lost'])
    their_n = len(w['their_ko_won']) + len(w['their_ko_ret'])
    L.append(f"  Our kickouts retained {len(w['ko_ret'])}/{ko_n}; their kickouts won by us {len(w['their_ko_won'])}/{their_n}")
    if not last:
        L.append("  (nothing was logged in this window)")

    # ── where we lose the ball / win it ───────────────────────────────────
    lost_pos = [(e, framed(e)) for e in a["to_lost"]]
    lost_pos = [(e, f) for e, f in lost_pos if f]
    if lost_pos:
        L.append(f"\nWHERE WE LOSE THE BALL ({len(a['to_lost'])} turnovers/unforced errors, {len(lost_pos)} located): "
                 + _tally(lost_pos, lambda ef: f"in {_third(ef[1][0])} ({_channel(ef[1][1])})"))
        recent_lost = [(e, f) for e, f in lost_pos if e.minute > now - 10]
        if recent_lost:
            L.append("  last 10 min: " + _tally(recent_lost, lambda ef: f"in {_third(ef[1][0])} ({_channel(ef[1][1])})"))
    won_pos = [(e, framed(e)) for e in a["to_won"] if _is_own(e)]
    won_pos = [(e, f) for e, f in won_pos if f]
    if won_pos:
        L.append(f"WHERE WE WIN IT BACK ({len(a['to_won'])} turnovers won, {len(won_pos)} located): "
                 + _tally(won_pos, lambda ef: f"in {_third(ef[1][0])} ({_channel(ef[1][1])})"))

    # ── their scoring: where it comes from ────────────────────────────────
    opp_shots = [e for e in visible if not _is_own(e) and _t(e) in SHOT_TYPES]
    opp_sc = [e for e in opp_shots if _t(e) in SCORE_TYPES]
    if opp_sc:
        loc = []
        for e in opp_sc:
            f = framed(e)
            if f:
                loc.append((e, f))
        two = sum(1 for e in opp_sc if _t(e) in ("two_point", "two_point_free"))
        goals = sum(1 for e in opp_sc if _t(e) in ("goal", "penalty_goal"))
        free = sum(1 for e in opp_sc if _t(e).endswith("_free") or _t(e) == "forty_five")
        L.append(f"\nTHEIR SCORING ({len(opp_sc)} scores: {goals} goals, {two} two-pointers, {free} from frees/45s; {len(opp_shots) - len(opp_sc)} misses):")
        if loc:
            def _band(f):
                d = distance_to_goal_m(f[0], f[1], False, LEN, WID)
                return "inside 20m" if d < 20 else ("20-40m out" if d < 40 else "40m+ out")
            L.append("  shot position (distance from our goal): " + _tally(loc, lambda ef: f"{_band(ef[1])} on {_channel(ef[1][1])}"))

    # ── evidence-backed cause links (so the agent never has to guess a cause) ──
    if opp_sc:
        after_to = []
        after_ko = 0
        from_free = 0
        for sc_ev in opp_sc:
            if _t(sc_ev).endswith("_free") or _t(sc_ev) == "forty_five":
                from_free += 1
            prior_to = [t for t in a["to_lost"] if sc_ev.minute - 2 <= t.minute <= sc_ev.minute]
            if prior_to:
                f = framed(prior_to[-1])
                after_to.append(f"{_third(f[0])} ({_channel(f[1])})" if f else "location not logged")
            if any(k.minute >= sc_ev.minute - 2 and k.minute <= sc_ev.minute for k in a["ko_lost"]):
                after_ko += 1
        L.append(f"\nLINKS BEHIND THEIR {len(opp_sc)} SCORES: {len(after_to)} came within 2 min of one of our turnovers/errors"
                 + (f" (lost {', '.join(after_to)})" if after_to else "")
                 + f"; {after_ko} within 2 min of a kickout we lost; {from_free} were frees/45s")

    # ── our shooting ──────────────────────────────────────────────────────
    own_shots = [e for e in visible if _is_own(e) and _t(e) in SHOT_TYPES]
    if own_shots:
        sc = [e for e in own_shots if _t(e) in SCORE_TYPES]
        dists = []
        for e in own_shots:
            f = framed(e)
            if f:
                dists.append((distance_to_goal_m(f[0], f[1], True, LEN, WID), f, e))
        two_att = sum(1 for e in own_shots if _t(e) in ("two_point", "two_point_free"))
        L.append(f"\nOUR SHOOTING ({len(own_shots)} shots: {len(sc)} scores, {len(own_shots) - len(sc)} misses; {two_att} two-pointers scored):")
        if dists:
            avg = sum(d for d, _, _ in dists) / len(dists)
            inside20 = sum(1 for d, _, _ in dists if d < 20)
            outside40 = sum(1 for d, _, _ in dists if d >= 40)
            L.append(f"  average shot ~{int(avg)}m from goal; {inside20} inside 20m, {outside40} from 40m+")
            misses = [(d, f, e) for d, f, e in dists if _t(e) in MISS_TYPES]
            if misses:
                L.append("  misses came from: " + _tally(misses, lambda x: f"{_channel(x[1][1])} ~{int(x[0])}m out"))

    # ── kickouts ─────────────────────────────────────────────────────────
    own_ko = [e for e in visible if _t(e) in OWN_KO_RETAINED | OWN_KO_LOST]
    if own_ko:
        def ko_len(e):
            f = framed(e)
            if not f:
                return None
            return "short (our defensive third)" if f[0] <= 31 else ("medium (to midfield)" if f[0] <= 50 else "long (past midfield)")
        buckets: dict[str, list] = {}
        for e in own_ko:
            b = ko_len(e)
            if b:
                buckets.setdefault(b, []).append(e)
        if buckets:
            parts = []
            for b, es in buckets.items():
                kept = sum(1 for e in es if _t(e) in OWN_KO_RETAINED)
                parts.append(f"{b}: {kept}/{len(es)} kept")
            L.append(f"\nOUR KICKOUTS ({len(own_ko)}): " + "; ".join(parts))
            chan: dict[str, list] = {}
            for e in own_ko:
                f = framed(e)
                if f:
                    chan.setdefault(_channel(f[1]), []).append(e)
            if chan:
                L.append("  by channel: " + "; ".join(f"{c}: {sum(1 for e in es if _t(e) in OWN_KO_RETAINED)}/{len(es)} kept" for c, es in chan.items()))
    their_ko = [e for e in visible if _t(e) in OPP_KO_WON_BY_US | OPP_KO_RETAINED]
    if their_ko:
        by: dict[str, list] = {}
        for e in their_ko:
            f = framed(e)
            if f:
                by.setdefault(_third(f[0]), []).append(e)
        if by:
            L.append(f"THEIR KICKOUTS ({len(their_ko)}): landing " + "; ".join(
                f"{k}: we won {sum(1 for e in es if _t(e) in OPP_KO_WON_BY_US)}/{len(es)}" for k, es in by.items()))

    # ── discipline by area ───────────────────────────────────────────────
    fouls = [(e, framed(e)) for e in a["fouls"]]
    fouls = [(e, f) for e, f in fouls if f]
    if fouls:
        L.append(f"\nOUR FOULS ({len(a['fouls'])}): " + _tally(fouls, lambda ef: f"in {_third(ef[1][0])}")
                 + (" — frees conceded in our defensive third are shots at our goal" if any(f[0] <= 31 for _, f in fouls) else ""))

    # ── exact positions of the key events (the numbers behind the patterns above) ──
    ids = {e.player_id for e in visible if getattr(e, "player_id", None)}
    names = {}
    if ids:
        for pid, pname in (await db.execute(select(Player.id, Player.name).where(Player.id.in_(list(ids))))).all():
            names[pid] = (pname or "").strip().split(" ")[-1]

    def who(e):
        if getattr(e, "player_id", None) and names.get(e.player_id):
            return names[e.player_id]
        return (getattr(e, "opponent_player_name", None) or "").strip()

    def row(e, goal):
        f = framed(e)
        if not f:
            return None
        nm = who(e)
        end = ""
        if _t(e) in ("short", "saved", "hit_post") and getattr(e, "end_x", None) is not None and getattr(e, "end_y", None) is not None:
            g = framed(e, e.end_x, e.end_y)
            if g:
                end = f" — ball ended up {_exact(g[0], g[1], goal, False, LEN, WID)}"
        return f"  {e.minute}' {'we' if _is_own(e) else 'they'} — {LABELS.get(_t(e), _t(e))}{' by ' + nm if nm else ''}: {_exact(f[0], f[1], goal, True, LEN, WID)}{end}"

    # ── who has scored (match to date) — names come from the data, so the agent never has to guess one ──
    def _scorer_line(own_side: bool) -> Optional[str]:
        tallies: dict[str, list[int]] = {}
        for e in visible:
            if _is_own(e) != own_side or _t(e) not in SCORE_TYPES:
                continue
            nm = who(e) or "unnamed"
            g, p = tallies.setdefault(nm, [0, 0])
            if _t(e) in ("goal", "penalty_goal"):
                tallies[nm][0] += 1
            else:
                tallies[nm][1] += 2 if _t(e) in ("two_point", "two_point_free") else 1
        if not tallies:
            return None
        parts = []
        for nm, (g, p) in sorted(tallies.items(), key=lambda kv: -(kv[1][0] * 3 + kv[1][1])):
            parts.append(f"{nm} {g}-{p:02d} ({g * 3 + p})")
        return ", ".join(parts)

    for side, lbl in ((True, "OUR SCORERS"), (False, "THEIR SCORERS")):
        ln = _scorer_line(side)
        if ln:
            L.append(f"\n{lbl} (match to date, goals-points and total points): {ln}")

    shots_detail = [e for e in visible if _t(e) in SHOT_TYPES][-14:]
    rows = [row(e, "their" if _is_own(e) else "our") for e in shots_detail]
    rows = [x for x in rows if x]
    if rows:
        L.append("\nEXACT POSITIONS — SHOTS AND SCORES (most recent 14; metres, accurate to ~1-3m):")
        L.extend(rows)
    lost_detail = [e for e in a["to_lost"] if e.minute > now - 10]
    rows = []
    for e in lost_detail:
        f = framed(e)
        if f:
            nm = who(e)
            rows.append(f"  {e.minute}' {LABELS.get(_t(e), _t(e))}{' by ' + nm if nm else ''}: {_exact(f[0], f[1], 'our', False, LEN, WID)}")
    if rows:
        L.append("EXACT POSITIONS — OUR TURNOVERS/ERRORS IN THE LAST 10 MINUTES (distance is from OUR goal line):")
        L.extend(rows)
    ko_detail = [e for e in own_ko if e.minute > now - 10] if own_ko else []
    rows = []
    for e in ko_detail:
        f = framed(e)
        if f:
            rows.append(f"  {e.minute}' our kickout {'kept' if _t(e) in OWN_KO_RETAINED else 'lost'}: landed {_exact(f[0], f[1], 'our', False, LEN, WID)}")
    if rows:
        L.append("EXACT POSITIONS — OUR KICKOUTS IN THE LAST 10 MINUTES:")
        L.extend(rows)

    # ── possession & ball movement ───────────────────────────────────────
    try:
        rows = (await db.execute(
            select(PossessionEvent.team, func.coalesce(func.sum(PossessionEvent.duration_seconds), 0))
            .where(PossessionEvent.match_id == match_id, PossessionEvent.minute <= now).group_by(PossessionEvent.team)
        )).all()
        secs = {t: s for t, s in rows}
        tot = (secs.get("own", 0) or 0) + (secs.get("opponent", 0) or 0)
        if tot > 0:
            L.append(f"\nPOSSESSION (timed): us {round(100 * (secs.get('own', 0) or 0) / tot)}% / them {round(100 * (secs.get('opponent', 0) or 0) / tot)}%")
    except Exception:
        pass
    # ── how THEY move the ball (ball-path derived, every match) ──
    try:
        from app.services.ai.opposition_movement import opposition_ball_path
        whole = await opposition_ball_path(db, match_id, length_m=LEN, up_to_minute=now)
        if whole:
            def _ob_line(tag: str, d: dict) -> str:
                via = d.get("entered_our_third_via") or {}
                started = d.get("started_in") or {}
                s = (f"  {tag}: {d['possessions']} possessions, avg {d['avg_seconds']}s (median {d['median_seconds']}s; "
                     f"{d['short_10s_or_less']} of 10s or less, {d['sustained_over_30s']} over 30s)")
                if started:
                    s += "; won/started in " + ", ".join(f"{k} {v}" for k, v in started.items())
                s += f"; worked it into our defensive third {d['built_into_our_defensive_third']}x"
                if via:
                    s += " (via " + ", ".join(f"{k} {v}" for k, v in via.items()) + ")"
                return s
            L.append("\nTHEIR BALL MOVEMENT (from the ball path — no players or passes tracked):")
            L.append(_ob_line("match to date", whole))
            recent = await opposition_ball_path(db, match_id, length_m=LEN, up_to_minute=now, since_minute=now - window)
            if recent:
                L.append(_ob_line(f"last {window} min", recent))
    except Exception:
        pass
    try:
        from app.services.ai._shared import get_ball_carrier_data
        raw = await get_ball_carrier_data(db, match_id=str(match_id), club_id=club_id)
        bc = json.loads(raw)
        tempo = bc.get("tempo") or {}
        ce = bc.get("chain_effectiveness") or {}
        if ce.get("total_chains"):
            L.append(f"BALL MOVEMENT (carry tracking, {bc.get('data_confidence', '?')} confidence): {ce.get('total_chains')} possession chains — "
                     f"{ce.get('scoring_chains', 0)} ended in a score, {ce.get('turnover_chains', 0)} in a turnover, {ce.get('wide_chains', 0)} in a wide; "
                     f"{_avg_actions(ce)}; "
                     f"{ce.get('direct_scores', 0)} direct scores vs {ce.get('buildup_scores', 0)} build-up scores; "
                     f"{max(0, ce.get('total_chains', 0) - ce.get('scoring_chains', 0) - ce.get('turnover_chains', 0) - ce.get('wide_chains', 0))} "
                     f"open or unclassified")
        if tempo.get("avg_transition_seconds") is not None:
            L.append(f"  transition speed: {tempo.get('avg_transition_seconds')}s average to move the ball on (fastest {tempo.get('fastest_transition_seconds')}s)")
        opp = bc.get("opposition") or {}
        oce = opp.get("chain_effectiveness") or {}
        if oce.get("total_chains"):
            L.append(f"THEIR BALL MOVEMENT (carry tracking, {opp.get('data_confidence', '?')} confidence): {oce.get('total_chains')} possession chains — "
                     f"{oce.get('scoring_chains', 0)} ended in a score, {oce.get('turnover_chains', 0)} in a turnover, {oce.get('wide_chains', 0)} in a wide; "
                     f"average {oce.get('avg_chain_length_all', '?')} carries per chain; {oce.get('direct_scores', 0)} direct scores vs {oce.get('buildup_scores', 0)} build-up scores")
            otempo = opp.get("tempo") or {}
            if otempo.get("avg_transition_seconds") is not None:
                L.append(f"  their transition speed: {otempo.get('avg_transition_seconds')}s average to move the ball on")
    except Exception:
        pass

    return "\n".join(L)
