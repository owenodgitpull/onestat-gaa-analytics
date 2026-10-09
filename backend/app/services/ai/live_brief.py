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
from app.models.match_event import MatchEvent, Team
from app.models.possession_event import PossessionEvent
from app.utils.attack_direction import own_attacks_right, to_attack_frame

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

    visible = [e for e in events if e.minute <= now]
    last = [e for e in visible if e.minute > now - window]

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

    # The half comes from the logged events (stoppage time still belongs to the half it was played in)
    logged_halves = [e.half for e in visible if getattr(e, "half", None)]
    half_now = max(logged_halves) if logged_halves else (1 if now <= hdm else 2)
    to_go = (hdm - now) if half_now == 1 else (2 * hdm - now)
    if to_go >= 0:
        clock = f"{to_go} min to {'half time' if half_now == 1 else 'full time'}"
    else:
        clock = f"{-to_go} min of added time at the end of the {'first' if half_now == 1 else 'second'} half"

    L = []
    L.append(f"=== LIVE TACTICAL BRIEF — {now}' (half {half_now}, {clock}; a half is {hdm} min) ===")
    L.append("All locations below are in OUR attacking frame: we attack towards the far goal; 'our defensive third' is nearest our own goal; "
             "'our left/right' is as we face the opposition goal.")

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
            def _band(fx):
                d = fx * PITCH_LEN_M / 100
                return "inside 20m" if d < 20 else ("20-40m out" if d < 40 else "40m+ out")
            L.append("  shot position (distance from our goal): " + _tally(loc, lambda ef: f"{_band(ef[1][0])} on {_channel(ef[1][1])}"))

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
                dists.append(((100 - f[0]) * PITCH_LEN_M / 100, f, e))
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
    try:
        from app.services.ai._shared import get_ball_carrier_data
        raw = await get_ball_carrier_data(db, match_id=str(match_id), club_id=club_id)
        bc = json.loads(raw)
        tempo = bc.get("tempo") or {}
        ce = bc.get("chain_effectiveness") or {}
        if ce.get("total_chains"):
            L.append(f"BALL MOVEMENT (carry tracking, {bc.get('data_confidence', '?')} confidence): {ce.get('total_chains')} possession chains — "
                     f"{ce.get('scoring_chains', 0)} ended in a score, {ce.get('turnover_chains', 0)} in a turnover, {ce.get('wide_chains', 0)} in a wide; "
                     f"average {ce.get('avg_chain_length_scores', '?')} actions before a score vs {ce.get('avg_chain_length_turnovers', '?')} before a turnover; "
                     f"{ce.get('direct_scores', 0)} direct scores vs {ce.get('buildup_scores', 0)} build-up scores")
        if tempo.get("avg_transition_seconds") is not None:
            L.append(f"  transition speed: {tempo.get('avg_transition_seconds')}s average to move the ball on (fastest {tempo.get('fastest_transition_seconds')}s)")
    except Exception:
        pass

    return "\n".join(L)
