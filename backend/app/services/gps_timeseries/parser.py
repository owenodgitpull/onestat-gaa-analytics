"""Read a raw GPS time-series file and detect what kind of GPS file something is.

Known shape: STATSports "RawDataExtended" (one CSV per player, 100 Hz rows, GPS fix repeated 10x per 0.1 s):
    Player Display Name,Time,Lat,Lon,Speed (m/s),Heart Rate (bpm),Hacc,Hdop,Quality of Signal,No. of Satellites,...
Any file with a time column and lat/lon (or x/y metres) columns is accepted; column names are matched loosely.

`Time` is time of day (HH:MM:SS.s) in UTC and has no date: the caller passes the match date. The file name usually
starts with the date too (2026-04-26-...), used as a cross-check only.
"""
from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import IO, Iterable, Optional

import numpy as np

from .codec import Track, densify

TIME_COLS = ("time", "timestamp", "utc time", "time (utc)", "elapsed time", "time of day")
LAT_COLS = ("lat", "latitude")
LON_COLS = ("lon", "long", "longitude", "lng")
SPEED_COLS = ("speed (m/s)", "speed", "velocity", "speed m/s")
HR_COLS = ("heart rate (bpm)", "heart rate", "hr", "hr (bpm)")
HDOP_COLS = ("hdop",)
SAT_COLS = ("no. of satellites", "satellites", "num satellites", "nsat")
NAME_COLS = ("player display name", "player", "player name", "name", "athlete")
SUMMARY_HINTS = ("total distance", "distance", "hsr", "high speed", "sprint", "player load", "max speed", "dsl")

HZ = 10
BAD_HDOP = 2.5
MIN_SATS = 8
FILE_DATE_RE = re.compile(r"(20\d\d)-(\d\d)-(\d\d)")


@dataclass
class FileKind:
    kind: str                      # 'timeseries' | 'timeseries_sparse' | 'summary' | 'unknown'
    message: str
    columns: list = field(default_factory=list)
    device_name: Optional[str] = None
    hz: Optional[float] = None


def _find(cols: list[str], names: Iterable[str]) -> Optional[int]:
    low = [c.strip().lower() for c in cols]
    for n in names:
        if n in low:
            return low.index(n)
    return None


def _parse_hms(s: str) -> float:
    h, m, sec = s.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + float(sec)


def detect_file_kind(head: bytes) -> FileKind:
    """Decide from the first 64 KB whether a file is a raw time series or the usual per-player summary (a 100 Hz
    STATSports file needs about 40 KB to show ten distinct timestamps)."""
    text = head.decode("utf-8", errors="replace")
    lines = [ln for ln in text.splitlines() if ln.strip()]
    if not lines:
        return FileKind("unknown", "Empty file")
    cols = next(csv.reader([lines[0]]))
    ti, lai, loi = _find(cols, TIME_COLS), _find(cols, LAT_COLS), _find(cols, LON_COLS)
    if ti is not None and lai is not None and loi is not None:
        times = []
        name = None
        for ln in lines[1:400]:
            try:
                row = next(csv.reader([ln]))
                times.append(_parse_hms(row[ti]))
                ni = _find(cols, NAME_COLS)
                if name is None and ni is not None:
                    name = row[ni].strip()
            except Exception:
                continue
        uniq = np.unique(np.array(times)) if times else np.array([])
        hz = None
        if len(uniq) > 5:
            hz = float(1.0 / np.median(np.diff(uniq)))
        if hz is not None and hz < 4.0:
            return FileKind("timeseries_sparse", f"GPS time series but only about {hz:.1f} samples per second: looks like a burst or event export, not a full 10 Hz track", cols, name, hz)
        return FileKind("timeseries", f"Full GPS time series ({hz:.0f} positions per second){' for ' + name if name else ''}: one file per player, upload with the time-series uploader", cols, name, hz)
    low = [c.lower() for c in cols]
    if any(any(h in c for h in SUMMARY_HINTS) for c in low):
        return FileKind("summary", "Per-player GPS summary (one row per player)", cols)
    return FileKind("unknown", "Could not recognise the columns", cols)


def file_date_from_name(filename: str) -> Optional[date]:
    m = FILE_DATE_RE.search(filename or "")
    if not m:
        return None
    try:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except ValueError:
        return None


@dataclass
class ParsedFile:
    device_name: str
    track: Track
    n_rows: int
    n_fixes: int
    n_bad: int
    columns: list
    motion: Optional["Motion"] = None


