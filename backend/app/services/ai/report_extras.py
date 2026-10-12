"""
Report extras — four more computed facts for the post-match report, so the agent reads the game from numbers
instead of guessing. Pure functions over the ordered source rows + normalised events; no DB, no LLM.

  kickouts_by_half   our kickouts by half: how long (landing third) and which channel kept the ball
  scores_by_game_state   scores for / against while we were behind, level or ahead
  frees              frees we conceded, how many were a free shot for them next, and how many were scored
  our_shots_by_range  our shots by distance from goal (inside 20m / 20-40m / 40m+): attempts, scores, points

Everything spatial is in OUR attacking frame (utils/attack_direction.py) and distances use the calibrated pitch lines.
"""
from typing import Optional

from app.services.ai.phase_facts import (
    FOUL_AGAINST_OWNER, KICKOUTS, MIN_N, OPP_KO_WON, OWN_KO_KEPT, OWN_KO_LOST, SCORE_TYPES, SHOT_TYPES, points_for,
)
from app.utils.attack_direction import own_attacks_right, to_attack_frame
from app.utils.pitch_calibration import DEFAULT_LENGTH_M, DEFAULT_WIDTH_M, distance_to_goal_m

FREE_SHOTS = {"point_free", "two_point_free", "wide_free", "forty_five", "forty_five_missed", "penalty_goal", "penalty_miss"}
FREE_SCORES = {"point_free", "two_point_free", "forty_five", "penalty_goal"}


def _framed(row, half, atk_first, hdm) -> Optional[tuple[float, float]]:
    x, y = getattr(row, "pitch_x", None), getattr(row, "pitch_y", None)
    if x is None or y is None:
        return None
    return to_attack_frame(float(x), float(y), own_attacks_right(atk_first, half, getattr(row, "minute", None), hdm))


def _length(fx: float) -> str:
    return "short, into our defensive third" if fx <= 31 else ("medium, to midfield" if fx <= 50 else "long, past midfield")


def _channel(fy: float) -> str:
    return "our left" if fy < 33 else ("our right" if fy > 67 else "the centre")


def _kept_line(kept: int, n: int) -> dict:
    d = {"kept": kept, "of": n}
    if n < MIN_N:
        d["note"] = f"only {n} - describe, do not conclude"
    return d


def kickouts_by_half(rows: list, evs: list, atk_first, hdm) -> dict:
    out = {}
    for h in (1, 2):
        own = [(rows[e.idx], e) for e in evs if e.half == h and (e.type in OWN_KO_KEPT or e.type in OWN_KO_LOST)]
        theirs = [e for e in evs if e.half == h and e.type in KICKOUTS and e.type not in OWN_KO_KEPT and e.type not in OWN_KO_LOST]
        if not own and not theirs:
            continue
        entry: dict = {}
        if own:
            kept = sum(1 for _, e in own if e.type in OWN_KO_KEPT)
            entry["our_kickouts"] = _kept_line(kept, len(own))
            by_len: dict[str, list] = {}
            by_ch: dict[str, list] = {}
            for row, e in own:
                f = _framed(row, h, atk_first, hdm)
                if not f:
                    continue
                by_len.setdefault(_length(f[0]), []).append(e)
                by_ch.setdefault(_channel(f[1]), []).append(e)
            if by_len:
                entry["by_length"] = {k: _kept_line(sum(1 for e in v if e.type in OWN_KO_KEPT), len(v)) for k, v in by_len.items()}
            if by_ch:
                entry["by_channel"] = {k: _kept_line(sum(1 for e in v if e.type in OWN_KO_KEPT), len(v)) for k, v in by_ch.items()}
        if theirs:
            entry["their_kickouts"] = {"won_by_us": sum(1 for e in theirs if e.type in OPP_KO_WON), "of": len(theirs)}
        out[f"half_{h}"] = entry
    return out


