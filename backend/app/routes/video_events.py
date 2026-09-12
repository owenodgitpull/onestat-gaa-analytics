"""
Video event CRUD routes — create, list, update, delete, bulk create, verify, sync.
"""

import logging
from uuid import UUID
from datetime import datetime
from typing import Optional, Tuple, List
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db, async_session_maker
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.video_session import VideoSession
from app.models.video_event import VideoEvent, TWO_POINTER_ZONES, SCORING_EVENT_TYPES
from app.models.match_event import MatchEvent, Team
from app.services.video.event_mapper import VideoEventMapper
from app.schemas.video_analysis import (
    VideoEventCreateRequest,
    VideoEventUpdateRequest,
    VideoEventResponse,
    VideoEventListResponse,
    VideoEventBulkCreateRequest,
    VideoEventSyncResponse,
    SyncPreviewEvent,
    VideoSyncPreviewResponse,
    VideoSyncConfirmResponse,
    VideoSyncStatusResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _event_to_response(event: VideoEvent) -> VideoEventResponse:
    """Convert a VideoEvent model to response schema."""
    return VideoEventResponse(
        id=event.id,
        video_session_id=event.video_session_id,
        match_id=event.match_id,
        event_type=event.event_type,
        sub_type=event.sub_type,
        team=event.team,
        half=event.half,
        match_minute=event.match_minute,
        match_second=event.match_second,
        video_timestamp_ms=event.video_timestamp_ms,
        pitch_zone=event.pitch_zone,
        pitch_x=event.pitch_x,
        pitch_y=event.pitch_y,
        player_id=event.player_id,
        player_name=event.player.name if event.player else None,
        sub_in_player_id=event.sub_in_player_id,
        sub_in_player_name=event.sub_in_player.name if event.sub_in_player else None,
        assist_player_id=event.assist_player_id,
        assist_player_name=event.assist_player.name if event.assist_player else None,
        jersey_number=event.jersey_number,
        player_confidence=event.player_confidence,
        event_confidence=event.event_confidence,
        scoring_context=event.scoring_context,
        kickout_context=event.kickout_context,
        possession_chain_id=event.possession_chain_id,
        possession_team=event.possession_team,
        description=event.description,
        source=event.source,
        is_verified=event.is_verified,
        created_at=event.created_at,
        updated_at=event.updated_at,
    )


def _auto_set_two_pointer(event_type: str, pitch_zone: str, scoring_context: dict) -> dict:
    """Auto-detect two-pointer based on pitch zone for scoring events."""
    if event_type in SCORING_EVENT_TYPES and pitch_zone:
        is_two_pointer = pitch_zone in TWO_POINTER_ZONES
        scoring_context = scoring_context or {}
        scoring_context["is_two_pointer"] = is_two_pointer
    return scoring_context


async def _get_session_for_club(
    session_id: UUID, club_id: UUID, db: AsyncSession
) -> VideoSession:
    """Get a video session, verifying club ownership."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")
    return session


@router.post("/{session_id}", response_model=VideoEventResponse)
async def create_video_event(
    session_id: UUID,
    body: VideoEventCreateRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new video event (human tag)."""
    session = await _get_session_for_club(session_id, user.club_id, db)

    # Auto-detect two-pointer from zone
    scoring_ctx = body.scoring_context.dict() if body.scoring_context else None
    scoring_ctx = _auto_set_two_pointer(body.event_type, body.pitch_zone, scoring_ctx)

    event = VideoEvent(
        video_session_id=session.id,
        match_id=session.match_id,
        event_type=body.event_type,
        sub_type=body.sub_type,
        team=body.team,
        half=body.half,
        match_minute=body.match_minute,
        match_second=body.match_second,
        video_timestamp_ms=body.video_timestamp_ms,
        pitch_zone=body.pitch_zone,
        pitch_x=body.pitch_x,
        pitch_y=body.pitch_y,
        player_id=body.player_id,
        sub_in_player_id=body.sub_in_player_id,
        assist_player_id=body.assist_player_id,
        jersey_number=body.jersey_number,
        player_confidence=body.player_confidence or "HIGH",
        event_confidence=body.event_confidence or "HIGH",
        scoring_context=scoring_ctx,
        kickout_context=body.kickout_context.dict() if body.kickout_context else None,
        possession_team=body.possession_team,
        description=body.description,
        source=body.source,
        is_verified=body.source == "human_tag",
    )
    db.add(event)
    await db.commit()
    await db.refresh(event)

    return _event_to_response(event)


@router.get("/{session_id}", response_model=VideoEventListResponse)
async def list_video_events(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List all events for a video session, ordered by video timestamp."""
    await _get_session_for_club(session_id, user.club_id, db)

    result = await db.execute(
        select(VideoEvent)
        .where(VideoEvent.video_session_id == session_id)
        .order_by(VideoEvent.video_timestamp_ms.asc().nullslast(), VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
    )
    events = result.scalars().all()

    return VideoEventListResponse(
        events=[_event_to_response(e) for e in events],
        total=len(events),
    )


@router.put("/event/{event_id}", response_model=VideoEventResponse)
async def update_video_event(
    event_id: UUID,
    body: VideoEventUpdateRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a video event."""
    result = await db.execute(
        select(VideoEvent)
        .join(VideoSession, VideoEvent.video_session_id == VideoSession.id)
        .where(VideoEvent.id == event_id, VideoSession.club_id == user.club_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Video event not found")

    update_data = body.dict(exclude_unset=True)

    # Handle nested schemas
    if "scoring_context" in update_data and update_data["scoring_context"] is not None:
        update_data["scoring_context"] = body.scoring_context.dict()
    if "kickout_context" in update_data and update_data["kickout_context"] is not None:
        update_data["kickout_context"] = body.kickout_context.dict()

    for field, value in update_data.items():
        setattr(event, field, value)

    # Re-check two-pointer if zone or event type changed
    zone = event.pitch_zone
    scoring_ctx = event.scoring_context or {}
    scoring_ctx = _auto_set_two_pointer(event.event_type, zone, scoring_ctx)
    event.scoring_context = scoring_ctx

    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)

    return _event_to_response(event)


@router.delete("/event/{event_id}")
async def delete_video_event(
    event_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a video event."""
    result = await db.execute(
        select(VideoEvent)
        .join(VideoSession, VideoEvent.video_session_id == VideoSession.id)
        .where(VideoEvent.id == event_id, VideoSession.club_id == user.club_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Video event not found")

    await db.delete(event)
    await db.commit()
    return {"detail": "Event deleted"}


@router.post("/{session_id}/bulk", response_model=VideoEventListResponse)
async def bulk_create_video_events(
    session_id: UUID,
    body: VideoEventBulkCreateRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bulk create video events (for Phase 2 AI-generated events)."""
    session = await _get_session_for_club(session_id, user.club_id, db)

    created = []
    for req in body.events:
        scoring_ctx = req.scoring_context.dict() if req.scoring_context else None
        scoring_ctx = _auto_set_two_pointer(req.event_type, req.pitch_zone, scoring_ctx)

        event = VideoEvent(
            video_session_id=session.id,
            match_id=session.match_id,
            event_type=req.event_type,
            team=req.team,
            half=req.half,
            match_minute=req.match_minute,
            match_second=req.match_second,
            video_timestamp_ms=req.video_timestamp_ms,
            pitch_zone=req.pitch_zone,
            pitch_x=req.pitch_x,
            pitch_y=req.pitch_y,
            player_id=req.player_id,
            sub_in_player_id=req.sub_in_player_id,
            assist_player_id=req.assist_player_id,
            jersey_number=req.jersey_number,
            player_confidence=req.player_confidence,
            event_confidence=req.event_confidence,
            scoring_context=scoring_ctx,
            kickout_context=req.kickout_context.dict() if req.kickout_context else None,
            possession_team=req.possession_team,
            description=req.description,
            source=req.source,
            is_verified=req.source == "human_tag",
        )
        db.add(event)
        created.append(event)

    await db.commit()
    for e in created:
        await db.refresh(e)

    return VideoEventListResponse(
        events=[_event_to_response(e) for e in created],
        total=len(created),
    )


@router.put("/event/{event_id}/verify", response_model=VideoEventResponse)
async def verify_video_event(
    event_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Mark a video event as human-verified."""
    result = await db.execute(
        select(VideoEvent)
        .join(VideoSession, VideoEvent.video_session_id == VideoSession.id)
        .where(VideoEvent.id == event_id, VideoSession.club_id == user.club_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Video event not found")

    event.is_verified = True
    event.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(event)

    return _event_to_response(event)


# ─── Smart Sync: deduplication algorithm ───

def _compute_sync_plan(
    verified_events: List[VideoEvent],
    existing_match_events: List[MatchEvent],
) -> Tuple[List[Tuple[VideoEvent, None]], List[Tuple[VideoEvent, MatchEvent]], List[VideoEvent]]:
    """
    Deduplicate verified VideoEvents against existing MatchEvents.

    Returns:
        (new, replaced, skipped) where:
        - new: (video_event, None) — no existing match, will create
        - replaced: (video_event, existing_match_event) — near match, will replace
        - skipped: video_events that exactly match existing MatchEvents
    """
    # Index existing events by (event_type, team) for fast lookup
    used_match_events: set = set()
    new = []
    replaced = []
    skipped = []

    for ve in verified_events:
        match_event_type = VideoEventMapper.to_match_event_type(
            ve.event_type,
            scoring_context=ve.scoring_context,
            pitch_zone=ve.pitch_zone,
        )
        if not match_event_type:
            skipped.append(ve)
            continue

        team = VideoEventMapper.video_team_to_match_team(ve.team)

        # Search for exact or near match
        best_match = None
        best_delta = None
        for me in existing_match_events:
            if me.id in used_match_events:
                continue
            if me.event_type != match_event_type:
                continue
            if me.team != team:
                continue
            delta = abs((me.minute or 0) - ve.match_minute)
            if delta > 1:
                continue
            # Prefer exact minute match, then closest
            if best_match is None or delta < best_delta:
                best_match = me
                best_delta = delta

        if best_match is not None:
            used_match_events.add(best_match.id)
            if best_delta == 0:
                # Exact match — skip (already exists)
                skipped.append(ve)
            else:
                # Near match (±1 min) — replace with richer video data
                replaced.append((ve, best_match))
        else:
            new.append((ve, None))

    return new, replaced, skipped


@router.post("/{session_id}/sync-preview", response_model=VideoSyncPreviewResponse)
async def sync_preview(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Preview what the sync will do — returns new/replaced/skipped events without committing.
    """
    session = await _get_session_for_club(session_id, user.club_id, db)

    # Get verified video events
    result = await db.execute(
        select(VideoEvent)
        .where(
            VideoEvent.video_session_id == session_id,
            VideoEvent.is_verified .is_(True),
        )
        .order_by(VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
    )
    verified_events = list(result.scalars().all())

    # Get existing match events
    me_result = await db.execute(
        select(MatchEvent)
        .where(MatchEvent.match_id == session.match_id)
        .order_by(MatchEvent.minute.asc())
    )
    existing_match_events = list(me_result.scalars().all())

    new, replaced, skipped = _compute_sync_plan(verified_events, existing_match_events)

    # Count manual-only events (existing MatchEvents not matched by any video event)
    matched_me_ids = {me.id for _, me in replaced}
    manual_only = sum(1 for me in existing_match_events if me.id not in matched_me_ids)

    def _to_preview(ve: VideoEvent, matched_me: Optional[MatchEvent] = None) -> SyncPreviewEvent:
        return SyncPreviewEvent(
            video_event_id=ve.id,
            event_type=ve.event_type,
            team=ve.team,
            minute=ve.match_minute,
            pitch_zone=ve.pitch_zone,
            description=ve.description,
            matched_event_id=matched_me.id if matched_me else None,
        )

    return VideoSyncPreviewResponse(
        new_events=[_to_preview(ve) for ve, _ in new],
        replaced_events=[_to_preview(ve, me) for ve, me in replaced],
        skipped_events=[_to_preview(ve) for ve in skipped],
        manual_only_count=manual_only,
    )


@router.post("/{session_id}/sync-confirm", response_model=VideoSyncConfirmResponse)
async def sync_confirm(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Confirm sync — performs the merge in the background and triggers AI re-analysis.
    """
    session = await _get_session_for_club(session_id, user.club_id, db)

    if session.status == "syncing":
        raise HTTPException(status_code=409, detail="Sync already in progress")

    # Get verified video events
    result = await db.execute(
        select(VideoEvent)
        .where(
            VideoEvent.video_session_id == session_id,
            VideoEvent.is_verified .is_(True),
        )
        .order_by(VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
    )
    verified_events = list(result.scalars().all())

    # Get existing match events
    me_result = await db.execute(
        select(MatchEvent)
        .where(MatchEvent.match_id == session.match_id)
        .order_by(MatchEvent.minute.asc())
    )
    existing_match_events = list(me_result.scalars().all())

    new, replaced, skipped = _compute_sync_plan(verified_events, existing_match_events)

    # Mark session as syncing before background task
    session.status = "syncing"
    session.reviewed_by_user_id = user.user_id
    session.reviewed_at = datetime.utcnow()
    await db.commit()

    # Kick off background task
    background_tasks.add_task(
        process_video_sync,
        session_id,
        session.match_id,
        [(ve.id, None) for ve, _ in new],
        [(ve.id, me.id) for ve, me in replaced],
    )

    return VideoSyncConfirmResponse(
        status="processing",
        synced_count=len(new),
        replaced_count=len(replaced),
        message=f"Syncing {len(new)} new + {len(replaced)} enriched events. AI report will regenerate.",
    )


@router.get("/{session_id}/sync-status", response_model=VideoSyncStatusResponse)
async def sync_status(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Poll sync + AI re-analysis progress."""
    session = await _get_session_for_club(session_id, user.club_id, db)

    # Check if the match has an AI report
    from app.models.match import Match
    match_result = await db.execute(select(Match).where(Match.id == session.match_id))
    match = match_result.scalar_one_or_none()
    ai_report_ready = bool(match and match.ai_analysis)

    return VideoSyncStatusResponse(
        status=session.status,
        synced_count=session.ai_events_accepted,
        ai_report_ready=ai_report_ready and session.status == "completed",
        error_message=session.error_message if session.status == "error" else None,
    )


# ─── Background task: merge + AI re-analysis ───

async def process_video_sync(
    session_id: UUID,
    match_id: UUID,
    new_event_ids: List[Tuple[UUID, None]],
    replaced_event_ids: List[Tuple[UUID, UUID]],
):
    """
    Background task to perform the actual merge and trigger AI re-analysis.
    Follows the GPS upload pattern from match_gps.py.
    """
    # Import here to avoid circular imports
    from app.services.ai import generate_post_match_report, generate_insight_alerts

    async with async_session_maker() as db:
        try:
            # Get the session
            sess_result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = sess_result.scalar_one_or_none()
            if not session:
                logger.error(f"Video session {session_id} not found in background task")
                return

            synced_count = 0

            # 1. Create new MatchEvents from video events with no existing match
            for ve_id, _ in new_event_ids:
                ve_result = await db.execute(select(VideoEvent).where(VideoEvent.id == ve_id))
                ve = ve_result.scalar_one_or_none()
                if not ve:
                    continue

                match_event_type = VideoEventMapper.to_match_event_type(
                    ve.event_type,
                    scoring_context=ve.scoring_context,
                    pitch_zone=ve.pitch_zone,
                )
                if not match_event_type:
                    continue

                team = VideoEventMapper.video_team_to_match_team(ve.team)
                match_event = MatchEvent(
                    match_id=ve.match_id,
                    event_type=match_event_type,
                    sub_type=ve.sub_type,
                    team=team,
                    minute=ve.match_minute,
                    pitch_x=ve.pitch_x,
                    pitch_y=ve.pitch_y,
                    player_id=ve.player_id,
                    sub_in_player_id=ve.sub_in_player_id,
                    assist_player_id=ve.assist_player_id,
                    notes=f"[video-sync] {ve.description or ''}".strip(),
                )
                db.add(match_event)
                synced_count += 1

            # 2. Replace near-matched MatchEvents with richer video data
            for ve_id, me_id in replaced_event_ids:
                ve_result = await db.execute(select(VideoEvent).where(VideoEvent.id == ve_id))
                ve = ve_result.scalar_one_or_none()
                me_result = await db.execute(select(MatchEvent).where(MatchEvent.id == me_id))
                me = me_result.scalar_one_or_none()
                if not ve or not me:
                    continue

                match_event_type = VideoEventMapper.to_match_event_type(
                    ve.event_type,
                    scoring_context=ve.scoring_context,
                    pitch_zone=ve.pitch_zone,
                )
                if match_event_type:
                    me.event_type = match_event_type
                me.sub_type = ve.sub_type or me.sub_type
                me.minute = ve.match_minute
                me.pitch_x = ve.pitch_x or me.pitch_x
                me.pitch_y = ve.pitch_y or me.pitch_y
                me.player_id = ve.player_id or me.player_id
                me.sub_in_player_id = ve.sub_in_player_id or me.sub_in_player_id
                me.assist_player_id = ve.assist_player_id or me.assist_player_id
                me.notes = f"[video-enriched] {ve.description or me.notes or ''}".strip()
                synced_count += 1

            await db.commit()
            logger.info(f"Video sync: {synced_count} events merged for session {session_id}")

            # Update session with sync count
            session.ai_events_accepted = synced_count
            session.status = "analyzing"
            await db.commit()

            # 3. Trigger AI re-analysis (same as GPS upload path)
            try:
                logger.info(f"Triggering AI re-analysis of match {match_id} after video sync")
                await generate_post_match_report(db, str(match_id), force_regenerate=True)
            except Exception as e:
                logger.error(f"AI re-analysis failed for match {match_id}: {e}")

            # 4. Generate insight alerts
            try:
                await generate_insight_alerts(db, source="video_sync", match_id=match_id)
            except Exception as e:
                logger.error(f"Insight alert generation failed after video sync: {e}")

            # 5. Mark completed only AFTER AI finishes
            session.status = "completed"
            await db.commit()
            logger.info(f"Video sync complete for session {session_id}")

        except Exception as e:
            logger.error(f"Video sync background task failed: {e}")
            try:
                session.status = "error"
                session.error_message = str(e)[:500]
                await db.commit()
            except Exception:
                pass


# ─── Legacy sync endpoint (kept for backward compat) ───

@router.post("/{session_id}/sync-to-match", response_model=VideoEventSyncResponse)
async def sync_events_to_match(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Legacy sync endpoint — naively copies verified video events to MatchEvent table.
    Prefer sync-preview + sync-confirm for deduplication.
    """
    session = await _get_session_for_club(session_id, user.club_id, db)

    # Get verified events
    result = await db.execute(
        select(VideoEvent)
        .where(
            VideoEvent.video_session_id == session_id,
            VideoEvent.is_verified .is_(True),
        )
        .order_by(VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
    )
    events = result.scalars().all()

    synced = 0
    skipped = 0
    errors = []

    for ve in events:
        try:
            match_event_type = VideoEventMapper.to_match_event_type(
                ve.event_type,
                scoring_context=ve.scoring_context,
                pitch_zone=ve.pitch_zone,
            )
            if not match_event_type:
                skipped += 1
                continue

            # Map team: team_a = own team by convention
            team = VideoEventMapper.video_team_to_match_team(ve.team)

            match_event = MatchEvent(
                match_id=ve.match_id,
                event_type=match_event_type,
                sub_type=ve.sub_type,
                team=team,
                minute=ve.match_minute,
                pitch_x=ve.pitch_x,
                pitch_y=ve.pitch_y,
                player_id=ve.player_id,
                sub_in_player_id=ve.sub_in_player_id,
                assist_player_id=ve.assist_player_id,
                notes=f"[video-sync] {ve.description or ''}".strip(),
            )
            db.add(match_event)
            synced += 1

        except Exception as e:
            errors.append(f"Event {ve.id}: {str(e)}")
            logger.warning(f"Failed to sync video event {ve.id}: {e}")

    if synced > 0:
        await db.commit()

    # Update session stats
    session.ai_events_accepted = synced
    session.status = "completed"
    session.reviewed_by_user_id = user.user_id
    session.reviewed_at = datetime.utcnow()
    await db.commit()

    logger.info(f"Synced {synced} events from video session {session_id}")
    return VideoEventSyncResponse(
        synced_count=synced,
        skipped_count=skipped,
        errors=errors,
    )
