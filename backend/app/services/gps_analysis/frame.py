"""Framing and the match grid: every tracked player's position in OUR attack frame on a regular video-time grid.

Frame (docs/pitch-coordinates.md): our team attacks towards x = 100 in every period. Raw screen coordinates are
rotated 180 degrees (x -> 100-x AND y -> 100-y) in the periods where we attack left, via
app.utils.attack_direction.own_attacks_right. Metres: X = x/100 * length (0 = our goal line), Y = y/100 * width
(Y small = our LEFT in the attack frame).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import numpy as np

from app.services.gps_timeseries import clock, codec, geo
from app.utils.attack_direction import own_attacks_right, to_attack_frame

from .loader import Carry, Event, MatchInputs

OWN_TEAMS = ("own", "team_a")
BLACK_CARD_MS = 10 * 60 * 1000


def period_bounds(inp: MatchInputs) -> List[Tuple[int, int, int]]:
    """(half, video_start_ms, video_end_ms) for each synced period, in video order."""
    s = inp.session
    ends = {1: s.get("halftime_ms"), 2: s.get("full_time_ms"), 3: s.get("et_halftime_ms"), 4: s.get("et_full_time_ms")}
    ps = sorted(inp.sync["periods"], key=lambda p: p["video_start_ms"])
    out = []
    for i, p in enumerate(ps):
        start = int(p["video_start_ms"])
        nxt = int(ps[i + 1]["video_start_ms"]) if i + 1 < len(ps) else None
        end = p.get("video_end_ms") or ends.get(p["half"]) or nxt or (s.get("duration_ms") or start + 45 * 60000)
        if nxt is not None:
            end = min(int(end), nxt)
        out.append((int(p["half"]), start, int(end)))
    return out


def half_at(bounds, video_ms: float) -> Optional[int]:
    h = None
    for half, start, _ in bounds:
        if video_ms >= start:
            h = half
    return h if h is not None else (bounds[0][0] if bounds else None)


def frame_point(x, y, half, arfh, L, W) -> Tuple[Optional[float], Optional[float]]:
    """One raw point -> metres in our frame, or (None, None)."""
    if x is None or y is None:
        return None, None
    fx, fy = to_attack_frame(float(x), float(y), own_attacks_right(arfh, half if half is not None else 1))
    return fx / 100.0 * L, fy / 100.0 * W


@dataclass
class Grid:
    hz: float
    t: np.ndarray            # video ms, shape (T,)
    half: np.ndarray         # period per sample (T,)
    pids: List[str]          # players, rows of X/Y/S/on
    X: np.ndarray            # (P, T) metres, our frame, nan = no position
    Y: np.ndarray
    S: np.ndarray            # speed m/s, nan = no fix
    on: np.ndarray           # (P, T) bool: on the pitch per lineup + subs + cards
    poss: np.ndarray         # (T,) +1 we have the ball, -1 they have it, 0 dead / unknown
    ballX: np.ndarray        # (T,) metres, nan unknown
    ballY: np.ndarray
    set_piece: Optional[np.ndarray] = None   # (T,) bool: a stoppage until the next carry (possession v2)
    carry_align: Optional[dict] = None       # each carry's start on the video clock, lined up from GPS (align_carry_starts)

    def idx(self, video_ms: float) -> int:
        return int(np.clip(np.searchsorted(self.t, video_ms), 0, len(self.t) - 1))

    def valid(self) -> np.ndarray:
        return self.on & ~np.isnan(self.X)


def on_pitch_intervals(inp: MatchInputs, bounds) -> Dict[str, List[Tuple[float, float]]]:
    """Video-time intervals each player is on the pitch: starters from the first throw-in, SUB_ON swaps (player_id off,
    sub_in_player_id on), black card 10 minutes off, red card off. Without a lineup every tracked player counts."""
    if not bounds:
        return {}
    t_start, t_end = bounds[0][1], bounds[-1][2]
    if not inp.starters:
        return {pid: [(t_start, t_end)] for pid in inp.tracks}
    on_since: Dict[str, Optional[float]] = {pid: t_start for pid in inp.starters}
    iv: Dict[str, List[Tuple[float, float]]] = {}

    def off(pid, t):
        s = on_since.get(pid)
        if s is not None:
            iv.setdefault(pid, []).append((s, t))
        on_since[pid] = None

    returns: List[Tuple[float, str]] = []
    for e in inp.events:
        if e.team != "team_a":
            continue
        while returns and returns[0][0] <= e.video_ms:
            t, pid = returns.pop(0); on_since[pid] = t
        if e.event_type in ("SUB_ON", "SUBSTITUTION") and e.sub_in_player_id:
            if e.player_id:
                off(e.player_id, e.video_ms)
            on_since[e.sub_in_player_id] = e.video_ms
        elif e.event_type == "RED_CARD" and e.player_id:
            off(e.player_id, e.video_ms)
        elif e.event_type == "BLACK_CARD" and e.player_id:
            off(e.player_id, e.video_ms)
            returns.append((e.video_ms + BLACK_CARD_MS, e.player_id)); returns.sort()
    for t, pid in returns:
        if t < t_end:
            on_since[pid] = t
    for pid, s in on_since.items():
        if s is not None:
            iv.setdefault(pid, []).append((s, t_end))
    return iv


# Possession v2 (2026-11-10): possession ends at stoppages and every edge is moved back by the measured tap delay. The
# time between a stoppage and the next carry is its own "set piece" state. False = the original rule below (revert switch).
POSSESSION_V2 = True
STOP_TYPES = ("POINT_SCORED", "GOAL_SCORED", "WIDE", "FOUL_COMMITTED", "YELLOW_CARD", "BLACK_CARD", "RED_CARD")  # ball dead at the tag
RESTART_TYPES = ("SIDELINE_KICK", "SIDELINE_BALL", "FORTY_FIVE", "FREE_KICK", "THROW_IN")                    # ball restarted at the tag
CARRY_CAP_MS = 20000
SET_PIECE_CAP_MS = 90000


CARRY_MATCH_RADIUS_M = 10.0      # tagged spots are 5-7 m out (median 5.9 m on Dublin): 5 m matched 38%, 10 m 73%
CARRY_SEARCH_BEFORE_MS = 8000
CARRY_SEARCH_AFTER_MS = 2000
CARRY_DEFAULT_DELAY_MS = 2000


def align_carry_starts(inp: MatchInputs, t: np.ndarray, pids, X: np.ndarray, Y: np.ndarray) -> dict:
    """When each tagged carry really started, on the video clock. Taps come a varying time after the action (Dublin:
    median 2.0 s, middle half -0.1 to 4.4 s), so one global delay put most carries early or late.
    - Our carries: the moment the carrier's GPS is nearest the tagged start spot, between 8 s before and 2 s after the
      tap, if he comes within 10 m ("gps").
    - Our other carries, and theirs (no opposition GPS): the tap less this match's median delay from the matched ones
      ("median").
    - Starts are kept in tag order; the user's Edit sync tag shift is applied on top.
    Returns {"starts": [ms per carry, in inp.carries own/opponent order], "how": [...], "median_delay_ms", "matched", "total"}."""
    from .lag import manual_shift_ms
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    row = {p: i for i, p in enumerate(pids)}
    L, W = inp.pitch_length_m, inp.pitch_width_m
    found = [None] * len(cs)
    for k, c in enumerate(cs):
        if c.team != "own" or c.player_id not in row or not len(t):
            continue
        sx, sy = frame_point(c.start_x, c.start_y, c.half, inp.attacking_right_first_half, L, W)
        if sx is None:
            continue
        a = int(np.searchsorted(t, c.video_ms - CARRY_SEARCH_BEFORE_MS))
        b = int(np.searchsorted(t, c.video_ms + CARRY_SEARCH_AFTER_MS))
        if b <= a:
            continue
        i = row[c.player_id]
        d = np.hypot(X[i, a:b] - sx, Y[i, a:b] - sy)
        if np.all(np.isnan(d)) or np.nanmin(d) > CARRY_MATCH_RADIUS_M:
            continue
        found[k] = float(t[a + int(np.nanargmin(d))])
    delays = [c.video_ms - f for c, f in zip(cs, found) if f is not None]
    med = float(np.median(delays)) if len(delays) >= 5 else float(CARRY_DEFAULT_DELAY_MS)
    med = min(6000.0, max(0.0, med))
    shift = manual_shift_ms(inp.sync.get("tag_lag"))
    starts, how, prev = [], [], -1e18
    for c, f in zip(cs, found):
        s = (f if f is not None else c.video_ms - med) + shift
        s = max(s, prev + 200)                 # keep the tagged order
        starts.append(int(s)); how.append("gps" if f is not None else "median"); prev = s
    return {"starts": starts, "how": how, "median_delay_ms": int(med), "matched": len(delays),
            "total": sum(1 for c in cs if c.team == "own"), "carries": len(cs)}


# ---- Replay timing (display only: the analysis keeps the clock above)
# The automatic sync fits each period's GPS offset to the tap times, so the GPS clock carries the usual tap delay: on
# the five 2026 matches the dots ran 1-6 s behind the video (median ~3 s), measured two ways that agree within ~1 s:
#  - the throw-in: the team's speed burst comes that long after the period's throw-in mark;
#  - the taps: nobody taps before seeing the play, yet 30-60% of carries "start" after the tap on the synced clock;
#    the 10th percentile of that early side is the lateness.
# The analysis pairs tags with GPS on that same clock, so it stays right on average and is left alone. The replay draws
# the pitch `lead_ms` ahead of the video to line both up with the footage.
REPLAY_TAU_MIN_MS, REPLAY_TAU_MAX_MS = -8000, 15000   # tap minus GPS moment, searched for the lead estimate
REPLAY_MATCH_BEFORE_MS = 12000                        # a carry may start up to 12 s before the tap (on the video)
REPLAY_EARLY_TAP_MS = 1000                            # ... or 1 s after it (a paused, early tap)
LEAD_MIN_MS, LEAD_MAX_MS = -5000, 10000


def _nearest_tau(t, X, Y, i, sx, sy, tap, lo_ms, hi_ms, step_ms):
    """tau (ms, tap minus moment) when player row i is nearest (sx, sy), searched over tau in [lo, hi]; with the
    distance and the best distance more than 3 s away from it (ambiguity)."""
    taus = np.arange(lo_ms, hi_ms + 1, step_ms)
    want = tap - taus
    idx = np.clip(np.searchsorted(t, want), 0, len(t) - 1)
    d = np.hypot(X[i, idx] - sx, Y[i, idx] - sy)
    d[np.abs(t[idx] - want) > step_ms * 2] = np.nan       # outside a period
    if np.all(np.isnan(d)):
        return None
    j = int(np.nanargmin(d))
    far = (np.abs(taus - taus[j]) > 3000) & ~np.isnan(d)
    d2 = float(np.nanmin(d[far])) if far.any() else float("inf")
    return float(taus[j]), float(d[j]), d2


def _throw_in_lateness_ms(t, S, on, start_ms) -> Optional[float]:
    """How long after the throw-in mark the team's speed bursts, on the synced clock. None when the players were
    already moving at the mark (no clean burst)."""
    i0 = int(np.searchsorted(t, start_ms))
    if i0 >= len(t):
        return None
    hz = 1000.0 / max(1.0, float(np.median(np.diff(t[i0:i0 + 20])))) if i0 + 2 < len(t) else 10.0
    seg = slice(i0, min(len(t), i0 + int(25 * hz)))
    with np.errstate(all="ignore"):
        sp = np.nanmean(np.where(on[:, seg], S[:, seg], np.nan), axis=0)
    if len(sp) < 3 * hz:
        return None
    base = float(np.nanmedian(sp[: max(2, int(hz))]))
    if not np.isfinite(base) or base > 1.5:
        return None
    hold = max(1, int(hz))
    for j in range(len(sp) - hold):
        if np.all(sp[j:j + hold] > base + 1.2):
            return float(t[i0 + j] - start_ms)
    return None


def replay_times(inp: MatchInputs, t, half_arr, pids, X, Y, S, on, bounds) -> dict:
    """Display timing for the replay: per period how far to draw the pitch ahead of the video (`lead_ms`), and each
    own/opposition carry's start on the synced clock (`starts`), matched from the carrier's GPS with a window that
    allows for the lead, else the tap less the usual delay. Read-only; the user's tag shift is NOT included."""
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    row = {p: i for i, p in enumerate(pids)}
    L, W, arfh = inp.pitch_length_m, inp.pitch_width_m, inp.attacking_right_first_half
    step = float(np.median(np.diff(t))) if len(t) > 1 else 100.0
    spots = [frame_point(c.start_x, c.start_y, c.half, arfh, L, W) for c in cs]
    # 1. clean own matches over a wide window: the floor of tau per period
    clean: Dict[int, list] = {}
    if len(t):
        for c, (sx, sy) in zip(cs, spots):
            if c.team != "own" or c.player_id not in row or sx is None:
                continue
            r = _nearest_tau(t, X, Y, row[c.player_id], sx, sy, c.video_ms, REPLAY_TAU_MIN_MS, REPLAY_TAU_MAX_MS, step)
            if r and r[1] < 6.0 and r[2] - r[1] > 4.0:
                clean.setdefault(int(half_at(bounds, c.video_ms) or 1), []).append(r[0])
    lead, how_lead = {}, {}
    for h, start, _ in bounds:
        burst = _throw_in_lateness_ms(t, S, on, start) if len(t) else None
        v = clean.get(h, [])
        floor = -float(np.percentile(v, 10)) if len(v) >= 20 else None
        if burst is not None and floor is not None:
            if abs(burst - floor) <= 2000:
                est, src = (burst + floor) / 2, "throw-in and taps"
            elif len(v) >= 30:
                est, src = floor, "taps"
            else:
                est, src = burst, "throw-in"
        elif floor is not None:
            est, src = floor, "taps"
        elif burst is not None:
            est, src = burst, "throw-in"
        else:
            est, src = None, None
        if est is not None:
            lead[h] = int(round(min(LEAD_MAX_MS, max(LEAD_MIN_MS, est)) / 100.0) * 100)
            how_lead[h] = src
    known = list(lead.values())
    for h, _, _ in bounds:                     # a period with no estimate borrows the match's median
        if h not in lead:
            lead[h] = int(np.median(known)) if known else 0
            how_lead[h] = "other periods" if known else "none"
    # 2. each own carry: nearest approach between 12 s before and 1 s after the tap ON THE VIDEO (lead added)
    found: List[Optional[float]] = [None] * len(cs)
    for k, (c, (sx, sy)) in enumerate(zip(cs, spots)):
        if c.team != "own" or c.player_id not in row or sx is None or not len(t):
            continue
        D = lead.get(int(half_at(bounds, c.video_ms) or 1), 0)
        r = _nearest_tau(t, X, Y, row[c.player_id], sx, sy, c.video_ms, -(D + REPLAY_EARLY_TAP_MS), REPLAY_MATCH_BEFORE_MS - D, step)
        if r and r[1] <= CARRY_MATCH_RADIUS_M:
            found[k] = c.video_ms - r[0]
    # the tap delay on the video, median of the matched ones; the others start that long before the tap
    delays = [c.video_ms - f + lead.get(int(half_at(bounds, c.video_ms) or 1), 0) for c, f in zip(cs, found) if f is not None]
    med = float(np.median(delays)) if len(delays) >= 5 else float(CARRY_DEFAULT_DELAY_MS)
    med = min(8000.0, max(0.0, med))
    starts, how, prev = [], [], -1e18
    for c, f in zip(cs, found):
        D = lead.get(int(half_at(bounds, c.video_ms) or 1), 0)
        s = f if f is not None else c.video_ms - med + D
        s = max(s, prev + 200)
        starts.append(int(s)); how.append("gps" if f is not None else "median"); prev = s
    return {"lead_ms": {str(h): v for h, v in lead.items()}, "lead_from": {str(h): v for h, v in how_lead.items()},
            "starts": starts, "how": how, "median_delay_ms": int(med), "matched": len(delays),
            "total": sum(1 for c in cs if c.team == "own")}


