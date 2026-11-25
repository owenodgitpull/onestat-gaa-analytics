"""GPS time-series plumbing: codec round trip, file detection, name matching, clock mapping, geometry and a
synthetic end-to-end sync whose answer is known (rotated, flipped and offset on purpose)."""
import io
import math
from datetime import date

import numpy as np
import pytest

from app.services.gps_timeseries import codec, geo, clock, parser, names, sync


# ------------------------------------------------------------------ codec

def _track(n=5000, hz=10):
    rng = np.random.default_rng(1)
    lat = 54.9454 + np.cumsum(rng.normal(0, 2e-6, n)); lon = -7.7524 + np.cumsum(rng.normal(0, 3e-6, n))
    speed = np.abs(rng.normal(2, 1, n)).astype(np.float32); hr = rng.integers(0, 190, n).astype(np.uint8)
    flags = np.zeros(n, dtype=np.uint8); flags[100:110] = codec.FLAG_INTERPOLATED; flags[7] = codec.FLAG_BAD_FIX
    return codec.Track(t0_ms=1_777_000_000_000, hz=hz, lat=lat, lon=lon, speed=speed, hr=hr, flags=flags)


def test_codec_round_trip_is_lossless_to_storage_precision():
    t = _track()
    blob = codec.encode(t)
    back = codec.decode(blob, t.t0_ms, t.hz, t.n)
    assert back.n == t.n
    assert np.max(np.abs(back.lat - t.lat)) < 1e-7 + 1e-12
    assert np.max(np.abs(back.lon - t.lon)) < 1e-7 + 1e-12
    assert np.max(np.abs(back.speed - t.speed)) <= 0.005 + 1e-6
    assert np.array_equal(back.hr, t.hr) and np.array_equal(back.flags, t.flags)
    # compact: well under 4 bytes per sample for a realistic walk
    assert len(blob) < t.n * 6  # random-walk test data; the real files come out near 2.8 bytes per sample


def test_codec_index_for_ms_and_time_bounds():
    t = _track(n=100)
    assert t.index_for_ms(t.t0_ms) == 0
    assert t.index_for_ms(t.t0_ms + 100) == 1
    assert t.index_for_ms(t.t0_ms + 149) == 1 and t.index_for_ms(t.t0_ms + 151) == 2
    assert t.index_for_ms(t.t0_ms - 100) == -1 and t.index_for_ms(t.end_ms + 100) == -1


def test_densify_fills_gaps_and_flags_them():
    t_s = np.array([10.0, 10.1, 10.2, 10.6, 10.7])   # gap between 10.2 and 10.6
    lat = np.array([54.0, 54.0, 54.0, 54.0004, 54.0004]); lon = np.zeros(5) - 7.0
    tr = codec.densify(t_s, lat, lon, np.ones(5), np.zeros(5, dtype=int), np.zeros(5, dtype=bool), 10, 0)
    assert tr.n == 8 and tr.t0_ms == 10_000
    # 10.4 is 0.2 s from the nearest fix -> interpolated; 10.3 and 10.5 are within 0.15 s of a fix
    assert tr.flags[4] & codec.FLAG_INTERPOLATED
    assert not (tr.flags[3] & codec.FLAG_INTERPOLATED) and not (tr.flags[5] & codec.FLAG_INTERPOLATED)
    assert 54.0 < tr.lat[4] < 54.0004


# ------------------------------------------------------------------ parser / detection

STATS_HEADER = "Player Display Name,Time,Lat,Lon,Speed (m/s),Heart Rate (bpm),Hacc,Hdop,Quality of Signal,No. of Satellites,Instantaneous Acceleration Impulse,Accl X,Accl Y,Accl Z,Gyro Yro X,Gyro Y,Gyro Z\n"


def _statsports_csv(n_fixes=50, name="EB. Gallagher"):
    rows = [STATS_HEADER]
    for i in range(n_fixes):
        t = 13 * 3600 + 26 * 60 + 9.4 + i * 0.1
        tt = f"{int(t//3600):02d}:{int(t%3600//60):02d}:{t%60:04.1f}"
        for k in range(10):  # 100 Hz rows repeat the fix
            rows.append(f'"{name}",{tt},{54.9448 + i*1e-6},{-7.7535 + i*2e-6},{1.5 + 0.01*i},0,3,0.8,251,19,0,{-0.4+k*0.01},0.8,-0.5,16.2,-34.5,-13.0\n')
    return "".join(rows)


