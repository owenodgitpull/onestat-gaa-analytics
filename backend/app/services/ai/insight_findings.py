"""
Findings engine — decides WHAT is worth saying, from the tagged events, in plain deterministic code.

The live insight used to be handed a pile of counts and left to pick (so it described whatever was biggest and repeated
the same theme). Here detection is separate from writing:

  * every candidate finding is computed with its numbers, its sample size `n` and a baseline;
  * each is given a MATERIALITY score (0..1) so the few that really matter rise to the top;
  * a finding with too few observations is never concluded from — it is dropped (or reported as "early read");
  * a theme the manager has just been told about is down-weighted so the insight moves on.

The agent then writes about the top finding or two in its own words, quoting the pre-computed sentences, so it cannot
get the arithmetic wrong. Nothing here rewrites what the agent says.

All numbers are our team's perspective ("we"/"they"), points are goals*3 + points, and a goal is shown as 3 points
whenever points and scores could be confused.
"""
from dataclasses import dataclass, field
from math import sqrt
from typing import Iterable, Optional

from app.services.ai.phase_facts import (
    Ev, MIN_N, MISS_TYPES, SCORE_TYPES, SHOT_TYPES, Possession, group_stats, points_for, possessions,
)

PHASES = {
    "own_ko": "Own Kick-Out",
    "opp_ko": "Opposition Kick-Out",
    "attack": "Possession/Attack",
    "defence": "Defensive Phase",
    "trans_att": "Transition to Attack",
    "trans_def": "Transition to Defence",
    "contest": "Turnover/Contest",
    "scoreboard": "Scoreboard",
}


# ── scoreboard arithmetic (computed, never left to the model) ────────────────────────

@dataclass
class Score:
    goals: int = 0
    points: int = 0        # points from non-goal scores (1 per point, 2 per two-pointer)
    point_scores: int = 0  # number of non-goal scores
    shots: int = 0
    misses: int = 0

    @property
    def total(self) -> int:
        return self.goals * 3 + self.points

    @property
    def scores(self) -> int:
        return self.goals + self.point_scores

    def line(self) -> str:
        return f"{self.goals}-{self.points:02d} ({self.total} pt{'s' if self.total != 1 else ''})"


def tally(events: Iterable[Ev], own: bool) -> Score:
    s = Score()
    for e in events:
        if e.own != own or e.type not in SHOT_TYPES:
            continue
        s.shots += 1
        if e.type in SCORE_TYPES:
            if e.type in ("goal", "penalty_goal"):
                s.goals += 1
            else:
                s.points += points_for(e.type)
                s.point_scores += 1
        else:
            s.misses += 1
    return s


def margin(events: Iterable[Ev]) -> int:
    evs = list(events)
    return tally(evs, True).total - tally(evs, False).total


def margin_phrase(m: int) -> str:
    if m == 0:
        return "level"
    n = abs(m)
    return f"{n} point{'s' if n != 1 else ''} {'up' if m > 0 else 'down'}"


def split_windows(events: list[Ev], now: int, window: int):
    """(before_window, last_window, previous_window) — minutes are cumulative across the match."""
    cur = max(((e.half or 1) for e in events), default=1)
    in_cur = [e for e in events if (e.half or 1) == cur]
    last = [e for e in in_cur if e.minute > now - window]
    prev = [e for e in in_cur if now - 2 * window < e.minute <= now - window]
    last_ids = {id(e) for e in last}
    before = [e for e in events if id(e) not in last_ids]   # everything earlier, including the previous half
    return before, last, prev


# ── findings ────────────────────────────────────────────────────────────────────────

@dataclass
class Finding:
    key: str                 # stable id for theme rotation
    theme: str
    phase: str               # PHASES key
    text: str                # ready-to-quote, numbers + n included
    n: int
    score: float             # materiality 0..1 (higher = say it)
    direction: str = "neutral"   # against | for | neutral
    evidence: list[str] = field(default_factory=list)
    poss: list = field(default_factory=list)   # the possessions behind the finding (the brief prints their rows)


def _clip(x: float) -> float:
    return max(0.0, min(1.0, x))


def _rate_shift(k_w: int, n_w: int, k_b: int, n_b: int) -> Optional[float]:
    """Standardised shift of the window rate from the earlier rate (z-like, signed: + = better than before)."""
    if n_w < MIN_N or n_b < MIN_N:
        return None
    p_b = k_b / n_b
    p_w = k_w / n_w
    var = max(p_b * (1 - p_b), 0.05) / n_w
    return (p_w - p_b) / sqrt(var)