def possession_series(inp: MatchInputs, t: np.ndarray, bounds, with_set_pieces: bool = False, starts=None):
    """+1 we have the ball / -1 they have it / 0 dead or unknown, per sample. With with_set_pieces, also a bool mask of
    the set-piece samples (a stoppage until the next carry)."""
    if not POSSESSION_V2:
        p = _possession_v1(inp, t, bounds)
        return (p, np.zeros(len(t), dtype=bool)) if with_set_pieces else p
    from .lag import lag_ms
    out = np.zeros(len(t), dtype=np.int8)
    setp = np.zeros(len(t), dtype=bool)
    l_carry = lag_ms(inp, "PASS_HAND")
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    if starts is None or len(starts) != len(cs):
        starts = [c.video_ms - l_carry for c in cs]
    stops = sorted(e.video_ms - lag_ms(inp, e.event_type) for e in inp.events if e.event_type in STOP_TYPES)
    restarts = sorted(e.video_ms - lag_ms(inp, e.event_type) for e in inp.events if e.event_type in RESTART_TYPES)

    def period_end(ms):
        for _, ps, pe in bounds:
            if ps <= ms < pe:
                return pe
        return ms

    for i, c in enumerate(cs):
        s0 = starts[i]
        nxt = starts[i + 1] if i + 1 < len(cs) else s0 + CARRY_CAP_MS
        end = min(nxt, s0 + CARRY_CAP_MS, period_end(c.video_ms))
        if c.ended_by in ("score", "wide") and c.end_video_ms:
            end = min(end, c.end_video_ms - lag_ms(inp, "POINT_SCORED" if c.ended_by == "score" else "WIDE"))
        # the first stoppage after the carry starts ends the possession
        k = int(np.searchsorted(stops, s0 + 1))
        stop_at = stops[k] if k < len(stops) and stops[k] < end else None
        # a restart (sideline, 45, free) before the next carry: the ball was dead before it; ended when the carry's tagged
        # end says, else at the restart itself (when it went out is not tagged)
        r = int(np.searchsorted(restarts, s0 + 1))
        restart_at = restarts[r] if r < len(restarts) and restarts[r] < end else None
        if restart_at is not None and (stop_at is None or restart_at < stop_at):
            stop_at = min(restart_at, (c.end_video_ms - l_carry) if c.end_video_ms else restart_at)
        live_end = max(s0, stop_at) if stop_at is not None else end
        a, b = np.searchsorted(t, s0), np.searchsorted(t, live_end)
        out[a:b] = 1 if c.team == "own" else -1
        if stop_at is not None:
            # set piece: from the stoppage until play restarts with the next carry (capped, and never across a period end)
            sp_end = min(nxt, stop_at + SET_PIECE_CAP_MS, period_end(c.video_ms))
            setp[np.searchsorted(t, live_end):np.searchsorted(t, sp_end)] = True
    out[setp] = 0
    return (out, setp) if with_set_pieces else out


