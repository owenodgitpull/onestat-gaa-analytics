"""
Attendance API Routes.

Handles CRUD operations for training sessions and attendance records.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import Optional
from uuid import UUID
from datetime import date, timedelta
import asyncio
import logging

from app.database import get_db, async_session_maker
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.services.workload_analysis_service import WorkloadAnalysisService

logger = logging.getLogger(__name__)
from app.models.attendance import TrainingSession, Attendance, SessionType, AttendanceStatus
from app.models.player import Player
from app.models.training_performance import TrainingGPSData
from app.schemas.attendance import (
    TrainingSessionCreate,
    TrainingSessionUpdate,
    TrainingSessionResponse,
    TrainingSessionDetail,
    AttendanceCreate,
    AttendanceBulkCreate,
    AttendanceUpdate,
    AttendanceResponse,
    PlayerAttendanceSummary,
    AttendanceOverview,
)

router = APIRouter()


# ============ Training Sessions ============

@router.post("/sessions", response_model=TrainingSessionResponse, status_code=201)
async def create_session(
    session: TrainingSessionCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new training session."""
    db_session = TrainingSession(**session.model_dump(), club_id=user.club_id)
    db.add(db_session)
    await db.commit()
    await db.refresh(db_session)

    return TrainingSessionResponse(
        **{k: v for k, v in db_session.__dict__.items() if not k.startswith('_')},
        attendance_count=0,
        present_count=0
    )


