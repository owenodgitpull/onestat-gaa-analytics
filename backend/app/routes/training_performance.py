"""
Training Performance API Routes.

Handles:
- GPS/STATSports data upload and management
- Weight training data upload and management
- AI analysis of training performance
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from typing import Optional
from uuid import UUID
from datetime import datetime
import json
import logging
import base64
import os

from app.database import get_db, async_session_maker
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.training_performance import TrainingGPSData, WeightTrainingSession, WeightExercise, GPSUploadLog
from app.services.workload_analysis_service import WorkloadAnalysisService
from app.models.attendance import TrainingSession, Attendance, AttendanceStatus
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a STATSports GPS data file.

    Accepts PDF (uses Claude Vision to extract) or CSV files.
    Processing happens in the background.
    """
    # Verify session exists and belongs to user's club
    session_query = select(TrainingSession).where(and_(TrainingSession.id == session_id, TrainingSession.club_id == user.club_id))
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
                # Use Claude AI to intelligently parse CSV columns
                extracted_data = await parse_gps_csv(content)
            else:
                raise ValueError(f"Unsupported file type: {filename}")

            if extracted_data:
                # Store raw extracted text for reference
                upload_log.raw_extracted_text = json.dumps(extracted_data) if isinstance(extracted_data, dict) else str(extracted_data)

                # Get players to match names
                players_query = select(Player)
                players_result = await db.execute(players_query)
                all_players = list(players_result.scalars().all())

                def match_player(gps_name: str):
                    """Smart player matching — handles abbreviated names like 'Dylan S' -> 'Dylan Sweeney'"""
                    import re as _re
                    # Normalise: strip quotes, replace ? with ', collapse whitespace
                    gps_name = gps_name.strip().strip('"').replace('?', "'")
                    gps_clean = gps_name.lower()

                    # Exact match
                    for p in all_players:
                        if p.name.lower() == gps_clean:
                            return p

                    # Parse name parts — rejoin "Mc C" / "McB" style fragments
                    parts = gps_clean.split()
                    if not parts:
                        return None

                    # Handle "Ethan Mc C" → first="ethan", surname_part="mcc"
                    # and "R Grannell" → first_initial="r", surname_part="grannell"
                    first_name = parts[0]
                    surname_part = ''.join(parts[1:]).lower() if len(parts) > 1 else None

                    # First name matches (exact first name)
                    first_name_matches = [p for p in all_players if p.name.lower().split()[0] == first_name]

                    if len(first_name_matches) == 1:
                        return first_name_matches[0]

                    # If first_name is a single letter, treat as initial — match on surname instead
                    if len(first_name) == 1 and surname_part:
                        for p in all_players:
                            pparts = p.name.lower().split()
                            if len(pparts) > 1 and pparts[0].startswith(first_name) and pparts[-1].startswith(surname_part[:3]):
                                return p
                        # Also try surname match alone
                        for p in all_players:
                            pparts = p.name.lower().split()
                            if len(pparts) > 1 and pparts[-1] == surname_part:
                                return p

                    if surname_part and len(first_name_matches) > 1:
                        # Multiple first-name matches — filter by surname start
                        surname_initial = surname_part[0]
                        for p in first_name_matches:
                            name_parts = p.name.split()
                            if len(name_parts) > 1:
                                db_surname = name_parts[-1].lower().replace("'", "")
                                if db_surname.startswith(surname_initial):
                                    return p

                    # Joined surname match: "Mc C" collapsed to "mcc" matches "mccaffrey"
                    if surname_part and len(surname_part) >= 2:
                        for p in all_players:
                            pparts = p.name.lower().split()
                            if len(pparts) > 1 and pparts[0] == first_name:
                                db_surname = pparts[-1].replace("'", "")
                                if db_surname.startswith(surname_part):
                                    return p

                    # Partial first name match (but only if first name is 3+ chars to avoid false matches)
                    if len(first_name) >= 3:
                        for p in all_players:
                            if first_name in p.name.lower():
                                return p

                    logger.warning(f"No match for GPS player: '{gps_name}'")
                    return None

                # Create GPS records for each player
                player_count = 0
                matched_player_ids = set()
                if isinstance(extracted_data, dict) and "players" in extracted_data:
                    for player_data in extracted_data["players"]:
                        gps_name = player_data.get("name", "")
                        player = match_player(gps_name)

                        if player:
                            matched_player_ids.add(player.id)
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
                                player_load=player_data.get("player_load"),
                                avg_heart_rate=player_data.get("avg_heart_rate"),
                                max_heart_rate=player_data.get("max_heart_rate"),
                                step_balance_left_pct=player_data.get("step_balance_left_pct"),
                                hml_distance_m=player_data.get("hml_distance_m"),
                                duration_mins=player_data.get("duration_mins"),
                                raw_data=player_data
                            )
                            db.add(gps_record)
                            player_count += 1
                        else:
                            logger.warning(f"No match for GPS player: '{gps_name}'")

                # Auto-record attendance from GPS data
                if matched_player_ids:
                    # Check for existing attendance records
                    existing_att = await db.execute(
                        select(Attendance.player_id).where(Attendance.session_id == session_id)
                    )
                    already_recorded = {row[0] for row in existing_att.all()}

                    # Players in GPS file = present
                    for pid in matched_player_ids:
                        if pid not in already_recorded:
                            db.add(Attendance(
                                session_id=session_id,
                                player_id=pid,
                                status=AttendanceStatus.PRESENT,
                                notes="Auto-detected from GPS upload"
                            ))

                    # Active players NOT in GPS file = absent
                    for p in all_players:
                        if p.id not in matched_player_ids and p.id not in already_recorded and p.active:
                            db.add(Attendance(
                                session_id=session_id,
                                player_id=p.id,
                                status=AttendanceStatus.ABSENT,
                                notes="Not in GPS upload"
                            ))

                    logger.info(f"Auto-recorded attendance: {len(matched_player_ids)} present, "
                                f"{sum(1 for p in all_players if p.id not in matched_player_ids and p.id not in already_recorded and p.active)} absent")

                upload_log.extracted_player_count = player_count
                upload_log.status = "completed"
                upload_log.processed_at = datetime.utcnow()

            await db.commit()
            logger.info(f"GPS upload processed: {upload_id}, {upload_log.extracted_player_count} players")

            # Trigger workload analysis for players with GPS data
            if isinstance(extracted_data, dict) and "players" in extracted_data:
                for player_data in extracted_data["players"]:
                    gps_name = player_data.get("name", "")
                    player = match_player(gps_name)
                    if player:
                        try:
                            await WorkloadAnalysisService.trigger_analysis_for_player(
                                db, player.id, "gps_upload"
                            )
                        except Exception as e:
                            logger.error(f"Workload analysis failed for {gps_name}: {e}")

            # Generate AI training summary
            try:
                from app.services.ai import analyze_training_session
                result = await analyze_training_session(db, str(session_id))
                if result.get("summary"):
                    session_query = select(TrainingSession).where(TrainingSession.id == session_id)
                    session_result = await db.execute(session_query)
                    session_obj = session_result.scalar_one_or_none()
                    if session_obj:
                        session_obj.ai_summary = result["summary"]
                        session_obj.ai_summary_generated_at = datetime.utcnow()
                        await db.commit()
                        logger.info(f"AI training summary generated for session {session_id}")
            except Exception as e:
                logger.error(f"AI training summary failed: {e}")

            # Generate cross-cutting insight alerts
            try:
                from app.services.ai import generate_insight_alerts
                alerts = await generate_insight_alerts(
                    db, source="training_gps", session_id=session_id
                )
                if alerts:
                    logger.info(f"Generated {len(alerts)} insight alerts from training GPS upload")
            except Exception as e:
                logger.error(f"Insight alert generation failed: {e}")

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


