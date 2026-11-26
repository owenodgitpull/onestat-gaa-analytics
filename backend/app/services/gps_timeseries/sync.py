"""Find the pitch calibration and the GPS<->video offset of every period from the tagged carries.

Pure numpy: no DB access. `compute()` takes decoded tracks plus the tagged data and returns the dicts that go
on match_gps_sync. Proven on the five Donegal 2026 matches (see docs/gps-build-handover.md for the numbers).

Method
  1. Orientation-free coarse offset: carriers are running when a carry starts, so the mean device speed of the
     carriers at (carry video time + offset) peaks sharply at the true offset. Scan the whole session at 1 s.
  2. Pitch axis: PCA of the starting fifteen's positions in the first 25 minutes after that offset, trimmed so
     the bench drops out (geo.fit_axis).
  3. Orientation: the long axis can map to screen x either way and the width either way (four candidates).
     Score each by the median distance between tagged carry starts and the carriers' GPS positions over a
     +-120 s offset scan; the right one wins by 20-35 m.
  4. Per period: fine 0.1 s scan (+-15 s); periods after the first are searched over a wide window first because
     the video has the breaks cut out.
  5. Anchors: for each carry the moment the carrier was nearest the tagged spot -> implied offset; a line through
     them gives the rate (drift). Tag bias = median residual vector in period 1.
  6. Tag lag per event type: how long after the tap the player was really at the tagged spot.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Optional

import numpy as np

from . import geo
from .codec import Track, FLAG_BAD_FIX, FLAG_INTERPOLATED

MIN_CARRIES = 25
STEP_MS = 100

# Throw-in anchor (2026-11-25). The tag fit above runs the GPS clock 1-3 s late (tags are placed after the play, and its
# per-half "rate" is noise). Checked against pitch lines read off the video on Kerry, Cork and Dublin: the team's speed
# burst at a throw-in lands THROW_IN_REACT_MS after the throw-in mark, and the true clock rate is 1.0. So each period's
# offset is set from that burst and the rate fixed at 1.0. A burst that is weak, or that would move the clock by more than
# MAX_ANCHOR_SHIFT_MS, is left alone (the half's mark is probably loose); the stored tag fit stays for that half.
THROW_IN_REACT_MS = 200
MIN_BURST_JUMP = 0.85          # m/s: mean speed of the starters, next 1 s minus previous 1 s
MAX_ANCHOR_SHIFT_MS = 4000
BURST_WINDOW_MS = 20_000


@dataclass
class Tagged:
    player_id: str
    half: int
    x: float          # raw screen 0-100
    y: float
    video_ms: int
    kind: str = ""    # event type (empty for carries)


class SyncError(ValueError):
    pass


class _Grid:
    """All tracks on one 10 Hz grid so a (player, time) lookup is one fancy index."""

    def __init__(self, tracks: Dict[str, Track]):
        self.ids = list(tracks)
        self.pos = {pid: i for i, pid in enumerate(self.ids)}
        self.t0 = min(t.t0_ms for t in tracks.values())
        end = max(t.end_ms for t in tracks.values())
        self.n = int((end - self.t0) // STEP_MS) + 1
        P = len(self.ids)
        self.lat = np.full((P, self.n), np.nan); self.lon = np.full((P, self.n), np.nan)
        self.speed = np.full((P, self.n), np.nan); self.ok = np.zeros((P, self.n), dtype=bool)
        for pid, t in tracks.items():
            p = self.pos[pid]; s = int(round((t.t0_ms - self.t0) / STEP_MS))
            good = (t.flags & FLAG_BAD_FIX) == 0
            la = np.where(good, t.lat, np.nan); lo = np.where(good, t.lon, np.nan)
            self.lat[p, s:s + t.n] = la; self.lon[p, s:s + t.n] = lo
            self.speed[p, s:s + t.n] = np.where(good, t.speed, np.nan)
            self.ok[p, s:s + t.n] = good
        self.u = None; self.v = None

    def project(self, cal: dict):
        u, v = geo.latlon_to_uv(self.lat, self.lon, cal)
        self.u = u; self.v = v

    def idx(self, t_ms):
        i = np.rint((np.asarray(t_ms, dtype=np.float64) - self.t0) / STEP_MS).astype(np.int64)
        return i

    def gather(self, arr, prow, i):
        ok = (i >= 0) & (i < self.n)
        out = np.full(i.shape, np.nan)
        out[ok] = arr[prow[ok] if np.ndim(prow) else prow, i[ok]]
        return out



def throw_in_burst(grid: "_Grid", rows: List[int], centre_ms: float, half_win_ms: int = BURST_WINDOW_MS, w: int = 10):
    """(gps_ms, jump) of the steepest rise in the mean GPS speed of `rows` within +-half_win of `centre_ms` (GPS epoch ms):
    jump = mean of the next w samples minus the previous w (w = 10 is 1 s). None when the window has too little data."""
    if not rows:
        return None
    i0 = int(grid.idx(centre_ms - half_win_ms)); i1 = int(grid.idx(centre_ms + half_win_ms))
    lo = max(0, i0 - w); hi = min(grid.n, i1 + w)
    if hi - lo < 4 * w:
        return None
    with np.errstate(all="ignore"):
        m = np.nanmean(grid.speed[rows, lo:hi], axis=0)
    if np.isnan(m).mean() > 0.5:
        return None
    m = np.where(np.isnan(m), np.nanmedian(m), m)
    cs = np.concatenate([[0.0], np.cumsum(m)])
    idx = np.arange(w, len(m) - w)
    jump = (cs[idx + w] - cs[idx]) / w - (cs[idx] - cs[idx - w]) / w
    ok = (lo + idx >= i0) & (lo + idx <= i1)
    if not ok.any():
        return None
    k = int(np.argmax(np.where(ok, jump, -np.inf)))
    return float(grid.t0 + (lo + idx[k]) * STEP_MS), float(jump[k])


def anchor_to_throw_in(period: dict, grid: "_Grid", rows: List[int], log=print) -> dict:
    """Set one period's offset from its throw-in burst (see the constants above). Edits `period` in place when the burst is
    clear and the move is small; always records what it found under period["throw_in"]."""
    mark = float(period["video_start_ms"]); rate = float(period.get("rate") or 1.0); off = float(period["offset_ms"])
    cur = mark * rate + off
    found = throw_in_burst(grid, rows, cur)
    info = {"applied": False, "shift_ms": None, "jump": None}
    if found is not None:
        burst, jump = found
        new_off = burst - THROW_IN_REACT_MS - mark
        shift = new_off + mark - cur
        info.update(jump=round(jump, 2), shift_ms=int(round(shift)))
        if jump >= MIN_BURST_JUMP and abs(shift) <= MAX_ANCHOR_SHIFT_MS:
            period["offset_ms"] = int(round(new_off)); period["rate"] = 1.0; period["source"] = "throw_in"
            info["applied"] = True
    period["throw_in"] = info
    log(f"period {period['half']}: throw-in anchor {'applied' if info['applied'] else 'kept the tag fit'} "
        f"(shift {info['shift_ms']} ms, burst jump {info['jump']} m/s)")
    return info


# ------------------------------------------------------------------ no-tags fallback (2026-11-25)
# A club that does not tag carries still gets a sync. The carries did two jobs besides timing: they said roughly where the
# match sits in the hours-long GPS file, and which way round the pitch is. Without them:
#   * where: the throw-in is the moment the whole starting fifteen goes from standing to running together; the fixture's
#     kick-off time (when the match has one) narrows the search, and the later halves are looked for after the first;
#   * which way round: the lineup says who plays back and who plays forward, so the end the backs stay at is our own end,
#     and the first-half attack direction fixes the screen side. A camera view is never mirrored, so exactly one of
#     flip_u / flip_v is set (true on all five 2026 matches), which settles left against right without any tags.
HALF_GAP_MS = {2: (4 * 60_000, 30 * 60_000), 3: (60_000, 25 * 60_000), 4: (60_000, 15 * 60_000)}   # GPS gap before a half starts, after the previous one
KICKOFF_WINDOW_MS = 40 * 60_000
MIN_ORIENT_GAP_M = 10.0


def irish_local_to_utc_ms(dt) -> int:
    """A naive Irish wall-clock datetime (the match's kick-off) as UTC epoch ms. BST runs from the last Sunday of March to the
    last Sunday of October; no tz database needed."""
    import calendar
    from datetime import datetime, timedelta, timezone

    def last_sunday(year, month):
        d = datetime(year, month, calendar.monthrange(year, month)[1])
        return d - timedelta(days=(d.weekday() + 1) % 7)
    naive = dt.replace(tzinfo=None)
    bst = last_sunday(naive.year, 3).replace(hour=1) <= naive < last_sunday(naive.year, 10).replace(hour=1)
    utc = naive - timedelta(hours=1 if bst else 0)
    return int(utc.replace(tzinfo=timezone.utc).timestamp() * 1000)


class _Activity:
    """The starting fifteen's mean speed and share running (> 2 m/s), per 100 ms sample, with running sums for fast window means."""

    def __init__(self, grid: "_Grid", rows: List[int]):
        self.grid = grid
        sp = grid.speed[rows]
        with np.errstate(all="ignore"):
            m = np.nanmean(sp, axis=0)
            run = np.nanmean((sp > 2.0).astype(float), axis=0)
            present = np.mean(~np.isnan(sp), axis=0)
        self.ok = present >= 0.6
        self.m = np.where(np.isnan(m), 0.0, m); self.run = np.where(np.isnan(run), 0.0, run)
        self.cm = np.concatenate([[0.0], np.cumsum(self.m)]); self.cr = np.concatenate([[0.0], np.cumsum(self.run)])

    def mean_between(self, a_ms: float, b_ms: float) -> float:
        i = max(0, int(self.grid.idx(a_ms))); j = min(self.grid.n, int(self.grid.idx(b_ms)))
        return float((self.cm[j] - self.cm[i]) / (j - i)) if j > i + 10 else float("nan")

    def continuity(self, g_ms: float) -> float:
        """Slowest 15 s stretch in the minute after g: a real throw-in runs straight into play; a jog before the lineup stands again does not."""
        vals = [self.mean_between(g_ms + a, g_ms + a + 15_000) for a in range(4_000, 70_000, 5_000)]
        vals = [v for v in vals if not np.isnan(v)]
        return min(vals) if vals else float("nan")

    def half_score(self, g_ms: float, duration_ms: float) -> float:
        """How much g looks like the start of a half: high average speed for a half-length, and the lineup standing still just before."""
        act = self.mean_between(g_ms + 60_000, g_ms + duration_ms - 60_000)
        lead = self.mean_between(g_ms - 180_000, g_ms - 20_000)
        if np.isnan(act):
            return -9.0
        return act - 0.5 * (0.0 if np.isnan(lead) else lead)

    def triggers(self, lo_ms: float, hi_ms: float, top: int = 40, relaxed: bool = False):
        """[(gps_ms, score)] best first: moments the starters go from standing to running together, at least 60 s apart."""
        grid = self.grid
        i0 = max(0, int(grid.idx(lo_ms)) - 100); i1 = min(grid.n, int(grid.idx(hi_ms)) + 60)
        if i1 - i0 < 400:
            return []
        m = self.m[i0:i1]; run = self.run[i0:i1]; ok = self.ok[i0:i1]
        cm = np.concatenate([[0.0], np.cumsum(m)]); cr = np.concatenate([[0.0], np.cumsum(run)])
        fwd, back = 60, 100
        idx = np.arange(back, len(m) - fwd)
        nxt = (cm[idx + fwd] - cm[idx]) / fwd; prv = (cm[idx] - cm[idx - back]) / back
        rn = (cr[idx + fwd] - cr[idx]) / fwd; rp = (cr[idx] - cr[idx - back]) / back
        if relaxed:
            good = ok[idx] & (prv < 2.0) & (nxt >= 1.8) & (rn >= 0.25) & (rp <= 0.45) & (nxt - prv >= 0.8)
        else:
            good = ok[idx] & (prv < 1.5) & (nxt >= 2.0) & (rn >= 0.35) & (rp <= 0.35) & (nxt - prv >= 1.0)
        score = np.where(good, (nxt - prv) + 2.0 * (rn - rp), -np.inf)
        out = []
        for k in np.argsort(score)[::-1]:
            if not np.isfinite(score[k]):
                break
            g = float(grid.t0 + (i0 + idx[k]) * STEP_MS)
            if g < lo_ms or g > hi_ms:
                continue
            if all(abs(g - o[0]) > 60_000 for o in out):
                out.append((g, float(score[k])))
            if len(out) >= top:
                break
        return out

    def pick_start(self, lo_ms: float, hi_ms: float, duration_ms: float):
        """(gps_ms, score) of the likeliest half start in the window, or None. Candidates whose play does not carry on are dropped;
        a looser trigger is tried when the strict one finds nothing (a gentle throw-in)."""
        for relaxed in (False, True):
            best = None
            for g, trig in self.triggers(lo_ms, hi_ms, relaxed=relaxed):
                cont = self.continuity(g)
                if np.isnan(cont) or cont < 0.9:
                    continue
                sc = self.half_score(g, duration_ms) + 0.2 * trig
                if best is None or sc > best[1]:
                    best = (g, sc)
            if best is not None:
                return best
        return None


def orient_from_lineup(pos0: Dict[str, tuple], roles: Dict[str, str], attacks_right_first: bool):
    """(flip_u, flip_v, back_minus_forward_m) from where the lineup's backs and forwards play, in the unflipped pitch frame.
    pos0: player -> (mean u, mean v) over the opening minutes. Raises SyncError when it cannot tell."""
    def mean_u(pred):
        a = [pos0[p][0] for p, r in roles.items() if p in pos0 and pred((r or "").lower())]
        return (float(np.mean(a)), len(a)) if a else (None, 0)
    bu, nb = mean_u(lambda r: r.startswith(("fb-", "hb-")))
    fu, nf = mean_u(lambda r: r.startswith(("hf-", "ff-")))
    if nb < 3 or nf < 3:
        raise SyncError("the lineup needs at least three backs and three forwards with GPS to tell which end is which")
    du = bu - fu
    if abs(du) < MIN_ORIENT_GAP_M:
        raise SyncError(f"could not tell which end is which from the lineup (backs and forwards only {abs(du):.0f} m apart)")
    want = -1.0 if attacks_right_first else 1.0          # screen: attacking right means our backs are at the LEFT (low u)
    flip_u = (1.0 if du > 0 else -1.0) != want
    flip_v = not flip_u                                   # a real camera view is not mirrored: exactly one flip
    return bool(flip_u), bool(flip_v), float(du)


def _quality(tracks: Dict[str, Track], grid: "_Grid", periods: List[dict], pitch_length_m: float, pitch_width_m: float) -> dict:
    quality = {}
    for pid, t in tracks.items():
        p = grid.pos[pid]; cov = 0; tot = 0; dist = 0.0; inside = 0
        for per in periods:
            end = per.get("video_end_ms") or (per["video_start_ms"] + 40 * 60_000)
            g0 = grid.idx(per["video_start_ms"] * per["rate"] + per["offset_ms"]); g1 = grid.idx(end * per["rate"] + per["offset_ms"])
            g0 = max(0, int(g0)); g1 = min(grid.n, int(g1))
            if g1 <= g0:
                continue
            tot += g1 - g0
            okk = grid.ok[p, g0:g1]; cov += int(okk.sum())
            sp = grid.speed[p, g0:g1]; dist += float(np.nansum(sp) * STEP_MS / 1000.0)
            uu = grid.u[p, g0:g1]; vv = grid.v[p, g0:g1]
            inside += int(np.sum((np.abs(uu) <= pitch_length_m / 2 + 3) & (np.abs(vv) <= pitch_width_m / 2 + 3)))
        quality[pid] = {"coverage": round(cov / tot, 3) if tot else 0.0, "on_pitch_share": round(inside / tot, 3) if tot else 0.0,
                        "in_match": unit_in_match(cov / tot if tot else 0.0, inside / tot if tot else 0.0, dist), "match_distance_m": round(dist), "n_samples": t.n,
                        "bad_fix_share": round(float(np.mean((t.flags & FLAG_BAD_FIX) != 0)), 3), "interpolated_share": round(float(np.mean((t.flags & FLAG_INTERPOLATED) != 0)), 3)}
    return quality


def _compute_without_tags(tracks, grid, starters, period_starts, period_ends, pitch_length_m, pitch_width_m, log, cal_fixed,
                          roles, attacks_right_first, kickoff_utc_ms) -> dict:
    rows = [grid.pos[p] for p in starters if p in grid.pos]
    if len(rows) < 8:
        raise SyncError("need GPS for at least eight of the starting fifteen to sync without tagged carries")
    halves = sorted(h for h, v in period_starts.items() if v is not None)
    lo, hi = float(grid.t0), float(grid.t0 + grid.n * STEP_MS)
    if kickoff_utc_ms:
        lo, hi = max(lo, kickoff_utc_ms - KICKOFF_WINDOW_MS), min(hi, kickoff_utc_ms + KICKOFF_WINDOW_MS)
    act = _Activity(grid, rows)

    def length(h):      # how long the half runs, from the video's own marks (the video has the breaks cut out)
        e = period_ends.get(h)
        d = (e - period_starts[h]) if e else 35 * 60_000
        return float(min(50 * 60_000, max(20 * 60_000, d)))
    f1 = act.pick_start(lo, hi, length(halves[0]))
    if f1 is None:
        raise SyncError("could not find the first-half throw-in in the GPS" + (" near the fixture's kick-off time" if kickoff_utc_ms else "")
                        + ": no moment where the starting fifteen went from standing to running together and kept playing")
    found = {halves[0]: f1}
    prev_h = halves[0]
    for h in halves[1:]:
        gmin, gmax = HALF_GAP_MS.get(h, (60_000, 25 * 60_000))
        g_prev = found[prev_h][0]; dv = period_starts[h] - period_starts[prev_h]
        c = act.pick_start(g_prev + dv + gmin, g_prev + dv + gmax, length(h))
        if c is None:
            break
        found[h] = c; prev_h = h
    periods = []
    for h in halves:
        if h not in found:
            log(f"period {h}: no throw-in found, skipped"); continue
        mark = float(period_starts[h]); g = found[h][0]
        b = throw_in_burst(grid, rows, g, 15_000)
        burst = b[0] if b else g
        off = burst - THROW_IN_REACT_MS - mark
        periods.append({"half": h, "video_start_ms": int(mark), "video_end_ms": period_ends.get(h), "offset_ms": int(round(off)), "rate": 1.0,
                        "source": "throw_in", "n_carries": 0, "median_residual_m": None, "p75_residual_m": None, "bias_u_m": None, "bias_v_m": None,
                        "implied_offset_spread_s": None, "scan_profile_m": [], "anchors": [],
                        "throw_in": {"applied": True, "shift_ms": None, "jump": round(float(b[1]), 2) if b else None, "found_by": "search"}})
        log(f"period {h}: no tags, throw-in found by search at GPS {burst/1000:.0f} s, offset {off/1000:.1f} s")
    if not periods:
        raise SyncError("no period could be synced")
    # ---- pitch frame
    good_lat = grid.lat[~np.isnan(grid.lat)]; good_lon = grid.lon[~np.isnan(grid.lon)]
    origin_lat = float(np.median(good_lat)); origin_lon = float(np.median(good_lon))
    g1 = periods[0]["offset_ms"] + periods[0]["video_start_ms"]
    if cal_fixed is not None:
        origin_lat, origin_lon = cal_fixed["origin_lat"], cal_fixed["origin_lon"]
        axis = {k: cal_fixed[k] for k in ("axis_x", "axis_y", "centre_x_m", "centre_y_m", "extent_u", "extent_v")}
        if cal_fixed.get("fit"):
            axis["fit"] = cal_fixed["fit"]
    else:
        i0 = max(0, int(grid.idx(g1 + 60_000))); i1 = min(grid.n, int(grid.idx(g1 + 1_560_000)))
        xs, ys = geo.to_local_m(grid.lat[rows, i0:i1].ravel(), grid.lon[rows, i0:i1].ravel(), origin_lat, origin_lon)
        try:
            axis = geo.fit_axis(xs, ys)
        except ValueError as e:
            raise SyncError(str(e))
    cal = {"origin_lat": origin_lat, "origin_lon": origin_lon, "pitch_length_m": pitch_length_m, "pitch_width_m": pitch_width_m, **axis, "flip_u": False, "flip_v": False}
    if cal_fixed is not None and "flip_u" in cal_fixed and "flip_v" in cal_fixed:
        cal["flip_u"], cal["flip_v"] = bool(cal_fixed["flip_u"]), bool(cal_fixed["flip_v"])
    else:
        if attacks_right_first is None:
            raise SyncError("set which way the team attacks in the first half: without tagged carries that is how the pitch is turned the right way round")
        grid.project(cal)
        i0 = max(0, int(grid.idx(g1 + 60_000))); i1 = min(grid.n, int(grid.idx(g1 + 1_560_000)))
        pos0 = {}
        for pid, r in grid.pos.items():
            if pid in roles and i1 > i0:
                with np.errstate(all="ignore"):
                    mu = np.nanmean(grid.u[r, i0:i1]); mv = np.nanmean(grid.v[r, i0:i1])
                if not (np.isnan(mu) or np.isnan(mv)):
                    pos0[pid] = (float(mu), float(mv))
        fu, fv, du = orient_from_lineup(pos0, roles, attacks_right_first)
        cal["flip_u"], cal["flip_v"] = fu, fv
        cal["orientation"] = {"from": "lineup", "backs_minus_forwards_m": round(du, 1)}
        log(f"orientation from the lineup: flip_u={fu} flip_v={fv} (backs {du:+.0f} m from forwards along the pitch)")
    cal["tag_bias_u_m"] = 0.0; cal["tag_bias_v_m"] = 0.0
    grid.project(cal)
    return {"calibration": cal, "periods": periods, "tag_lag": {}, "quality": _quality(tracks, grid, periods, pitch_length_m, pitch_width_m)}


def unit_in_match(coverage: float, on_pitch_share: float, distance_m: float) -> bool:
    """Was this unit worn in the match? Over half the match recorded, OR a unit that stopped part-way: what it did record
    was mostly on this pitch with real running (a starter whose battery died at 38% still played). A unit worn elsewhere
    (a morning session) records little on the pitch and stays out."""
    if coverage > 0.5:
        return True
    return coverage >= 0.15 and on_pitch_share >= 0.8 * coverage and distance_m >= 1000

def tag_uv(px, py, cal: dict):
    """Tagged raw 0-100 spots -> pitch-frame metres (u, v), TRUE metres. Tags are placed against the pitch artwork, whose
    13 m line, arc and 45 m line are not drawn to scale (its 45 sits at 50.7 m of a 145 m pitch): each spot is read
    against the drawn lines (gps_analysis.frame.art_to_real) before it meets GPS. The straight scaling this replaces left
    tags near the 45 up to 6 m from the player's GPS, which the offsets and the tag bias were then fitted to."""
    from app.services.gps_analysis.frame import art_to_real, ART_WARP
    L = float(cal.get("pitch_length_m") or 145.0); W = float(cal.get("pitch_width_m") or 90.0)
    xs = np.atleast_1d(np.asarray(px, dtype=np.float64)) / 100.0 * L; ys = np.atleast_1d(np.asarray(py, dtype=np.float64)) / 100.0 * W
    if ART_WARP:
        xs = np.array([art_to_real(float(a), float(b), L, W)[0] for a, b in zip(xs, ys)])
    u, v = xs - L / 2, ys - W / 2
    return (u, v) if np.ndim(px) else (float(u[0]), float(v[0]))


def _prep(items: List[Tagged], grid: _Grid, half: Optional[int], cal: Optional[dict]):
    sel = [d for d in items if (half is None or d.half == half) and d.player_id in grid.pos]
    prow = np.array([grid.pos[d.player_id] for d in sel], dtype=np.int64)
    vms = np.array([d.video_ms for d in sel], dtype=np.float64)
    if cal is not None:
        tu, tv = tag_uv(np.array([d.x for d in sel]), np.array([d.y for d in sel]), cal) if sel else (np.zeros(0), np.zeros(0))
    else:
        tu = tv = None
    return sel, prow, vms, tu, tv


def _median_dist(grid: _Grid, prow, vms, tu, tv, offsets_ms, min_frac=0.7):
    """Median tagged-vs-GPS distance for every offset (metres). NaN when too few carries are inside the data."""
    O = np.asarray(offsets_ms, dtype=np.float64)
    i = grid.idx(vms[None, :] + O[:, None])                       # (offsets, carries)
    ok = (i >= 0) & (i < grid.n)
    ii = np.where(ok, i, 0)
    gu = grid.u[prow[None, :], ii]; gv = grid.v[prow[None, :], ii]
    d = np.hypot(gu - tu[None, :], gv - tv[None, :]); d[~ok] = np.nan
    valid = np.sum(~np.isnan(d), axis=1)
    med = np.nanmedian(np.where(np.isnan(d), np.nan, d), axis=1) if d.size else np.array([])
    med[valid < min_frac * len(vms)] = np.nan
    return med


def compute(tracks: Dict[str, Track], carries: List[Tagged], events: List[Tagged], starters: List[str],
            period_starts: Dict[int, int], period_ends: Dict[int, Optional[int]],
            pitch_length_m: float = 145.0, pitch_width_m: float = 90.0, log=print, cal_fixed: Optional[dict] = None,
            roles: Optional[Dict[str, str]] = None, attacks_right_first: Optional[bool] = None, kickoff_utc_ms: Optional[int] = None) -> dict:
    """Returns {"calibration", "periods", "tag_lag", "quality"}; raises SyncError when it cannot sync.
    cal_fixed: a calibration whose origin, axis and centre are already known (the whole-match pitch fit, service.run_sync's
    second pass): pass 2 is skipped; the orientation and the offsets are still found from the tags."""
    if not tracks:
        raise SyncError("no GPS tracks")
    if 1 not in period_starts or period_starts[1] is None:
        raise SyncError("the video session has no first-half throw-in mark")
    grid = _Grid(tracks)
    # ---- pass 1: coarse offset from carrier speed (orientation-free)
    sel1, prow1, vms1, _, _ = _prep(carries, grid, 1, None)
    if len(sel1) < MIN_CARRIES:
        if roles:
            log(f"only {len(sel1)} tagged first-half carries: syncing from the throw-in bursts and the lineup instead")
            return _compute_without_tags(tracks, grid, starters, period_starts, period_ends, pitch_length_m, pitch_width_m, log, cal_fixed,
                                         roles, attacks_right_first, kickoff_utc_ms)
        raise SyncError(f"need at least {MIN_CARRIES} tagged first-half carries by players with GPS, have {len(sel1)}")
    # offset = gps - video. Video times are small (ms into the file), GPS times are epoch ms, so the offset lies
    # between (session start - longest plausible video) and session end.
    offs = np.arange(grid.t0 - 4 * 3600 * 1000, grid.t0 + grid.n * STEP_MS, 1000.0)
    i = grid.idx(vms1[None, :] + offs[:, None])
    ok = (i >= 0) & (i < grid.n); ii = np.where(ok, i, 0)
    sp = grid.speed[prow1[None, :], ii]; sp[~ok] = np.nan
    valid = np.sum(~np.isnan(sp), axis=1)
    mean_sp = np.nanmean(np.where(valid[:, None] >= 0.7 * len(sel1), sp, np.nan), axis=1)
    if np.all(np.isnan(mean_sp)):
        raise SyncError("the GPS session does not overlap the tagged first half")
    j = int(np.nanargmax(mean_sp)); coarse = offs[j]
    log(f"pass1: carrier speed peak {mean_sp[j]:.2f} m/s (session median {np.nanmedian(mean_sp):.2f}) at offset {coarse/1000:.0f} s")
    # ---- pass 2: pitch axis from the starters during the first 25 minutes
    good_lat = grid.lat[~np.isnan(grid.lat)]; good_lon = grid.lon[~np.isnan(grid.lon)]
    origin_lat = float(np.median(good_lat)); origin_lon = float(np.median(good_lon))
    w0 = period_starts[1] + coarse + 60_000; w1 = w0 + 1_440_000
    i0 = max(0, int(grid.idx(w0))); i1 = min(grid.n, int(grid.idx(w1)))
    rows = [grid.pos[p] for p in starters if p in grid.pos] or list(range(len(grid.ids)))
    xs, ys = geo.to_local_m(grid.lat[rows, i0:i1].ravel(), grid.lon[rows, i0:i1].ravel(), origin_lat, origin_lon)
    if cal_fixed is not None:
        origin_lat, origin_lon = cal_fixed["origin_lat"], cal_fixed["origin_lon"]
        axis = {k: cal_fixed[k] for k in ("axis_x", "axis_y", "centre_x_m", "centre_y_m", "extent_u", "extent_v")}
        if cal_fixed.get("fit"):
            axis["fit"] = cal_fixed["fit"]
    else:
        try:
            axis = geo.fit_axis(xs, ys)
        except ValueError as e:
            raise SyncError(str(e))
    cal = {"origin_lat": origin_lat, "origin_lon": origin_lon, "pitch_length_m": pitch_length_m, "pitch_width_m": pitch_width_m, **axis, "flip_u": False, "flip_v": False}
    log(f"pass2: axis {math.degrees(math.atan2(axis['axis_y'], axis['axis_x'])):.1f} deg, fitted extent {axis['extent_u'][1]-axis['extent_u'][0]:.0f} x {axis['extent_v'][1]-axis['extent_v'][0]:.0f} m from {len(rows)} starters")
    # ---- orientation
    near = np.arange(coarse - 120_000, coarse + 120_000, 500.0)
    best = None
    for fu in (False, True):
        for fv in (False, True):
            cal["flip_u"], cal["flip_v"] = fu, fv
            grid.project(cal)
            sel, prow, vms, tu, tv = _prep(carries, grid, 1, cal)
            med = _median_dist(grid, prow, vms, tu, tv, near)
            if np.all(np.isnan(med)):
                continue
            k = int(np.nanargmin(med))
            log(f"orientation flip_u={fu} flip_v={fv}: {med[k]:.1f} m at {near[k]/1000:.1f} s")
            if best is None or med[k] < best[0]:
                best = (float(med[k]), float(near[k]), fu, fv)
    if best is None:
        raise SyncError("could not score any orientation")
    cal["flip_u"], cal["flip_v"] = best[2], best[3]
    grid.project(cal)
    # ---- per period
    periods = []
    bias_u = bias_v = 0.0
    prev_off = best[1]
    for half in (1, 2, 3, 4):
        start = period_starts.get(half)
        if start is None:
            continue
        sel, prow, vms, tu, tv = _prep(carries, grid, half, cal)
        if len(sel) < 10:
            log(f"period {half}: only {len(sel)} carries, skipped")
            continue
        if half == 1:
            c0 = best[1]
        else:
            wide = np.arange(prev_off - 600_000, prev_off + 4_000_000, 2000.0)
            med = _median_dist(grid, prow, vms, tu, tv, wide)
            if np.all(np.isnan(med)):
                log(f"period {half}: no overlap with the GPS session"); continue
            c0 = wide[int(np.nanargmin(med))]
        fine = np.arange(c0 - 15_000, c0 + 15_000, 100.0)
        med = _median_dist(grid, prow, vms, tu, tv, fine)
        if np.all(np.isnan(med)):
            continue
        k = int(np.nanargmin(med)); off = float(fine[k]); prev_off = off
        ii = grid.idx(vms + off); gu = grid.gather(grid.u, prow, ii); gv = grid.gather(grid.v, prow, ii)
        res = np.hypot(gu - tu, gv - tv)
        b_u = float(np.nanmedian(gu - tu)); b_v = float(np.nanmedian(gv - tv))
        if half == 1:
            bias_u, bias_v = b_u, b_v
        # anchors: nearest moment within +-8 s
        anchors = []
        for d, p, x_, y_ in zip(sel, prow, tu, tv):
            win = grid.idx(np.arange(d.video_ms + off - 8000, d.video_ms + off + 8000, STEP_MS))
            win = win[(win >= 0) & (win < grid.n)]
            if not len(win):
                continue
            dd = np.hypot(grid.u[p, win] - x_, grid.v[p, win] - y_)
            if np.all(np.isnan(dd)):
                continue
            q = int(np.nanargmin(dd))
            if dd[q] < 6.0:
                gps_ms = grid.t0 + int(win[q]) * STEP_MS
                anchors.append({"video_ms": int(d.video_ms), "gps_ms": int(gps_ms), "implied_offset_ms": int(gps_ms - d.video_ms), "dist_m": round(float(dd[q]), 1)})
        rate = 1.0; spread = None
        if len(anchors) > 20:
            a = np.array([[x["video_ms"], x["implied_offset_ms"]] for x in anchors], dtype=np.float64)
            A = np.column_stack([np.ones(len(a)), a[:, 0] - a[0, 0]])
            coef, *_ = np.linalg.lstsq(A, a[:, 1], rcond=None)
            rate = float(1.0 + coef[1]); spread = float(np.std(a[:, 1]) / 1000.0)
        periods.append({
            "half": half, "video_start_ms": int(start), "video_end_ms": period_ends.get(half),
            "offset_ms": int(round(off)), "rate": rate, "source": "auto",
            "n_carries": int(len(sel)), "median_residual_m": round(float(np.nanmedian(res)), 1), "p75_residual_m": round(float(np.nanpercentile(res, 75)), 1),
            "bias_u_m": round(b_u, 1), "bias_v_m": round(b_v, 1), "implied_offset_spread_s": round(spread, 2) if spread is not None else None,
            "scan_profile_m": [round(float(x), 1) if not np.isnan(x) else None for x in med[::10]],
            "anchors": anchors,
        })
        log(f"period {half}: offset {off/1000:.1f} s, rate {rate:.6f}, median residual {np.nanmedian(res):.1f} m (p75 {np.nanpercentile(res, 75):.1f}), bias ({b_u:+.1f}, {b_v:+.1f}) m, n={len(sel)}, anchors {len(anchors)}")
    if not periods:
        raise SyncError("no period could be synced")
    # ---- throw-in anchor: the offsets and rate come from the half-start burst, not from the tags
    starter_rows = [grid.pos[p] for p in starters if p in grid.pos] or list(range(len(grid.ids)))
    for per in periods:
        anchor_to_throw_in(per, grid, starter_rows, log=log)
    cal["tag_bias_u_m"] = round(bias_u, 2); cal["tag_bias_v_m"] = round(bias_v, 2)
    # ---- tag lag per event type
    by_half = {p["half"]: p for p in periods}
    lags: Dict[str, list] = {}
    for e in events:
        p = by_half.get(e.half)
        if p is None or e.player_id not in grid.pos:
            continue
        off = p["offset_ms"]; prow = grid.pos[e.player_id]
        x_, y_ = tag_uv(e.x, e.y, cal)
        win = grid.idx(np.arange(e.video_ms + off - 12_000, e.video_ms + off + 6_000, STEP_MS))
        win = win[(win >= 0) & (win < grid.n)]
        if not len(win):
            continue
        dd = np.hypot(grid.u[prow, win] - x_, grid.v[prow, win] - y_)
        if np.all(np.isnan(dd)):
            continue
        q = int(np.nanargmin(dd))
        if dd[q] < 6.0:
            lags.setdefault(e.kind, []).append((grid.t0 + int(win[q]) * STEP_MS - off - e.video_ms) / 1000.0)
    tag_lag = {k: {"n": len(v), "median_s": round(float(np.median(v)), 1), "p25_s": round(float(np.percentile(v, 25)), 1), "p75_s": round(float(np.percentile(v, 75)), 1)}
               for k, v in lags.items() if len(v) >= 3}
    # ---- per track quality inside the match periods
    quality = _quality(tracks, grid, periods, pitch_length_m, pitch_width_m)
    return {"calibration": cal, "periods": periods, "tag_lag": tag_lag, "quality": quality}
