"""DB-facing GPS time-series functions. Routes and scripts call these; nothing else touches the tables."""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import UUID

import numpy as np
from sqlalchemy import select, delete, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.match_gps_track import MatchGPSTrack, MatchGPSSync
from app.models.match_lineup import MatchLineup
from app.models.player import Player
from app.models.video_session import VideoSession
from . import codec, geo, clock, sync as syncmod
from .codec import Track
from .names import match_device_name

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------- tracks

def track_stats(track: Track, n_rows: Optional[int] = None, n_fixes: Optional[int] = None, n_bad: Optional[int] = None) -> dict:
    good = (track.flags & codec.FLAG_BAD_FIX) == 0
    sp = np.where(good, track.speed, np.nan)
    return {
        "n_rows": n_rows, "n_fixes": n_fixes, "n_bad": n_bad,
        "duration_min": round((track.n / track.hz) / 60.0, 1),
        "session_distance_m": round(float(np.nansum(sp)) / track.hz),
        "max_speed_ms": round(float(np.nanmax(sp)), 2) if np.any(good) else None,
        "hr_available": bool(np.any(track.hr > 0)),
        "bad_fix_share": round(float(np.mean(~good)), 3),
        "interpolated_share": round(float(np.mean((track.flags & codec.FLAG_INTERPOLATED) != 0)), 3),
    }


async def club_players(db: AsyncSession, club_id) -> List[Player]:
    return list((await db.execute(select(Player).where(Player.club_id == club_id))).scalars().all())


async def upsert_track(db: AsyncSession, match: Match, player_id: UUID, track: Track, device_name: str,
                       source_filename: Optional[str], stats: Optional[dict] = None, aux: Optional[bytes] = None,
                       raw_file_key: Optional[str] = None, raw_file_bytes: Optional[int] = None) -> MatchGPSTrack:
    """Insert or replace the player's track for this match. Caller commits. Motion channels (aux) and the archived raw
    file key are kept when a resend does not include them. Resending identical positions (e.g. to add the motion
    data) is not a change: the sync and its in-match figures stay."""
    existing = (await db.execute(select(MatchGPSTrack).where(MatchGPSTrack.match_id == match.id, MatchGPSTrack.player_id == player_id))).scalar_one_or_none()
    blob = codec.encode(track)
    unchanged = existing is not None and existing.blob == blob and existing.t0_ms == track.t0_ms
    row = existing or MatchGPSTrack(match_id=match.id, club_id=match.club_id, player_id=player_id)
    row.device_name = device_name[:120] if device_name else None
    row.source_filename = (source_filename or "")[:300] or None
    row.hz = track.hz; row.t0_ms = track.t0_ms; row.n_samples = track.n; row.blob = blob
    new_stats = stats or track_stats(track)
    row.stats = {**(existing.stats or {}), **new_stats} if unchanged else new_stats
    if aux is not None:
        row.aux = aux
    if raw_file_key:
        row.raw_file_key = raw_file_key[:500]; row.raw_file_bytes = raw_file_bytes
    if existing is None:
        db.add(row)
    if unchanged:
        await db.flush()
        return row
    # any stored sync is stale once a track changes
    s = await db.get(MatchGPSSync, match.id)
    if s is not None and s.status != "confirmed":
        s.status = "pending"
    await db.flush()
    return row


async def load_tracks(db: AsyncSession, match_id: UUID, player_ids: Optional[List[UUID]] = None) -> List[Tuple[MatchGPSTrack, Track]]:
    q = select(MatchGPSTrack).where(MatchGPSTrack.match_id == match_id)
    if player_ids:
        q = q.where(MatchGPSTrack.player_id.in_(player_ids))
    rows = list((await db.execute(q)).scalars().all())
    return [(r, codec.decode(r.blob, r.t0_ms, r.hz, r.n_samples)) for r in rows]


async def delete_all(db: AsyncSession, match_id: UUID) -> int:
    n = (await db.execute(delete(MatchGPSTrack).where(MatchGPSTrack.match_id == match_id))).rowcount or 0
    await db.execute(delete(MatchGPSSync).where(MatchGPSSync.match_id == match_id))
    return n


# ---------------------------------------------------------------- sync

