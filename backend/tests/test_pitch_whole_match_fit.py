"""Whole-match pitch placement on a ground's measured size (geo.fit_rect, bearing_from_corners; 2026-11-23)."""
import math

import numpy as np

from app.services.gps_timeseries import geo, pitch_fit, sync


def _cloud(L, W, angle_deg, cx, cy, n=60000, seed=1):
    rng = np.random.default_rng(seed)
    u = np.clip(rng.normal(0, L / 4, n), -L / 2, L / 2)
    v = np.clip(rng.normal(0, W / 4, n), -W / 2, W / 2)
    th = math.radians(angle_deg)
    return cx + u * math.cos(th) - v * math.sin(th), cy + u * math.sin(th) + v * math.cos(th)


def _angle_err(a, b):
    d = (a - b) % 180
    return min(d, 180 - d)


def test_fit_rect_finds_centre_and_angle_without_corners():
    x, y = _cloud(137.82, 86.75, 31.0, 12.0, -7.0)
    r = geo.fit_rect(x, y, 137.82, 86.75)
    assert abs(r["centre_x_m"] - 12.0) < 0.5 and abs(r["centre_y_m"] + 7.0) < 0.5
    assert _angle_err(r["fit"]["angle_deg"], 31.0) < 0.5
    assert r["fit"]["angle_from"] == "whole-match positions"


def test_fit_rect_ignores_strays_and_uses_given_axis():
    x, y = _cloud(144.0, 84.0, 8.0, 0.0, 0.0)
    # 0.5 % of the points far behind one goal (a ball fetched, treatment off the pitch)
    sx = np.full(300, 95.0 * math.cos(math.radians(8.0))); sy = np.full(300, 95.0 * math.sin(math.radians(8.0)))
    r = geo.fit_rect(np.concatenate([x, sx]), np.concatenate([y, sy]), 144.0, 84.0,
                     axis=(math.cos(math.radians(8.0)), math.sin(math.radians(8.0))))
    assert math.hypot(r["centre_x_m"], r["centre_y_m"]) < 0.6
    assert r["fit"]["angle_from"] == "ground corners" and abs(r["fit"]["angle_deg"] - 8.0) < 0.01


def test_fit_rect_keeps_the_direction_of_the_first_axis():
    x, y = _cloud(140.0, 86.0, 30.0, 0.0, 0.0)
    th = math.radians(30.0)
    a = geo.fit_rect(x, y, 140.0, 86.0, like=(math.cos(th), math.sin(th)))
    b = geo.fit_rect(x, y, 140.0, 86.0, like=(-math.cos(th), -math.sin(th)))
    assert a["axis_x"] * math.cos(th) + a["axis_y"] * math.sin(th) > 0.99
    assert b["axis_x"] * math.cos(th) + b["axis_y"] * math.sin(th) < -0.99


def test_bearing_from_corners():
    # Croke Park's outline (OpenStreetMap way 4541251): long side ~142 m at ~70.7 degrees
    c = [[53.3602706, -6.2520854], [53.361485, -6.2513769], [53.3612344, -6.2501706], [53.3600199, -6.2508788]]
    ax = geo.bearing_from_corners(c, 53.3608, -6.2515)
    assert _angle_err(math.degrees(math.atan2(ax[1], ax[0])), 70.68) < 0.1
    # two flags on one sideline are enough; a short pair (goal posts) is refused
    assert geo.bearing_from_corners(c[:2], 53.3608, -6.2515) is not None
    assert geo.bearing_from_corners([[53.3602706, -6.2520854], [53.36030, -6.25205]], 53.3608, -6.2515) is None
    assert geo.bearing_from_corners(None, 53.0, -6.0) is None


def test_tag_uv_reads_tags_against_the_artwork():
    cal = {"pitch_length_m": 145.0, "pitch_width_m": 90.0}
    # the artwork's 45 m line sits at 34.97 % of the length: a tag on it is 45 m from the goal line, not 50.7 m
    u, _ = sync.tag_uv(np.array([34.97]), np.array([50.0]), cal)
    assert abs((u[0] + 72.5) - 45.0) < 0.3
    u, v = sync.tag_uv(50.0, 50.0, cal)
    assert abs(u) < 1e-6 and abs(v) < 1e-6


def test_ends_fit_weight_moves_part_of_the_way():
    assert "weight" in pitch_fit.fit_ends.__code__.co_varnames
