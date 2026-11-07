"""Motion-sensor channels of a raw GPS file, binned onto the track's 10 Hz grid.

STATSports RawDataExtended rows are 100 Hz (accelerometer + gyro) with the 10 Hz GPS fix repeated. Per grid sample
(0.1 s) we keep:
  pl    sum over the rows of sqrt(dAx^2 + dAy^2 + dAz^2) (g), the change from the previous row: PlayerLoad = sum / 100
  gmax  the largest resultant acceleration |A| in g: impacts for the Dynamic Stress Load estimate
  imp   sum of the file's own "Instantaneous Acceleration Impulse" column
Mirror of frontend/src/utils/gpsTimeseriesParser.ts (motion part): same binning, same formulas.
The original file is also archived in R2 (match_gps_tracks.raw_file_key), so anything else can be recomputed later.
"""
from __future__ import annotations

import zlib
from dataclasses import dataclass
from typing import Optional

import numpy as np

VERSION = 1
ACC_X_COLS = ["accl x", "accel x", "acc x", "accelerometer x"]
ACC_Y_COLS = ["accl y", "accel y", "acc y", "accelerometer y"]
ACC_Z_COLS = ["accl z", "accel z", "acc z", "accelerometer z"]
IMPULSE_COLS = ["instantaneous acceleration impulse"]


@dataclass
class Motion:
    pl: np.ndarray     # float32, length n
    gmax: np.ndarray   # float32 g
    imp: np.ndarray    # float32

    @property
    def n(self) -> int:
        return len(self.pl)


def encode(m: Motion) -> bytes:
    n = m.n
    body = b"".join([
        np.asarray(m.pl, dtype="<f4").tobytes(),
        np.clip(np.rint(np.nan_to_num(m.gmax) * 100), 0, 65535).astype("<u2").tobytes(),
        np.asarray(m.imp, dtype="<f4").tobytes(),
    ])
    assert len(body) == n * 10
    return bytes([VERSION]) + zlib.compress(body, 6)


def decode(blob: Optional[bytes], n: int) -> Optional[Motion]:
    if not blob or blob[0] != VERSION:
        return None
    body = zlib.decompress(blob[1:])
    if len(body) != n * 10:
        return None
    pl = np.frombuffer(body, dtype="<f4", count=n, offset=0).astype(np.float32)
    gmax = np.frombuffer(body, dtype="<u2", count=n, offset=4 * n).astype(np.float32) / 100.0
    imp = np.frombuffer(body, dtype="<f4", count=n, offset=6 * n).astype(np.float32)
    return Motion(pl, gmax, imp)


def from_arrays(pl, gmax, imp, n: int) -> Motion:
    if not (len(pl) == len(gmax) == len(imp) == n):
        raise ValueError("motion arrays must match the track length")
    return Motion(np.asarray(pl, dtype=np.float32), np.asarray(gmax, dtype=np.float32), np.asarray(imp, dtype=np.float32))


class Binner:
    """Feed rows in file order: add(time_of_day_s, ax, ay, az, imp). finish(t0_s, hz, n) -> Motion on the grid."""

    def __init__(self):
        self.t = []; self.pl = []; self.g = []; self.imp = []
        self._prev = None

    def add(self, t_s: float, ax: float, ay: float, az: float, imp: float):
        if self._prev is None:
            d = 0.0
        else:
            px, py, pz = self._prev
            d = ((ax - px) ** 2 + (ay - py) ** 2 + (az - pz) ** 2) ** 0.5
        self._prev = (ax, ay, az)
        self.t.append(t_s); self.pl.append(d); self.g.append((ax * ax + ay * ay + az * az) ** 0.5); self.imp.append(imp)

    def finish(self, t0_s: float, hz: int, n: int) -> Motion:
        pl = np.zeros(n, np.float64); g = np.zeros(n, np.float64); imp = np.zeros(n, np.float64)
        if self.t:
            idx = np.rint((np.array(self.t) - t0_s) * hz).astype(np.int64)
            ok = (idx >= 0) & (idx < n)
            np.add.at(pl, idx[ok], np.array(self.pl)[ok])
            np.maximum.at(g, idx[ok], np.array(self.g)[ok])
            np.add.at(imp, idx[ok], np.array(self.imp)[ok])
        return Motion(pl.astype(np.float32), g.astype(np.float32), imp.astype(np.float32))
