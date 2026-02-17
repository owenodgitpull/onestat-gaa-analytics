"""
API routes for Possession Event tracking.

Handles ball movement and possession changes during matches.
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.models.possession_event import PossessionTeam
from app.schemas.possession_event import (
    PossessionEventCreate,
    PossessionEventResponse,
)
from app.services.possession_service import PossessionService

router = APIRouter()


@router.post("/", response_model=PossessionEventResponse, status_code=status.HTTP_201_CREATED)
async def create_possession_event(
    event_data: PossessionEventCreate,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Record a possession event.
    
    Automatically calculates duration for the previous possession event.
    
    How it works:
    - Each time you record possession, we calculate how long the PREVIOUS possession lasted
    - This gives accurate time-based possession percentages
    - Duration = time_between_this_event_and_previous_event
    
    Example:
    - 00:00 - Dungloe gets possession (duration=null, waiting for next event)
    - 05:00 - Opponent wins turnover (sets Dungloe's duration=300 seconds)
    - 07:00 - Dungloe regains possession (sets Opponent's duration=120 seconds)
    
    Result: Dungloe 71% (300s), Opponent 29% (120s)
    """
    event = await PossessionService.create_possession_event(db, event_data)
    
    # Build response
    response = PossessionEventResponse.model_validate(event)
    response.zone_name = event.zone_name
    response.is_in_two_point_zone = event.is_in_two_point_zone
    
    return response


@router.get("/{event_id}", response_model=PossessionEventResponse)
async def get_possession_event(
    event_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get a single possession event by ID."""
    event = await PossessionService.get_possession_event(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Possession event with ID {event_id} not found"
        )
    
    response = PossessionEventResponse.model_validate(event)
    response.zone_name = event.zone_name
    response.is_in_two_point_zone = event.is_in_two_point_zone
    
    return response


@router.get("/", response_model=List[PossessionEventResponse])
async def list_possession_events(
    match_id: UUID = Query(..., description="Filter by match ID"),
    team: Optional[PossessionTeam] = Query(None, description="Filter by team"),
    limit: int = Query(1000, ge=1, le=10000, description="Max events to return"),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    List possession events for a match.
    
    Returns events in chronological order (oldest first).
    Use this to build possession timeline or heat maps.
    """
    events = await PossessionService.list_possession_events(
        db, match_id, team, limit
    )
    
    responses = []
    for event in events:
        response = PossessionEventResponse.model_validate(event)
        response.zone_name = event.zone_name
        response.is_in_two_point_zone = event.is_in_two_point_zone
        responses.append(response)
    
    return responses


@router.post("/finalize/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def finalize_match_possession(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize possession tracking for a completed match.
    
    Sets duration for the last possession event.
    Should be called automatically when completing a match.
    """
    await PossessionService.finalize_match_possession(db, match_id)
    return None