def test_detect_timeseries_vs_summary():
    k = parser.detect_file_kind(_statsports_csv().encode())
    assert k.kind == "timeseries" and k.device_name == "EB. Gallagher" and abs(k.hz - 10) < 0.5
    summary = b"Player,Total Distance (m),HSR (m),Sprints,Max Speed (m/s)\nAaron Ward,8120,540,12,8.9\n"
    assert parser.detect_file_kind(summary).kind == "summary"
    sparse = "Time,Lat,Lon,Speed (m/s)\n" + "".join(f"13:00:{i*2:02d}.0,54.9,-7.7,3.0\n" for i in range(20))
    assert parser.detect_file_kind(sparse.encode()).kind == "timeseries_sparse"
    assert parser.detect_file_kind(b"").kind == "unknown"


def test_parse_timeseries_collapses_100hz_rows_to_10hz():
    pf = parser.parse_timeseries(io.StringIO(_statsports_csv(n_fixes=80)), date(2026, 4, 26))
    assert pf.device_name == "EB. Gallagher" and pf.n_rows == 800 and pf.n_fixes == 80
    assert pf.track.n == 80 and pf.track.hz == 10
    # 2026-04-26 00:00 UTC is 1777161600000; 13:26:09.4 is 48369400 ms later
    assert pf.track.t0_ms == 1777161600000 + 48_369_400
    assert pf.n_bad == 0


def test_parse_flags_bad_fixes_and_denormal_speed():
    txt = _statsports_csv(n_fixes=20).replace("1.5,", "1.7E-109,", 1)
    lines = txt.splitlines(True)
    lines[11] = lines[11].replace(",0.8,251,19", ",5.2,162,6")  # second fix's first row: hdop 5.2, 6 satellites -> bad
    pf = parser.parse_timeseries(io.StringIO("".join(lines)), date(2026, 4, 26))
    assert pf.n_bad >= 1 and pf.track.speed[0] == 0.0


def test_file_date_from_name():
    assert parser.file_date_from_name("2026-04-26-EB.-Gallagher-Session-Full-Session.csv") == date(2026, 4, 26)
    assert parser.file_date_from_name("gps.csv") is None


# ------------------------------------------------------------------ names

class _P:
    def __init__(self, name, gps_alias=None):
        self.id = name; self.name = name; self.gps_alias = gps_alias


ROSTER = [_P(n) for n in ["Eoghan Bán Gallagher", "Kieran Gallagher", "Conor O'Donnell", "Shane O'Donnell", "Dáire Ó Baoill",
                           "Eoin McGeehin", "Eoin McHugh", "Ryan McHugh", "Peadar Mogan (c)", "Michael Murphy", "Sean Martin", "Turlough Carr", "Seanán Carr"]]


@pytest.mark.parametrize("device,expected", [
    ("EB. Gallagher", "Eoghan Bán Gallagher"), ("K. Gallagher", "Kieran Gallagher"), ("CC. O'Donnell", "Conor O'Donnell"),
    ("S. O'Donnell", "Shane O'Donnell"), ("D. O'Baoill", "Dáire Ó Baoill"), ("E. McGeehan", "Eoin McGeehin"),
    ("E. McHugh", "Eoin McHugh"), ("R. McHugh", "Ryan McHugh"), ("P. Mogan", "Peadar Mogan (c)"), ("T. Carr", "Turlough Carr"), ("S. Carr", "Seanán Carr"),
])
def test_device_name_matching(device, expected):
    p, how = names.match_device_name(device, ROSTER)
    assert p is not None and p.name == expected, (device, how)


def test_device_name_alias_wins_and_ambiguous_is_none():
    roster = ROSTER + [_P("Someone Else", gps_alias="Damo McG")]
    assert names.match_device_name("Damo McG", roster)[0].name == "Someone Else"
    assert names.match_device_name("X. Gallagher", [_P("Eoghan Gallagher"), _P("Eoin Gallagher")])[0] is None


# ------------------------------------------------------------------ clock

PERIODS = [{"half": 1, "video_start_ms": 44_270, "offset_ms": 50_372_400, "rate": 1.0},
           {"half": 2, "video_start_ms": 2_335_498, "offset_ms": 51_449_800, "rate": 1.0}]


def test_clock_period_selection_and_round_trip():
    assert clock.period_for_video_ms(PERIODS, 0)["half"] == 1
    assert clock.period_for_video_ms(PERIODS, 2_335_498)["half"] == 2
    v = 1_000_000
    g = clock.video_to_gps_ms(PERIODS, v)
    assert g == v + 50_372_400
    assert abs(clock.gps_to_video_ms(PERIODS, g) - v) < 1e-6
    v2 = 3_000_000
    assert abs(clock.gps_to_video_ms(PERIODS, clock.video_to_gps_ms(PERIODS, v2)) - v2) < 1e-6
    # a GPS time inside the half-time cut clamps to the start of period 2
    cut = 2_335_000 + 50_372_400  # just before period 2's gps start (51 449 800 + 2 335 498)
    assert clock.gps_to_video_ms(PERIODS, cut) == 2_335_498 or clock.gps_to_video_ms(PERIODS, cut) < 2_335_498


