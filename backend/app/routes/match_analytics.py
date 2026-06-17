from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from uuid import UUID
from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.match import Match
from app.services.match_analytics_service import (
    get_score_origins,
    get_scoreable_frees,
    get_attack_efficiency,
    get_season_benchmark,
)

router = APIRouter()


async def _verify_match_club(db: AsyncSession, match_id: UUID, club_id: UUID):
    result = await db.execute(select(Match.id).where(and_(Match.id == match_id, Match.club_id == club_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")


@router.get("/{match_id}/score-origins")
async def score_origins(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, match_id, user.club_id)
    return await get_score_origins(db, match_id, user.club_id)


@router.get("/{match_id}/scoreable-frees")
async def scoreable_frees(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, match_id, user.club_id)
    return await get_scoreable_frees(db, match_id, user.club_id)


@router.get("/{match_id}/attack-efficiency")
async def attack_efficiency(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, match_id, user.club_id)
    return await get_attack_efficiency(db, match_id, user.club_id)


@router.get("/{match_id}/vs-season")
async def vs_season(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, match_id, user.club_id)
    return await get_season_benchmark(db, match_id, user.club_id)
