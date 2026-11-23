"""Lat/lon -> local metres -> pitch frame.

Pitch frame ("screen frame", the same one pitch_x / pitch_y on events use):
    u  metres along the pitch length from the centre, positive towards screen RIGHT (the x = 100 goal)
    v  metres across the pitch from the centre, positive towards pitch_y = 100
    pitch_x = 50 + u / pitch_length_m * 100      pitch_y = 50 + v / pitch_width_m * 100

It is direction-blind exactly like raw event coordinates: anything that reads meaning into it must go through
app/utils/attack_direction.py.

Calibration dict (stored as JSON on match_gps_sync.calibration):
    origin_lat, origin_lon   reference point of the local metre grid (any point near the pitch)
    axis_x, axis_y           unit vector (local metres, east/north) of the pitch's long axis before flipping
    centre_x_m, centre_y_m   pitch centre in local metres
    flip_u, flip_v           bools: mirror after rotating so that +u is screen right and +v is screen down
    pitch_length_m, pitch_width_m
"""
from __future__ import annotations

import math
from typing import Tuple

import numpy as np

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON_EQ = 111320.0


def to_local_m(lat, lon, origin_lat: float, origin_lon: float) -> Tuple[np.ndarray, np.ndarray]:
    """Equirectangular projection: fine to well under a metre over a pitch-sized area."""
    kx = M_PER_DEG_LON_EQ * math.cos(math.radians(origin_lat))
    return (np.asarray(lon) - origin_lon) * kx, (np.asarray(lat) - origin_lat) * M_PER_DEG_LAT


def local_to_uv(x, y, cal: dict) -> Tuple[np.ndarray, np.ndarray]:
    ax, ay = cal["axis_x"], cal["axis_y"]
    dx = np.asarray(x) - cal["centre_x_m"]; dy = np.asarray(y) - cal["centre_y_m"]
    u = dx * ax + dy * ay
    v = -dx * ay + dy * ax
    if cal.get("flip_u"):
        u = -u
    if cal.get("flip_v"):
        v = -v
    return u, v


def latlon_to_uv(lat, lon, cal: dict) -> Tuple[np.ndarray, np.ndarray]:
    x, y = to_local_m(lat, lon, cal["origin_lat"], cal["origin_lon"])
    return local_to_uv(x, y, cal)


def uv_to_pitch(u, v, cal: dict) -> Tuple[np.ndarray, np.ndarray]:
    """Pitch frame metres -> app 0-100 raw screen coordinates (may fall outside 0-100 off the pitch)."""
    L = cal.get("pitch_length_m") or 145.0
    W = cal.get("pitch_width_m") or 90.0
    return 50.0 + np.asarray(u) / L * 100.0, 50.0 + np.asarray(v) / W * 100.0


def pitch_to_uv(px, py, cal: dict) -> Tuple[np.ndarray, np.ndarray]:
    L = cal.get("pitch_length_m") or 145.0
    W = cal.get("pitch_width_m") or 90.0
    return (np.asarray(px) - 50.0) / 100.0 * L, (np.asarray(py) - 50.0) / 100.0 * W


def fit_axis(x: np.ndarray, y: np.ndarray, iterations: int = 4, box=(80.0, 52.0)) -> dict:
    """Pitch long axis + centre from a cloud of on-pitch positions (local metres).

    PCA gives the long axis; the centre is the midpoint of the 0.1 / 99.9 percentiles along each axis; points
    outside a `box` (half-sizes, metres) around that centre are trimmed and the fit repeated so bench / warm-up
    points fall out. Returns axis_x, axis_y, centre_x_m, centre_y_m, extent_u, extent_v (fitted, metres).
    """
    pts = np.column_stack([x, y]); pts = pts[~np.isnan(pts).any(axis=1)]
    if len(pts) < 100:
        raise ValueError("not enough positions to fit the pitch")
    c = np.median(pts, axis=0)
    ax = np.array([1.0, 0.0]); ext_u = ext_v = (0.0, 0.0)
    for _ in range(iterations):
        w, vecs = np.linalg.eigh(np.cov((pts - c).T)); ax = vecs[:, 1]
        if ax[0] < 0:
            ax = -ax
        R = np.array([[ax[0], ax[1]], [-ax[1], ax[0]]]); pu = (pts - c) @ R.T
        lo_u, hi_u = np.percentile(pu[:, 0], [0.1, 99.9]); lo_v, hi_v = np.percentile(pu[:, 1], [0.1, 99.9])
        c = c + R.T @ np.array([(lo_u + hi_u) / 2, (lo_v + hi_v) / 2]); pu = (pts - c) @ R.T
        ext_u = (float(np.percentile(pu[:, 0], 0.1)), float(np.percentile(pu[:, 0], 99.9)))
        ext_v = (float(np.percentile(pu[:, 1], 0.1)), float(np.percentile(pu[:, 1], 99.9)))
        keep = (np.abs(pu[:, 0]) < box[0]) & (np.abs(pu[:, 1]) < box[1])
        if keep.sum() < 100:
            break
        pts = pts[keep]
    return {"axis_x": float(ax[0]), "axis_y": float(ax[1]), "centre_x_m": float(c[0]), "centre_y_m": float(c[1]),
            "extent_u": list(ext_u), "extent_v": list(ext_v)}


