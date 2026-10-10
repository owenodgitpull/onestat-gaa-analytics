"""
Phase facts — the seven phases as COMPUTED, quotable facts. Pure functions over tagged events: no DB, no LLM.

A "possession" starts at an event that gives a team the ball (a kickout kept/won, a turnover won, a contest won …) and
is followed through the event ORDER until it ends: in a score, a shot that missed, the ball being lost, a foul, or the
half ending. The fact is then "the possession that began from this origin ended in …", never an outcome-conditioned
label, so conversions are honest (every origin is in the denominator). A possession still open at the end of the data is
counted as `open` and left out of the rates so a half-finished attack is not read as a failed one.

Timing: where both the origin and the ending event carry `match_clock_s`, the possession has `seconds` (origin → ending
event). Matches recorded before the clock existed fall back to order only and report no seconds.

Phase mapping (see docs/agent-plan-inputs/05-phase-plan-amended.md):
  own_ko_kept / own_ko_lost            -> Own Kick-Out            (what the kept / lost restart became)
  opp_ko_won / opp_ko_kept             -> Opposition Kick-Out
  turnover_won(_forced)                -> Transition to Attack    (we have it)
  turnover_lost(_unforced)             -> Transition to Defence   (they have it)
  contest_won / contest_lost           -> Turnover / Contest
  every possession we / they had       -> Possession-Attack / Defensive
"""
from dataclasses import dataclass
from statistics import median
from typing import Iterable, Optional

SCORE_TYPES = {"goal", "point", "two_point", "point_free", "two_point_free", "forty_five", "penalty_goal"}
MISS_TYPES = {"wide", "wide_free", "short", "saved", "hit_post", "forty_five_missed", "penalty_miss"}
SHOT_TYPES = SCORE_TYPES | MISS_TYPES

OWN_KO_KEPT = {"own_kickout_won", "own_kickout_won_break"}
OWN_KO_LOST = {"own_kickout_opposition_won", "own_kickout_opposition_won_break", "own_kickout_sideline"}
OPP_KO_WON = {"opp_kickout_won", "opp_kickout_won_break"}
OPP_KO_KEPT = {"opp_kickout_opposition_won", "opp_kickout_opposition_won_break"}
KICKOUTS = OWN_KO_KEPT | OWN_KO_LOST | OPP_KO_WON | OPP_KO_KEPT
BREAK_KO = {"own_kickout_won_break", "own_kickout_opposition_won_break", "opp_kickout_won_break",
            "opp_kickout_opposition_won_break"}

WIN_FORCED = {"tackle_won", "interception", "block"}
WIN_GENERIC = {"turnover_won"}
LOSE_TYPES = {"turnover_lost", "unforced_error"}
FOUL_AGAINST_OWNER = {"foul_committed", "free_conceded"}

MIN_N = 3   # below this a rate is described, never concluded


@dataclass
class Ev:
    type: str
    own: bool
    minute: int
    half: Optional[int] = None
    clock_s: Optional[int] = None
    idx: int = -1            # position in the list this was normalised from (to find the source row again)


@dataclass
class Possession:
    origin: str            # own_ko_kept | own_ko_lost | opp_ko_won | opp_ko_kept | turnover_won(_forced)
                           # | turnover_lost(_unforced) | contest_won | contest_lost | free_won
    owner_is_own: bool
    minute: int
    half: Optional[int]
    outcome: str = "open"  # score | miss | lost | foul | half_end | open | unknown
    end_type: Optional[str] = None
    points: int = 0
    seconds: Optional[int] = None
    contested: bool = False
    clock_s: Optional[int] = None
    origin_idx: int = -1     # Ev.idx of the event that started it
    end_idx: int = -1        # Ev.idx of the event that ended it (-1 while open)

    @property
    def shot(self) -> bool:
        return self.outcome in ("score", "miss")

    @property
    def finished(self) -> bool:
        return self.outcome not in ("open", "unknown")


def normalise(events: Iterable, half_duration_mins: Optional[int] = None) -> list[Ev]:
    """DB rows (or anything with event_type/team/minute[/half/match_clock_s]) -> Ev, in the order given.
    A row with no stored half gets one from its minute and the match's half length."""
    hdm = half_duration_mins or 30
    out: list[Ev] = []
    for e in events:
        mn = getattr(e, "minute", None)
        if mn is None:
            continue
        et = getattr(e, "event_type", None)
        et = et.value if hasattr(et, "value") else str(et)
        tm = getattr(e, "team", None)
        tm = tm.value if hasattr(tm, "value") else str(tm)
        half = getattr(e, "half", None) or (1 if int(mn) <= hdm else 2)
        out.append(Ev(et, tm.lower() == "own", int(mn), half, getattr(e, "match_clock_s", None), len(out)))
    return out


def order_key(e, half_duration_mins: Optional[int] = None):
    """Chronological sort key for DB rows. `minute` alone is wrong across half time (a 34' first half with added time
    sorts after a 30' second-half minute), so the half and the match clock come first."""
    hdm = half_duration_mins or 30
    mn = getattr(e, "minute", None) or 0
    half = getattr(e, "half", None) or (1 if mn <= hdm else 2)
    clock = getattr(e, "match_clock_s", None)
    return (half, clock if clock is not None else mn * 60, getattr(e, "created_at", None) or 0)


def points_for(event_type: str) -> int:
    if event_type in ("goal", "penalty_goal"):
        return 3
    if event_type in ("two_point", "two_point_free"):
        return 2
    return 1 if event_type in SCORE_TYPES else 0


