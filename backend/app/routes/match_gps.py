"""
Match GPS API Routes.

Handles:
- GPS/STATSports data upload for completed matches
- Match GPS data retrieval
- AI re-analysis trigger when GPS data is added
"""

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from uuid import UUID
from datetime import datetime
import json
import logging

from app.database import get_db, async_session_maker
from app.models.match import Match, MatchStatus
from app.models.match_gps import MatchGPSData
from app.models.training_performance import GPSUploadLog
from app.models.player import Player
from app.services.workload_analysis_service import WorkloadAnalysisService
from app.schemas.match_gps import (
    MatchGPSDataCreate,
    MatchGPSDataResponse,
    MatchGPSBulkCreate,
    MatchGPSUploadResponse,
    MatchGPSUploadStatus,
    MatchGPSSummary,
    MatchReanalysisResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Match GPS Upload ============

@router.post("/{match_id}/gps/upload", response_model=MatchGPSUploadResponse)
async def upload_match_gps(
    match_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="STATSports PDF or CSV file"),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a STATSports GPS data file for a completed match.

    Accepts PDF (uses Claude Vision to extract) or CSV files.
    Processing happens in the background.
    After processing, AI will re-analyze the match with GPS data included.
    """
    # Verify match exists and is completed
    match_query = select(Match).where(Match.id == match_id)
    result = await db.execute(match_query)
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if match.status != MatchStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail="GPS data can only be uploaded for completed matches"
        )

    # Read file content
    content = await file.read()
    file_size = len(content)

    # Create upload log with match_id
    upload_log = GPSUploadLog(
        match_id=match_id,
        upload_type="match",
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
        process_match_gps_upload,
        upload_log.id,
        content,
        file.filename or "unknown",
        match_id
    )

    return MatchGPSUploadResponse(
        upload_id=upload_log.id,
        match_id=match_id,
        status="processing",
        filename=file.filename or "unknown",
        message="File uploaded. Processing in background. AI will re-analyze match when complete."
    )


async def process_match_gps_upload(upload_id: UUID, content: bytes, filename: str, match_id: UUID):
    """
    Background task to process match GPS upload.

    Uses Claude Vision for PDFs, parses CSV directly.
    After processing, triggers AI re-analysis of the match.
    """
    from app.database import async_session_maker
    # Import here to avoid circular imports
    from app.routes.training_performance import extract_gps_from_pdf, parse_gps_csv

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

                # Log extracted data structure
                logger.info(f"Extracted data type: {type(extracted_data)}")
                if isinstance(extracted_data, dict):
                    logger.info(f"Extracted data keys: {extracted_data.keys()}")
                    if "players" in extracted_data:
                        logger.info(f"Number of players in extraction: {len(extracted_data['players'])}")
                        for i, p in enumerate(extracted_data['players'][:3]):  # Log first 3
                            logger.info(f"  Player {i}: {p.get('name', 'NO NAME')} - distance: {p.get('total_distance_m', 'N/A')}")

                # Get players to match names
                players_query = select(Player)
                players_result = await db.execute(players_query)
                all_players = list(players_result.scalars().all())
                logger.info(f"Database has {len(all_players)} players")

                def match_player(gps_name: str) -> Optional[Player]:
                    """
                    Smart player matching - handles abbreviated names like "Dylan S" -> "Dylan Sweeney"
                    """
                    gps_name = gps_name.strip().lower()
                    logger.info(f"Matching GPS name: '{gps_name}'")

                    # Try exact match first
                    for p in all_players:
                        if p.name.lower() == gps_name:
                            logger.info(f"  Exact match: {p.name}")
                            return p

                    # Parse the GPS name - could be "FirstName LastInitial" or just "FirstName"
                    parts = gps_name.split()
                    if not parts:
                        logger.info(f"  No parts found in name")
                        return None

                    first_name = parts[0]
                    # Handle surname initial - could be single letter "S" or abbreviated "Sw"
                    surname_part = parts[1] if len(parts) > 1 else None
                    surname_initial = surname_part[0] if surname_part else None

                    logger.info(f"  Parsed: first='{first_name}', surname_part='{surname_part}'")

                    # Find matches where first name matches the start of player's first name
                    first_name_matches = []
                    for p in all_players:
                        player_parts = p.name.lower().split()
                        if player_parts and player_parts[0] == first_name:
                            first_name_matches.append(p)

                    logger.info(f"  First name matches: {[p.name for p in first_name_matches]}")

                    if len(first_name_matches) == 1:
                        # Only one player with this first name - use them
                        logger.info(f"  Single first name match: {first_name_matches[0].name}")
                        return first_name_matches[0]

                    if surname_initial and len(first_name_matches) > 1:
                        # Multiple matches, filter by surname initial
                        for p in first_name_matches:
                            name_parts = p.name.split()
                            if len(name_parts) > 1:
                                surname = name_parts[-1].lower()
                                if surname.startswith(surname_initial):
                                    logger.info(f"  Surname initial match: {p.name}")
                                    return p

                    # Try matching first name anywhere in the player name
                    for p in all_players:
                        if first_name in p.name.lower():
                            logger.info(f"  Partial match: {p.name}")
                            return p

                    logger.info(f"  No match found for '{gps_name}'")
                    return None

                # Create Match GPS records for each player
                player_count = 0
                if isinstance(extracted_data, dict) and "players" in extracted_data:
                    for player_data in extracted_data["players"]:
                        gps_player_name = player_data.get("name", "")
                        player = match_player(gps_player_name)

                        if player:
                            # Check if record already exists for this player/match
                            existing_query = select(MatchGPSData).where(
                                MatchGPSData.match_id == match_id,
                                MatchGPSData.player_id == player.id
                            )
                            existing_result = await db.execute(existing_query)
                            existing_record = existing_result.scalar_one_or_none()

                            if existing_record:
                                # Update existing record
                                for key, value in player_data.items():
                                    if key != "name" and hasattr(existing_record, key):
                                        setattr(existing_record, key, value)
                            else:
                                # Create new record
                                gps_record = MatchGPSData(
                                    match_id=match_id,
                                    player_id=player.id,
                                    total_distance_m=player_data.get("total_distance_m"),
                                    high_speed_running_m=player_data.get("high_speed_running_m"),
                                    sprint_distance_m=player_data.get("sprint_distance_m"),
                                    hml_distance_m=player_data.get("hml_distance_m"),
                                    max_speed_ms=player_data.get("max_speed_ms"),
                                    avg_speed_ms=player_data.get("avg_speed_ms"),
                                    sprint_count=player_data.get("sprint_count"),
                                    acceleration_count=player_data.get("acceleration_count"),
                                    deceleration_count=player_data.get("deceleration_count"),
                                    dynamic_stress_load=player_data.get("dynamic_stress_load"),
                                    player_load=player_data.get("player_load"),
                                    avg_heart_rate=player_data.get("avg_heart_rate"),
                                    max_heart_rate=player_data.get("max_heart_rate"),
                                    time_in_red_zone_mins=player_data.get("time_in_red_zone_mins"),
                                    playing_minutes=player_data.get("playing_minutes"),
                                    raw_data=player_data
                                )
                                db.add(gps_record)
                            player_count += 1

                upload_log.extracted_player_count = player_count
                upload_log.status = "gps_processed"
                upload_log.processed_at = datetime.utcnow()
                logger.info(f"Match GPS processing complete: {player_count} players matched and saved")

            await db.commit()
            logger.info(f"Match GPS upload processed: {upload_id}, {upload_log.extracted_player_count} players committed")

            # Trigger workload analysis for players with GPS data
            # Use the match date so the snapshot is created for the correct day
            match_query = select(Match).where(Match.id == match_id)
            match_result = await db.execute(match_query)
            match_obj = match_result.scalar_one_or_none()
            match_date = match_obj.match_date if match_obj else None

            if isinstance(extracted_data, dict) and "players" in extracted_data:
                for player_data in extracted_data["players"]:
                    gps_player_name = player_data.get("name", "")
                    player = match_player(gps_player_name)
                    if player:
                        try:
                            await WorkloadAnalysisService.trigger_analysis_for_player(
                                db, player.id, "match_gps_upload",
                                for_date=match_date
                            )
                        except Exception as e:
                            logger.error(f"Workload analysis failed for {gps_player_name}: {e}")

            # Trigger AI re-analysis of the match with GPS data
            await trigger_match_reanalysis_with_gps(db, match_id)

            # Only mark as "completed" AFTER AI re-analysis finishes,
            # so the frontend won't re-fetch until the new report is ready
            upload_log.status = "completed"
            await db.commit()

        except Exception as e:
            logger.error(f"Match GPS upload processing failed: {e}")
            upload_log.status = "failed"
            upload_log.error_message = str(e)
            await db.commit()


async def trigger_match_reanalysis_with_gps(db: AsyncSession, match_id: UUID):
    """
    Re-analyze a match after GPS data has been uploaded.

    Forces regeneration of AI analysis with GPS context included.
    The generate_post_match_report function handles persistence.
    """
    from app.services.ai import generate_post_match_report

    try:
        logger.info(f"Triggering AI re-analysis of match {match_id} with GPS data")

        # Force regenerate to include new GPS data
        report = await generate_post_match_report(db, str(match_id), force_regenerate=True)

        if report and report.get("analysis"):
            logger.info(f"Match {match_id} re-analysis complete (version {report.get('version', 1)}, GPS={report.get('gps_included', False)})")
        else:
            logger.warning(f"AI re-analysis returned empty for match {match_id}")

    except Exception as e:
        logger.error(f"Match re-analysis failed for {match_id}: {e}")


# ============ Match GPS Data Retrieval ============

@router.get("/{match_id}/gps", response_model=list[MatchGPSDataResponse])
async def get_match_gps(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get all GPS data for a match."""
    # Verify match exists
    match_query = select(Match).where(Match.id == match_id)
    result = await db.execute(match_query)
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Get GPS data with player names
    gps_query = select(MatchGPSData, Player.name).join(
        Player, MatchGPSData.player_id == Player.id
    ).where(MatchGPSData.match_id == match_id)

    gps_result = await db.execute(gps_query)
    gps_records = gps_result.all()

    return [
        MatchGPSDataResponse(
            id=record.MatchGPSData.id,
            match_id=record.MatchGPSData.match_id,
            player_id=record.MatchGPSData.player_id,
            player_name=record.name,
            total_distance_m=record.MatchGPSData.total_distance_m,
            high_speed_running_m=record.MatchGPSData.high_speed_running_m,
            sprint_distance_m=record.MatchGPSData.sprint_distance_m,
            hml_distance_m=record.MatchGPSData.hml_distance_m,
            max_speed_ms=record.MatchGPSData.max_speed_ms,
            avg_speed_ms=record.MatchGPSData.avg_speed_ms,
            sprint_count=record.MatchGPSData.sprint_count,
            acceleration_count=record.MatchGPSData.acceleration_count,
            deceleration_count=record.MatchGPSData.deceleration_count,
            dynamic_stress_load=record.MatchGPSData.dynamic_stress_load,
            player_load=record.MatchGPSData.player_load,
            avg_heart_rate=record.MatchGPSData.avg_heart_rate,
            max_heart_rate=record.MatchGPSData.max_heart_rate,
            time_in_red_zone_mins=record.MatchGPSData.time_in_red_zone_mins,
            playing_minutes=record.MatchGPSData.playing_minutes,
            started_as_sub=record.MatchGPSData.started_as_sub,
            duration_mins=record.MatchGPSData.duration_mins,
            notes=record.MatchGPSData.notes,
            created_at=record.MatchGPSData.created_at
        )
        for record in gps_records
    ]


@router.get("/{match_id}/gps/upload/{upload_id}", response_model=MatchGPSUploadStatus)
async def get_match_gps_upload_status(
    match_id: UUID,
    upload_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get the status of a match GPS upload."""
    query = select(GPSUploadLog).where(
        GPSUploadLog.id == upload_id,
        GPSUploadLog.match_id == match_id
    )
    result = await db.execute(query)
    upload = result.scalar_one_or_none()

    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")

    return MatchGPSUploadStatus(
        id=upload.id,
        match_id=upload.match_id,
        filename=upload.filename,
        status=upload.status,
        extracted_player_count=upload.extracted_player_count,
        error_message=upload.error_message,
        created_at=upload.created_at,
        processed_at=upload.processed_at
    )


@router.get("/{match_id}/gps/summary", response_model=MatchGPSSummary)
async def get_match_gps_summary(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get a summary of GPS data for a match."""
    # Get match
    match_query = select(Match).where(Match.id == match_id)
    result = await db.execute(match_query)
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Get GPS data with player names
    gps_query = select(MatchGPSData, Player.name).join(
        Player, MatchGPSData.player_id == Player.id
    ).where(MatchGPSData.match_id == match_id)

    gps_result = await db.execute(gps_query)
    gps_records = gps_result.all()

    if not gps_records:
        return MatchGPSSummary(
            match_id=match_id,
            opponent=match.opponent,
            match_date=match.match_date,
            players_with_data=0,
            team_total_distance=0,
            team_avg_distance=0,
            team_avg_max_speed=0,
            team_total_sprints=0,
            gps_analysis_included=match.gps_analysis_included
        )

    # Calculate summary stats
    total_distance = sum(r.MatchGPSData.total_distance_m or 0 for r in gps_records)
    max_speeds = [r.MatchGPSData.max_speed_ms for r in gps_records if r.MatchGPSData.max_speed_ms]
    total_sprints = sum(r.MatchGPSData.sprint_count or 0 for r in gps_records)

    # Find top performers
    top_distance = max(gps_records, key=lambda r: r.MatchGPSData.total_distance_m or 0)
    top_speed = max(gps_records, key=lambda r: r.MatchGPSData.max_speed_ms or 0) if max_speeds else None

    return MatchGPSSummary(
        match_id=match_id,
        opponent=match.opponent,
        match_date=match.match_date,
        players_with_data=len(gps_records),
        team_total_distance=total_distance,
        team_avg_distance=total_distance / len(gps_records) if gps_records else 0,
        team_avg_max_speed=sum(max_speeds) / len(max_speeds) if max_speeds else 0,
        team_total_sprints=total_sprints,
        top_distance_player={
            "name": top_distance.name,
            "distance_m": top_distance.MatchGPSData.total_distance_m
        } if top_distance else None,
        top_speed_player={
            "name": top_speed.name,
            "max_speed_ms": top_speed.MatchGPSData.max_speed_ms
        } if top_speed else None,
        gps_analysis_included=match.gps_analysis_included
    )


# ============ Manual GPS Entry ============

@router.post("/{match_id}/gps/manual", response_model=list[MatchGPSDataResponse], status_code=201)
async def add_match_gps_manually(
    match_id: UUID,
    data: MatchGPSBulkCreate,
    db: AsyncSession = Depends(get_db)
):
    """Manually add GPS data for players in a match."""
    # Verify match exists and is completed
    match_query = select(Match).where(Match.id == match_id)
    result = await db.execute(match_query)
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    if match.status != MatchStatus.COMPLETED:
        raise HTTPException(
            status_code=400,
            detail="GPS data can only be added for completed matches"
        )

    # Get player names for response
    players_query = select(Player)
    players_result = await db.execute(players_query)
    players = {str(p.id): p.name for p in players_result.scalars().all()}

    responses = []
    for record in data.records:
        gps_data = MatchGPSData(
            match_id=match_id,
            **record.model_dump()
        )
        db.add(gps_data)
        await db.flush()

        responses.append(MatchGPSDataResponse(
            id=gps_data.id,
            match_id=gps_data.match_id,
            player_id=gps_data.player_id,
            player_name=players.get(str(gps_data.player_id)),
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
            playing_minutes=gps_data.playing_minutes,
            started_as_sub=gps_data.started_as_sub,
            duration_mins=gps_data.duration_mins,
            notes=gps_data.notes,
            created_at=gps_data.created_at
        ))

    await db.commit()
    return responses


# ============ Delete Match GPS Data ============

@router.delete("/{match_id}/gps", status_code=204)
async def delete_match_gps(
    match_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete all GPS data for a match.

    Used when re-uploading GPS data or correcting mistakes.
    Also resets the match's gps_analysis_included flag.
    """
    # Verify match exists
    match_query = select(Match).where(Match.id == match_id)
    result = await db.execute(match_query)
    match = result.scalar_one_or_none()

    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Delete all GPS data for this match
    from sqlalchemy import delete
    delete_query = delete(MatchGPSData).where(MatchGPSData.match_id == match_id)
    await db.execute(delete_query)

    # Reset the GPS analysis flag on the match
    match.gps_analysis_included = False
    await db.commit()

    logger.info(f"Deleted GPS data for match {match_id}")
    return None


# ============ Player Match GPS History ============

@router.get("/player/{player_id}/match-gps", response_model=list[MatchGPSDataResponse])
async def get_player_match_gps_history(
    player_id: UUID,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db)
):
    """Get match GPS history for a player."""
    query = select(MatchGPSData, Player.name, Match.opponent, Match.match_date).join(
        Player, MatchGPSData.player_id == Player.id
    ).join(
        Match, MatchGPSData.match_id == Match.id
    ).where(
        MatchGPSData.player_id == player_id
    ).order_by(
        Match.match_date.desc()
    ).limit(limit)

    result = await db.execute(query)
    records = result.all()

    return [
        MatchGPSDataResponse(
            id=r.MatchGPSData.id,
            match_id=r.MatchGPSData.match_id,
            player_id=r.MatchGPSData.player_id,
            player_name=r.name,
            total_distance_m=r.MatchGPSData.total_distance_m,
            high_speed_running_m=r.MatchGPSData.high_speed_running_m,
            sprint_distance_m=r.MatchGPSData.sprint_distance_m,
            hml_distance_m=r.MatchGPSData.hml_distance_m,
            max_speed_ms=r.MatchGPSData.max_speed_ms,
            avg_speed_ms=r.MatchGPSData.avg_speed_ms,
            sprint_count=r.MatchGPSData.sprint_count,
            acceleration_count=r.MatchGPSData.acceleration_count,
            deceleration_count=r.MatchGPSData.deceleration_count,
            dynamic_stress_load=r.MatchGPSData.dynamic_stress_load,
            player_load=r.MatchGPSData.player_load,
            avg_heart_rate=r.MatchGPSData.avg_heart_rate,
            max_heart_rate=r.MatchGPSData.max_heart_rate,
            time_in_red_zone_mins=r.MatchGPSData.time_in_red_zone_mins,
            playing_minutes=r.MatchGPSData.playing_minutes,
            started_as_sub=r.MatchGPSData.started_as_sub,
            duration_mins=r.MatchGPSData.duration_mins,
            notes=r.MatchGPSData.notes,
            created_at=r.MatchGPSData.created_at
        )
        for r in records
    ]