# ---------------------------------------------------------------- whole-match pitch fit (2026-11-23)
def bearing_from_corners(corners, origin_lat: float, origin_lon: float):
    """Unit vector (local metres, east/north) of the pitch's LONG side from 2-4 surveyed corner points [[lat, lon], ...]
    (a ground's corner flags read off a map). Two points = the two ends of one sideline. None when it cannot tell."""
    try:
        pts = [(float(c[0]), float(c[1])) for c in corners or []]
    except (TypeError, ValueError, IndexError):
        return None
    if len(pts) < 2:
        return None
    xs, ys = to_local_m(np.array([p[0] for p in pts]), np.array([p[1] for p in pts]), origin_lat, origin_lon)
    best = None
    n = len(pts)
    pairs = [(0, 1)] if n == 2 else [(i, (i + 1) % n) for i in range(n)]
    for i, j in pairs:
        dx, dy = float(xs[j] - xs[i]), float(ys[j] - ys[i]); d = math.hypot(dx, dy)
        if best is None or d > best[0]:
            best = (d, dx, dy)
    if best is None or best[0] < 60:          # shorter than any pitch: not a sideline
        return None
    return best[1] / best[0], best[2] / best[0]


def fit_rect(x: np.ndarray, y: np.ndarray, length_m: float, width_m: float, axis=None, like=None) -> dict:
    """Where a pitch of KNOWN size sits, from every on-pitch position of the whole match (local metres).

    The first calibration read the angle and centre off the starters' first 25 minutes: up to 3 degrees out (4 m sideways
    at the goals, Killarney 2026) and 1-3 m off centre. Here:
      angle   `axis` (unit vector from the ground's surveyed corners) when given - exact; else PCA of the whole match
              (within ~1 degree of the mapped outline on four matches; the first-25-minutes PCA was up to 3).
      centre  the teams swap ends, so over a match the positions are mirror-symmetric about the centre in BOTH directions:
              the midpoint of matching low / high percentiles (median over three cuts). Two matches at Croke Park agreed
              to 0.5 m along and 1 m across.
    `like`: an earlier axis (axis_x, axis_y); the result points the same way so stored flips stay valid.
    Returns axis_x, axis_y, centre_x_m, centre_y_m, extent_u, extent_v, fit (how it was found, and how the measured cloud
    compares with the size given)."""
    pts = np.column_stack([x, y]); pts = pts[~np.isnan(pts).any(axis=1)]
    if len(pts) < 2000:
        raise ValueError("not enough on-pitch positions to place the pitch")
    c = np.median(pts, axis=0)
    if axis is not None:
        ax = np.array([float(axis[0]), float(axis[1])]); ax = ax / np.hypot(ax[0], ax[1]); source = "ground corners"
    else:
        p = pts
        ax = np.array([1.0, 0.0])
        for _ in range(3):
            _, vecs = np.linalg.eigh(np.cov((p - c).T)); ax = vecs[:, 1]
            R = np.array([[ax[0], ax[1]], [-ax[1], ax[0]]]); pu = (p - c) @ R.T
            keep = (np.abs(pu[:, 0] - np.median(pu[:, 0])) < length_m / 2 + 8) & (np.abs(pu[:, 1] - np.median(pu[:, 1])) < width_m / 2 + 8)
            if keep.sum() < 2000:
                break
            p = p[keep]; c = np.median(p, axis=0)
        source = "whole-match positions"
    if like is not None and ax[0] * like[0] + ax[1] * like[1] < 0:
        ax = -ax
    R = np.array([[ax[0], ax[1]], [-ax[1], ax[0]]])
    pu = (pts - c) @ R.T
    mid = np.zeros(2)
    for _ in range(3):                              # trim strays (treatment off the pitch, a ball fetched behind the goal)
        q = pu - mid
        inb = (np.abs(q[:, 0]) < length_m / 2 + 5) & (np.abs(q[:, 1]) < width_m / 2 + 5)
        if inb.sum() < 2000:
            break
        cuts = []
        for k in (0.3, 0.5, 1.0):
            lo = np.percentile(pu[inb], k, axis=0); hi = np.percentile(pu[inb], 100 - k, axis=0)
            cuts.append((lo + hi) / 2)
        mid = np.median(np.array(cuts), axis=0)
    centre = c + R.T @ mid
    pu = (pts - centre) @ R.T
    inb = (np.abs(pu[:, 0]) < length_m / 2 + 5) & (np.abs(pu[:, 1]) < width_m / 2 + 5)
    eu = [float(v) for v in np.percentile(pu[inb, 0], [0.3, 99.7])]; ev = [float(v) for v in np.percentile(pu[inb, 1], [0.3, 99.7])]
    return {"axis_x": float(ax[0]), "axis_y": float(ax[1]), "centre_x_m": float(centre[0]), "centre_y_m": float(centre[1]),
            "extent_u": eu, "extent_v": ev,
            "fit": {"angle_from": source, "angle_deg": round(math.degrees(math.atan2(ax[1], ax[0])), 2), "positions": int(len(pts)),
                    "reach_length_m": round(eu[1] - eu[0], 1), "reach_width_m": round(ev[1] - ev[0], 1),
                    "outside_share": round(float(1 - np.mean((np.abs(pu[:, 0]) <= length_m / 2 + 1) & (np.abs(pu[:, 1]) <= width_m / 2 + 1))), 4)}}
