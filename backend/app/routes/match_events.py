"""
API routes for MatchEvent operations.

Handles recording match events during live tracking.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from uuid import UUID
from app.database import get_db
from app.models.match_event import EventType, Team
from app.schemas.match_event import (
    MatchEventCreate,
    MatchEventUpdate,
    MatchEventResponse,
    MatchEventListResponse,
    QuickScoreRequest,
    QuickEventRequest,
)
from app.services.match_event_service import MatchEventService

router = APIRouter()


@router.post("/", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_data: MatchEventCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new match event.
    
    Automatically:
    - Detects 2-point zone for points (40m+)
    - Updates match scores
    - Updates player match stats
    """
    event = await MatchEventService.create_event(db, event_data)
    
    # Build response with computed fields
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    
    return response


@router.post("/quick-score", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def quick_score(
    score_data: QuickScoreRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Quick score recording endpoint.
    
    Simplified endpoint for recording scores during live match.
    Use when user taps 'Goal' or 'Point' button.
    
    Automatically detects if shot is from 2-point zone.
    """
    event_data = MatchEventCreate(
        match_id=score_data.match_id,
        event_type=score_data.event_type,
        team=score_data.team,
        player_id=score_data.player_id,
        assist_player_id=score_data.assist_player_id,
        pitch_x=score_data.pitch_x,
        pitch_y=score_data.pitch_y,
        minute=score_data.minute,
    )
    
    event = await MatchEventService.create_event(db, event_data)
    
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    
    return response


@router.post("/quick-event", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def quick_event(
    event_data: QuickEventRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Quick event recording endpoint.
    
    Simplified endpoint for recording non-scoring events during live match.
    Use for: turnovers, kickouts, cards, blocks, etc.
    """
    full_event_data = MatchEventCreate(
        match_id=event_data.match_id,
        event_type=event_data.event_type,
        team=event_data.team,
        player_id=event_data.player_id,
        pitch_x=event_data.pitch_x,
        pitch_y=event_data.pitch_y,
        minute=event_data.minute,
    )
    
    event = await MatchEventService.create_event(db, full_event_data)
    
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    
    return response


@router.get("/match/{match_id}", response_model=MatchEventListResponse)
async def list_match_events(
    match_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    event_type: Optional[EventType] = Query(None, description="Filter by event type"),
    team: Optional[Team] = Query(None, description="Filter by team"),
    db: AsyncSession = Depends(get_db)
):
    """
    List all events for a specific match.
    
    Returns events in chronological order with pagination and filtering.
    """
    events, total = await MatchEventService.list_events(
        db, match_id, skip, limit, event_type, team
    )
    
    # Build responses with computed fields
    event_responses = []
    for event in events:
        response = MatchEventResponse.model_validate(event)
        response.is_score = event.is_score
        response.points_value = event.points_value
        response.is_in_two_point_zone = event.is_in_two_point_zone
        response.player_name = event.player.name if event.player else None
        response.assist_player_name = event.assist_player.name if event.assist_player else None
        event_responses.append(response)
    
    return MatchEventListResponse(
        events=event_responses,
        total=total,
        page=skip // limit + 1,
        page_size=limit
    )


@router.get("/{event_id}", response_model=MatchEventResponse)
async def get_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get a specific event by ID."""
    event = await MatchEventService.get_event(db, event_id)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event with ID {event_id} not found"
        )
    
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    
    return response


@router.put("/{event_id}", response_model=MatchEventResponse)
async def update_event(
    event_id: UUID,
    event_data: MatchEventUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update a match event.
    
    Recalculates match scores and player stats after update.
    """
    event = await MatchEventService.update_event(db, event_id, event_data)
    if not event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event with ID {event_id} not found"
        )
    
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    
    return response


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a match event.
    
    Recalculates match scores and player stats after deletion.
    """
    success = await MatchEventService.delete_event(db, event_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event with ID {event_id} not found"
        )
    
    return None