def parse_timeseries(fh: IO[str], match_date: date, hz: int = HZ, with_motion: bool = False) -> ParsedFile:
    """Stream a raw file into a dense track. Only rows whose Time differs from the previous row are parsed, which
    collapses the 100 Hz accelerometer rows to the 10 Hz GPS fixes without reading every field."""
    header = fh.readline()
    cols = next(csv.reader([header]))
    ti, lai, loi = _find(cols, TIME_COLS), _find(cols, LAT_COLS), _find(cols, LON_COLS)
    if ti is None or lai is None or loi is None:
        raise ValueError("not a GPS time series: needs Time, Lat and Lon columns")
    si, hi, hdi, sati, ni = _find(cols, SPEED_COLS), _find(cols, HR_COLS), _find(cols, HDOP_COLS), _find(cols, SAT_COLS), _find(cols, NAME_COLS)
    from app.services.gps_timeseries import motion as motion_mod
    axi, ayi, azi, ipi = (_find(cols, motion_mod.ACC_X_COLS), _find(cols, motion_mod.ACC_Y_COLS),
                          _find(cols, motion_mod.ACC_Z_COLS), _find(cols, motion_mod.IMPULSE_COLS))
    binner = motion_mod.Binner() if with_motion and None not in (axi, ayi, azi) else None
    t = []; lat = []; lon = []; spd = []; hr = []; bad = []
    last = None; name = None; n_rows = 0
    last_motion_t = None; last_motion_s = 0.0
    reader = csv.reader(fh)
    for row in reader:
        n_rows += 1
        if len(row) <= max(ti, lai, loi):
            continue
        tt = row[ti]
        if binner is not None:
            try:
                if tt != last_motion_t:
                    last_motion_t = tt; last_motion_s = _parse_hms(tt)
                binner.add(last_motion_s, float(row[axi]), float(row[ayi]), float(row[azi]), float(row[ipi]) if ipi is not None and row[ipi] else 0.0)
            except (ValueError, IndexError):
                pass
        if tt == last:
            continue
        last = tt
        try:
            ts = _parse_hms(tt)
            la = float(row[lai]); lo = float(row[loi])
        except ValueError:
            continue
        if name is None and ni is not None:
            name = row[ni].strip().strip('"')
        t.append(ts); lat.append(la); lon.append(lo)
        try:
            spd.append(float(row[si]) if si is not None else 0.0)
        except ValueError:
            spd.append(0.0)
        try:
            hr.append(int(float(row[hi])) if hi is not None else 0)
        except ValueError:
            hr.append(0)
        b = la == 0.0 or lo == 0.0
        try:
            if hdi is not None and float(row[hdi]) > BAD_HDOP:
                b = True
            if sati is not None and float(row[sati]) < MIN_SATS:
                b = True
        except ValueError:
            pass
        bad.append(b)
    if not t:
        raise ValueError("no GPS fixes found")
    t = np.array(t); lat = np.array(lat); lon = np.array(lon); spd = np.array(spd); hr = np.array(hr); bad = np.array(bad)
    spd = np.where(np.abs(spd) < 1e-6, 0.0, spd)  # 1.7E-109 style denormals
    # drop junk fixes far from where the session was (before satellite lock)
    good = ~bad & (lat != 0) & (lon != 0)
    if good.sum() >= 50:
        mlat = np.median(lat[good]); mlon = np.median(lon[good])
        far = (np.abs(lat - mlat) > 0.01) | (np.abs(lon - mlon) > 0.02)  # ~1 km
        bad = bad | far
    n_bad = int(bad.sum())
    # fixes with lat/lon 0 are useless even for interpolation
    usable = (lat != 0) & (lon != 0)
    if usable.sum() == 0:
        raise ValueError("every fix is empty (no satellite lock)")
    date_epoch_s = int(datetime(match_date.year, match_date.month, match_date.day, tzinfo=timezone.utc).timestamp())
    track = densify(t[usable], lat[usable], lon[usable], spd[usable], hr[usable], bad[usable], hz, date_epoch_s)
    mot = binner.finish(track.t0_ms / 1000.0 - date_epoch_s, hz, track.n) if binner is not None else None
    return ParsedFile(device_name=name or "", track=track, n_rows=n_rows, n_fixes=int(len(t)), n_bad=n_bad, columns=cols, motion=mot)


def parse_timeseries_bytes(data: bytes, match_date: date, hz: int = HZ) -> ParsedFile:
    return parse_timeseries(io.StringIO(data.decode("utf-8", errors="replace")), match_date, hz)


def track_from_arrays(t0_ms: int, hz: int, lat, lon, speed, hr, flags) -> Track:
    """Build a Track from arrays a client already parsed (the browser uploader sends these)."""
    n = len(lat)
    for a in (lon, speed, hr, flags):
        if len(a) != n:
            raise ValueError("array lengths differ")
    return Track(t0_ms=int(t0_ms), hz=int(hz), lat=np.asarray(lat, dtype=np.float64), lon=np.asarray(lon, dtype=np.float64),
                 speed=np.asarray(speed, dtype=np.float32), hr=np.asarray(hr, dtype=np.uint8), flags=np.asarray(flags, dtype=np.uint8))