def _gain(ev: Ev) -> Optional[tuple[bool, str, bool]]:
    """If this event gives a team the ball: (new owner is own, origin label, contested). Else None."""
    t = ev.type
    if t in OWN_KO_KEPT:
        return True, "own_ko_kept", t in BREAK_KO
    if t in OWN_KO_LOST:
        return False, "own_ko_lost", t in BREAK_KO
    if t in OPP_KO_WON:
        return True, "opp_ko_won", t in BREAK_KO
    if t in OPP_KO_KEPT:
        return False, "opp_ko_kept", t in BREAK_KO
    if t in WIN_FORCED:
        return ev.own, "turnover_won_forced", False
    if t in WIN_GENERIC:
        return ev.own, "turnover_won", False
    if t == "breaking_ball_won":
        return ev.own, "contest_won", True
    if t in LOSE_TYPES:  # whoever lost it, the OTHER team now has it
        return (not ev.own), ("turnover_lost_unforced" if t == "unforced_error" else "turnover_lost"), False
    if t == "breaking_ball_lost":
        return (not ev.own), "contest_lost", True
    return None


def possessions(events: Iterable) -> list[Possession]:
    evs = events if events and isinstance(next(iter(events)), Ev) else normalise(events)
    out: list[Possession] = []
    owner: Optional[bool] = None
    open_p: Optional[Possession] = None
    prev_half: Optional[int] = None

    def close(outcome: str, end_ev: Optional[Ev] = None):
        nonlocal open_p
        if open_p is None:
            return
        open_p.outcome = outcome
        if end_ev is not None:
            open_p.end_idx = end_ev.idx
            open_p.end_type = end_ev.type
            if end_ev.type in SCORE_TYPES:
                open_p.points = points_for(end_ev.type)
            if end_ev.clock_s is not None and open_p.clock_s is not None and end_ev.clock_s >= open_p.clock_s:
                open_p.seconds = end_ev.clock_s - open_p.clock_s
        open_p = None

    for ev in evs:
        if prev_half is not None and ev.half is not None and ev.half != prev_half:
            close("half_end")
            owner = None
        if ev.half is not None:
            prev_half = ev.half

        g = _gain(ev)
        if g is not None:
            new_owner, origin, contested = g
            kickout = ev.type in KICKOUTS
            # a kickout is always a fresh possession; an open-play event only is if the ball really changes hands
            if kickout or owner is None or new_owner != owner:
                if open_p is not None:
                    close("lost" if owner != new_owner else "unknown", ev)
                p = Possession(origin, new_owner, ev.minute, ev.half, "open", None, 0, None, contested, ev.clock_s, ev.idx)
                out.append(p)
                open_p = p
                owner = new_owner
            continue

        if open_p is None:
            if ev.type in SHOT_TYPES:
                owner = None
            continue

        if ev.type in SHOT_TYPES and ev.own == owner:
            close("score" if ev.type in SCORE_TYPES else "miss", ev)
            owner = None
        elif ev.type in FOUL_AGAINST_OWNER and ev.own == owner:
            close("foul", ev)
            owner = None
        elif ev.type in ("foul_won", "free_won") and ev.own and owner is False:
            close("foul", ev)   # they fouled, we were awarded the free: their possession ends, ours begins
            p = Possession("free_won", True, ev.minute, ev.half, "open", None, 0, None, False, ev.clock_s, ev.idx)
            out.append(p)
            open_p = p
            owner = True
    return out


# ── aggregation ────────────────────────────────────────────────────────────────

def rate(n: int, d: int) -> Optional[float]:
    return round(100 * n / d) if d else None


def group_stats(ps: list[Possession]) -> dict:
    """What a set of possessions turned into. Open/unknown possessions are excluded from every rate."""
    fin = [p for p in ps if p.finished]
    shots = [p for p in fin if p.shot]
    scores = [p for p in shots if p.outcome == "score"]
    secs = [p.seconds for p in shots if p.seconds is not None]
    return {
        "n": len(ps),
        "finished": len(fin),
        "open": sum(1 for p in ps if p.outcome == "open"),
        "shots": len(shots),
        "scores": len(scores),
        "points": sum(p.points for p in scores),
        "died": len(fin) - len(shots),            # ended without a shot (turnover, foul, half end)
        "shot_rate": rate(len(shots), len(fin)),
        "score_rate": rate(len(scores), len(fin)),
        "median_seconds_to_shot": round(median(secs)) if len(secs) >= MIN_N else None,
    }


GROUPS = {
    "own_ko_kept": lambda p: p.origin == "own_ko_kept",
    "own_ko_lost": lambda p: p.origin == "own_ko_lost",            # THEIR possession after a kickout we lost
    "opp_ko_won": lambda p: p.origin == "opp_ko_won",
    "opp_ko_kept": lambda p: p.origin == "opp_ko_kept",            # THEIR possession after they kept their restart
    "turnovers_won": lambda p: p.owner_is_own and p.origin in ("turnover_won", "turnover_won_forced", "turnover_lost", "turnover_lost_unforced", "contest_lost"),
    "turnovers_lost": lambda p: (not p.owner_is_own) and p.origin in ("turnover_won", "turnover_won_forced", "turnover_lost", "turnover_lost_unforced", "contest_lost"),
    "contests_won": lambda p: p.owner_is_own and p.contested,
    "contests_lost": lambda p: (not p.owner_is_own) and p.contested,
    "all_ours": lambda p: p.owner_is_own,
    "all_theirs": lambda p: not p.owner_is_own,
}


def summarise(ps: list[Possession], now: int, window: int = 5) -> dict:
    """{group: {"to_date": stats, "window": stats}} — the window is possessions that STARTED in the last `window` min."""
    out = {}
    for name, pred in GROUPS.items():
        allp = [p for p in ps if pred(p)]
        win = [p for p in allp if p.minute > now - window]
        out[name] = {"to_date": group_stats(allp), "window": group_stats(win)}
    return out
