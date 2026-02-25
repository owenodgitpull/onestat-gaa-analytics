"""
Video analysis routes — session management, upload, and enrichment.

Direct-to-R2 upload pattern: client gets presigned PUT URL, uploads directly,
then confirms completion. No multi-GB proxying through Fly.io.
"""

import logging
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.models.match import Match
from app.models.video_session import VideoSession
from app.services.storage_service import storage
from app.schemas.video_analysis import (
    VideoUploadInitiateRequest,
    VideoUploadInitiateResponse,
    VideoUploadCompleteRequest,
    VideoSessionResponse,
    VideoSessionListResponse,
    EnrichmentResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _session_to_response(session: VideoSession, download_url: str = None) -> VideoSessionResponse:
    """Convert a VideoSession model to response schema."""
    return VideoSessionResponse(
        id=session.id,
        match_id=session.match_id,
        club_id=session.club_id,
        title=session.title,
        half=session.half,
        video_r2_key=session.video_r2_key,
        video_duration_ms=session.video_duration_ms,
        video_size_bytes=session.video_size_bytes,
        status=session.status,
        ai_model_used=session.ai_model_used,
        ai_events_generated=session.ai_events_generated,
        ai_events_accepted=session.ai_events_accepted,
        reviewed_by_user_id=session.reviewed_by_user_id,
        reviewed_at=session.reviewed_at,
        error_message=session.error_message,
        created_at=session.created_at,
        updated_at=session.updated_at,
        event_count=len(session.events) if session.events else 0,
        download_url=download_url,
    )


@router.post("/upload/initiate", response_model=VideoUploadInitiateResponse)
async def initiate_video_upload(
    match_id: UUID,
    body: VideoUploadInitiateRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Initiate a video upload. Returns a presigned PUT URL for direct-to-R2 upload.

    Client should PUT the video file directly to the returned URL, then call
    /upload/complete to confirm.
    """
    # Verify match exists and belongs to club
    result = await db.execute(
        select(Match).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    # Generate presigned upload URL
    filename = f"match_{match_id}_half{body.half or 0}.mp4"
    presigned = storage.generate_presigned_upload_url(
        folder="video",
        filename=filename,
        content_type=body.content_type,
        expires_in=7200,  # 2 hours for large uploads
    )
    if not presigned:
        raise HTTPException(status_code=503, detail="Storage service not available")

    # Create VideoSession row
    session = VideoSession(
        match_id=match_id,
        club_id=user.club_id,
        title=body.title,
        half=body.half,
        video_r2_key=presigned["key"],
        video_size_bytes=body.file_size_bytes,
        status="uploading",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)

    logger.info(f"Video upload initiated: session={session.id}, match={match_id}")

    return VideoUploadInitiateResponse(
        session_id=session.id,
        upload_url=presigned["upload_url"],
        r2_key=presigned["key"],
    )


@router.post("/session/{session_id}/upload-complete", response_model=VideoSessionResponse)
async def complete_video_upload(
    session_id: UUID,
    body: VideoUploadCompleteRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Confirm that the client has finished uploading the video to R2."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    if session.status != "uploading":
        raise HTTPException(status_code=400, detail=f"Session status is '{session.status}', expected 'uploading'")

    # Update session
    session.status = "uploaded"
    if body.video_duration_ms:
        session.video_duration_ms = body.video_duration_ms
    if body.video_size_bytes:
        session.video_size_bytes = body.video_size_bytes

    await db.commit()
    await db.refresh(session)

    logger.info(f"Video upload completed: session={session_id}")
    return _session_to_response(session)


@router.get("/sessions/{match_id}", response_model=VideoSessionListResponse)
async def list_video_sessions(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """List all video sessions for a match."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.match_id == match_id,
            VideoSession.club_id == user.club_id,
        ).order_by(VideoSession.created_at.desc())
    )
    sessions = result.scalars().all()

    return VideoSessionListResponse(
        sessions=[_session_to_response(s) for s in sessions]
    )


@router.get("/session/{session_id}", response_model=VideoSessionResponse)
async def get_video_session(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get video session details with presigned download URL for playback."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    # Generate download URL for video playback
    download_url = None
    if session.video_r2_key and session.status != "pending":
        download_url = storage.get_download_url(session.video_r2_key, expires_in=7200)

    return _session_to_response(session, download_url=download_url)


@router.delete("/session/{session_id}")
async def delete_video_session(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Delete a video session and its R2 object."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    # Delete video from R2
    if session.video_r2_key:
        storage.delete_file(session.video_r2_key)

    await db.delete(session)
    await db.commit()

    logger.info(f"Video session deleted: {session_id}")
    return {"detail": "Video session deleted"}


@router.post("/session/{session_id}/enrich", response_model=EnrichmentResponse)
async def enrich_video_session(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Run LLM enrichment on tagged video events.

    Generates tactical report and suggests possession chains.
    """
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    if not session.events or len(session.events) == 0:
        raise HTTPException(status_code=400, detail="No events to enrich. Tag some events first.")

    # Late import to avoid circular dependency
    from app.services.ai.video_enrichment_agent import generate_video_match_report

    report = await generate_video_match_report(db, session_id)

    return EnrichmentResponse(
        report=report,
        possession_chains_created=0,
    )