async def _tagged_inputs(db: AsyncSession, match: Match):
    session = (await db.execute(select(VideoSession).where(VideoSession.match_id == match.id).order_by(VideoSession.created_at.desc()))).scalars().first()
    if session is None:
        raise syncmod.SyncError("the match has no video session to sync to")
    carries = [syncmod.Tagged(str(r[0]), int(r[1]), float(r[2]), float(r[3]), int(r[4])) for r in (await db.execute(text(
        "select player_id, half, start_x, start_y, video_timestamp_ms from ball_carrier_segments "
        "where match_id=:m and team='own' and player_id is not null and video_timestamp_ms is not null and start_x is not null and half is not null"
    ), {"m": match.id})).all()]
    events = [syncmod.Tagged(str(r[0]), int(r[1]), float(r[2]), float(r[3]), int(r[4]), str(r[5])) for r in (await db.execute(text(
        "select player_id, half, pitch_x, pitch_y, video_timestamp_ms, event_type from video_events "
        "where match_id=:m and team='team_a' and player_id is not null and video_timestamp_ms is not null and pitch_x is not null"
    ), {"m": match.id})).all()]
    starters = [str(r[0]) for r in (await db.execute(select(MatchLineup.player_id).where(MatchLineup.match_id == match.id, MatchLineup.is_substitute == False))).all()]  # noqa: E712
    starts = {1: session.first_half_start_ms or 0, 2: session.second_half_start_ms, 3: session.et_first_half_start_ms, 4: session.et_second_half_start_ms}
    ends = {1: session.halftime_timestamp_ms, 2: session.full_time_ms, 3: session.et_halftime_ms, 4: session.et_full_time_ms}
    return session, carries, events, starters, starts, ends


async def their_kickouts(db: AsyncSession, match_id, arfh) -> list:
    """Their kickouts with the raw-screen end they kicked from: their goal is the one we attack."""
    from app.utils.attack_direction import own_attacks_right
    if arfh is None:
        return []
    return [{"video_ms": int(r[0]), "half": r[1], "end": "R" if own_attacks_right(arfh, r[1] or 1) else "L"} for r in (await db.execute(text(
        "select video_timestamp_ms, half from video_events where match_id = :m and event_type like 'OPP_KICKOUT%' "
        "and event_type <> 'OPP_KICKOUT_SIDELINE' and video_timestamp_ms is not null"), {"m": match_id})).all()]


async def refit_pitch_ends(db: AsyncSession, match, tracks, cal: dict, periods: list, log=logger.info):
    """Centre the picture between the two goals from the 40 m arc at their kickouts (pitch_fit)."""
    from . import pitch_fit
    try:
        return pitch_fit.fit_ends(tracks, cal, periods, await their_kickouts(db, match.id, match.attacking_right_first_half), log=log)
    except Exception:
        logger.exception("pitch end fit failed for %s", match.id)
        return None


async def run_sync(db: AsyncSession, match: Match, log=logger.info) -> MatchGPSSync:
    """Compute (or recompute) the calibration and offsets and store them. Caller commits."""
    row = await db.get(MatchGPSSync, match.id)
    if row is None:
        row = MatchGPSSync(match_id=match.id, club_id=match.club_id); db.add(row)
    loaded = await load_tracks(db, match.id)
    tracks = {str(r.player_id): t for r, t in loaded}
    try:
        _, carries, events, starters, starts, ends = await _tagged_inputs(db, match)
        out = syncmod.compute(tracks, carries, events, starters, starts, ends,
                              pitch_length_m=match.pitch_length_m or 145.0, pitch_width_m=match.pitch_width_m or 90.0, log=log)
    except syncmod.SyncError as e:
        row.status = "failed"; row.error = str(e); row.computed_at = datetime.utcnow()
        await db.flush()
        return row
    # keep manual (confirmed) offsets if the user set any
    old = {p["half"]: p for p in (row.periods or []) if p.get("source") == "manual"}
    for p in out["periods"]:
        if p["half"] in old:
            p["offset_ms"] = old[p["half"]]["offset_ms"]; p["rate"] = old[p["half"]].get("rate", 1.0); p["source"] = "manual"
    out["calibration"] = await refit_pitch_ends(db, match, tracks, out["calibration"], out["periods"], log) or out["calibration"]
    row.calibration = out["calibration"]; row.periods = out["periods"]
    # keep the user's tag shift and ball pins (replay "Edit sync") through a re-sync
    kept = {k: v for k, v in (row.tag_lag or {}).items() if k in ("_manual", "_pins") and v}
    row.tag_lag = {**(out["tag_lag"] or {}), **kept}; row.quality = out["quality"]
    row.status = "confirmed" if row.status == "confirmed" else "auto"; row.error = None; row.computed_at = datetime.utcnow()
    for r, _ in loaded:
        q = out["quality"].get(str(r.player_id))
        if q:
            r.stats = {**(r.stats or {}), "in_match": q["in_match"], "match_coverage": q["coverage"], "match_distance_m": q["match_distance_m"], "on_pitch_share": q["on_pitch_share"]}
    await db.flush()
    return row


