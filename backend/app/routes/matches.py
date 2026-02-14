"""
API routes for Match operations.

Handles CRUD operations, match start/complete, and statistics.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from uuid import UUID
import logging
from app.database import get_db, async_session_maker
from app.models.match_lineup import MatchLineup
from app.services.workload_analysis_service import WorkloadAnalysisService

logger = logging.getLogger(__name__)
from app.models.match import MatchStatus, MatchVenue
from app.schemas.match import (
    MatchCreate,
    MatchUpdate,
    MatchResponse,
    MatchListResponse,
    MatchStartRequest,
    MatchCompleteRequest,
    MatchPhaseUpdate,
    MatchScoreUpdate,
    MatchStatsResponse,
)
from app.services.match_service import MatchService
import math

router = APIRouter()


@router.post("/", response_model=MatchResponse, status_code=status.HTTP_201_CREATED)
async def create_match(
    match_data: MatchCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new match.
    
    - **opponent**: Name of opposing team
    - **match_date**: Date and time of match
    - **venue**: home/away/neutral
    - **notes**: Optional match notes
    """
    match = await MatchService.create_match(db, match_data)
    
    # Add computed properties
    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.get("/", response_model=MatchListResponse)
async def list_matches(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=100, description="Number of records to return"),
    status: Optional[MatchStatus] = Query(None, description="Filter by match status"),
    venue: Optional[MatchVenue] = Query(None, description="Filter by venue"),
    db: AsyncSession = Depends(get_db)
):
    """
    List all matches with pagination and filtering.
    
    - **skip**: Pagination offset
    - **limit**: Number of matches to return (max 100)
    - **status**: Filter by status (scheduled/in_progress/completed/cancelled)
    - **venue**: Filter by venue (home/away/neutral)
    """
    matches, total = await MatchService.list_matches(db, skip, limit, status, venue)
    
    # Convert to response models with computed fields
    match_responses = []
    for match in matches:
        response = MatchResponse.model_validate(match)
        response.dungloe_total_score = match.dungloe_total_score
        response.opponent_total_score = match.opponent_total_score
        response.result = match.result
        match_responses.append(response)
    
    total_pages = math.ceil(total / limit) if total > 0 else 0
    
    return MatchListResponse(
        matches=match_responses,
        total=total,
        page=skip // limit + 1,
        page_size=limit,
        total_pages=total_pages
    )


@router.get("/{match_id}", response_model=MatchResponse)
async def get_match(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Get a specific match by ID.
    """
    match = await MatchService.get_match(db, match_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.put("/{match_id}", response_model=MatchResponse)
async def update_match(
    match_id: UUID,
    match_data: MatchUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update a match.
    
    Can update any field including scores and status.
    """
    match = await MatchService.update_match(db, match_id, match_data)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.post("/{match_id}/start", response_model=MatchResponse)
async def start_match(
    match_id: UUID,
    start_data: MatchStartRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Start a match (change status to IN_PROGRESS).
    
    Sets the match status and records the start time.
    """
    match = await MatchService.start_match(db, match_id, start_data.started_at)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.post("/{match_id}/phase", response_model=MatchResponse)
async def update_match_phase(
    match_id: UUID,
    phase_data: MatchPhaseUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update match phase for resumable recording.

    Persists current_phase, attacking_right_first_half, and second_half_started_at.
    """
    match = await MatchService.update_match_phase(
        db, match_id, phase_data.phase, phase_data.attacking_right_first_half
    )
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


@router.post("/{match_id}/complete", response_model=MatchResponse)
async def complete_match(
    match_id: UUID,
    complete_data: MatchCompleteRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """
    Complete a match (change status to COMPLETED).

    Sets the match status, records completion time, and optional post-match notes.
    Triggers workload analysis for all players in the lineup.
    """
    match = await MatchService.complete_match(
        db,
        match_id,
        complete_data.completed_at,
        complete_data.notes
    )
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    # Get all players in the lineup for workload analysis
    lineup_result = await db.execute(
        select(MatchLineup.player_id).where(MatchLineup.match_id == match_id)
    )
    player_ids = [row[0] for row in lineup_result.all()]

    # Trigger workload analysis in background
    if player_ids:
        background_tasks.add_task(
            trigger_match_workload_analysis,
            player_ids
        )

    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


async def trigger_match_workload_analysis(player_ids: list):
    """Background task to analyze workload for players after match completion."""
    async with async_session_maker() as db:
        for player_id in player_ids:
            try:
                await WorkloadAnalysisService.trigger_analysis_for_player(
                    db, player_id, "match_completed"
                )
            except Exception as e:
                logger.error(f"Workload analysis failed for player {player_id}: {e}")


@router.put("/{match_id}/score", response_model=MatchResponse)
async def update_match_score(
    match_id: UUID,
    score_data: MatchScoreUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Quick update for match scores.
    
    Updates goals and points for both teams.
    Typically used by automatic event recording system.
    """
    update_data = MatchUpdate(
        dungloe_goals=score_data.dungloe_goals,
        dungloe_points=score_data.dungloe_points,
        opponent_goals=score_data.opponent_goals,
        opponent_points=score_data.opponent_points
    )
    
    match = await MatchService.update_match(db, match_id, update_data)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    response = MatchResponse.model_validate(match)
    response.dungloe_total_score = match.dungloe_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.get("/{match_id}/stats", response_model=MatchStatsResponse)
async def get_match_stats(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Get comprehensive match statistics.
    
    Returns:
    - Possession percentages
    - Shot statistics and accuracy
    - Turnover stats
    - Kickout stats
    - Discipline (cards)
    
    Calculated in real-time from match events.
    """
    # Verify match exists
    match = await MatchService.get_match(db, match_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    # Calculate stats
    stats = await MatchService.calculate_match_stats(db, match_id)
    
    return MatchStatsResponse(**stats)


@router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_match(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a match (soft delete).
    
    The match and all related events are marked as deleted but not removed from database.
    """
    success = await MatchService.delete_match(db, match_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    return None

