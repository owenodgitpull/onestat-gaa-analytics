"""
API routes for Match operations.

Handles CRUD operations, match start/complete, and statistics.
"""

from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional
from uuid import UUID
import logging
import json
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.database import get_db, async_session_maker
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.match_lineup import MatchLineup
from app.services.workload_analysis_service import WorkloadAnalysisService

limiter = Limiter(key_func=get_remote_address)

logger = logging.getLogger(__name__)
from app.models.match import Match, MatchStatus, MatchVenue
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
from app.services.possession_service import PossessionService
import math

router = APIRouter()


async def _get_match_flags(db: AsyncSession, match_ids: list) -> dict:
    """Lightweight has_gps/has_video/has_events lookup for a set of matches.

    Replaces the old `bool(match.events)`/`bool(match.gps_data)`/
    `bool(match.video_sessions)` pattern, which — since these relationships
    default to eager (selectin) loading — forced a full fetch of every
    event/GPS/video-session row for every match on the page just to answer a
    true/false flag. This does the same job with 3 queries returning only
    match_id, regardless of how many matches are being flagged.
    """
    from app.models.match_gps import MatchGPSData
    from app.models.video_session import VideoSession
    from app.models.match_event import MatchEvent

    if not match_ids:
        return {"gps": set(), "video": set(), "events": set()}

    gps_ids = (await db.execute(
        select(MatchGPSData.match_id).where(MatchGPSData.match_id.in_(match_ids)).distinct()
    )).scalars().all()
    video_ids = (await db.execute(
        select(VideoSession.match_id).where(VideoSession.match_id.in_(match_ids)).distinct()
    )).scalars().all()
    event_ids = (await db.execute(
        select(MatchEvent.match_id).where(MatchEvent.match_id.in_(match_ids)).distinct()
    )).scalars().all()

    return {"gps": set(gps_ids), "video": set(video_ids), "events": set(event_ids)}