@router.get("/sessions", response_model=list[TrainingSessionResponse])
async def list_sessions(
    start_date: Optional[date] = Query(None, description="Filter from date"),
    end_date: Optional[date] = Query(None, description="Filter to date"),
    session_type: Optional[SessionType] = Query(None, description="Filter by type"),
    limit: int = Query(50, ge=1, le=100),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List training sessions with optional filters."""
    query = select(TrainingSession).options(selectinload(TrainingSession.attendance_records)).where(TrainingSession.club_id == user.club_id)

    if start_date:
        query = query.where(TrainingSession.session_date >= start_date)
    if end_date:
        query = query.where(TrainingSession.session_date <= end_date)
    if session_type:
        query = query.where(TrainingSession.session_type == session_type)

    query = query.order_by(TrainingSession.session_date.desc()).limit(limit)

    result = await db.execute(query)
    sessions = result.scalars().all()

    # Check which sessions have GPS data
    session_ids = [s.id for s in sessions]
    gps_query = select(TrainingGPSData.session_id).where(
        TrainingGPSData.session_id.in_(session_ids)
    ).distinct()
    gps_result = await db.execute(gps_query)
    sessions_with_gps = {row[0] for row in gps_result.all()}

    response = []
    for s in sessions:
        present = sum(1 for a in s.attendance_records if a.status == AttendanceStatus.PRESENT)
        response.append(TrainingSessionResponse(
            id=s.id,
            session_date=s.session_date,
            session_type=s.session_type,
            start_time=s.start_time,
            end_time=s.end_time,
            location=s.location,
            notes=s.notes,
            created_at=s.created_at,
            attendance_count=len(s.attendance_records),
            present_count=present,
            has_gps_data=s.id in sessions_with_gps
        ))

    return response


@router.get("/sessions/{session_id}", response_model=TrainingSessionDetail)
async def get_session(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a training session with attendance records."""
    query = (
        select(TrainingSession)
        .options(selectinload(TrainingSession.attendance_records))
        .where(TrainingSession.id == session_id)
    )
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Get player names for attendance records
    player_ids = [a.player_id for a in session.attendance_records]
    if player_ids:
        players_query = select(Player).where(Player.id.in_(player_ids))
        players_result = await db.execute(players_query)
        players = {p.id: p.name for p in players_result.scalars().all()}
    else:
        players = {}

    attendance_responses = [
        AttendanceResponse(
            id=a.id,
            session_id=a.session_id,
            player_id=a.player_id,
            player_name=players.get(a.player_id),
            status=a.status,
            arrival_time=a.arrival_time,
            notes=a.notes,
            created_at=a.created_at
        )
        for a in session.attendance_records
    ]

    present = sum(1 for a in session.attendance_records if a.status == AttendanceStatus.PRESENT)

    return TrainingSessionDetail(
        id=session.id,
        session_date=session.session_date,
        session_type=session.session_type,
        start_time=session.start_time,
        end_time=session.end_time,
        location=session.location,
        notes=session.notes,
        created_at=session.created_at,
        attendance_count=len(session.attendance_records),
        present_count=present,
        attendance_records=attendance_responses
    )


@router.put("/sessions/{session_id}", response_model=TrainingSessionResponse)
async def update_session(
    session_id: UUID,
    update: TrainingSessionUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a training session."""
    query = select(TrainingSession).where(TrainingSession.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(session, field, value)

    await db.commit()
    await db.refresh(session)

    return TrainingSessionResponse(
        **{k: v for k, v in session.__dict__.items() if not k.startswith('_')},
        attendance_count=0,
        present_count=0
    )


@router.delete("/sessions/{session_id}", status_code=204)
async def delete_session(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a training session (cascades to attendance records)."""
    query = select(TrainingSession).where(TrainingSession.id == session_id)
    result = await db.execute(query)
    session = result.scalar_one_or_none()

    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return None


# ============ Attendance Records ============

@router.post("/sessions/{session_id}/attendance", response_model=AttendanceResponse, status_code=201)
async def add_attendance(
    session_id: UUID,
    attendance: AttendanceCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add a single attendance record to a session."""
    # Verify session exists
    session_query = select(TrainingSession).where(TrainingSession.id == session_id)
    result = await db.execute(session_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    # Check for duplicate
    dup_query = select(Attendance).where(
        and_(Attendance.session_id == session_id, Attendance.player_id == attendance.player_id)
    )
    dup_result = await db.execute(dup_query)
    if dup_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Attendance already recorded for this player")

    db_attendance = Attendance(session_id=session_id, **attendance.model_dump())
    db.add(db_attendance)
    await db.commit()
    await db.refresh(db_attendance)

    # Get player name
    player_query = select(Player).where(Player.id == attendance.player_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()

    return AttendanceResponse(
        id=db_attendance.id,
        session_id=db_attendance.session_id,
        player_id=db_attendance.player_id,
        player_name=player.name if player else None,
        status=db_attendance.status,
        arrival_time=db_attendance.arrival_time,
        notes=db_attendance.notes,
        created_at=db_attendance.created_at
    )


@router.post("/attendance/bulk", response_model=list[AttendanceResponse], status_code=201)
async def bulk_add_attendance(
    bulk: AttendanceBulkCreate,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add multiple attendance records for a session."""
    # Verify session exists
    session_query = select(TrainingSession).where(TrainingSession.id == bulk.session_id)
    result = await db.execute(session_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

    # Get all players for names
    player_ids = [r.player_id for r in bulk.records]
    players_query = select(Player).where(Player.id.in_(player_ids))
    players_result = await db.execute(players_query)
    players = {p.id: p.name for p in players_result.scalars().all()}

    responses = []
    for record in bulk.records:
        # Skip duplicates
        dup_query = select(Attendance).where(
            and_(Attendance.session_id == bulk.session_id, Attendance.player_id == record.player_id)
        )
        dup_result = await db.execute(dup_query)
        if dup_result.scalar_one_or_none():
            continue

        db_attendance = Attendance(session_id=bulk.session_id, **record.model_dump())
        db.add(db_attendance)
        await db.flush()

        responses.append(AttendanceResponse(
            id=db_attendance.id,
            session_id=db_attendance.session_id,
            player_id=db_attendance.player_id,
            player_name=players.get(record.player_id),
            status=db_attendance.status,
            arrival_time=db_attendance.arrival_time,
            notes=db_attendance.notes,
            created_at=db_attendance.created_at
        ))

    await db.commit()

    # Trigger workload analysis for players who attended
    present_player_ids = [
        r.player_id for r in bulk.records
        if r.status == AttendanceStatus.PRESENT
    ]
    if present_player_ids:
        background_tasks.add_task(
            trigger_workload_analysis_for_players,
            present_player_ids,
            "attendance_logged"
        )

    return responses


async def trigger_workload_analysis_for_players(player_ids: list, trigger_source: str):
    """Background task to analyze workload for multiple players."""
    async with async_session_maker() as db:
        for player_id in player_ids:
            try:
                await WorkloadAnalysisService.trigger_analysis_for_player(
                    db, player_id, trigger_source
                )
            except Exception as e:
                logger.error(f"Workload analysis failed for player {player_id}: {e}")


@router.put("/attendance/{attendance_id}", response_model=AttendanceResponse)
async def update_attendance(
    attendance_id: UUID,
    update: AttendanceUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update an attendance record."""
    query = select(Attendance).where(Attendance.id == attendance_id)
    result = await db.execute(query)
    attendance = result.scalar_one_or_none()

    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    update_data = update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(attendance, field, value)

    await db.commit()
    await db.refresh(attendance)

    # Get player name
    player_query = select(Player).where(Player.id == attendance.player_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()

    return AttendanceResponse(
        id=attendance.id,
        session_id=attendance.session_id,
        player_id=attendance.player_id,
        player_name=player.name if player else None,
        status=attendance.status,
        arrival_time=attendance.arrival_time,
        notes=attendance.notes,
        created_at=attendance.created_at
    )


@router.delete("/attendance/{attendance_id}", status_code=204)
async def delete_attendance(
    attendance_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete an attendance record."""
    query = select(Attendance).where(Attendance.id == attendance_id)
    result = await db.execute(query)
    attendance = result.scalar_one_or_none()

    if not attendance:
        raise HTTPException(status_code=404, detail="Attendance record not found")

    await db.delete(attendance)
    await db.commit()
    return None


# ============ Reports ============

@router.get("/overview", response_model=AttendanceOverview)
async def get_attendance_overview(
    start_date: Optional[date] = Query(None, description="Start date for report"),
    end_date: Optional[date] = Query(None, description="End date for report"),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get attendance overview with player summaries."""
    # Default to last 30 days if no dates provided
    if not end_date:
        end_date = date.today()
    if not start_date:
        start_date = end_date - timedelta(days=30)

    # Get all sessions in range
    sessions_query = select(TrainingSession).where(
        and_(
            TrainingSession.session_date >= start_date,
            TrainingSession.session_date <= end_date
        )
    )
    sessions_result = await db.execute(sessions_query)
    sessions = sessions_result.scalars().all()
    session_ids = [s.id for s in sessions]

    if not session_ids:
        return AttendanceOverview(
            total_sessions=0,
            total_players=0,
            average_attendance_rate=0.0,
            player_summaries=[]
        )

    # Get all attendance records
    attendance_query = select(Attendance).where(Attendance.session_id.in_(session_ids))
    attendance_result = await db.execute(attendance_query)
    attendance_records = attendance_result.scalars().all()

    # Get all active players
    players_query = select(Player).where(Player.active == True)
    players_result = await db.execute(players_query)
    players = {p.id: p for p in players_result.scalars().all()}

    # Calculate per-player summaries
    player_stats = {}
    for player_id, player in players.items():
        player_stats[player_id] = {
            "player_id": player_id,
            "player_name": player.name,
            "total_sessions": len(session_ids),
            "present_count": 0,
            "absent_count": 0,
            "late_count": 0,
            "excused_count": 0,
        }

    for record in attendance_records:
        if record.player_id in player_stats:
            if record.status == AttendanceStatus.PRESENT:
                player_stats[record.player_id]["present_count"] += 1
            elif record.status == AttendanceStatus.ABSENT:
                player_stats[record.player_id]["absent_count"] += 1
            elif record.status == AttendanceStatus.LATE:
                player_stats[record.player_id]["late_count"] += 1
            elif record.status == AttendanceStatus.EXCUSED:
                player_stats[record.player_id]["excused_count"] += 1

    # Calculate attendance rates
    summaries = []
    total_rate = 0
    for stats in player_stats.values():
        attended = stats["present_count"] + stats["late_count"]
        rate = (attended / stats["total_sessions"] * 100) if stats["total_sessions"] > 0 else 0
        total_rate += rate
        summaries.append(PlayerAttendanceSummary(
            **stats,
            attendance_rate=round(rate, 1)
        ))

    # Sort by attendance rate descending
    summaries.sort(key=lambda x: x.attendance_rate, reverse=True)

    avg_rate = total_rate / len(summaries) if summaries else 0

    return AttendanceOverview(
        total_sessions=len(session_ids),
        total_players=len(players),
        average_attendance_rate=round(avg_rate, 1),
        player_summaries=summaries
    )
