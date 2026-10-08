"""
API routes for MatchEvent operations.

Handles recording match events during live tracking.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import List, Optional
from uuid import UUID
from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.match import Match
from app.models.match_event import MatchEvent, EventType, Team
from app.schemas.match_event import (
    MatchEventCreate,
    MatchEventUpdate,
    MatchEventResponse,
    MatchEventListResponse,
    QuickScoreRequest,
    QuickEventRequest,
)
from app.services.match_event_service import MatchEventService
from app.auth.tenancy import assert_event_in_club

router = APIRouter()


async def _verify_match_club(db: AsyncSession, match_id: UUID, club_id: UUID):
    """Verify match belongs to user's club."""
    result = await db.execute(select(Match.id).where(and_(Match.id == match_id, Match.club_id == club_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")


@router.post("/", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def create_event(
    event_data: MatchEventCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new match event.

    Automatically:
    - Detects 2-point zone for points (40m+)
    - Updates match scores
    - Updates player match stats
    """
    await _verify_match_club(db, event_data.match_id, user.club_id)

    # Idempotent deduplication — if client_event_id already exists, return existing record
    if event_data.client_event_id:
        result = await db.execute(
            select(MatchEvent).where(MatchEvent.client_event_id == event_data.client_event_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            response = MatchEventResponse.model_validate(existing)
            response.is_score = existing.is_score
            response.points_value = existing.points_value
            response.is_in_two_point_zone = existing.is_in_two_point_zone
            response.player_name = existing.player.name if existing.player else None
            response.assist_player_name = existing.assist_player.name if existing.assist_player else None
            response.kickout_target_player_name = existing.kickout_target_player.name if existing.kickout_target_player else None
            return response

    event = await MatchEventService.create_event(db, event_data)

    # Build response with computed fields
    response = MatchEventResponse.model_validate(event)
    response.is_score = event.is_score
    response.points_value = event.points_value
    response.is_in_two_point_zone = event.is_in_two_point_zone
    response.player_name = event.player.name if event.player else None
    response.assist_player_name = event.assist_player.name if event.assist_player else None
    response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None

    return response


@router.post("/quick-score", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def quick_score(
    score_data: QuickScoreRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick score recording endpoint.
    
    Simplified endpoint for recording scores during live match.
    Use when user taps 'Goal' or 'Point' button.
    
    Automatically detects if shot is from 2-point zone.
    """
    await _verify_match_club(db, score_data.match_id, user.club_id)
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
    response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None
    
    return response


@router.post("/quick-event", response_model=MatchEventResponse, status_code=status.HTTP_201_CREATED)
async def quick_event(
    event_data: QuickEventRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick event recording endpoint.
    
    Simplified endpoint for recording non-scoring events during live match.
    Use for: turnovers, kickouts, cards, blocks, etc.
    """
    await _verify_match_club(db, event_data.match_id, user.club_id)
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
    response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None
    
    return response


@router.get("/match/{match_id}", response_model=MatchEventListResponse)
async def list_match_events(
    match_id: UUID,
    skip: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=1000),
    event_type: Optional[EventType] = Query(None, description="Filter by event type"),
    team: Optional[Team] = Query(None, description="Filter by team"),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    List all events for a specific match.

    Returns events in chronological order with pagination and filtering.
    """
    await _verify_match_club(db, match_id, user.club_id)
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
        response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None
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
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific event by ID."""
    await assert_event_in_club(db, event_id, user.club_id)
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
    response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None
    
    return response


@router.put("/{event_id}", response_model=MatchEventResponse)
async def update_event(
    event_id: UUID,
    event_data: MatchEventUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a match event.
    
    Recalculates match scores and player stats after update.
    """
    await assert_event_in_club(db, event_id, user.club_id)
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
    response.kickout_target_player_name = event.kickout_target_player.name if event.kickout_target_player else None
    
    return response


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_event(
    event_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a match event.
    
    Recalculates match scores and player stats after deletion.
    """
    await assert_event_in_club(db, event_id, user.club_id)
    success = await MatchEventService.delete_event(db, event_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Event with ID {event_id} not found"
        )

    return None


@router.delete("/reset/{match_id}", status_code=status.HTTP_200_OK)
async def reset_match_events(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete ALL events for a match and reset scores to 0-0, status to scheduled.
    Keeps lineup, opposition roster, weather, tactical notes, strip colours.
    """
    await _verify_match_club(db, match_id, user.club_id)

    # Delete all events
    from sqlalchemy import delete
    result = await db.execute(delete(MatchEvent).where(MatchEvent.match_id == match_id))
    deleted_count = result.rowcount

    # Delete possession events
    from app.models.possession_event import PossessionEvent
    await db.execute(delete(PossessionEvent).where(PossessionEvent.match_id == match_id))

    # Delete carrier segments
    try:
        from app.models.ball_carrier_segment import BallCarrierSegment
        await db.execute(delete(BallCarrierSegment).where(BallCarrierSegment.match_id == match_id))
    except Exception:
        pass

    # Delete tactical tags
    try:
        from app.models.tactical_tag import TacticalTag
        await db.execute(delete(TacticalTag).where(TacticalTag.match_id == match_id))
    except Exception:
        pass

    # Delete live insights
    try:
        from app.models.live_insight import LiveInsight
        await db.execute(delete(LiveInsight).where(LiveInsight.match_id == match_id))
    except Exception:
        pass

    # Reset match scores and status
    match_result = await db.execute(select(Match).where(Match.id == match_id))
    match = match_result.scalar_one_or_none()
    if match:
        match.team_goals = 0
        match.team_points = 0
        match.opponent_goals = 0
        match.opponent_points = 0
        match.status = "SCHEDULED"
        match.current_phase = None
        match.started_at = None
        match.completed_at = None
        match.second_half_started_at = None
        match.ai_analysis = None
        match.ai_analysis_generated_at = None

    await db.commit()
    return {"deleted_events": deleted_count, "match_id": str(match_id)}