def _possession_v1(inp: MatchInputs, t: np.ndarray, bounds) -> np.ndarray:
    """The original rule: the team of the latest carry, until a score / wide ends it, a period ends, or 20 s pass
    without a new carry (dead ball). Stoppages counted as play; no tap-delay correction."""
    out = np.zeros(len(t), dtype=np.int8)
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    for i, c in enumerate(cs):
        nxt = cs[i + 1].video_ms if i + 1 < len(cs) else c.video_ms + 20000
        end = min(nxt, c.video_ms + 20000)
        if c.ended_by in ("score", "wide"):
            end = min(end, c.end_video_ms or c.video_ms + 4000)
        for _, ps, pe in bounds:
            if ps <= c.video_ms < pe:
                end = min(end, pe)
        a, b = np.searchsorted(t, c.video_ms), np.searchsorted(t, end)
        out[a:b] = 1 if c.team == "own" else -1
    return out


def build_grid(inp: MatchInputs, hz: float = 1.0) -> Grid:
    bounds = period_bounds(inp)
    cal = inp.sync["calibration"]
    periods = inp.sync["periods"]
    L, W = inp.pitch_length_m, inp.pitch_width_m
    step = 1000.0 / hz
    ts, hs = [], []
    for half, start, end in bounds:
        tt = np.arange(start, end, step)
        ts.append(tt); hs.append(np.full(len(tt), half))
    t = np.concatenate(ts) if ts else np.zeros(0)
    half = np.concatenate(hs).astype(np.int64) if hs else np.zeros(0, dtype=np.int64)
    gps = np.empty(len(t))
    for h, start, end in bounds:
        m = half == h
        p = next(p for p in periods if p["half"] == h)
        gps[m] = t[m] * (p.get("rate") or 1.0) + p["offset_ms"]
    right = np.array([own_attacks_right(inp.attacking_right_first_half, int(h)) for h in range(5)])[half] if len(half) else np.zeros(0, bool)

    pids = sorted(inp.tracks)
    P, T = len(pids), len(t)
    X = np.full((P, T), np.nan); Y = np.full((P, T), np.nan); S = np.full((P, T), np.nan)
    for i, pid in enumerate(pids):
        tr = inp.tracks[pid]
        idx = tr.index_for_ms(gps)
        ok = idx >= 0
        j = np.where(ok, idx, 0)
        ok &= (tr.flags[j] & codec.FLAG_BAD_FIX) == 0
        u, v = geo.latlon_to_uv(tr.lat[j], tr.lon[j], cal)
        px, py = geo.uv_to_pitch(u, v, cal)
        fx = np.where(right, px, 100.0 - px); fy = np.where(right, py, 100.0 - py)
        X[i] = np.where(ok, fx / 100.0 * L, np.nan)
        Y[i] = np.where(ok, fy / 100.0 * W, np.nan)
        S[i] = np.where(ok, tr.speed[j], np.nan)

    on = np.zeros((P, T), dtype=bool)
    iv = on_pitch_intervals(inp, bounds)
    for i, pid in enumerate(pids):
        for a, b in iv.get(pid, []):
            on[i, np.searchsorted(t, a):np.searchsorted(t, b)] = True

    align = align_carry_starts(inp, t, pids, X, Y)
    poss, setp = possession_series(inp, t, bounds, with_set_pieces=True, starts=align["starts"])
    ballX, ballY = ball_series(inp, t, half, pids, X, Y, L, W, starts=align["starts"])
    return Grid(hz, t, half, pids, X, Y, S, on, poss, ballX, ballY, setp, align)