def _parse_csv_local(content: bytes) -> dict:
    """
    Local CSV parser for STATSports exports — no AI needed.

    Maps common column name variations to our standard fields.
    """
    import csv
    import io

    # Decode
    text = None
    for encoding in ('utf-8', 'utf-8-sig', 'latin-1', 'cp1252'):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    if text is None:
        raise ValueError("Could not decode CSV file")

    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError("CSV has no header row")

    # Build a lowercase column name → original name mapping
    col_map = {name.strip().lower(): name.strip() for name in reader.fieldnames}

    def find_col(*candidates):
        """Find the first matching column name (case-insensitive, substring match)."""
        for candidate in candidates:
            cl = candidate.lower()
            # Exact match first
            if cl in col_map:
                return col_map[cl]
            # Substring match
            for key, orig in col_map.items():
                if cl in key:
                    return orig
        return None

    name_col = find_col("player display name", "player name", "player", "name", "athlete")
    dist_col = find_col("total distance")
    hsr_col = find_col("high speed running", "hsr")
    sprint_dist_col = find_col("sprint distance")
    max_speed_col = find_col("max speed", "max vel", "top speed")
    sprint_count_col = find_col("sprints", "sprint count", "number of sprints")
    accel_col = find_col("accelerations", "accel count")
    decel_col = find_col("decelerations", "decel count")
    dsl_col = find_col("dynamic stress load", "dsl", "stress load")
    pl_col = find_col("player load")
    avg_hr_col = find_col("average heart rate", "avg heart rate", "avg hr")
    max_hr_col = find_col("max heart rate", "max hr", "maximum heart rate")
    step_bal_col = find_col("step balance", "step balance left", "step bal", "balance left")
    hml_col = find_col("high metabolic load", "hml distance", "hml", "hmld")
    duration_col = find_col("duration", "session duration", "time", "total time")

    if not name_col:
        raise ValueError(f"Cannot find player name column in: {list(reader.fieldnames)}")

    logger.info(f"CSV columns mapped: name={name_col}, dist={dist_col}, hsr={hsr_col}, "
                f"sprints={sprint_count_col}, max_speed={max_speed_col}, step_bal={step_bal_col}")

    def safe_float(row, col):
        if not col:
            return None
        val = row.get(col, "").strip()
        if not val:
            return None
        try:
            v = float(val)
            return v if v > 0 else None
        except (ValueError, TypeError):
            return None

    def safe_int(row, col):
        v = safe_float(row, col)
        return int(v) if v is not None else None

    players = []
    for row in reader:
        name = row.get(name_col, "").strip().strip('"')
        if not name:
            continue
        players.append({
            "name": name,
            "total_distance_m": safe_float(row, dist_col),
            "high_speed_running_m": safe_float(row, hsr_col),
            "sprint_distance_m": safe_float(row, sprint_dist_col),
            "max_speed_ms": safe_float(row, max_speed_col),
            "sprint_count": safe_int(row, sprint_count_col),
            "acceleration_count": safe_int(row, accel_col),
            "deceleration_count": safe_int(row, decel_col),
            "dynamic_stress_load": safe_float(row, dsl_col),
            "player_load": safe_float(row, pl_col),
            "avg_heart_rate": safe_int(row, avg_hr_col),
            "max_heart_rate": safe_int(row, max_hr_col),
            "step_balance_left_pct": safe_float(row, step_bal_col),
            "hml_distance_m": safe_float(row, hml_col),
            "duration_mins": safe_float(row, duration_col),
        })

    logger.info(f"Local CSV parser extracted {len(players)} players")
    return {"session_info": {"session_type": "training"}, "players": players}


