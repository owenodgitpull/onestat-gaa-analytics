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
