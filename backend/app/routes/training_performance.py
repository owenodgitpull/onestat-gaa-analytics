"""
Training Performance API Routes.

Handles:
- GPS/STATSports data upload and management
- Weight training data upload and management
- AI analysis of training performance
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload
from typing import Optional
from uuid import UUID
from datetime import datetime
import json
import logging
import base64
import os

from app.database import get_db
from app.models.training_performance import TrainingGPSData, WeightTrainingSession, WeightExercise, GPSUploadLog
from app.models.attendance import TrainingSession
from app.models.player import Player
from app.schemas.training_performance import (
    TrainingGPSDataCreate,
    TrainingGPSDataResponse,
    GPSDataBulkCreate,
    WeightTrainingSessionCreate,
    WeightTrainingSessionResponse,
    WeightExerciseResponse,
    GPSUploadResponse,
    GPSUploadStatus,
    PlayerGPSTrend,
    TeamGPSSummary
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ GPS Data Endpoints ============

@router.post("/gps/upload", response_model=GPSUploadResponse)
async def upload_gps_data(
    background_tasks: BackgroundTasks,
    session_id: UUID = Form(..., description="Training session UUID"),
    file: UploadFile = File(..., description="STATSports PDF or CSV file"),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a STATSports GPS data file.

    Accepts PDF (uses Claude Vision to extract) or CSV files.
    Processing happens in the background.
    """
    # Verify session exists
    session_query = select(TrainingSession).where(TrainingSession.id == session_id)
    result = await db.execute(session_query)
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Training session not found")

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Create upload log
    upload_log = GPSUploadLog(
        session_id=session_id,
        filename=file.filename or "unknown",
        file_size_bytes=file_size,
        upload_source="manual",
        status="pending"
    )
    db.add(upload_log)
    await db.commit()
    await db.refresh(upload_log)

    # Process in background
    background_tasks.add_task(
        process_gps_upload,
        upload_log.id,
        content,
        file.filename or "unknown",
        session_id
    )

    return GPSUploadResponse(
        upload_id=upload_log.id,
        status="processing",
        filename=file.filename or "unknown",
        message="File uploaded. Processing in background."
    )


async def process_gps_upload(upload_id: UUID, content: bytes, filename: str, session_id: UUID):
    """
    Background task to process GPS upload.

    Uses Claude Vision for PDFs, parses CSV directly.
    """
    from app.database import async_session_maker

    async with async_session_maker() as db:
        # Get upload log
        query = select(GPSUploadLog).where(GPSUploadLog.id == upload_id)
        result = await db.execute(query)
        upload_log = result.scalar_one_or_none()

        if not upload_log:
            logger.error(f"Upload log not found: {upload_id}")
            return

        try:
            upload_log.status = "processing"
            await db.commit()

            extracted_data = None

            if filename.lower().endswith('.pdf'):
                # Use Claude Vision to extract
                extracted_data = await extract_gps_from_pdf(content, filename)
            elif filename.lower().endswith('.csv'):
                # Parse CSV directly
                extracted_data = parse_gps_csv(content)
            else:
                raise ValueError(f"Unsupported file type: {filename}")

            if extracted_data:
                # Store raw extracted text for reference
                upload_log.raw_extracted_text = json.dumps(extracted_data) if isinstance(extracted_data, dict) else str(extracted_data)

                # Get players to match names
                players_query = select(Player)
                players_result = await db.execute(players_query)
                players = {p.name.lower(): p for p in players_result.scalars().all()}

                # Create GPS records for each player
                player_count = 0
                if isinstance(extracted_data, dict) and "players" in extracted_data:
                    for player_data in extracted_data["players"]:
                        player_name = player_data.get("name", "").lower()
                        player = players.get(player_name)

                        if player:
                            gps_record = TrainingGPSData(
                                session_id=session_id,
                                player_id=player.id,
                                total_distance_m=player_data.get("total_distance_m"),
                                high_speed_running_m=player_data.get("high_speed_running_m"),
                                sprint_distance_m=player_data.get("sprint_distance_m"),
                                max_speed_ms=player_data.get("max_speed_ms"),
                                sprint_count=player_data.get("sprint_count"),
                                acceleration_count=player_data.get("acceleration_count"),
                                deceleration_count=player_data.get("deceleration_count"),
                                dynamic_stress_load=player_data.get("dynamic_stress_load"),
                                avg_heart_rate=player_data.get("avg_heart_rate"),
                                max_heart_rate=player_data.get("max_heart_rate"),
                                raw_data=player_data
                            )
                            db.add(gps_record)
                            player_count += 1

                upload_log.extracted_player_count = player_count
                upload_log.status = "completed"
                upload_log.processed_at = datetime.utcnow()

            await db.commit()
            logger.info(f"GPS upload processed: {upload_id}, {upload_log.extracted_player_count} players")

        except Exception as e:
            logger.error(f"GPS upload processing failed: {e}")
            upload_log.status = "failed"
            upload_log.error_message = str(e)
            await db.commit()