def scores_by_game_state(evs: list) -> dict:
    """Each score is put in the state we were in just BEFORE it: behind, level or ahead."""
    ours = {"while_behind": [0, 0], "while_level": [0, 0], "while_ahead": [0, 0]}
    theirs = {"while_behind": [0, 0], "while_level": [0, 0], "while_ahead": [0, 0]}
    m = 0   # our points minus theirs
    for e in evs:
        if e.type not in SCORE_TYPES:
            continue
        state = "while_behind" if m < 0 else ("while_ahead" if m > 0 else "while_level")
        pts = points_for(e.type)
        bucket = (ours if e.own else theirs)[state]
        bucket[0] += 1
        bucket[1] += pts
        m += pts if e.own else -pts
    fmt = lambda d: {k: {"scores": v[0], "points": v[1]} for k, v in d.items()}
    return {
        "our_scores": fmt(ours), "their_scores": fmt(theirs),
        "note": "State is our margin just before each score (behind / level / ahead from OUR side). "
                "A team protecting or chasing a lead changes how it plays - describe that, do not call it a trend.",
    }


def frees(rows: list, evs: list, atk_first, hdm) -> dict:
    """Frees we conceded and whether the very next events were a free shot for them (adjacent in order, not proven cause)."""
    conceded = [(i, e) for i, e in enumerate(evs) if e.own and e.type in FOUL_AGAINST_OWNER]
    linked_shot = linked_score = in_def_third = def_third_linked = 0
    for i, e in conceded:
        f = _framed(rows[e.idx], e.half, atk_first, hdm)
        in_third = bool(f and f[0] <= 31)
        in_def_third += 1 if in_third else 0
        nxt = [x for x in evs[i + 1:i + 4] if x.half == e.half]
        shot = next((x for x in nxt if (not x.own) and x.type in FREE_SHOTS), None)
        if shot is not None:
            linked_shot += 1
            def_third_linked += 1 if in_third else 0
            if shot.type in FREE_SCORES:
                linked_score += 1
    their_free_shots = [e for e in evs if (not e.own) and e.type in FREE_SHOTS]
    return {
        "frees_conceded": len(conceded),
        "conceded_in_our_defensive_third": in_def_third,
        "followed_by_a_free_shot_for_them": linked_shot,
        "of_which_scored": linked_score,
        "their_free_shots_in_total": len(their_free_shots),
        "their_free_scores_in_total": sum(1 for e in their_free_shots if e.type in FREE_SCORES),
        "note": "'followed by' means the next few logged events were a free shot for them - adjacent in order, "
                "not a proven cause. Say the two facts side by side.",
    }


def our_shots_by_range(rows: list, evs: list, atk_first, hdm, length_m=None, width_m=None) -> dict:
    LEN = length_m or DEFAULT_LENGTH_M
    WID = width_m or DEFAULT_WIDTH_M
    bands = {"inside_20m": [0, 0, 0], "20_to_40m": [0, 0, 0], "40m_plus": [0, 0, 0]}
    placed = 0
    total = 0
    for e in evs:
        if not e.own or e.type not in SHOT_TYPES:
            continue
        total += 1
        f = _framed(rows[e.idx], e.half, atk_first, hdm)
        if not f:
            continue
        placed += 1
        d = distance_to_goal_m(f[0], f[1], True, LEN, WID)
        key = "inside_20m" if d < 20 else ("20_to_40m" if d < 40 else "40m_plus")
        b = bands[key]
        b[0] += 1
        if e.type in SCORE_TYPES:
            b[1] += 1
            b[2] += points_for(e.type)
    return {
        "bands": {k: {"shots": v[0], "scores": v[1], "points": v[2],
                      **({"points_per_shot": round(v[2] / v[0], 2)} if v[0] >= MIN_N else {"note": f"only {v[0]} - describe, do not conclude"})}
                  for k, v in bands.items()},
        "shots_with_a_position": placed, "shots_logged": total,
        "covers": "all our shots, frees and 45s included",
        "note": ("Distance from the goal we attack. 40m+ is outside the two-point arc range, so those scores can be two-pointers. "
                 "Compare ranges by points_per_shot, not by score count: a two-pointer from range can be worth as much per shot "
                 "as a point from close in, and then 'avoid long shots' is NOT what the numbers say."),
    }


def build_extras(rows: list, evs: list, atk_first, hdm, length_m=None, width_m=None) -> dict:
    return {
        "kickouts_by_half": kickouts_by_half(rows, evs, atk_first, hdm),
        "scores_by_game_state": scores_by_game_state(evs),
        "frees": frees(rows, evs, atk_first, hdm),
        "our_shots_by_range": our_shots_by_range(rows, evs, atk_first, hdm, length_m, width_m),
    }
