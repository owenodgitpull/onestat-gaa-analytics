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


def _prep(items: List[Tagged], grid: _Grid, half: Optional[int], cal: Optional[dict]):
    sel = [d for d in items if (half is None or d.half == half) and d.player_id in grid.pos]
    prow = np.array([grid.pos[d.player_id] for d in sel], dtype=np.int64)
    vms = np.array([d.video_ms for d in sel], dtype=np.float64)
    if cal is not None:
        tu, tv = geo.pitch_to_uv(np.array([d.x for d in sel]), np.array([d.y for d in sel]), cal)
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
            pitch_length_m: float = 145.0, pitch_width_m: float = 90.0, log=print) -> dict:
    """Returns {"calibration", "periods", "tag_lag", "quality"}; raises SyncError when it cannot sync."""
    if not tracks:
        raise SyncError("no GPS tracks")
    if 1 not in period_starts or period_starts[1] is None:
        raise SyncError("the video session has no first-half throw-in mark")
    grid = _Grid(tracks)
    # ---- pass 1: coarse offset from carrier speed (orientation-free)
    sel1, prow1, vms1, _, _ = _prep(carries, grid, 1, None)
    if len(sel1) < MIN_CARRIES:
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
    cal["tag_bias_u_m"] = round(bias_u, 2); cal["tag_bias_v_m"] = round(bias_v, 2)
    # ---- tag lag per event type
    by_half = {p["half"]: p for p in periods}
    lags: Dict[str, list] = {}
    for e in events:
        p = by_half.get(e.half)
        if p is None or e.player_id not in grid.pos:
            continue
        off = p["offset_ms"]; prow = grid.pos[e.player_id]
        x_, y_ = geo.pitch_to_uv(e.x, e.y, cal)
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
                        "in_match": bool(tot and cov / tot > 0.5), "match_distance_m": round(dist), "n_samples": t.n,
                        "bad_fix_share": round(float(np.mean((t.flags & FLAG_BAD_FIX) != 0)), 3), "interpolated_share": round(float(np.mean((t.flags & FLAG_INTERPOLATED) != 0)), 3)}
    return {"calibration": cal, "periods": periods, "tag_lag": tag_lag, "quality": quality}