def ball_series(inp: MatchInputs, t, half, pids, X, Y, L, W, starts=None):
    """Best estimate of the ball per sample: our carrier's GPS position while we carry; for their carries the tagged
    start -> end line (no opposition GPS). nan when nobody is carrying."""
    bx = np.full(len(t), np.nan); by = np.full(len(t), np.nan)
    row = {pid: i for i, pid in enumerate(pids)}
    cs = [c for c in inp.carries if c.team in ("own", "opponent")]
    arfh = inp.attacking_right_first_half
    st = starts if starts is not None and len(starts) == len(cs) else [c.video_ms for c in cs]
    for k, c in enumerate(cs):
        s0 = st[k]
        nxt = st[k + 1] if k + 1 < len(cs) else s0 + 8000
        end = min(nxt, (c.end_video_ms or nxt), s0 + 20000)
        a, b = np.searchsorted(t, s0), np.searchsorted(t, end)
        if b <= a:
            continue
        if c.team == "own" and c.player_id in row:
            i = row[c.player_id]
            bx[a:b] = X[i, a:b]; by[a:b] = Y[i, a:b]
        sx, sy = frame_point(c.start_x, c.start_y, c.half, arfh, L, W)
        if sx is None:
            continue
        ex, ey = frame_point(c.end_x, c.end_y, c.half, arfh, L, W)
        if ex is None:
            ex, ey = sx, sy
        w = np.linspace(0, 1, b - a)
        fill = np.isnan(bx[a:b])
        bx[a:b] = np.where(fill, sx + (ex - sx) * w, bx[a:b])
        by[a:b] = np.where(fill, sy + (ey - sy) * w, by[a:b])
    return bx, by