def build_findings(events: list[Ev], now: int, window: int = 5, recent_keys: Optional[set[str]] = None,
                   possession_list: Optional[list[Possession]] = None) -> list[Finding]:
    """All candidate findings, most material first. Pure; `events` must already be in chronological order."""
    recent_keys = recent_keys or set()
    vis = [e for e in events if e.minute <= now]
    before, last, prev = split_windows(vis, now, window)
    ps = possession_list if possession_list is not None else possessions(vis)
    out: list[Finding] = []

    # 1. who is winning the last few minutes, and how the margin moved ------------------
    w_us, w_them = tally(last, True), tally(last, False)
    if w_us.total or w_them.total:
        m_now, m_then = margin(vis), margin(before)
        shift = m_now - m_then
        run = f"In the last {window} minutes: us {w_us.line()}, them {w_them.line()}; the margin moved from {margin_phrase(m_then)} to {margin_phrase(m_now)}."
        out.append(Finding("scoring_window", "scoring", "scoreboard", run,
                           n=w_us.scores + w_them.scores, score=_clip(abs(shift) / 6.0),
                           direction="for" if shift > 0 else ("against" if shift < 0 else "neutral"),
                           evidence=[run]))

    # 2. our kickouts: window against the earlier rate ----------------------------------
    def _ko_counts(evs: list[Ev]):
        kept = sum(1 for e in evs if e.type in ("own_kickout_won", "own_kickout_won_break"))
        lost = sum(1 for e in evs if e.type in ("own_kickout_opposition_won", "own_kickout_opposition_won_break", "own_kickout_sideline"))
        return kept, kept + lost

    k_w, n_w = _ko_counts(last)
    k_b, n_b = _ko_counts(before)
    z = _rate_shift(k_w, n_w, k_b, n_b)
    if z is not None:
        txt = (f"Our kickouts: {k_w} of {n_w} kept in the last {window} minutes, against {k_b} of {n_b} "
               f"({round(100 * k_b / n_b)}%) before that.")
        out.append(Finding("own_ko_retention", "kickouts", "own_ko", txt, n=n_w, score=_clip(abs(z) / 3.0),
                           direction="for" if z > 0 else "against", evidence=[txt]))
    elif n_w + n_b >= 5 and (k_w + k_b) / (n_w + n_b) < 0.5:
        k, n = k_w + k_b, n_w + n_b
        txt = f"Our kickouts: only {k} of {n} kept so far ({round(100 * k / n)}%)."
        out.append(Finding("own_ko_retention", "kickouts", "own_ko", txt, n=n, score=_clip((0.5 - k / n) * 1.6 * min(1, n / 8)),
                           direction="against", evidence=[txt]))

    # 3. their kickouts: are we winning them -------------------------------------------
    def _their_ko(evs: list[Ev]):
        won = sum(1 for e in evs if e.type in ("opp_kickout_won", "opp_kickout_won_break"))
        kept = sum(1 for e in evs if e.type in ("opp_kickout_opposition_won", "opp_kickout_opposition_won_break"))
        return won, won + kept

    k_w, n_w = _their_ko(last)
    k_b, n_b = _their_ko(before)
    z = _rate_shift(k_w, n_w, k_b, n_b)
    if z is not None:
        txt = f"Their kickouts: we won {k_w} of {n_w} in the last {window} minutes, against {k_b} of {n_b} before that."
        out.append(Finding("opp_ko_win", "kickouts", "opp_ko", txt, n=n_w, score=_clip(abs(z) / 3.0),
                           direction="for" if z > 0 else "against", evidence=[txt]))
    elif n_w + n_b >= 4 and (k_w + k_b) / (n_w + n_b) < 0.35:
        k, n = k_w + k_b, n_w + n_b
        txt = f"Their kickouts: we have won only {k} of {n} so far ({round(100 * k / n)}%)."
        out.append(Finding("opp_ko_win", "kickouts", "opp_ko", txt, n=n, score=_clip((0.35 - k / n) * 1.8 * min(1, n / 6)),
                           direction="against", evidence=[txt]))

    # 4. what the ball we LOST became for them (transition to defence) ----------------
    lost_ps = [p for p in ps if (not p.owner_is_own) and p.origin in ("turnover_lost", "turnover_lost_unforced")]
    st = group_stats(lost_ps)
    lost_logged = sum(1 for e in vis if e.own and e.type in ("turnover_lost", "unforced_error"))
    if st["finished"] >= MIN_N:
        txt = (f"Turnovers/errors we lost: {lost_logged} logged; {st['finished']} of them have a finished possession for them — "
               f"{st['shots']} became a shot ({st['scores']} a score, {st['points']} pts), {st['died']} ended without one.")
        share = st["scores"] / st["finished"]
        out.append(Finding("turnover_lost_conceded", "turnovers", "trans_def", txt, n=st["finished"],
                           score=_clip(share * 1.4 * min(1, st["finished"] / 6)), direction="against", evidence=[txt],
                           poss=[p for p in lost_ps if p.finished]))

    # 5. what the ball we WON became for us (transition to attack) --------------------
    won_ps = [p for p in ps if p.owner_is_own and p.origin in ("turnover_won", "turnover_won_forced")]
    st = group_stats(won_ps)
    if st["finished"] >= MIN_N:
        sec = f"; median {st['median_seconds_to_shot']}s to the shot" if st["median_seconds_to_shot"] is not None else ""
        txt = (f"Turnovers we won: {st['finished']} finished possessions for us — {st['shots']} became a shot "
               f"({st['scores']} a score, {st['points']} pts), {st['died']} ended without one{sec}.")
        stall = 1 - (st["shots"] / st["finished"])
        out.append(Finding("turnover_won_converted", "turnovers", "trans_att", txt, n=st["finished"],
                           score=_clip(stall * 1.1 * min(1, st["finished"] / 6)) if st["shots"] == 0 else _clip((st["scores"] / st["finished"]) * 0.9),
                           direction="against" if st["shots"] == 0 else "for", evidence=[txt],
                           poss=[p for p in won_ps if p.finished]))

    # 6. restarts we lost: did they punish them ----------------------------------------
    lko = [p for p in ps if p.origin == "own_ko_lost"]
    st = group_stats(lko)
    lko_logged = sum(1 for e in vis if e.type in ("own_kickout_opposition_won", "own_kickout_opposition_won_break", "own_kickout_sideline"))
    if st["finished"] >= MIN_N:
        txt = (f"Kickouts we lost: {lko_logged} logged; {st['finished']} of them have a finished possession for them — "
               f"{st['scores']} ended in a score ({st['points']} pts), {st['shots'] - st['scores']} in a miss, "
               f"{st['died']} ended without a shot.")
        out.append(Finding("lost_ko_punished", "kickouts", "own_ko", txt, n=st["finished"],
                           score=_clip((st["scores"] / st["finished"]) * 1.4 * min(1, st["finished"] / 6)),
                           direction="against", evidence=[txt], poss=[p for p in lko if p.finished]))

    # 6b. restarts we KEPT: are they turning into anything (a kept kickout that never becomes a shot is a finding)
    kko = [p for p in ps if p.origin == "own_ko_kept"]
    st = group_stats(kko)
    if st["finished"] >= 4 and st["scores"] / st["finished"] <= 0.25:
        shots = f"{st['shots']} became a shot" if st["shots"] else "none became a shot"
        txt = (f"Kickouts we kept: {st['finished']} finished possessions — {shots}, {st['scores']} ended in a score "
               f"({st['points']} pts), {st['died']} ended without a shot.")
        out.append(Finding("kept_ko_unproductive", "kickouts", "own_ko", txt, n=st["finished"],
                           score=_clip((1 - st["scores"] / st["finished"]) * 0.55 * min(1, st["finished"] / 8)),
                           direction="against", evidence=[txt], poss=[p for p in kko if p.finished]))

    # 7. our shooting: window against before ---------------------------------------------
    def _shoot(evs: list[Ev]):
        s = tally(evs, True)
        return s.scores, s.shots

    k_w, n_w = _shoot(last)
    k_b, n_b = _shoot(before)
    z = _rate_shift(k_w, n_w, k_b, n_b)
    if z is not None:
        txt = f"Our shooting: {k_w} scores from {n_w} shots in the last {window} minutes, against {k_b} from {n_b} before."
        out.append(Finding("shooting", "shooting", "attack", txt, n=n_w, score=_clip(abs(z) / 3.0),
                           direction="for" if z > 0 else "against", evidence=[txt]))

    # 8. discipline -----------------------------------------------------------------------
    fw = sum(1 for e in last if e.own and e.type in ("foul_committed", "free_conceded"))
    fb = sum(1 for e in before if e.own and e.type in ("foul_committed", "free_conceded"))
    if fw >= 3 and fw > fb / max(1, (now - window)) * window * 1.5:
        txt = f"Our fouls: {fw} in the last {window} minutes ({fb} in the {max(0, now - window)} before)."
        out.append(Finding("discipline", "discipline", "defence", txt, n=fw, score=_clip(fw / 6.0), direction="against", evidence=[txt]))

    # rotation: a theme the manager was just told about is down-weighted
    for f in out:
        if f.key in recent_keys:
            f.score *= 0.55
            f.evidence.append("(raised recently — repeat only if it has moved)")
    out.sort(key=lambda f: f.score, reverse=True)
    return out


