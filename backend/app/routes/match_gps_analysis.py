"""GPS analysis routes (read-only): replay context, match metrics, shape series, heat maps, season trends.

All positions in the responses are in OUR attack frame (we attack towards x = pitch length) unless the field says raw.
"""
from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_admin_or_viewer
from app.database import get_db
from app.services.gps_analysis import service, metrics
from app.services.gps_analysis.loader import NotReady, match_row

router = APIRouter()
season_router = APIRouter()


async def _match(db: AsyncSession, match_id: UUID, user: AuthenticatedUser):
    m = await match_row(db, match_id, user.club_id)
    if m is None:
        raise HTTPException(status_code=404, detail="Match not found")
    return m


@router.get("/{match_id}/gps/analysis/context")
async def replay_context(match_id: UUID, user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """Players, carries and events (raw screen coordinates, with each period's direction) for the replay."""
    try:
        return await service.replay_context(db, await _match(db, match_id, user))
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{match_id}/gps/analysis")
async def match_analysis(match_id: UUID, user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """Every GPS metric for the match: summary, transitions, kickouts, intensity, tag health, support, marking, moments."""
    try:
        res, _, _ = await service.analyse(db, await _match(db, match_id, user))
        return res
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.get("/{match_id}/gps/analysis/carry-times")
async def carry_times(match_id: UUID, user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """When each tagged carry really started (lined up from our players' GPS), for the replay's ball."""
    try:
        res, _, _ = await service.analyse(db, await _match(db, match_id, user))
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))
    return res.get("carry_times") or {}


@router.get("/{match_id}/gps/analysis/shape-series")
async def shape_series(match_id: UUID, step_s: int = Query(2, ge=1, le=30), user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    try:
        _, g1, _ = await service.analyse(db, await _match(db, match_id, user))
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))
    return service.shape_series_payload(g1, step_s)


@router.get("/{match_id}/gps/analysis/heatmap")
async def heatmap(match_id: UUID, player_id: Optional[str] = None, half: Optional[int] = Query(None, ge=1, le=4),
                  state: str = Query("all", pattern="^(all|in|out)$"),
                  user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    try:
        _, g1, inp = await service.analyse(db, await _match(db, match_id, user))
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))
    return metrics.heatmap(inp, g1, player_id, half, state)


@router.get("/{match_id}/gps/analysis/play")
async def play_window(match_id: UUID, from_ms: int = Query(..., ge=0), to_ms: int = Query(..., ge=0),
                      user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """Our players moving from one moment (e.g. a kickout) for up to a minute, plus the ball, tags and their lineup."""
    if to_ms <= from_ms:
        raise HTTPException(status_code=400, detail="to_ms must be after from_ms")
    try:
        return await service.play_window(db, await _match(db, match_id, user), from_ms, to_ms)
    except NotReady as e:
        raise HTTPException(status_code=409, detail=str(e))


@season_router.get("/season")
async def season(user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """One row per synced match (shape, transition, intensity, kickout push-up) + per-player running-load alerts."""
    return await service.season(db, user.club_id)


@season_router.get("/season/kickout-patterns")
async def kickout_patterns(user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    """Which player spots, pairings and kick types go with winning or losing kickouts, across every GPS match, with a
    luck check (services/gps_analysis/ko_rules.py)."""
    return await service.season_kickout_patterns(db, user.club_id)
