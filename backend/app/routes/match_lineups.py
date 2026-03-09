"""
Match Lineup routes.

Handles storing and retrieving match lineups (starting XI + substitutes).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
import uuid
from pydantic import BaseModel

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club, require_admin
from app.models.match_lineup import MatchLineup
from app.models.match import Match
from app.models.player import Player

router = APIRouter(
    prefix="/api/v1/match-lineups",
    tags=["match-lineups"]
)


class MatchLineupCreate(BaseModel):
    player_id: str  # UUID as string
    position_id: str  # e.g. 'gk', 'fb-left', 'sub-1'
    is_substitute: bool
    jersey_number: int | None = None  # Match-day override


class MatchLineupResponse(BaseModel):
    id: str
    match_id: str
    player_id: str
    position_id: str
    is_substitute: bool
    is_on_field: bool
    player_name: str
    player_jersey_number: int | None  # Effective: match override or player default
    match_jersey_number: int | None  # Explicit match-day override (null = using default)

    model_config = {"from_attributes": True}


@router.post("/matches/{match_id}/lineup", response_model=List[MatchLineupResponse])
async def set_match_lineup(
    match_id: str,
    lineup: List[MatchLineupCreate],
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Set the starting lineup and substitutes for a match.

    This replaces any existing lineup for the match.
    """
    try:
        match_uuid = uuid.UUID(match_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid match ID format")

    # Check if match exists
    result = await db.execute(select(Match).where(Match.id == match_uuid))
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Delete existing lineup
    result = await db.execute(select(MatchLineup).where(MatchLineup.match_id == match_uuid))
    existing = result.scalars().all()
    for lineup_entry in existing:
        await db.delete(lineup_entry)

    # Create new lineup
    created_lineups = []
    for lineup_entry in lineup:
        try:
            player_uuid = uuid.UUID(lineup_entry.player_id)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Invalid player ID format: {lineup_entry.player_id}")

        # Check if player exists
        result = await db.execute(select(Player).where(Player.id == player_uuid))
        player = result.scalar_one_or_none()
        if not player:
            raise HTTPException(status_code=404, detail=f"Player not found: {lineup_entry.player_id}")

        new_lineup = MatchLineup(
            match_id=match_uuid,
            player_id=player_uuid,
            position_id=lineup_entry.position_id,
            is_substitute=lineup_entry.is_substitute,
            is_on_field=not lineup_entry.is_substitute,  # Starters on field, subs on bench
            jersey_number=lineup_entry.jersey_number,
        )
        db.add(new_lineup)
        created_lineups.append(new_lineup)

    await db.commit()

    # Refresh and return with player details
    response = []
    for lineup_entry in created_lineups:
        await db.refresh(lineup_entry)
        response.append(MatchLineupResponse(
            id=str(lineup_entry.id),
            match_id=str(lineup_entry.match_id),
            player_id=str(lineup_entry.player_id),
            position_id=lineup_entry.position_id,
            is_substitute=lineup_entry.is_substitute,
            is_on_field=lineup_entry.is_on_field,
            player_name=lineup_entry.player.name,
            player_jersey_number=lineup_entry.jersey_number or lineup_entry.player.jersey_number,
            match_jersey_number=lineup_entry.jersey_number,
        ))

    return response


@router.get("/matches/{match_id}/lineup", response_model=List[MatchLineupResponse])
async def get_match_lineup(
    match_id: str,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the lineup for a match.

    Returns starting XI and substitutes.
    """
    try:
        match_uuid = uuid.UUID(match_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid match ID format")

    result = await db.execute(
        select(MatchLineup).where(MatchLineup.match_id == match_uuid)
    )
    lineup = result.scalars().all()

    response = []
    for lineup_entry in lineup:
        response.append(MatchLineupResponse(
            id=str(lineup_entry.id),
            match_id=str(lineup_entry.match_id),
            player_id=str(lineup_entry.player_id),
            position_id=lineup_entry.position_id,
            is_substitute=lineup_entry.is_substitute,
            is_on_field=lineup_entry.is_on_field,
            player_name=lineup_entry.player.name,
            player_jersey_number=lineup_entry.jersey_number or lineup_entry.player.jersey_number,
            match_jersey_number=lineup_entry.jersey_number,
        ))

    return response


@router.get("/last-lineup", response_model=List[MatchLineupResponse])
async def get_last_match_lineup(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the lineup from the most recent match that had a lineup set.

    Useful for quickly re-using a previous lineup.
    """
    # Find the most recent match with a lineup
    result = await db.execute(
        select(Match)
        .join(MatchLineup, Match.id == MatchLineup.match_id)
        .where(Match.club_id == user.club_id)
        .order_by(Match.match_date.desc())
        .limit(1)
    )
    match = result.scalar_one_or_none()

    if not match:
        return []

    # Get that match's lineup
    result = await db.execute(
        select(MatchLineup).where(MatchLineup.match_id == match.id)
    )
    lineup = result.scalars().all()

    response = []
    for lineup_entry in lineup:
        response.append(MatchLineupResponse(
            id=str(lineup_entry.id),
            match_id=str(lineup_entry.match_id),
            player_id=str(lineup_entry.player_id),
            position_id=lineup_entry.position_id,
            is_substitute=lineup_entry.is_substitute,
            is_on_field=lineup_entry.is_on_field,
            player_name=lineup_entry.player.name,
            player_jersey_number=lineup_entry.jersey_number or lineup_entry.player.jersey_number,
            match_jersey_number=lineup_entry.jersey_number,
        ))

    return response


@router.patch("/matches/{match_id}/lineup/{player_id}/substitute")
async def record_substitution(
    match_id: str,
    player_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Record a substitution by updating is_on_field status.

    When a player is subbed off, their is_on_field becomes False.
    When a player is subbed on, their is_on_field becomes True.
    """
    try:
        match_uuid = uuid.UUID(match_id)
        player_uuid = uuid.UUID(player_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ID format")

    result = await db.execute(
        select(MatchLineup).where(
            MatchLineup.match_id == match_uuid,
            MatchLineup.player_id == player_uuid
        )
    )
    lineup_entry = result.scalar_one_or_none()
    if not lineup_entry:
        raise HTTPException(status_code=404, detail="Player not found in lineup")

    # Toggle on/off field status
    lineup_entry.is_on_field = not lineup_entry.is_on_field
    await db.commit()

    return {"message": "Substitution recorded", "is_on_field": lineup_entry.is_on_field}