async def extract_gps_from_pdf(content: bytes, filename: str) -> dict:
    """
    Use Claude Vision to extract GPS data from a PDF.
    """
    try:
        import anthropic
        import fitz  # pymupdf

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")

        # Convert PDF pages to images
        pdf = fitz.open(stream=content, filetype="pdf")
        images_base64 = []

        for page_num in range(min(len(pdf), 5)):  # Limit to 5 pages
            page = pdf[page_num]
            mat = fitz.Matrix(150/72, 150/72)  # 150 DPI
            pix = page.get_pixmap(matrix=mat)
            img_bytes = pix.tobytes("png")
            img_base64 = base64.b64encode(img_bytes).decode('utf-8')
            images_base64.append(img_base64)

        pdf.close()

        # Build Claude request
        message_content = []
        for img_b64 in images_base64:
            message_content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": img_b64
                }
            })

        message_content.append({
            "type": "text",
            "text": """Extract ALL player GPS performance data from this STATSports report.

Return a JSON object with this structure:
{
    "session_info": {
        "date": "YYYY-MM-DD",
        "session_type": "training/match",
        "duration_mins": 90
    },
    "team_averages": {
        "total_distance_m": 10000,
        "max_speed_ms": 8.5,
        "sprint_count": 40
    },
    "players": [
        {
            "name": "Player Name",
            "total_distance_m": 10500,
            "high_speed_running_m": 800,
            "sprint_distance_m": 200,
            "max_speed_ms": 8.9,
            "sprint_count": 45,
            "acceleration_count": 50,
            "deceleration_count": 48,
            "dynamic_stress_load": 350,
            "avg_heart_rate": 155,
            "max_heart_rate": 185
        }
    ]
}

Extract EVERY player and ALL metrics visible. Use null for missing values.
Return ONLY the JSON object, no other text."""
        })

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{"role": "user", "content": message_content}]
        )

        response_text = response.content[0].text

        # Parse JSON from response
        import re
        json_match = re.search(r'\{[\s\S]*\}', response_text)
        if json_match:
            return json.loads(json_match.group())

        return {"error": "Could not parse response", "raw": response_text}

    except Exception as e:
        logger.error(f"PDF extraction failed: {e}")
        return {"error": str(e)}


def parse_gps_csv(content: bytes) -> dict:
    """
    Parse GPS data from CSV format.
    """
    import csv
    from io import StringIO

    try:
        text = content.decode('utf-8')
        reader = csv.DictReader(StringIO(text))

        players = []
        for row in reader:
            player_data = {
                "name": row.get("Player", row.get("Name", "")),
                "total_distance_m": float(row.get("Total Distance", row.get("Distance", 0)) or 0),
                "max_speed_ms": float(row.get("Max Speed", row.get("Top Speed", 0)) or 0),
                "sprint_count": int(row.get("Sprints", row.get("Sprint Count", 0)) or 0),
            }
            players.append(player_data)

        return {"players": players}

    except Exception as e:
        logger.error(f"CSV parsing failed: {e}")
        return {"error": str(e)}