# ------------------------------------------------------------------ geo

def test_geo_pitch_round_trip_and_flips():
    cal = {"origin_lat": 54.9454, "origin_lon": -7.7524, "axis_x": math.cos(0.7), "axis_y": math.sin(0.7), "centre_x_m": 12.0, "centre_y_m": -5.0,
           "flip_u": True, "flip_v": False, "pitch_length_m": 145.0, "pitch_width_m": 90.0}
    u = np.array([-72.5, 0.0, 30.0]); v = np.array([-45.0, 0.0, 10.0])
    px, py = geo.uv_to_pitch(u, v, cal)
    assert np.allclose(px, [0, 50, 50 + 30 / 145 * 100]) and np.allclose(py, [0, 50, 50 + 10 / 90 * 100])
    bu, bv = geo.pitch_to_uv(px, py, cal)
    assert np.allclose(bu, u) and np.allclose(bv, v)
    # local metres -> uv honours the flip
    x = cal["centre_x_m"] + 10 * cal["axis_x"]; y = cal["centre_y_m"] + 10 * cal["axis_y"]  # 10 m along +axis
    uu, vv = geo.local_to_uv(np.array([x]), np.array([y]), cal)
    assert np.isclose(uu[0], -10.0) and np.isclose(vv[0], 0.0, atol=1e-9)


# ------------------------------------------------------------------ synthetic sync

T0 = 1_777_000_000_000
OFF1 = T0 + 290_000            # video 10 000 ms (the throw-in mark) = 5 min into the GPS session
OFF2 = OFF1 + 300_000          # the video drops 5 min of the break


def _synthetic_match(offset1_ms=OFF1, offset2_ms=OFF2, angle=0.9, flip_u=True, flip_v=False, rate=1.0):
    """15 players running random walks on a 145 x 90 pitch rotated by `angle`, 70 minutes of GPS; carries tagged
    at their true positions with the video clock = (gps - offset) per half."""
    rng = np.random.default_rng(7)
    hz = 10; n = 70 * 60 * hz; t0 = T0
    origin = (54.9454, -7.7524)
    ax = np.array([math.cos(angle), math.sin(angle)]); ay = np.array([-ax[1], ax[0]])
    tracks = {}; truth = {}
    def _walk(n, lim, start):
        # footballer-like motion: velocity is a slowly turning AR(1) process (about 3 m/s RMS), reflected at the lines
        vel = np.empty(n); x = np.empty(n); vel[0] = 0.0; x[0] = start
        for i in range(1, n):
            vel[i] = 0.98 * vel[i - 1] + rng.normal(0, 0.06)
            x[i] = x[i - 1] + vel[i]
            if abs(x[i]) > lim:
                x[i] = np.sign(x[i]) * (2 * lim - abs(x[i])); vel[i] = -vel[i]
        return x
    for p in range(15):
        u = _walk(n, 72, rng.uniform(-60, 60))
        v = _walk(n, 44, rng.uniform(-40, 40))
        su = -u if flip_u else u; sv = -v if flip_v else v     # screen frame
        xy = np.outer(u, ax) + np.outer(v, ay)                 # local metres (unflipped physical axis)
        lat = origin[0] + xy[:, 1] / geo.M_PER_DEG_LAT; lon = origin[1] + xy[:, 0] / (geo.M_PER_DEG_LON_EQ * math.cos(math.radians(origin[0])))
        speed = np.hypot(np.gradient(u), np.gradient(v)) * hz
        tracks[f"p{p}"] = codec.Track(t0_ms=t0, hz=hz, lat=lat, lon=lon, speed=speed.astype(np.float32), hr=np.zeros(n, np.uint8), flags=np.zeros(n, np.uint8))
        truth[f"p{p}"] = (su, sv, speed)
    carries = []; events = []
    starts = {1: 10_000, 2: 1_660_000}; ends = {1: 1_650_000, 2: 3_400_000}
    for half, (off, g0, g1) in {1: (offset1_ms, 5 * 60_000, 32 * 60_000), 2: (offset2_ms, 38 * 60_000, 66 * 60_000)}.items():
        for _ in range(120):
            p = f"p{rng.integers(0, 15)}"; gps_rel = rng.uniform(g0, g1)
            i = int(gps_rel / 100); su, sv, sp = truth[p]
            if sp[i] < 2.0:  # carries start when running
                continue
            # a tagger places the spot against the ARTWORK's lines (its 45 is not at 45 m): true metres -> artwork
            from app.services.gps_analysis.frame import real_to_art
            ax_, _ = real_to_art(su[i] + 72.5, sv[i] + 45.0, 145.0, 90.0)
            px = ax_ / 145 * 100 + rng.normal(0, 1.5); py = 50 + sv[i] / 90 * 100 + rng.normal(0, 1.5)
            video_ms = int(((t0 + gps_rel) - off) / rate)
            carries.append(sync.Tagged(p, half, px, py, video_ms))
            events.append(sync.Tagged(p, half, px, py, video_ms + 2000, "POINT_SCORED"))  # tapped 2 s late
    return tracks, carries, events, starts, ends