@router.post("/", response_model=MatchResponse, status_code=status.HTTP_201_CREATED)
async def create_match(
    match_data: MatchCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new match.

    - **opponent**: Name of opposing team
    - **match_date**: Date and time of match
    - **venue**: home/away/neutral
    - **notes**: Optional match notes
    """
    # Idempotent deduplication — if client-provided ID already exists, return it
    if match_data.id:
        existing = await db.execute(select(Match).where(Match.id == match_data.id))
        existing_match = existing.scalar_one_or_none()
        if existing_match:
            response = MatchResponse.model_validate(existing_match)
            response.team_total_score = existing_match.team_total_score
            response.opponent_total_score = existing_match.opponent_total_score
            response.result = existing_match.result
            return response

    match = await MatchService.create_match(db, match_data, club_id=user.club_id)

    # Add computed properties
    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


@router.get("/", response_model=MatchListResponse)
async def list_matches(
    skip: int = Query(0, ge=0, description="Number of records to skip"),
    limit: int = Query(50, ge=1, le=100, description="Number of records to return"),
    status: Optional[MatchStatus] = Query(None, description="Filter by match status"),
    venue: Optional[MatchVenue] = Query(None, description="Filter by venue"),
    sort: Optional[str] = Query(None, description="Sort order: 'asc' or 'desc' (default desc)"),
    upcoming_only: bool = Query(False, description="Only include matches with match_date in the future — filters server-side rather than relying on the client to skip past stale/unreconciled 'scheduled' entries"),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    List all matches with pagination and filtering.

    - **skip**: Pagination offset
    - **limit**: Number of matches to return (max 100)
    - **status**: Filter by status (scheduled/in_progress/completed/cancelled)
    - **venue**: Filter by venue (home/away/neutral)
    - **sort**: Sort by date: 'asc' (earliest first) or 'desc' (latest first, default)
    - **upcoming_only**: Only matches from now onward
    """
    sort_asc = sort == "asc"
    matches, total = await MatchService.list_matches(db, skip, limit, status, venue, club_id=user.club_id, sort_asc=sort_asc, upcoming_only=upcoming_only)
    
    # Convert to response models with computed fields
    flags = await _get_match_flags(db, [m.id for m in matches])
    match_responses = []
    for match in matches:
        response = MatchResponse.model_validate(match)
        response.team_total_score = match.team_total_score
        response.opponent_total_score = match.opponent_total_score
        response.result = match.result
        response.has_gps = match.id in flags["gps"]
        response.has_video = match.id in flags["video"]
        response.has_events = match.id in flags["events"]
        match_responses.append(response)
    
    total_pages = math.ceil(total / limit) if total > 0 else 0
    
    return MatchListResponse(
        matches=match_responses,
        total=total,
        page=skip // limit + 1,
        page_size=limit,
        total_pages=total_pages
    )


@router.get("/competitions", response_model=List[str])
async def list_competitions(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Distinct competition names already used across every match for this club
    — scheduled and completed both, so a competition entered only on an
    upcoming fixture still shows up. Powers the autocomplete on the match/
    fixture "Competition" field so coaches pick an existing name (keeping
    season-dashboard filtering/grouping consistent) instead of retyping it
    slightly differently each time, while still allowing a genuinely new
    competition to be typed freely.
    """
    result = await db.execute(
        select(Match.competition).where(
            Match.club_id == user.club_id,
            Match.is_deleted.is_(False),
            Match.competition.isnot(None),
            Match.competition != "",
        ).distinct()
    )
    return sorted({row[0] for row in result.all()}, key=str.lower)


@router.get("/{match_id}", response_model=MatchResponse)
async def get_match(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get a specific match by ID.
    """
    match = await MatchService.get_match(db, match_id, club_id=user.club_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    flags = await _get_match_flags(db, [match.id])
    response.has_gps = match.id in flags["gps"]
    response.has_video = match.id in flags["video"]
    response.has_events = match.id in flags["events"]
    if match.opposition_team_id:  # only ever set for inter-county clubs, so clubs pay nothing extra
        from app.services.opposition_service import lineup_for_match
        response.opposition_lineup = await lineup_for_match(db, match.id)

    return response


@router.put("/{match_id}", response_model=MatchResponse)
async def update_match(
    match_id: UUID,
    match_data: MatchUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Update a match.
    
    Can update any field including scores and status.
    """
    match = await MatchService.update_match(db, match_id, match_data, club_id=user.club_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


@router.post("/{match_id}/start", response_model=MatchResponse)
async def start_match(
    match_id: UUID,
    start_data: MatchStartRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Start a match (change status to IN_PROGRESS).
    
    Sets the match status and records the start time.
    """
    match = await MatchService.start_match(db, match_id, start_data.started_at, club_id=user.club_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result
    
    return response


@router.post("/{match_id}/phase", response_model=MatchResponse)
async def update_match_phase(
    match_id: UUID,
    phase_data: MatchPhaseUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Update match phase for resumable recording.

    Persists current_phase, attacking_right_first_half, and second_half_started_at.
    """
    match = await MatchService.update_match_phase(
        db, match_id, phase_data.phase, phase_data.attacking_right_first_half, club_id=user.club_id
    )
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    # Close all open possession events at half-time so no timer bleeds
    # into the break (or overnight if the recording is resumed later)
    if phase_data.phase == "half_time":
        await PossessionService.close_open_events(db, match_id)

    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


@router.post("/{match_id}/complete", response_model=MatchResponse)
async def complete_match(
    match_id: UUID,
    complete_data: MatchCompleteRequest,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
        complete_data.notes,
        club_id=user.club_id,
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
    response.team_total_score = match.team_total_score
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Quick update for match scores.
    
    Updates goals and points for both teams.
    Typically used by automatic event recording system.
    """
    update_data = MatchUpdate(
        team_goals=score_data.team_goals,
        team_points=score_data.team_points,
        opponent_goals=score_data.opponent_goals,
        opponent_points=score_data.opponent_points
    )
    
    match = await MatchService.update_match(db, match_id, update_data, club_id=user.club_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    response = MatchResponse.model_validate(match)
    response.team_total_score = match.team_total_score
    response.opponent_total_score = match.opponent_total_score
    response.result = match.result

    return response


@router.get("/{match_id}/stats/stream")
async def stream_match_stats(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """SSE endpoint — pushes stats every 5s. Replaces client-side polling during live recording."""
    import asyncio
    from fastapi.responses import StreamingResponse

    match = await MatchService.get_match(db, match_id, club_id=user.club_id)
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    async def event_generator():
        consecutive_errors = 0
        tick = 0
        while True:
            try:
                async with async_session_maker() as session:
                    stats = await MatchService.calculate_match_stats(session, match_id)
                yield f"data: {json.dumps(stats)}\n\n"
                consecutive_errors = 0
            except asyncio.CancelledError:
                break
            except Exception as e:
                consecutive_errors += 1
                logger.warning(f"SSE stats error for {match_id}: {e}")
                if consecutive_errors > 10:
                    break
                yield ": retry\n\n"

            tick += 1
            # Keep-alive comment every 6 ticks (~30s) in case of idle proxies
            if tick % 6 == 0:
                yield ": keep-alive\n\n"

            try:
                await asyncio.sleep(5)
            except asyncio.CancelledError:
                break

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{match_id}/stats", response_model=MatchStatsResponse)
async def get_match_stats(
    match_id: UUID,
    half: Optional[int] = Query(None, ge=1, le=2, description="Filter stats by half (1 or 2). Omit for full match."),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
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
    match = await MatchService.get_match(db, match_id, club_id=user.club_id)
    if not match:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )

    # Calculate stats
    stats = await MatchService.calculate_match_stats(db, match_id, half=half)

    return MatchStatsResponse(**stats)


@router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_match(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Delete a match and all associated data.

    Permanently removes the match and cascades to all related records:
    events, possession_events, player_stats, lineup, gps_data, video_sessions.
    """
    success = await MatchService.delete_match(db, match_id, club_id=user.club_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Match with ID {match_id} not found"
        )
    
    return None


@router.get("/{match_id}/pitch-paths")
async def get_match_pitch_paths(
    match_id: UUID,
    outcomes: Optional[str] = Query(None, description="Comma-separated outcome types, e.g. goal,point,wide"),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get pitch path visualizations for a match.
    Traces full possession chains backwards from outcome events.
    """
    from app.services.ai._shared import get_pitch_paths

    match = await MatchService.get_match(db, match_id, club_id=user.club_id)
    if not match:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")

    outcome_list = outcomes.split(",") if outcomes else None
    result_json = await get_pitch_paths(db, match_id=str(match_id), outcomes=outcome_list)
    result = json.loads(result_json)

    if not result.get("success"):
        return {"paths": [], "insight": result.get("error", "No paths found")}

    chart = result.get("chart", {})
    return {
        "paths": chart.get("data", []),
        "insight": chart.get("insight", ""),
        "title": chart.get("title", ""),
        "attacking_right_first_half": match.attacking_right_first_half if match.attacking_right_first_half is not None else True,
        "half_duration_mins": match.half_duration_mins or 30,
    }


@router.get("/{match_id}/expected-points")
@limiter.limit("20/minute")
async def get_match_expected_points(
    request: Request,
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Team- and player-level Expected Points (xP) for a match, computed fresh
    from shot location data against a shot-quality model calibrated from real
    shot outcomes logged across the platform. See expected_points_service.py.

    Post-match reporting only — the underlying model build is cached
    (see expected_points_service._model_cache) but this must never be polled
    from live match tracking.
    """
    from app.services.expected_points_service import compute_match_expected_points

    match = await MatchService.get_match(db, match_id, club_id=user.club_id)
    if not match:
        raise HTTPException(status_code=404, detail=f"Match {match_id} not found")

    return await compute_match_expected_points(db, match)