async def parse_gps_csv(content: bytes) -> dict:
    """
    Parse GPS data from CSV. Uses local parser (fast, no API needed).
    Falls back to AI only if local parsing finds no players.
    """
    try:
        result = _parse_csv_local(content)
        if result.get("players"):
            return result
        logger.warning("Local CSV parser found 0 players, trying AI fallback...")
    except Exception as e:
        logger.warning(f"Local CSV parser failed: {e}, trying AI fallback...")

    # AI fallback
    try:
        import anthropic

        for encoding in ('utf-8', 'utf-8-sig', 'latin-1', 'cp1252'):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        else:
            raise ValueError("Could not decode CSV file")

        lines = text.splitlines()
        if len(lines) > 200:
            text = '\n'.join(lines[:200])

        api_key = os.getenv("ANTHROPIC_API_KEY")
        if not api_key:
            raise ValueError("ANTHROPIC_API_KEY not set")

        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            messages=[{
                "role": "user",
                "content": f"""Extract ALL player GPS data from this CSV. Return JSON:
{{"players": [{{"name": "...", "total_distance_m": ..., "high_speed_running_m": ..., "sprint_distance_m": ..., "max_speed_ms": ..., "sprint_count": ..., "acceleration_count": ..., "deceleration_count": ..., "dynamic_stress_load": ..., "player_load": ..., "avg_heart_rate": ..., "max_heart_rate": ...}}]}}
Distances in metres, speed in m/s. Use null for missing. Return ONLY JSON.

CSV:
{text}"""
            }]
        )

        import re
        json_match = re.search(r'\{[\s\S]*\}', response.content[0].text)
        if json_match:
            return json.loads(json_match.group())

        return {"error": "Could not parse AI response"}

    except Exception as e:
        logger.error(f"AI CSV parsing also failed: {e}")
        return {"error": str(e)}


@router.get("/gps/upload/{upload_id}", response_model=GPSUploadStatus)
async def get_upload_status(
    upload_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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


@router.get("/ai-summary/latest")
async def get_latest_training_ai_summary(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get the latest AI-generated training session summary."""
    result = await db.execute(
        select(TrainingSession)
        .where(and_(TrainingSession.ai_summary.isnot(None), TrainingSession.club_id == user.club_id))
        .order_by(TrainingSession.session_date.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()

    if not session or not session.ai_summary:
        return {"summary": None}

    return {
        "summary": session.ai_summary,
        "session_date": session.session_date.isoformat() if session.session_date else None,
        "generated_at": session.ai_summary_generated_at.isoformat() if session.ai_summary_generated_at else None,
    }


@router.get("/gps/session/{session_id}", response_model=list[TrainingGPSDataResponse])
async def get_session_gps_data(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get all GPS data for a training session."""
    # Verify session belongs to user's club
    from app.models.attendance import TrainingSession
    session_check = await db.execute(
        select(TrainingSession.id).where(and_(TrainingSession.id == session_id, TrainingSession.club_id == user.club_id))
    )
    if not session_check.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Session not found")

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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get weight training history for a player."""
    # Validate player belongs to user's club
    player_query = select(Player).where(and_(Player.id == player_id, Player.club_id == user.club_id))
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")

    query = (
        select(WeightTrainingSession)
        .options(selectinload(WeightTrainingSession.exercises))
        .where(WeightTrainingSession.player_id == player_id)
        .order_by(WeightTrainingSession.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    sessions = result.scalars().all()
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get GPS history for a player."""
    # Validate player belongs to user's club
    player_query = select(Player).where(and_(Player.id == player_id, Player.club_id == user.club_id))
    player_result = await db.execute(player_query)
    player = player_result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found")
    player_name = player.name

    query = (
        select(TrainingGPSData)
        .where(TrainingGPSData.player_id == player_id)
        .order_by(TrainingGPSData.created_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    records = result.scalars().all()

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
