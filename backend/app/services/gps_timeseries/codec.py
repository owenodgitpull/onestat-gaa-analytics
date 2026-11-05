"""Pack / unpack one player's dense 10 Hz track.

Blob format v1:
    byte 0            version (1)
    bytes 1..         zlib(level 6) of the concatenated columns, in this order, little-endian:
        lat_e7   int32   first value absolute, then deltas   (degrees * 1e7)
        lon_e7   int32   first value absolute, then deltas
        speed    uint16  cm/s (device speed, 0 when missing)
        hr       uint8   bpm, 0 = no strap
        flags    uint8   bit0 interpolated gap, bit1 bad fix, bit2 clamped

Sample i is at t0_ms + i * (1000 / hz). The arrays are dense (gaps interpolated and flagged), so a time maps to
an index with one division: i = round((t_ms - t0_ms) * hz / 1000).

Positions are stored as raw lat/lon on purpose: the pitch calibration (axis, centre, flips) is only known after the
sync and may be redone later; projecting 90k points to the pitch frame is a few milliseconds of numpy at read time.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass

import numpy as np

VERSION = 1
FLAG_INTERPOLATED = 1
FLAG_BAD_FIX = 2
FLAG_CLAMPED = 4


@dataclass
class Track:
    """Dense track. All arrays have the same length n."""
    t0_ms: int
    hz: int
    lat: np.ndarray    # float64 degrees
    lon: np.ndarray    # float64 degrees
    speed: np.ndarray  # float32 m/s
    hr: np.ndarray     # uint8 bpm
    flags: np.ndarray  # uint8

    @property
    def n(self) -> int:
        return int(len(self.lat))

    @property
    def end_ms(self) -> int:
        return int(self.t0_ms + (self.n - 1) * 1000 / self.hz) if self.n else int(self.t0_ms)

    def times_ms(self) -> np.ndarray:
        return self.t0_ms + np.arange(self.n, dtype=np.int64) * (1000 // self.hz)

    def index_for_ms(self, t_ms) -> np.ndarray:
        """Nearest sample index for GPS UTC epoch ms (scalar or array); out-of-range values are returned as -1."""
        idx = np.rint((np.asarray(t_ms, dtype=np.float64) - self.t0_ms) * self.hz / 1000.0).astype(np.int64)
        return np.where((idx >= 0) & (idx < self.n), idx, -1)


def _delta_encode(a: np.ndarray) -> np.ndarray:
    out = np.empty_like(a)
    if len(a):
        out[0] = a[0]
        out[1:] = np.diff(a)
    return out


def _delta_decode(a: np.ndarray) -> np.ndarray:
    return np.cumsum(a, dtype=a.dtype)


def encode(track: Track) -> bytes:
    n = track.n
    lat_e7 = np.rint(track.lat * 1e7).astype(np.int32)
    lon_e7 = np.rint(track.lon * 1e7).astype(np.int32)
    speed = np.clip(np.rint(np.nan_to_num(track.speed, nan=0.0) * 100.0), 0, 65535).astype(np.uint16)
    hr = np.clip(np.nan_to_num(track.hr, nan=0), 0, 255).astype(np.uint8)
    flags = track.flags.astype(np.uint8)
    body = b"".join([
        _delta_encode(lat_e7).astype("<i4").tobytes(),
        _delta_encode(lon_e7).astype("<i4").tobytes(),
        speed.astype("<u2").tobytes(),
        hr.tobytes(),
        flags.tobytes(),
    ])
    assert len(body) == n * (4 + 4 + 2 + 1 + 1)
    return bytes([VERSION]) + zlib.compress(body, 6)


def decode(blob: bytes, t0_ms: int, hz: int, n: int) -> Track:
    if not blob or blob[0] != VERSION:
        raise ValueError(f"unknown gps track blob version {blob[:1]!r}")
    body = zlib.decompress(blob[1:])
    if len(body) != n * 12:
        raise ValueError(f"gps track blob length {len(body)} does not match n={n}")
    o = 0
    lat_e7 = _delta_decode(np.frombuffer(body, dtype="<i4", count=n, offset=o)); o += 4 * n
    lon_e7 = _delta_decode(np.frombuffer(body, dtype="<i4", count=n, offset=o)); o += 4 * n
    speed = np.frombuffer(body, dtype="<u2", count=n, offset=o).astype(np.float32) / 100.0; o += 2 * n
    hr = np.frombuffer(body, dtype=np.uint8, count=n, offset=o).copy(); o += n
    flags = np.frombuffer(body, dtype=np.uint8, count=n, offset=o).copy()
    return Track(t0_ms=int(t0_ms), hz=int(hz), lat=lat_e7.astype(np.float64) / 1e7, lon=lon_e7.astype(np.float64) / 1e7,
                 speed=speed, hr=hr, flags=flags)


def densify(t_s: np.ndarray, lat: np.ndarray, lon: np.ndarray, speed: np.ndarray, hr: np.ndarray, bad: np.ndarray,
            hz: int, date_epoch_s: int) -> Track:
    """Turn irregular fixes (time of day in seconds, UTC) into a dense fixed-rate track.

    t_s must be non-decreasing. Duplicated timestamps keep the first fix. Gaps are linearly interpolated and
    flagged FLAG_INTERPOLATED when no fix lies within 1.5 sample periods. `bad` marks fixes to flag FLAG_BAD_FIX
    (they still contribute to the interpolation unless every fix is bad).
    """
    if len(t_s) == 0:
        raise ValueError("no fixes")
    order = np.argsort(t_s, kind="stable")
    t_s = t_s[order]; lat = lat[order]; lon = lon[order]; speed = speed[order]; hr = hr[order]; bad = bad[order]
    keep = np.concatenate([[True], np.diff(t_s) > 1e-6])
    t_s, lat, lon, speed, hr, bad = t_s[keep], lat[keep], lon[keep], speed[keep], hr[keep], bad[keep]
    step = 1.0 / hz
    t0 = np.floor(t_s[0] / step) * step
    n = int(np.floor((t_s[-1] - t0) / step + 1e-6)) + 1
    grid = t0 + np.arange(n) * step
    lat_d = np.interp(grid, t_s, lat)
    lon_d = np.interp(grid, t_s, lon)
    speed_d = np.interp(grid, t_s, speed)
    hr_d = np.interp(grid, t_s, hr.astype(np.float64))
    # nearest-fix distance -> interpolated flag
    pos = np.searchsorted(t_s, grid)
    left = np.clip(pos - 1, 0, len(t_s) - 1); right = np.clip(pos, 0, len(t_s) - 1)
    nearest = np.minimum(np.abs(grid - t_s[left]), np.abs(grid - t_s[right]))
    flags = np.zeros(n, dtype=np.uint8)
    flags[nearest > 1.5 * step] |= FLAG_INTERPOLATED
    bad_d = bad[np.where(np.abs(grid - t_s[left]) <= np.abs(grid - t_s[right]), left, right)]
    flags[bad_d] |= FLAG_BAD_FIX
    t0_ms = int(round(date_epoch_s * 1000 + t0 * 1000))
    return Track(t0_ms=t0_ms, hz=hz, lat=lat_d, lon=lon_d, speed=speed_d.astype(np.float32),
                 hr=np.clip(np.rint(hr_d), 0, 255).astype(np.uint8), flags=flags)
