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
    fx, fy = frame_point(10, 20, 2, True, 145, 90)
    assert np.isclose(fx, 0.9 * 145) and np.isclose(fy, 0.8 * 90)


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