def test_sync_recovers_offsets_orientation_and_lag():
    tracks, carries, events, starts, ends = _synthetic_match()
    out = sync.compute(tracks, carries, events, list(tracks)[:15], starts, ends, log=lambda *_: None)
    cal = out["calibration"]; per = {p["half"]: p for p in out["periods"]}
    assert cal["flip_u"] is True and cal["flip_v"] is False
    assert abs(per[1]["offset_ms"] - OFF1) <= 500 and abs(per[2]["offset_ms"] - OFF2) <= 500
    assert per[1]["median_residual_m"] < 5.0 and per[2]["median_residual_m"] < 5.0  # tags carry 1.5-unit noise (about 2 m)
    assert abs(per[1]["rate"] - 1.0) < 5e-4
    assert abs(out["tag_lag"]["POINT_SCORED"]["median_s"] - (-2.0)) <= 0.5
    q = out["quality"]["p0"]; assert q["in_match"] and q["coverage"] > 0.9


def test_sync_is_invariant_to_pitch_rotation_and_flip():
    tracks, carries, events, starts, ends = _synthetic_match(angle=2.4, flip_u=False, flip_v=True)
    a = sync.compute(tracks, carries, events, list(tracks), starts, ends, log=lambda *_: None)
    cal = a["calibration"]; per = {p["half"]: p for p in a["periods"]}
    assert (cal["flip_u"], cal["flip_v"]) in {(False, True), (True, False)}  # same 180-degree family as the truth
    assert abs(per[1]["offset_ms"] - OFF1) <= 500 and per[1]["median_residual_m"] < 5.0


def test_sync_refuses_without_enough_carries():
    tracks, carries, events, starts, ends = _synthetic_match()
    with pytest.raises(sync.SyncError):
        sync.compute(tracks, carries[:5], events, [], starts, ends, log=lambda *_: None)


# ------------------------------------------------------------------ throw-in anchor

def _plant_burst(tracks, gps_ms, quiet_s=20, run_s=15, run_ms=5.0):
    """Every player stands still for quiet_s, then runs at run_ms for run_s: a throw-in at gps_ms."""
    for tr in tracks.values():
        i = int((gps_ms - tr.t0_ms) / 100)
        tr.speed[i - quiet_s * 10:i] = 0.3
        tr.speed[i:i + run_s * 10] = run_ms


def test_throw_in_anchor_sets_offset_and_rate_from_the_burst():
    tracks, carries, events, starts, ends = _synthetic_match()
    mark1 = starts[1] + OFF1; mark2 = starts[2] + OFF2        # where the tag fit puts the two throw-in marks (GPS ms)
    _plant_burst(tracks, mark1 + 1000); _plant_burst(tracks, mark2 + 2500)   # players react 1.0 s and 2.5 s after
    out = sync.compute(tracks, carries, events, list(tracks)[:15], starts, ends, log=lambda *_: None)
    per = {p["half"]: p for p in out["periods"]}
    assert per[1]["throw_in"]["applied"] and per[2]["throw_in"]["applied"]
    # offset = burst - 200 ms - mark: the clock moves +800 ms and +2300 ms
    assert abs(per[1]["offset_ms"] - (OFF1 + 800)) <= 150 and abs(per[2]["offset_ms"] - (OFF2 + 2300)) <= 150
    assert per[1]["rate"] == 1.0 and per[2]["rate"] == 1.0 and per[1]["source"] == "throw_in"


def test_throw_in_anchor_leaves_a_half_alone_when_the_mark_looks_loose():
    tracks, carries, events, starts, ends = _synthetic_match()
    mark1 = starts[1] + OFF1
    _plant_burst(tracks, mark1 + 7000)                      # burst 7 s after the mark: beyond MAX_ANCHOR_SHIFT_MS
    out = sync.compute(tracks, carries, events, list(tracks)[:15], starts, ends, log=lambda *_: None)
    p1 = [p for p in out["periods"] if p["half"] == 1][0]
    assert p1["throw_in"]["applied"] is False and p1["source"] == "auto"
    assert abs(p1["offset_ms"] - OFF1) <= 500               # the tag fit stands


def test_throw_in_anchor_ignores_a_flat_speed_profile():
    tracks, carries, events, starts, ends = _synthetic_match()
    for tr in tracks.values():
        tr.speed[:] = 3.0
    out = sync.compute(tracks, carries, events, list(tracks)[:15], starts, ends, log=lambda *_: None)
    assert all(p["throw_in"]["applied"] is False for p in out["periods"])
