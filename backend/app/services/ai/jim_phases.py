"""
The eight phases as Jim McGuinness named them (confirmed with the coaching staff 2026-11-23):

  1 transitions to attack      2 established attack      3 kick-outs (won / lost)      4 turnovers (won / lost)
  5 build-up phase             6 tracked possession      7 restarts: throw-ins         8 restarts: sideline balls

Definitions, as the staff gave them:
  build-up phase       winning the ball in our own third and building it into an attack (an attack = crossing their 45)
  established attack   what is left once the transition and the initial quick attack are gone: the attack that builds up
There is no agreed stopwatch for the quick attack, so none is used. Where the data has to draw a line the code states it:
  quick attack = a possession that began with a turnover we won and went DIRECT to inside their 45 (no ball movement backwards
  on the way). A tagged phase change (tagger marks when the quick attack stalled) will take precedence once it exists.
Pure functions over the ordered source rows + normalised events (the same inputs as report_extras); no DB, no LLM.
"""
from typing import Callable, Optional

from app.services.ai.phase_facts import Ev, Possession, TURNOVER_ORIGINS
from app.utils.attack_direction import own_attacks_right, to_attack_frame

BACK_TOL = 3.0          # a pitch-scale drop in x bigger than this between two tagged ball positions counts as going backwards
OWN_THIRD_X = 33.3      # our attacking frame, 0 = our goal line, 100 = theirs (saved pitch scale)
CROSS_45_X = 65.0       # their 45 on the saved pitch scale (the artwork's 45 sits at 65 %)

PHASE_NAMES = {
    "transition": "Transitions to attack", "established": "Established attack", "kickouts": "Kick-outs",
    "turnovers": "Turnovers", "buildup": "Build-up phase", "tracked": "Tracked possession", "restarts": "Restarts",
}

DEFINITIONS = {
    "transition": "We win the ball (turnover, tackle, interception, block) and go direct to inside their 45 with no ball movement backwards on the way: the quick attack. No stopwatch is used.",
    "established": "Every other possession of ours (kick-outs, frees, and turnovers that did not go direct): the attack that builds up once the quick attack is gone.",
    "kickouts": "Our kick-outs kept and lost, and theirs we won and they kept.",
    "turnovers": "Turnovers we won and turnovers we lost (their possession next).",
    "buildup": "We win the ball in our own third (turnover, tackle, interception, block, breaking ball) and build it into an attack, which means crossing their 45. Kick-outs are counted under kick-outs, not here.",
    "tracked": "Every possession we followed through the event order, ours and theirs.",
    "restarts": "Throw-ins won and sideline balls, counted as tagged.",
}


def _fx(rows, e: Ev, atk_first, hdm) -> Optional[float]:
    r = rows[e.idx]
    x, y = getattr(r, "pitch_x", None), getattr(r, "pitch_y", None)
    if x is None or y is None:
        return None
    return to_attack_frame(float(x), float(y), own_attacks_right(atk_first, e.half, getattr(r, "minute", None), hdm))[0]


def classify(rows, evs: list, ps: list[Possession], atk_first, hdm) -> dict:
    """The possession lists behind each of Jim's phases (a possession can sit in more than one: they are views, not a split)."""
    ours = [p for p in ps if p.owner_is_own]
    won_from = [p for p in ours if p.origin in ("turnover_won", "turnover_won_forced")]
    quick = []
    for p in won_from:
        if p.origin_idx < 0:
            continue
        end = p.end_idx if p.end_idx >= 0 else len(evs) - 1
        xs = [v for e in evs[p.origin_idx:end + 1] if e.own and (v := _fx(rows, e, atk_first, hdm)) is not None]
        crossing = next((i for i, v in enumerate(xs) if v >= CROSS_45_X), None)
        if crossing is None:
            continue
        run = xs[:crossing + 1]
        if all(b >= a - BACK_TOL for a, b in zip(run, run[1:])):
            quick.append(p)
    quick_ids = {id(p) for p in quick}
    established = [p for p in ours if id(p) not in quick_ids]

    buildup, crossed = [], []
    for p in ours:
        if p.origin not in ("turnover_won", "turnover_won_forced", "contest_won") or p.origin_idx < 0:
            continue
        fx = _fx(rows, evs[p.origin_idx], atk_first, hdm)
        if fx is None or fx >= OWN_THIRD_X:
            continue
        buildup.append(p)
        end = p.end_idx if p.end_idx >= 0 else len(evs) - 1
        span = evs[p.origin_idx:end + 1]
        if any(e.own and (v := _fx(rows, e, atk_first, hdm)) is not None and v >= CROSS_45_X for e in span):
            crossed.append(p)
    return {"quick": quick, "established": established, "buildup": buildup, "buildup_crossed": crossed,
            "no_clock": sum(1 for p in ours if p.seconds is None and p.finished)}
