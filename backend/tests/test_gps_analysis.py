"""GPS analysis: framing is direction-proof (mirror test) and the shape / heat-map maths on a synthetic match."""
import numpy as np

from app.services.gps_analysis.frame import frame_point, Grid
from app.services.gps_analysis import metrics as M


def test_frame_point_mirror():
    # the same physical spot, recorded with the opposite attack direction and rotated 180 degrees, frames identically
    for half in (1, 2, 3, 4):
        for x, y in ((10, 20), (75, 90), (50, 50)):
            a = frame_point(x, y, half, True, 145, 90)
            b = frame_point(100 - x, 100 - y, half, False, 145, 90)
            assert np.allclose(a, b)
    # second half flips relative to the first for the same raw point
    assert not np.allclose(frame_point(10, 20, 1, True, 145, 90), frame_point(10, 20, 2, True, 145, 90))
    # left stays left: a rotation, never a mirror of x alone
    fx, fy = frame_point(10, 20, 2, True, 145, 90, real=False)
    assert np.isclose(fx, 0.9 * 145) and np.isclose(fy, 0.8 * 90)


def test_art_warp_lines_and_round_trip():
    # the artwork's drawn lines map to the real lines (centre row), the drawn arc to the real 40 m arc all round,
    # and art -> real -> art returns the same spot; y never changes
    import math
    from app.services.gps_analysis.frame import real_to_art, art_to_real
    L, W = 145.0, 90.0
    for real_d, art_d in ((13, 14.4), (20, 19.5), (40, 44.5), (45, 50.7), (65, 65.0), (72.5, 72.5)):
        assert abs(real_to_art(real_d, 45, L, W)[0] - art_d) < 0.1
        assert abs(real_to_art(L - real_d, 45, L, W)[0] - (L - art_d)) < 0.1
    for t in (0.0, 0.4, 0.8, 1.0):
        x, y = real_to_art(40 * math.cos(t), 45 + 40 * math.sin(t), L, W)
        assert abs(math.hypot(x, y - 45) - 44.5) < 0.2
    for x, y in ((5, 85), (26.5, 75), (44, 45), (100, 10), (140, 60)):
        ax, ay = real_to_art(x, y, L, W)
        bx, by = art_to_real(ax, ay, L, W)
        assert abs(bx - x) < 0.05 and ay == y == by


def _grid(X, Y, poss):
    P, T = X.shape
    return Grid(1.0, np.arange(T) * 1000.0, np.ones(T, int), [f"p{i}" for i in range(P)], X, Y, np.full((P, T), 3.0),
                np.ones((P, T), bool), np.asarray(poss, np.int8), np.full(T, np.nan), np.full(T, np.nan))


def test_shape_series_line():
    # 12 players on a 10 m grid, 3 x 4: length 20 m, width 30 m, hull area 600 m2
    xs, ys = np.meshgrid([20, 30, 40], [10, 20, 30, 40])
    X = np.repeat(xs.ravel()[:, None], 3, 1).astype(float); Y = np.repeat(ys.ravel()[:, None], 3, 1).astype(float)
    sh = M.shape_series(_grid(X, Y, [1, -1, 0]))
    assert np.allclose(sh["length"], 20) and np.allclose(sh["width"], 30) and np.allclose(sh["area"], 600)
    assert np.allclose(sh["deep6"], (20 * 4 + 30 * 2) / 6)


def test_shape_needs_ten_players():
    X = np.full((9, 2), 30.0); Y = np.arange(9)[:, None] * np.ones((1, 2)) * 5
    sh = M.shape_series(_grid(X, Y, [1, 1]))
    assert np.isnan(sh["length"]).all()


def test_ko_patterns_only_states_supported_differences():
    """Won-v-lost kickout facts: a clear team-height and ours-near difference is stated with its n; small groups are flagged
    as not comparable; nothing is stated for a difference inside the noise."""
    from app.services.gps_analysis.metrics import _ko_patterns
    def row(won, x, near):
        return {"kind": "own", "outcome": "won clean" if won else "lost clean", "won": won, "team_mean_x": x, "ours_within_10m_of_landing": near}
    rows = [row(True, 40, 3) for _ in range(6)] + [row(False, 48, 1) for _ in range(5)]
    p = _ko_patterns(rows, {}, {})["own"]
    assert p["comparable"] is True and p["n_won"] == 6 and p["n_lost"] == 5
    whats = {f["what"] for f in p["facts"]}
    assert "team height at the kick" in whats and any("ours near the drop" in w for w in whats)
    height = next(f for f in p["facts"] if f["what"] == "team height at the kick")
    assert "8 m higher on the ones we lost" in height["reads"]
    small = _ko_patterns([row(True, 40, 3)] * 6 + [row(False, 41, 3)] * 2, {}, {})["own"]
    assert small["comparable"] is False and small["facts"] == []