def update_on_previous(prev_top: list[Finding], now_findings: list[Finding], prev_minute: int) -> list[str]:
    """For each theme the manager was last told about: the same measure then and now (so a repeat is quoted as a change)."""
    now_by_key = {f.key: f for f in now_findings}
    lines = []
    for p in prev_top:
        cur = now_by_key.get(p.key)
        if cur is None:
            lines.append(f"Raised at {prev_minute}': {p.text}  → now: no longer on enough observations.")
        elif cur.text == p.text:
            lines.append(f"Raised at {prev_minute}': {p.text}  → now: unchanged.")
        else:
            lines.append(f"Raised at {prev_minute}': {p.text}  → now: {cur.text}")
    return lines


def top_findings(findings: list[Finding], limit: int = 3, floor: float = 0.12) -> list[Finding]:
    """The few findings worth saying; one per theme so the insight cannot be three versions of the same point."""
    seen: set[str] = set()
    picked: list[Finding] = []
    for f in findings:
        if f.score < floor or f.theme in seen:
            continue
        seen.add(f.theme)
        picked.append(f)
        if len(picked) >= limit:
            break
    return picked


def early_read_note(n_events: int, now: int) -> Optional[str]:
    if n_events < 20 or now <= 10:
        return f"EARLY READ: only {n_events} events logged in {now} minutes — describe, do not draw conclusions."
    return None
