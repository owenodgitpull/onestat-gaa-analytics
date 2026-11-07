"""Per-player match summary (the match_gps_data rows the Match Result GPS section, leaderboards and charts read),
worked out from the raw time series.

Only time ON THE PITCH counts: video-synced periods (throw-in to half-time / full-time), the lineup, subs and cards
(gps_analysis.frame.on_pitch_intervals). Warm-ups, half-time and the bench are left out.

Definitions (STATSports defaults where they publish one):
  distance        sum of device speed x 0.1 s
  high-speed      distance above 5.5 m/s (19.8 km/h); sprint distance above 7.0 m/s (25.2 km/h)
  sprints         efforts above 7.0 m/s lasting 1 s or more
  accels / decels speed change above +3 / below -3 m/s^2 held for 0.3 s or more (speed smoothed over 0.3 s)
  max speed       highest 0.3 s average speed (single-sample spikes ignored), capped at 11.5 m/s
  HML distance    distance while metabolic power is above 25.5 W/kg (di Prampero / Osgnach energy cost of
                  accelerated running, the published model STATSports uses). Close to their figure, not identical:
                  their speed smoothing is not published
  DSL (estimate)  sum of weighted impacts: peaks of the resultant acceleration above 2 g, weight (g / 2)^3, scaled so a full inter-county game is about 450.
                  STATSports publishes the method (impacts over 2 g, weighted by size) but not the exact weighting,
                  so this is consistent match to match, not identical to their number
  player load     sum of sqrt(dAx^2 + dAy^2 + dAz^2) / 100 at 100 Hz (the public PlayerLoad formula)
  heart rate      average / max while on; red zone = minutes above 90% of the player's highest heart rate in the file

Official summaries win: a row a STATSports summary upload wrote (raw_data.source is not "raw_gps") is only filled
where a field is empty. Uploading a summary after this overwrites the calculated figures it contains.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Dict, List, Optional

import numpy as np
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match_gps import MatchGPSData
from app.services.gps_timeseries import codec, motion as motion_mod

logger = logging.getLogger(__name__)

SOURCE = "raw_gps"
HSR = 5.5
SPRINT = 7.0
ACCEL = 3.0
HML_W_KG = 25.5
DSL_G = 2.0
DSL_SCALE = 0.0046       # every hard footstrike counts at 100 Hz: scaled so a full inter-county game lands near 450, the usual STATSports range (Kerry, Down, Kerry, Cork, Dublin 2026: raw median 9,700)
MAX_SPEED_CAP = 11.5
KT = 1.29                # terrain constant of the energy-cost model (grass)
G = 9.81

FIELDS = ["total_distance_m", "high_speed_running_m", "sprint_distance_m", "hml_distance_m", "max_speed_ms", "avg_speed_ms",
          "sprint_count", "acceleration_count", "deceleration_count", "dynamic_stress_load", "player_load",
          "avg_heart_rate", "max_heart_rate", "time_in_red_zone_mins", "playing_minutes", "started_as_sub", "duration_mins"]


def _runs(mask: np.ndarray, min_len: int) -> int:
    if not mask.any():
        return 0
    d = np.diff(np.concatenate([[0], mask.astype(np.int8), [0]]))
    starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
    return int(((ends - starts) >= min_len).sum())


def _smooth(a: np.ndarray, k: int) -> np.ndarray:
    return np.convolve(a, np.ones(k) / k, mode="same")


def metabolic_power(speed: np.ndarray, acc: np.ndarray) -> np.ndarray:
    """W/kg from speed (m/s) and forward acceleration (m/s^2), di Prampero 2005 / Osgnach 2010."""
    es = acc / G
    em = np.sqrt(es * es + 1.0)
    ec = (155.4 * es ** 5 - 30.4 * es ** 4 - 43.3 * es ** 3 + 46.3 * es ** 2 + 19.5 * es + 3.6) * em * KT
    return ec * speed


def player_summary(speed: np.ndarray, on: np.ndarray, hz: float, hr: Optional[np.ndarray] = None, hr_max_file: Optional[float] = None,
                   mot: Optional[dict] = None) -> dict:
    """speed: m/s per sample (nan = no fix), on: bool per sample. mot: {'pl','gmax'} arrays aligned to speed."""
    dt = 1.0 / hz
    s = np.where(on & ~np.isnan(speed), speed, 0.0)
    s = np.where(s < 0, 0.0, s)
    on_n = int(on.sum())
    out: Dict[str, Optional[float]] = {}
    out["total_distance_m"] = round(float(s.sum() * dt), 1)
    out["high_speed_running_m"] = round(float(s[s > HSR].sum() * dt), 1)
    out["sprint_distance_m"] = round(float(s[s > SPRINT].sum() * dt), 1)
    out["avg_speed_ms"] = round(float(s.sum() / on_n), 2) if on_n else None
    sm3 = _smooth(s, 3)
    out["max_speed_ms"] = round(float(min(MAX_SPEED_CAP, sm3[on].max())), 2) if on_n else None
    out["sprint_count"] = _runs(on & (s > SPRINT), int(round(hz)))
    k = max(1, int(round(0.3 * hz)))
    vs = _smooth(s, k)
    acc = np.gradient(vs) * hz
    acc = np.where(on, acc, 0.0)
    out["acceleration_count"] = _runs(on & (acc > ACCEL), k)
    out["deceleration_count"] = _runs(on & (acc < -ACCEL), k)
    p = metabolic_power(vs, np.clip(acc, -6, 6))
    out["hml_distance_m"] = round(float(s[on & (p > HML_W_KG)].sum() * dt), 1)
    if mot is not None:
        g = np.where(on, mot["gmax"], 0.0)
        peak = (g > DSL_G) & (g >= np.roll(g, 1)) & (g >= np.roll(g, -1))
        out["dynamic_stress_load"] = round(float(((g[peak] / DSL_G) ** 3).sum() * DSL_SCALE), 1)
        out["player_load"] = round(float(np.where(on, mot["pl"], 0.0).sum() / 100.0), 1)
    else:
        out["dynamic_stress_load"] = None; out["player_load"] = None
    if hr is not None:
        h = hr[on & (hr > 30)]
        # no strap worn = a constant filler value (82 in STATSports files): treat as no heart rate
        if len(h) > hz * 60 and h.std() >= 3 and h.max() > 100:
            out["avg_heart_rate"] = int(round(h.mean())); out["max_heart_rate"] = int(h.max())
            if hr_max_file:
                out["time_in_red_zone_mins"] = round(float((h > 0.9 * hr_max_file).sum() / hz / 60.0), 1)
    return out


async def derive(db: AsyncSession, match, log=logger.info) -> dict:
    """Write / refresh match_gps_data for every tracked player who was on the pitch. Needs the video sync.
    Returns {'written': n, 'official_kept': n, 'players': [...]}. Caller commits."""
    from app.services.gps_analysis import loader, frame
    inp = await loader.load_match(db, match, with_tracks=True)
    g = frame.build_grid(inp, 10.0)
    if not len(g.t):
        raise loader.NotReady("no match periods")
    gps_ms = np.empty(len(g.t))
    for h in np.unique(g.half):
        p = next(p for p in inp.sync["periods"] if p["half"] == int(h))
        m = g.half == h
        gps_ms[m] = g.t[m] * (p.get("rate") or 1.0) + p["offset_ms"]
    aux_rows = {str(r[0]): (r[1], int(r[2])) for r in (await db.execute(text(
        "select player_id, aux, n_samples from match_gps_tracks where match_id = :m"), {"m": inp.match_id})).all()}
    bounds = frame.period_bounds(inp)
    iv = frame.on_pitch_intervals(inp, bounds)
    existing = {str(r.player_id): r for r in (await db.execute(select(MatchGPSData).where(MatchGPSData.match_id == match.id))).scalars().all()}
    written = kept = 0
    players: List[dict] = []
    for i, pid in enumerate(g.pids):
        on = g.on[i]
        if on.sum() < 10 * 60:          # under a minute on the pitch
            continue
        tr = inp.tracks[pid]
        idx = tr.index_for_ms(gps_ms)
        ok = idx >= 0
        j = np.where(ok, idx, 0)
        bad = (tr.flags[j] & codec.FLAG_BAD_FIX) != 0
        speed = np.where(ok & ~bad, tr.speed[j].astype(np.float64), np.nan)
        hr = np.where(ok, tr.hr[j].astype(np.float64), 0.0)
        hr_file = tr.hr[(tr.hr > 30) & (tr.hr < 230)]
        mot = None
        blob, n = aux_rows.get(pid, (None, 0))
        mm = motion_mod.decode(blob, n) if blob else None
        if mm is not None:
            mot = {"pl": np.where(ok, mm.pl[j], 0.0), "gmax": np.where(ok, mm.gmax[j], 0.0)}
        vals = player_summary(speed, on & ok, 10.0, hr, float(hr_file.max()) if len(hr_file) else None, mot)
        mins = sum(b - a for a, b in iv.get(pid, [])) / 60000.0
        vals["playing_minutes"] = int(round(mins)); vals["duration_mins"] = round(mins, 1)
        vals["started_as_sub"] = pid not in inp.starters
        row = existing.get(pid)
        if row is None:
            row = MatchGPSData(match_id=match.id, player_id=uuid.UUID(pid))
            db.add(row)
            official = False
        else:
            official = ((row.raw_data or {}).get("source") != SOURCE) and any(getattr(row, f) is not None for f in FIELDS[:12])
        filled = []
        for f in FIELDS:
            v = vals.get(f)
            if v is None:
                continue
            if official and getattr(row, f) is not None:
                continue
            setattr(row, f, v); filled.append(f)
        if official:
            kept += 1
            rd = dict(row.raw_data or {}); rd["raw_gps_filled"] = filled; rd["raw_gps_values"] = vals
            row.raw_data = rd
        else:
            row.raw_data = {"source": SOURCE, "computed_at": datetime.utcnow().isoformat(timespec="seconds"), "name": inp.players.get(pid, {}).get("name"),
                            "motion": mm is not None, **vals}
        written += 1
        players.append({"player_id": pid, "name": inp.players.get(pid, {}).get("name"), "official_kept": official, **vals})
    await db.flush()
    log(f"GPS summary from raw: {written} players ({kept} kept official summary values)")
    return {"written": written, "official_kept": kept, "players": players}