async def set_manual_periods(db: AsyncSession, match: Match, overrides: list, user_id=None, confirm=True,
                             tag_shift_ms: Optional[int] = None, pins: Optional[dict] = None) -> MatchGPSSync:
    row = await db.get(MatchGPSSync, match.id)
    if row is None or not row.periods:
        raise ValueError("run the automatic sync first")
    if pins:
        # replay ball pins: {carry id: video ms the carry really starts, or None to remove}. Display only.
        tl = dict(row.tag_lag or {})
        cur = dict(tl.get("_pins") or {})
        for cid, v in pins.items():
            if v is None:
                cur.pop(str(cid), None)
            else:
                cur[str(cid)] = int(v)
        if cur:
            tl["_pins"] = cur
        else:
            tl.pop("_pins", None)
        row.tag_lag = tl
    if tag_shift_ms is not None:
        from app.services.gps_analysis.lag import MAX_SHIFT_MS
        v = int(max(-MAX_SHIFT_MS, min(MAX_SHIFT_MS, tag_shift_ms)))
        tl = dict(row.tag_lag or {})
        if v:
            tl["_manual"] = {"shift_ms": v, "set_at": datetime.utcnow().isoformat(), "by": str(user_id) if user_id else None}
        else:
            tl.pop("_manual", None)
        row.tag_lag = tl
    periods = list(row.periods)
    for o in overrides:
        for p in periods:
            if p["half"] == o["half"]:
                p["offset_ms"] = int(o["offset_ms"]); p["rate"] = float(o.get("rate") or 1.0); p["source"] = "manual"
    row.periods = periods
    if confirm:
        row.status = "confirmed"; row.confirmed_at = datetime.utcnow(); row.confirmed_by_user_id = user_id
    await db.flush()
    return row


# ---------------------------------------------------------------- reads

def _half_for(periods, video_ms) -> Optional[int]:
    p = clock.period_for_video_ms(periods, video_ms)
    return p["half"] if p else None


async def window(db: AsyncSession, match: Match, from_video_ms: int, to_video_ms: int, hz: float = 5.0,
                 player_ids: Optional[List[UUID]] = None) -> dict:
    """Positions of every tracked player between two video times, resampled to `hz`, in raw screen 0-100."""
    s = await db.get(MatchGPSSync, match.id)
    if s is None or not s.periods or s.status in ("pending", "failed"):
        raise ValueError("GPS is not synced to the video for this match")
    cal = s.calibration; periods = s.periods
    L = cal.get("pitch_length_m") or 145.0; W = cal.get("pitch_width_m") or 90.0
    step = 1000.0 / hz
    times = np.arange(from_video_ms, to_video_ms + 1e-6, step)
    gps_t = np.array([clock.video_to_gps_ms(periods, v) for v in times], dtype=np.float64)
    players = {}
    for r, t in await load_tracks(db, match.id, player_ids):
        idx = t.index_for_ms(gps_t)
        ok = idx >= 0
        u, v = geo.latlon_to_uv(t.lat[np.where(ok, idx, 0)], t.lon[np.where(ok, idx, 0)], cal)
        px, py = geo.uv_to_pitch(u, v, cal)
        bad = (t.flags[np.where(ok, idx, 0)] & codec.FLAG_BAD_FIX) != 0
        ok = ok & ~bad
        sp = t.speed[np.where(ok, idx, 0)]
        players[str(r.player_id)] = {
            "player_id": r.player_id, "t0_video_ms": int(from_video_ms), "hz": hz,
            "x": [round(float(a), 1) if o else None for a, o in zip(px, ok)],
            "y": [round(float(a), 1) if o else None for a, o in zip(py, ok)],
            "speed": [round(float(a), 2) if o else None for a, o in zip(sp, ok)],
        }
    return {"match_id": match.id, "from_video_ms": int(from_video_ms), "to_video_ms": int(to_video_ms), "hz": hz,
            "half": _half_for(periods, from_video_ms), "pitch_length_m": L, "pitch_width_m": W, "players": players}


async def summary(db: AsyncSession, match: Match) -> dict:
    rows = list((await db.execute(select(MatchGPSTrack, Player.name).join(Player, Player.id == MatchGPSTrack.player_id).where(MatchGPSTrack.match_id == match.id).order_by(Player.name))).all())
    s = await db.get(MatchGPSSync, match.id)
    quality = (s.quality or {}) if s else {}
    tracks = [{"id": r.id, "player_id": r.player_id, "player_name": name, "device_name": r.device_name, "hz": r.hz, "t0_ms": r.t0_ms,
               "end_ms": r.end_ms, "n_samples": r.n_samples, "stats": r.stats, "quality": quality.get(str(r.player_id))} for r, name in rows]
    sync_out = None
    if s is not None:
        periods = [{k: v for k, v in p.items() if k != "anchors"} | {"n_anchors": len(p.get("anchors") or [])} for p in (s.periods or [])]
        sync_out = {"status": s.status, "calibration": s.calibration, "periods": periods, "tag_lag": s.tag_lag, "error": s.error,
                    "computed_at": s.computed_at.isoformat() if s.computed_at else None, "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None}
    return {"match_id": match.id, "tracks": tracks, "sync": sync_out}


async def anchors(db: AsyncSession, match: Match) -> dict:
    s = await db.get(MatchGPSSync, match.id)
    if s is None:
        return {"periods": []}
    return {"periods": [{"half": p["half"], "offset_ms": p["offset_ms"], "rate": p.get("rate", 1.0), "anchors": p.get("anchors") or []} for p in (s.periods or [])]}
