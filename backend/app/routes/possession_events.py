"""
API routes for Possession Event tracking.

Handles ball movement and possession changes during matches.
"""

from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, case, delete, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.match import Match
from app.models.ball_carrier_segment import BallCarrierSegment
from app.schemas.possession_event import (
    PossessionEventCreate,
    PossessionEventBulkCreate,
    PossessionEventResponse,
    PossessionVideoBatch,
)
from app.services.possession_service import PossessionService
from app.auth.tenancy import assert_match_in_club, assert_possession_event_in_club

router = APIRouter()


@router.get("/summary")
async def possession_summary(
    match_id: UUID = Query(..., description="Match ID"),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Possession totals for a match, computed in the database.

    The stats panels only need totals (time split, event counts, spells), not
    the thousands of rows behind them — fetching every row on a timer made each
    poll heavier as the match went on. One indexed aggregate returns ~6 numbers.

    Rules mirror the previous client-side maths: anything that isn't "own" counts
    as the opposition; a "spell" is a run of consecutive events by the same side.
    """
    owner = await db.execute(
        select(Match.id).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    if owner.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Match not found")

    is_own = case((PossessionEvent.team == "own", True), else_=False)
    prev_own = func.lag(is_own).over(order_by=(PossessionEvent.created_at, PossessionEvent.id))
    rows = (
        select(
            is_own.label("own"),
            func.coalesce(PossessionEvent.duration_seconds, 0).label("secs"),
            prev_own.label("prev_own"),
        )
        .where(PossessionEvent.match_id == match_id)
        .subquery()
    )
    # IS DISTINCT FROM so the very first row (prev NULL) starts a spell
    own_spell = (rows.c.own.is_(True)) & (rows.c.prev_own.is_distinct_from(True))
    opp_spell = (rows.c.own.is_(False)) & (rows.c.prev_own.is_distinct_from(False))
    result = await db.execute(
        select(
            func.coalesce(func.sum(rows.c.secs).filter(rows.c.own.is_(True)), 0),
            func.coalesce(func.sum(rows.c.secs).filter(rows.c.own.is_(False)), 0),
            func.count().filter(rows.c.own.is_(True)),
            func.count().filter(rows.c.own.is_(False)),
            func.count().filter(own_spell),
            func.count().filter(opp_spell),
        )
    )
    own_s, opp_s, own_n, opp_n, own_spells, opp_spells = result.one()
    return {
        "own_seconds": int(own_s),
        "opponent_seconds": int(opp_s),
        "own_count": int(own_n),
        "opponent_count": int(opp_n),
        "own_spells": int(own_spells),
        "opponent_spells": int(opp_spells),
    }


@router.delete("/match/{match_id}/after-video/{timestamp_ms}")
async def delete_possession_after_video_time(
    match_id: UUID,
    timestamp_ms: int,
    minute: int = Query(..., ge=0, description="Match minute at the rollback point (fallback for rows without video_ms)"),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Video Tagging "Undo to Point": delete the possession recorded after a video time.
    Rows that know their video time are cut exactly; older rows without it fall back to the
    match minute (anything in a LATER minute than the rollback point).
    """
    owner = await db.execute(
        select(Match.id).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    if owner.scalar_one_or_none() is None:
        raise HTTPException(status_code=404, detail="Match not found")

    result = await db.execute(
        delete(PossessionEvent).where(
            PossessionEvent.match_id == match_id,
            or_(
                PossessionEvent.video_ms > timestamp_ms,
                and_(PossessionEvent.video_ms.is_(None), PossessionEvent.minute > minute),
            ),
        )
    )
    await db.commit()
    # Who had the ball at the rollback point = the latest remaining possession row up to it
    last = await db.execute(
        select(PossessionEvent.team, PossessionEvent.pitch_x, PossessionEvent.pitch_y)
        .where(PossessionEvent.match_id == match_id, PossessionEvent.video_ms.is_not(None), PossessionEvent.video_ms <= timestamp_ms)
        .order_by(PossessionEvent.video_ms.desc(), PossessionEvent.created_at.desc())
        .limit(1)
    )
    row = last.first()
    team_at_point = getattr(row[0], "value", row[0]) if row else None
    # Ball spot: the latest remaining row that has coordinates
    spot = await db.execute(
        select(PossessionEvent.pitch_x, PossessionEvent.pitch_y)
        .where(PossessionEvent.match_id == match_id, PossessionEvent.video_ms.is_not(None),
               PossessionEvent.video_ms <= timestamp_ms, PossessionEvent.pitch_x.is_not(None), PossessionEvent.pitch_y.is_not(None))
        .order_by(PossessionEvent.video_ms.desc(), PossessionEvent.created_at.desc())
        .limit(1)
    )
    spot_row = spot.first()
    # Carrier: the latest remaining carry that began by this point and hadn't ended terminally
    seg = await db.execute(
        select(BallCarrierSegment.player_id, BallCarrierSegment.jersey_number, BallCarrierSegment.team, BallCarrierSegment.ended_by)
        .where(BallCarrierSegment.match_id == match_id, BallCarrierSegment.video_timestamp_ms.is_not(None),
               BallCarrierSegment.video_timestamp_ms <= timestamp_ms)
        .order_by(BallCarrierSegment.video_timestamp_ms.desc())
        .limit(1)
    )
    seg_row = seg.first()
    carrier = None
    if seg_row and seg_row[2] == "own" and (seg_row[3] is None or seg_row[3] == "pass"):
        carrier = {"player_id": str(seg_row[0]), "jersey_number": seg_row[1]}
    return {
        "deleted_count": result.rowcount, "match_id": str(match_id), "after_ms": timestamp_ms,
        "team_at_point": team_at_point,
        "ball_x": spot_row[0] if spot_row else None, "ball_y": spot_row[1] if spot_row else None,
        "carrier": carrier,
    }


@router.post("/video-batch", status_code=status.HTTP_201_CREATED)
async def create_video_possession_batch(
    data: PossessionVideoBatch,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Video Tagging: batched video-time possession points (explicit durations)."""
    await assert_match_in_club(db, data.match_id, user.club_id)
    created = await PossessionService.create_video_batch(db, data.match_id, data.points)
    return {"created": created}


@router.post("/bulk", status_code=status.HTTP_201_CREATED)
async def bulk_create_possession_events(
    data: PossessionEventBulkCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Bulk-record possession waypoints from a drag path.

    Accepts up to 50 waypoints in a single request.
    Duration chaining is handled sequentially server-side.
    """
    await assert_match_in_club(db, data.match_id, user.club_id)
    count = await PossessionService.bulk_create_possession_events(
        db,
        match_id=data.match_id,
        team=data.team.value if hasattr(data.team, 'value') else data.team,
        minute=data.minute,
        waypoints=data.waypoints,
        match_clock_s=data.match_clock_s,
    )
    return {"created": count}


@router.post("/", response_model=PossessionEventResponse, status_code=status.HTTP_201_CREATED)
async def create_possession_event(
    event_data: PossessionEventCreate,
    user: AuthenticatedUser = Depends(require_admin),
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
    # Idempotent deduplication
    await assert_match_in_club(db, event_data.match_id, user.club_id)
    if event_data.client_event_id:
        result = await db.execute(
            select(PossessionEvent).where(PossessionEvent.client_event_id == event_data.client_event_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            response = PossessionEventResponse.model_validate(existing)
            response.zone_name = existing.zone_name
            response.is_in_two_point_zone = existing.is_in_two_point_zone
            return response

    event = await PossessionService.create_possession_event(db, event_data)

    # Build response
    response = PossessionEventResponse.model_validate(event)
    response.zone_name = event.zone_name
    response.is_in_two_point_zone = event.is_in_two_point_zone

    return response


@router.get("/{event_id}", response_model=PossessionEventResponse)
async def get_possession_event(
    event_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get a single possession event by ID."""
    await assert_possession_event_in_club(db, event_id, user.club_id)
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
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    List possession events for a match.
    
    Returns events in chronological order (oldest first).
    Use this to build possession timeline or heat maps.
    """
    await assert_match_in_club(db, match_id, user.club_id)
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


@router.post("/freeze/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def freeze_match_possession(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Live Recording: the ball just went idle (kickout/free outcome pending, clock stopped, half time).
    Close the open possession now with its true duration so the idle time is never added to it.
    """
    await assert_match_in_club(db, match_id, user.club_id)
    await PossessionService.close_open_events(db, match_id)


@router.post("/finalize/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
async def finalize_match_possession(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Finalize possession tracking for a completed match.
    
    Sets duration for the last possession event.
    Should be called automatically when completing a match.
    """
    await assert_match_in_club(db, match_id, user.club_id)
    await PossessionService.finalize_match_possession(db, match_id)
    return None