@router.get("/gps/upload/{upload_id}", response_model=GPSUploadStatus)
async def get_upload_status(
    upload_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get the status of a GPS upload."""
    query = select(GPSUploadLog).where(GPSUploadLog.id == upload_id)
    result = await db.execute(query)
    upload = result.scalar_one_or_none()

    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")

    return GPSUploadStatus(
        id=upload.id,
        session_id=upload.session_id,
        filename=upload.filename,
        status=upload.status,
        extracted_player_count=upload.extracted_player_count,
        error_message=upload.error_message,
        created_at=upload.created_at,
        processed_at=upload.processed_at
    )


@router.get("/gps/session/{session_id}", response_model=list[TrainingGPSDataResponse])
async def get_session_gps_data(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get all GPS data for a training session."""
    query = select(TrainingGPSData).where(TrainingGPSData.session_id == session_id)
    result = await db.execute(query)
    records = result.scalars().all()

    # Get player names
    player_ids = [r.player_id for r in records]
    if player_ids:
        players_query = select(Player).where(Player.id.in_(player_ids))
        players_result = await db.execute(players_query)
        players = {p.id: p.name for p in players_result.scalars().all()}
    else:
        players = {}

    return [
        TrainingGPSDataResponse(
            id=r.id,
            session_id=r.session_id,
            player_id=r.player_id,
            player_name=players.get(r.player_id),
            total_distance_m=r.total_distance_m,
            high_speed_running_m=r.high_speed_running_m,
            sprint_distance_m=r.sprint_distance_m,
            hml_distance_m=r.hml_distance_m,
            max_speed_ms=r.max_speed_ms,
            avg_speed_ms=r.avg_speed_ms,
            sprint_count=r.sprint_count,
            acceleration_count=r.acceleration_count,
            deceleration_count=r.deceleration_count,
            dynamic_stress_load=r.dynamic_stress_load,
            player_load=r.player_load,
            avg_heart_rate=r.avg_heart_rate,
            max_heart_rate=r.max_heart_rate,
            time_in_red_zone_mins=r.time_in_red_zone_mins,
            duration_mins=r.duration_mins,
            notes=r.notes,
            created_at=r.created_at
        )
        for r in records
    ]


@router.post("/gps/manual", response_model=list[TrainingGPSDataResponse], status_code=201)
async def add_gps_data_manually(
    data: GPSDataBulkCreate,
    db: AsyncSession = Depends(get_db)
):
    """Manually add GPS data for multiple players."""
    # Verify session exists
    session_query = select(TrainingSession).where(TrainingSession.id == data.session_id)
    result = await db.execute(session_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Training session not found")

    # Get player names
    player_ids = [r.player_id for r in data.records]
    players_query = select(Player).where(Player.id.in_(player_ids))
    players_result = await db.execute(players_query)
    players = {p.id: p.name for p in players_result.scalars().all()}

    responses = []
    for record in data.records:
        gps_data = TrainingGPSData(
            session_id=data.session_id,
            **record.model_dump()
        )
        db.add(gps_data)
        await db.flush()

        responses.append(TrainingGPSDataResponse(
            id=gps_data.id,
            session_id=gps_data.session_id,
            player_id=gps_data.player_id,
            player_name=players.get(gps_data.player_id),
            total_distance_m=gps_data.total_distance_m,
            high_speed_running_m=gps_data.high_speed_running_m,
            sprint_distance_m=gps_data.sprint_distance_m,
            hml_distance_m=gps_data.hml_distance_m,
            max_speed_ms=gps_data.max_speed_ms,
            avg_speed_ms=gps_data.avg_speed_ms,
            sprint_count=gps_data.sprint_count,
            acceleration_count=gps_data.acceleration_count,
            deceleration_count=gps_data.deceleration_count,
            dynamic_stress_load=gps_data.dynamic_stress_load,
            player_load=gps_data.player_load,
            avg_heart_rate=gps_data.avg_heart_rate,
            max_heart_rate=gps_data.max_heart_rate,
            time_in_red_zone_mins=gps_data.time_in_red_zone_mins,
            duration_mins=gps_data.duration_mins,
            notes=gps_data.notes,
            created_at=gps_data.created_at
        ))

    await db.commit()
    return responses


# ============ Weight Training Endpoints ============

@router.post("/weights", response_model=WeightTrainingSessionResponse, status_code=201)
async def create_weight_session(
    data: WeightTrainingSessionCreate,
    db: AsyncSession = Depends(get_db)
):
    """Create a weight training session with exercises."""
    # Verify training session exists
    session_query = select(TrainingSession).where(TrainingSession.id == data.session_id)
    result = await db.execute(session_query)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Training session not found")

    # Get player name
    player_query = select(Player).where(Player.id == data.player_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()

    # Create weight session
    weight_session = WeightTrainingSession(
        session_id=data.session_id,
        player_id=data.player_id,
        total_volume_kg=data.total_volume_kg,
        session_duration_mins=data.session_duration_mins,
        notes=data.notes
    )
    db.add(weight_session)
    await db.flush()

    # Add exercises
    exercise_responses = []
    for ex_data in data.exercises:
        exercise = WeightExercise(
            weight_session_id=weight_session.id,
            **ex_data.model_dump()
        )
        db.add(exercise)
        await db.flush()

        exercise_responses.append(WeightExerciseResponse(
            id=exercise.id,
            weight_session_id=exercise.weight_session_id,
            exercise_name=exercise.exercise_name,
            exercise_category=exercise.exercise_category,
            sets=exercise.sets,
            reps_per_set=exercise.reps_per_set,
            weight_kg=exercise.weight_kg,
            one_rep_max_estimate=exercise.one_rep_max_estimate,
            rpe=exercise.rpe,
            notes=exercise.notes,
            created_at=exercise.created_at
        ))

    await db.commit()

    return WeightTrainingSessionResponse(
        id=weight_session.id,
        session_id=weight_session.session_id,
        player_id=weight_session.player_id,
        player_name=player.name if player else None,
        total_volume_kg=weight_session.total_volume_kg,
        session_duration_mins=weight_session.session_duration_mins,
        notes=weight_session.notes,
        exercises=exercise_responses,
        created_at=weight_session.created_at
    )


@router.get("/weights/session/{session_id}", response_model=list[WeightTrainingSessionResponse])
async def get_session_weight_data(
    session_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get all weight training data for a session."""
    query = (
        select(WeightTrainingSession)
        .options(selectinload(WeightTrainingSession.exercises))
        .where(WeightTrainingSession.session_id == session_id)
    )
    result = await db.execute(query)
    sessions = result.scalars().all()

    # Get player names
    player_ids = [s.player_id for s in sessions]
    if player_ids:
        players_query = select(Player).where(Player.id.in_(player_ids))
        players_result = await db.execute(players_query)
        players = {p.id: p.name for p in players_result.scalars().all()}
    else:
        players = {}

    return [
        WeightTrainingSessionResponse(
            id=s.id,
            session_id=s.session_id,
            player_id=s.player_id,
            player_name=players.get(s.player_id),
            total_volume_kg=s.total_volume_kg,
            session_duration_mins=s.session_duration_mins,
            notes=s.notes,
            exercises=[
                WeightExerciseResponse(
                    id=e.id,
                    weight_session_id=e.weight_session_id,
                    exercise_name=e.exercise_name,
                    exercise_category=e.exercise_category,
                    sets=e.sets,
                    reps_per_set=e.reps_per_set,
                    weight_kg=e.weight_kg,
                    one_rep_max_estimate=e.one_rep_max_estimate,
                    rpe=e.rpe,
                    notes=e.notes,
                    created_at=e.created_at
                )
                for e in s.exercises
            ],
            created_at=s.created_at
        )
        for s in sessions
    ]


@router.get("/weights/player/{player_id}", response_model=list[WeightTrainingSessionResponse])
async def get_player_weight_history(
    player_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get weight training history for a player."""
    query = (
        select(WeightTrainingSession)
        .options(selectinload(WeightTrainingSession.exercises))
        .where(WeightTrainingSession.player_id == player_id)
        .order_by(WeightTrainingSession.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    sessions = result.scalars().all()

    # Get player name
    player_query = select(Player).where(Player.id == player_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()
    player_name = player.name if player else None

    return [
        WeightTrainingSessionResponse(
            id=s.id,
            session_id=s.session_id,
            player_id=s.player_id,
            player_name=player_name,
            total_volume_kg=s.total_volume_kg,
            session_duration_mins=s.session_duration_mins,
            notes=s.notes,
            exercises=[
                WeightExerciseResponse(
                    id=e.id,
                    weight_session_id=e.weight_session_id,
                    exercise_name=e.exercise_name,
                    exercise_category=e.exercise_category,
                    sets=e.sets,
                    reps_per_set=e.reps_per_set,
                    weight_kg=e.weight_kg,
                    one_rep_max_estimate=e.one_rep_max_estimate,
                    rpe=e.rpe,
                    notes=e.notes,
                    created_at=e.created_at
                )
                for e in s.exercises
            ],
            created_at=s.created_at
        )
        for s in sessions
    ]


# ============ Player GPS History ============

@router.get("/gps/player/{player_id}", response_model=list[TrainingGPSDataResponse])
async def get_player_gps_history(
    player_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get GPS history for a player."""
    query = (
        select(TrainingGPSData)
        .where(TrainingGPSData.player_id == player_id)
        .order_by(TrainingGPSData.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    records = result.scalars().all()

    # Get player name
    player_query = select(Player).where(Player.id == player_id)
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()
    player_name = player.name if player else None

    return [
        TrainingGPSDataResponse(
            id=r.id,
            session_id=r.session_id,
            player_id=r.player_id,
            player_name=player_name,
            total_distance_m=r.total_distance_m,
            high_speed_running_m=r.high_speed_running_m,
            sprint_distance_m=r.sprint_distance_m,
            hml_distance_m=r.hml_distance_m,
            max_speed_ms=r.max_speed_ms,
            avg_speed_ms=r.avg_speed_ms,
            sprint_count=r.sprint_count,
            acceleration_count=r.acceleration_count,
            deceleration_count=r.deceleration_count,
            dynamic_stress_load=r.dynamic_stress_load,
            player_load=r.player_load,
            avg_heart_rate=r.avg_heart_rate,
            max_heart_rate=r.max_heart_rate,
            time_in_red_zone_mins=r.time_in_red_zone_mins,
            duration_mins=r.duration_mins,
            notes=r.notes,
            created_at=r.created_at
        )
        for r in records
    ]
