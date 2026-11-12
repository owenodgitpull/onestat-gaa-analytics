"""frame.replay_times: the pitch lead (GPS clock late by the usual tap delay) and carry starts, on synthetic data with a
known answer. Pure numpy, no DB."""
import types

import numpy as np

from app.services.gps_analysis.frame import replay_times
from app.services.gps_analysis.loader import Carry

L, W = 145.0, 90.0
HZ = 10
LATE_MS = 3000          # the synced GPS clock runs this far behind the video


def _setup(seed=1, n=40):
    """One player running laps; n carries tapped 0-5 s after he really reaches each spot on the video."""
    rng = np.random.default_rng(seed)
    t = np.arange(0, 600_000, 1000 / HZ, dtype=float)                    # synced clock, ms
    # position as a function of the REAL video time; the grid at synced time g shows the video moment g - LATE_MS
    def pos(video_ms):
        a = video_ms / 60_000 * 2 * np.pi          # a lap a minute: ~4 m/s, each spot passed once a minute
        return 72.5 + 50 * np.cos(a), 45 + 30 * np.sin(a)
    gx, gy = pos(t - LATE_MS)
    X = gx[None, :]; Y = gy[None, :]
    S = np.full_like(X, 3.0); on = np.ones_like(X, dtype=bool)
    carries, true_video = [], []
    for k in range(n):
        real = 20_000 + k * 13_000
        x, y = pos(real)
        delay = rng.uniform(0, 5000)
        carries.append(Carry(id=str(k), team="own", player_id="p1", opposition_player_id=None, half=1,
                             start_x=float(x / L * 100), start_y=float(y / W * 100), end_x=None, end_y=None,
                             video_ms=int(real + delay), end_video_ms=None, ended_by="pass"))
        true_video.append(real)
    inp = types.SimpleNamespace(carries=carries, pitch_length_m=L, pitch_width_m=W, attacking_right_first_half=True,
                                sync={"tag_lag": {}})
    return inp, t, X, Y, S, on, true_video


def test_lead_found_from_the_taps_and_carries_line_up_with_the_video():
    inp, t, X, Y, S, on, true_video = _setup()
    r = replay_times(inp, t, np.ones(len(t), dtype=int), ["p1"], X, Y, S, on, [(1, 0, 600_000)])
    lead = r["lead_ms"]["1"]
    # nearly-instant taps exist, so the floor of the delays recovers the lateness (within the tap spread's edge)
    assert 2000 <= lead <= 3500, lead
    assert r["matched"] == len(true_video)
    # each start on the synced clock, drawn at video time start - lead, lands near the real moment
    err = [abs((s - lead) - v) for s, v in zip(r["starts"], true_video)]
    assert np.median(err) <= 700, np.median(err)


def test_opposition_carries_use_the_usual_delay_plus_the_lead():
    inp, t, X, Y, S, on, _ = _setup()
    opp = Carry(id="o", team="opponent", player_id=None, opposition_player_id=None, half=1, start_x=50, start_y=50,
                end_x=None, end_y=None, video_ms=300_500, end_video_ms=None, ended_by="pass")
    inp.carries = sorted(inp.carries + [opp], key=lambda c: c.video_ms)
    r = replay_times(inp, t, np.ones(len(t), dtype=int), ["p1"], X, Y, S, on, [(1, 0, 600_000)])
    i = [c.id for c in inp.carries].index("o")
    lead = r["lead_ms"]["1"]
    expect = opp.video_ms - r["median_delay_ms"] + lead
    assert abs(r["starts"][i] - expect) <= 200 or r["starts"][i] == r["starts"][i - 1] + 200
    assert 1500 <= r["median_delay_ms"] <= 3500       # uniform 0-5 s taps: median ~2.5 s
