"""GPS time-series routes: /matches/{match_id}/gps/timeseries/...

Upload is one request per player (TrackUpload: arrays the browser parsed from the 130 MB STATSports file),
then one sync request. Reads are windowed by video time so a replay only pulls what it shows.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.database import get_db
from app.models.match import Match
from app.schemas.match_gps_timeseries import (
    TrackUpload, TrackUploadResult, TimeseriesSummary, SyncOverride, WindowResponse,
)
from app.services.gps_timeseries import service
from app.services.gps_timeseries.names import match_device_name
from app.services.gps_timeseries.parser import track_from_arrays

logger = logging.getLogger(__name__)
router = APIRouter()


async def _verify_match_club(db: AsyncSession, match_id: UUID, user: AuthenticatedUser) -> Match:
    """The match must belong to the caller's club (user.club_id)."""
    m = (await db.execute(select(Match).where(and_(Match.id == match_id, Match.club_id == user.club_id)))).scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


def _utc(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%H:%M:%S")


@router.post("/{match_id}/gps/timeseries/tracks", response_model=TrackUploadResult)
async def upload_track(match_id: UUID, body: TrackUpload, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Store one player's parsed track. Without player_id the device name is matched to a player; an unmatched or
    ambiguous name is a 422 that names the device so the user can pick a player and resend."""
    match = await _verify_match_club(db, match_id, user)
    if len(body.lat) < 600:
        raise HTTPException(status_code=422, detail="Track too short (under a minute): not a match session")
    try:
        track = track_from_arrays(body.t0_ms, body.hz, body.lat, body.lon, body.speed, body.hr, body.flags)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    players = await service.club_players(db, match.club_id)
    player = None; how = "given"
    if body.player_id:
        player = next((p for p in players if p.id == body.player_id), None)
        if player is None:
            raise HTTPException(status_code=404, detail="Player not found in this club")
    else:
        player, how = match_device_name(body.device_name, players)
        if player is None:
            raise HTTPException(status_code=422, detail=f"Could not match '{body.device_name}' to a player ({how}). Pick the player and resend with player_id.")
    stats = service.track_stats(track, body.n_rows, body.n_fixes, body.n_bad)
    row = await service.upsert_track(db, match, player.id, track, body.device_name, body.source_filename, stats)
    await db.commit()
    return TrackUploadResult(track_id=row.id, player_id=player.id, player_name=player.name, match_type=how, n_samples=track.n,
                             start_utc=_utc(track.t0_ms), end_utc=_utc(track.end_ms), duration_min=round(track.n / track.hz / 60, 1))


@router.post("/{match_id}/gps/timeseries/sync")
async def run_sync(match_id: UUID, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Find the pitch calibration and the per-period video offsets from the tagged carries. Takes 10-60 s."""
    match = await _verify_match_club(db, match_id, user)
    row = await service.run_sync(db, match)
    await db.commit()
    out = await service.summary(db, match)
    if row.status == "failed":
        raise HTTPException(status_code=422, detail=row.error or "sync failed")
    return out["sync"]


@router.patch("/{match_id}/gps/timeseries/sync")
async def override_sync(match_id: UUID, body: SyncOverride, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Manual per-period offset (the sync-check screen's nudge). Marks the sync confirmed."""
    match = await _verify_match_club(db, match_id, user)
    try:
        await service.set_manual_periods(db, match, [p.model_dump() for p in body.periods], getattr(user, "user_id", None), body.confirm)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    await db.commit()
    return (await service.summary(db, match))["sync"]


@router.get("/{match_id}/gps/timeseries", response_model=TimeseriesSummary)
async def get_summary(match_id: UUID, user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    match = await _verify_match_club(db, match_id, user)
    return await service.summary(db, match)


@router.get("/{match_id}/gps/timeseries/anchors")
async def get_anchors(match_id: UUID, user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """The per-carry implied offsets behind each period's offset (for the sync-check chart)."""
    match = await _verify_match_club(db, match_id, user)
    return await service.anchors(db, match)


@router.get("/{match_id}/gps/timeseries/window", response_model=WindowResponse)
async def get_window(
    match_id: UUID,
    from_ms: int = Query(..., ge=0, description="video ms"),
    to_ms: int = Query(..., ge=0, description="video ms"),
    hz: float = Query(5.0, ge=0.2, le=10.0),
    players: Optional[str] = Query(None, description="comma-separated player ids; default all"),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Every tracked player's position between two video times, in the raw screen frame (0-100, like pitch_x).
    Frame the points with the attack-direction helpers before reading meaning into them."""
    if to_ms <= from_ms:
        raise HTTPException(status_code=422, detail="to_ms must be after from_ms")
    if (to_ms - from_ms) * hz / 1000 > 6000:
        raise HTTPException(status_code=422, detail="window too large: at most 6000 samples per player per request (e.g. 10 minutes at 10 Hz)")
    match = await _verify_match_club(db, match_id, user)
    ids: Optional[List[UUID]] = None
    if players:
        try:
            ids = [UUID(x) for x in players.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="bad player id")
    try:
        return await service.window(db, match, from_ms, to_ms, hz, ids)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.delete("/{match_id}/gps/timeseries")
async def delete_timeseries(match_id: UUID, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    match = await _verify_match_club(db, match_id, user)
    n = await service.delete_all(db, match.id)
    await db.commit()
    return {"deleted_tracks": n}
