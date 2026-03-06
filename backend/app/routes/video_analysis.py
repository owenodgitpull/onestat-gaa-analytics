"""
Video analysis routes — session management, upload, and enrichment.

Direct-to-R2 upload pattern: client gets presigned PUT URL, uploads directly,
then confirms completion. No multi-GB proxying through Fly.io.
"""

import asyncio
import logging
from uuid import UUID
import json
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.models.match import Match
from app.models.match_lineup import MatchLineup
from app.models.club import Club
from app.models.video_session import VideoSession
from app.services.storage_service import storage
from app.schemas.video_analysis import (
    VideoUploadInitiateRequest,
    VideoUploadInitiateResponse,
    VideoUploadCompleteRequest,
    SetHalftimeRequest,
    VideoSessionResponse,
    VideoSessionListResponse,
    EnrichmentResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ── In-memory progress queues for SSE streaming ──────────────────────────
# Background task pushes events → SSE endpoint reads them.
_progress_queues: dict[str, asyncio.Queue] = {}


async def _emit_progress(session_id: UUID, data: dict):
    """Push a progress event to the queue (if an SSE consumer is listening)."""
    q = _progress_queues.get(str(session_id))
    if q:
        await q.put(data)


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
        halftime_timestamp_ms=session.halftime_timestamp_ms,
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
        club_id=str(user.club_id),
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
        download_url = storage.get_download_url(session.video_r2_key, expires_in=7200, club_id=str(user.club_id))

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
        storage.delete_file(session.video_r2_key, club_id=str(user.club_id))

    await db.delete(session)
    await db.commit()

    logger.info(f"Video session deleted: {session_id}")
    return {"detail": "Video session deleted"}


@router.post("/session/{session_id}/set-halftime", response_model=VideoSessionResponse)
async def set_halftime(
    session_id: UUID,
    body: SetHalftimeRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Set the half-time timestamp for a full-match video session."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    if session.half is not None:
        raise HTTPException(status_code=400, detail="Cannot set half-time on a single-half upload")

    if session.video_duration_ms and body.halftime_timestamp_ms >= session.video_duration_ms:
        raise HTTPException(status_code=400, detail="Half-time timestamp must be before video end")

    session.halftime_timestamp_ms = body.halftime_timestamp_ms
    await db.commit()
    await db.refresh(session)

    download_url = None
    if session.video_r2_key:
        download_url = storage.get_download_url(session.video_r2_key, expires_in=7200, club_id=str(user.club_id))

    logger.info(f"Half-time set: session={session_id}, timestamp={body.halftime_timestamp_ms}ms")
    return _session_to_response(session, download_url=download_url)


@router.post("/session/{session_id}/set-half-starts", response_model=VideoSessionResponse)
async def set_half_starts(
    session_id: UUID,
    body: dict,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Set the throw-in timestamps for 1st and/or 2nd half."""
    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    if "first_half_start_ms" in body and body["first_half_start_ms"] is not None:
        session.first_half_start_ms = int(body["first_half_start_ms"])
    if "second_half_start_ms" in body and body["second_half_start_ms"] is not None:
        session.second_half_start_ms = int(body["second_half_start_ms"])

    await db.commit()
    await db.refresh(session)

    download_url = None
    if session.video_r2_key:
        download_url = storage.get_download_url(session.video_r2_key, expires_in=7200, club_id=str(user.club_id))

    logger.info(f"Half starts set: session={session_id}, 1H={session.first_half_start_ms}ms, 2H={session.second_half_start_ms}ms")
    return _session_to_response(session, download_url=download_url)


@router.post("/session/{session_id}/auto-analyze")
async def auto_analyze_video(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger Gemini 2.5 Flash auto-analysis of uploaded video.

    Returns immediately; analysis runs in background.
    Creates VideoEvents with source='gemini_auto', is_verified=False.
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

    if session.status not in ("uploaded", "draft_ready", "error"):
        raise HTTPException(
            status_code=400,
            detail=f"Session status is '{session.status}', expected 'uploaded', 'draft_ready', or 'error'"
        )

    if not session.video_r2_key:
        raise HTTPException(status_code=400, detail="No video file uploaded for this session")

    # Mark as processing
    session.status = "processing"
    session.ai_model_used = "gemini-2.5-flash"
    session.error_message = None
    await db.commit()

    # Create progress queue for SSE streaming (before launching task)
    _progress_queues[str(session_id)] = asyncio.Queue()

    background_tasks.add_task(
        _run_gemini_analysis, session_id, session.video_r2_key, session.half, session.halftime_timestamp_ms, session.match_id
    )

    return {"status": "processing"}


async def _run_gemini_analysis(session_id: UUID, video_r2_key: str, half: int | None, halftime_ms: int | None, match_id: UUID | None = None):
    """
    Background task: download video to disk, optionally split, run Gemini, bulk-insert events.

    Emits progress to _progress_queues so the SSE endpoint can stream to frontend.
    Resumable: on retry, skips halves that already have gemini_auto events.
    Each half's events are committed immediately so partial progress is preserved.
    """
    await _emit_progress(session_id, {"type": "progress", "stage": "initializing"})

    import tempfile
    from pathlib import Path
    from sqlalchemy import func, delete
    from app.database import async_session_maker
    from app.services.storage_service import storage as storage_svc
    from app.services.ai.gemini_video_agent import analyze_video_with_gemini
    from app.models.video_event import VideoEvent, TWO_POINTER_ZONES

    async with async_session_maker() as db:
        try:
            # 1. Get session
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            if not session:
                logger.error(f"Auto-analyze: session {session_id} not found")
                await _emit_progress(session_id, {"type": "error", "message": "Session not found"})
                return

            # 1b. Build match context for Gemini (team names, colours, venue, final score)
            match_context = await _build_match_context(db, match_id) if match_id else None
            if match_context:
                logger.info(f"Auto-analyze: match context built — {match_context.get('our_team')} vs {match_context.get('opponent')}")

            # 1c. Load roster for jersey → player_id resolution
            roster = await _load_roster(db, match_id) if match_id else []
            jersey_to_player = {}
            for r in roster:
                jn = r.get("jersey_number")
                if jn is not None:
                    jersey_to_player[jn] = r.get("player_id")
            logger.info(f"Auto-analyze: roster has {len(roster)} players")

            # 2. Delete existing AI events on re-run (both gemini_auto and keyframe_auto)
            for source in ("gemini_auto", "keyframe_auto"):
                await db.execute(
                    delete(VideoEvent).where(
                        VideoEvent.video_session_id == session_id,
                        VideoEvent.source == source,
                    )
                )
            await db.commit()

            with tempfile.TemporaryDirectory() as tmpdir:
                # 3. Stream video from R2 to disk (run in thread to avoid blocking event loop)
                input_path = str(Path(tmpdir) / "input.mp4")
                logger.info(f"Auto-analyze: downloading video to disk for session {session_id}")
                ok = await asyncio.to_thread(storage_svc.download_file_to_path, video_r2_key, input_path)
                if not ok:
                    raise RuntimeError("Failed to download video from R2")

                # 4. Determine analysis runs (file paths, not bytes)
                if half is not None:
                    # Single-half upload — send directly
                    analysis_runs = [(input_path, half)]
                elif halftime_ms is not None:
                    # Full match with halftime marked — split with FFmpeg (in thread)
                    from app.services.video.video_splitter import split_video_at_timestamp
                    logger.info(f"Auto-analyze: splitting video at {halftime_ms}ms")
                    half1_path, half2_path = await asyncio.to_thread(
                        split_video_at_timestamp, input_path, halftime_ms, tmpdir
                    )
                    # Delete full input — we only need the two halves now
                    Path(input_path).unlink(missing_ok=True)
                    logger.info("Auto-analyze: deleted full input file after split")
                    analysis_runs = [(half1_path, 1), (half2_path, 2)]
                else:
                    # Full match, skip pressed — treat as single half 1
                    analysis_runs = [(input_path, 1)]

                # 5. Run Gemini on each half, commit events per-half for resilience
                total_created = 0
                total_halves = len(analysis_runs)

                for run_path, run_half in analysis_runs:
                    # Upload to Gemini
                    await _emit_progress(session_id, {
                        "type": "progress", "stage": "uploading_to_gemini", "half": run_half,
                    })
                    logger.info(f"Auto-analyze: sending half {run_half} to Gemini for session {session_id}")

                    await _emit_progress(session_id, {
                        "type": "progress", "stage": "analyzing",
                        "completed": run_half - 1, "total": total_halves,
                    })
                    run_events = await analyze_video_with_gemini(run_path, half=run_half, match_context=match_context)

                    # Delete this file now that Gemini has uploaded it
                    Path(run_path).unlink(missing_ok=True)
                    logger.info(f"Auto-analyze: deleted temp file for half {run_half}")

                    # Offset half 2 timestamps so they align with the full video
                    if halftime_ms is not None and run_half == 2:
                        for ed in run_events:
                            if ed.get("video_timestamp_ms") is not None:
                                ed["video_timestamp_ms"] += halftime_ms

                    # Insert and commit this half's events immediately
                    half_count = 0
                    for ed in run_events:
                        scoring_ctx = ed.get("scoring_context")
                        if ed["event_type"] in ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT"):
                            is_two_pt = ed.get("pitch_zone") in TWO_POINTER_ZONES if ed.get("pitch_zone") else False
                            if scoring_ctx:
                                scoring_ctx["is_two_pointer"] = is_two_pt
                            else:
                                scoring_ctx = {"is_two_pointer": is_two_pt, "source": "FROM_PLAY"}

                        # Jersey → player_id resolution (team_a only)
                        player_id = None
                        jn = ed.get("jersey_number")
                        if jn and ed.get("team") == "team_a":
                            player_id = jersey_to_player.get(jn)

                        event = VideoEvent(
                            video_session_id=session.id,
                            match_id=session.match_id,
                            event_type=ed["event_type"],
                            team=ed["team"],
                            half=ed["half"],
                            match_minute=ed["match_minute"],
                            match_second=ed.get("match_second", 0),
                            video_timestamp_ms=ed.get("video_timestamp_ms"),
                            pitch_zone=ed.get("pitch_zone"),
                            player_id=player_id,
                            jersey_number=ed.get("jersey_number"),
                            player_confidence=ed.get("player_confidence"),
                            event_confidence=ed.get("event_confidence", "MEDIUM"),
                            scoring_context=scoring_ctx,
                            kickout_context=ed.get("kickout_context"),
                            possession_team=ed.get("possession_team"),
                            description=ed.get("description"),
                            source="gemini_auto",
                            is_verified=False,
                        )
                        db.add(event)
                        half_count += 1

                    await db.commit()
                    total_created += half_count
                    logger.info(f"Auto-analyze: half {run_half} committed — {half_count} events")

                    await _emit_progress(session_id, {
                        "type": "progress", "stage": "analyzing",
                        "completed": run_half, "total": total_halves,
                        "events_so_far": total_created,
                        "half_complete": True,
                    })

            # 6. Update session (all halves done)
            # Re-fetch session to avoid stale state after per-half commits
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            session.ai_events_generated = total_created
            session.status = "draft_ready"
            session.error_message = None
            await db.commit()

            logger.info(f"Auto-analyze complete: session {session_id}, {total_created} events total")
            await _emit_progress(session_id, {"type": "done", "total_events": total_created})

        except Exception as e:
            logger.error(f"Auto-analyze failed for session {session_id}: {e}", exc_info=True)
            try:
                result = await db.execute(
                    select(VideoSession).where(VideoSession.id == session_id)
                )
                session = result.scalar_one_or_none()
                if session:
                    session.status = "error"
                    session.error_message = str(e)[:500]
                    await db.commit()
            except Exception:
                logger.error(f"Failed to update session error status for {session_id}")
            await _emit_progress(session_id, {"type": "error", "message": str(e)[:500]})
        finally:
            # Clean up queue after a delay (let SSE consumer read final event)
            await asyncio.sleep(5)
            _progress_queues.pop(str(session_id), None)


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


# ── Ball position samples (minimap tracking) ─────────────────────────────


@router.post("/session/{session_id}/ball-samples")
async def save_ball_samples(
    session_id: UUID,
    payload: dict,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Bulk save ball position samples from the minimap tracker."""
    from app.models.ball_position_sample import BallPositionSample

    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Video session not found")

    samples = payload.get("samples", [])
    if not samples:
        return {"saved": 0}

    for s in samples:
        db.add(BallPositionSample(
            video_session_id=session_id,
            video_timestamp_ms=s["video_timestamp_ms"],
            pitch_x=s["pitch_x"],
            pitch_y=s["pitch_y"],
            possession_team=s["possession_team"],
        ))

    await db.commit()
    return {"saved": len(samples)}


@router.get("/session/{session_id}/ball-samples")
async def get_ball_samples(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all ball position samples for a video session."""
    from app.models.ball_position_sample import BallPositionSample

    result = await db.execute(
        select(VideoSession).where(
            VideoSession.id == session_id,
            VideoSession.club_id == user.club_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Video session not found")

    result = await db.execute(
        select(BallPositionSample)
        .where(BallPositionSample.video_session_id == session_id)
        .order_by(BallPositionSample.video_timestamp_ms)
    )
    samples = result.scalars().all()

    return {
        "samples": [
            {
                "video_timestamp_ms": s.video_timestamp_ms,
                "pitch_x": s.pitch_x,
                "pitch_y": s.pitch_y,
                "possession_team": s.possession_team,
            }
            for s in samples
        ]
    }


# ── Keyframe Claude Vision pipeline ──────────────────────────────────────


@router.post("/session/{session_id}/keyframe-analyze")
async def keyframe_analyze_video(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger keyframe extraction + Claude Vision auto-analysis (Haiku).

    Returns immediately; analysis runs in background.
    Creates VideoEvents with source='keyframe_auto'.
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

    if session.status not in ("uploaded", "draft_ready", "error", "processing"):
        raise HTTPException(
            status_code=400,
            detail=f"Session status is '{session.status}', expected 'uploaded', 'draft_ready', or 'error'"
        )

    if not session.video_r2_key:
        raise HTTPException(status_code=400, detail="No video file uploaded for this session")

    # Mark as processing
    session.status = "processing"
    session.ai_model_used = "claude-haiku-keyframe"
    session.error_message = None
    await db.commit()

    # Create progress queue for SSE streaming (before launching task)
    _progress_queues[str(session_id)] = asyncio.Queue()

    background_tasks.add_task(
        _run_keyframe_analysis,
        session_id,
        session.video_r2_key,
        session.half,
        session.halftime_timestamp_ms,
        session.match_id,
    )

    return {"status": "processing"}


@router.get("/session/{session_id}/analysis-progress")
async def analysis_progress_sse(
    session_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
):
    """
    SSE stream of analysis progress for a running background task.

    Lightweight reader — no heavy work happens here. The background task
    (_run_keyframe_analysis) pushes progress events to an in-memory queue;
    this endpoint just reads them and streams to the client.
    """
    sid = str(session_id)

    async def generator():
        def sse(data: dict) -> str:
            return f"data: {json.dumps(data)}\n\n"

        queue = _progress_queues.get(sid)
        if not queue:
            yield sse({"type": "error", "message": "No active analysis. Try refreshing."})
            return

        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=120)
                yield sse(event)
                if event.get("type") in ("done", "error"):
                    _progress_queues.pop(sid, None)
                    return
            except asyncio.TimeoutError:
                # Heartbeat keeps connection alive
                yield sse({"type": "heartbeat"})

    return StreamingResponse(
        generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/session/{session_id}/improve-analysis")
async def improve_analysis(
    session_id: UUID,
    background_tasks: BackgroundTasks,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Re-run low-confidence batches through Sonnet for improved accuracy.

    Only re-analyses batches where >50% of events are LOW confidence.
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

    if session.status not in ("draft_ready",):
        raise HTTPException(
            status_code=400,
            detail=f"Session status is '{session.status}', expected 'draft_ready'"
        )

    if not session.video_r2_key:
        raise HTTPException(status_code=400, detail="No video file uploaded for this session")

    # Mark as processing
    session.status = "processing"
    session.error_message = None
    await db.commit()

    background_tasks.add_task(
        _run_improve_analysis,
        session_id,
        session.video_r2_key,
        session.half,
        session.halftime_timestamp_ms,
        session.match_id,
    )

    return {"status": "processing"}


async def _load_roster(db, match_id: UUID) -> list[dict]:
    """Load the match lineup as a roster for Claude Vision."""
    result = await db.execute(
        select(MatchLineup).where(MatchLineup.match_id == match_id)
    )
    lineup_entries = result.scalars().all()

    roster = []
    for entry in lineup_entries:
        effective_jersey = entry.jersey_number or (entry.player.jersey_number if entry.player else None)
        roster.append({
            "name": entry.player.name if entry.player else "Unknown",
            "jersey_number": effective_jersey,
            "position_id": entry.position_id,
            "player_id": str(entry.player_id),
        })
    return roster


async def _build_match_context(db, match_id: UUID) -> dict | None:
    """Build match context dict for the vision agent."""
    try:
        match_result = await db.execute(select(Match).where(Match.id == match_id))
        match = match_result.scalar_one_or_none()
        if not match:
            return None

        club = None
        if match.club_id:
            club_result = await db.execute(select(Club).where(Club.id == match.club_id))
            club = club_result.scalar_one_or_none()

        return {
            "our_team": (club.short_name or club.name) if club else "Team A",
            "opponent": match.opponent or "Team B",
            "our_colour": match.team_strip_colour or (club.primary_colour if club else None),
            "opp_colour": match.opponent_strip_colour,
            "venue": match.venue.value.upper() if match.venue else None,
            "final_score_team": f"{match.team_goals}-{match.team_points:02d}" if match.team_goals is not None else None,
            "final_score_opponent": f"{match.opponent_goals}-{match.opponent_points:02d}" if match.opponent_goals is not None else None,
        }
    except Exception as e:
        logger.warning(f"Failed to build match context: {e}")
        return None


async def _run_keyframe_analysis(
    session_id: UUID,
    video_r2_key: str,
    half: int | None,
    halftime_ms: int | None,
    match_id: UUID,
):
    """
    Background task: download video → extract frames → SSIM filter → Claude Vision batches.

    Emits progress to _progress_queues so the SSE endpoint can stream to frontend.
    Each half committed separately for resilience.
    """
    # Emit immediately (before any blocking imports)
    await _emit_progress(session_id, {"type": "progress", "stage": "initializing"})

    # Heavy imports (cv2, numpy) block the event loop — run in a thread
    def _do_imports():
        import tempfile
        from pathlib import Path
        from sqlalchemy import delete
        from app.database import async_session_maker
        from app.services.storage_service import storage as storage_svc
        from app.services.video.frame_extractor import extract_frames, filter_static_frames, create_batches
        from app.services.ai.keyframe_video_agent import analyze_batch, deduplicate_events
        from app.models.video_event import VideoEvent, TWO_POINTER_ZONES
        return (tempfile, Path, delete, async_session_maker, storage_svc,
                extract_frames, filter_static_frames, create_batches,
                analyze_batch, deduplicate_events, VideoEvent, TWO_POINTER_ZONES)

    (tempfile, Path, delete, async_session_maker, storage_svc,
     extract_frames, filter_static_frames, create_batches,
     analyze_batch, deduplicate_events, VideoEvent, TWO_POINTER_ZONES
    ) = await asyncio.to_thread(_do_imports)

    async with async_session_maker() as db:
        try:
            # 1. Get session
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            if not session:
                logger.error(f"Keyframe-analyze: session {session_id} not found")
                await _emit_progress(session_id, {"type": "error", "message": "Session not found"})
                return

            # 2. Load roster and match context
            roster = await _load_roster(db, match_id)
            match_context = await _build_match_context(db, match_id)
            logger.info(f"Keyframe-analyze: roster has {len(roster)} players")

            # 3. Delete existing keyframe_auto events (re-run)
            await db.execute(
                delete(VideoEvent).where(
                    VideoEvent.video_session_id == session_id,
                    VideoEvent.source == "keyframe_auto",
                )
            )
            await db.commit()

            with tempfile.TemporaryDirectory() as tmpdir:
                # 4. Download video from R2
                await _emit_progress(session_id, {"type": "progress", "stage": "downloading"})
                input_path = str(Path(tmpdir) / "input.mp4")
                logger.info(f"Keyframe-analyze: downloading video for session {session_id}")
                ok = await asyncio.to_thread(storage_svc.download_file_to_path, video_r2_key, input_path)
                if not ok:
                    raise RuntimeError("Failed to download video from R2")

                # 5. Determine analysis runs (split halves if needed)
                if half is not None:
                    analysis_runs = [(input_path, half)]
                elif halftime_ms is not None:
                    from app.services.video.video_splitter import split_video_at_timestamp
                    logger.info(f"Keyframe-analyze: splitting video at {halftime_ms}ms")
                    half1_path, half2_path = await asyncio.to_thread(
                        split_video_at_timestamp, input_path, halftime_ms, tmpdir
                    )
                    Path(input_path).unlink(missing_ok=True)
                    analysis_runs = [(half1_path, 1), (half2_path, 2)]
                else:
                    analysis_runs = [(input_path, 1)]

                # 6. Process each half — parallel batches with per-batch commits
                total_created = 0
                batch_offset = 0
                sem = asyncio.Semaphore(5)  # max 5 concurrent Claude API calls
                total_events_so_far = 0

                # Pre-build jersey → player_id map (shared across batches)
                jersey_to_player = {}
                for r in roster:
                    jn = r.get("jersey_number")
                    if jn is not None:
                        jersey_to_player[jn] = r.get("player_id")

                for run_path, run_half in analysis_runs:
                    await _emit_progress(session_id, {"type": "progress", "stage": "extracting", "half": run_half})
                    frames_dir = str(Path(tmpdir) / f"frames_half{run_half}")
                    frame_paths = await asyncio.to_thread(extract_frames, run_path, frames_dir)
                    Path(run_path).unlink(missing_ok=True)

                    await _emit_progress(session_id, {"type": "progress", "stage": "extracting", "total_frames": len(frame_paths)})

                    # SSIM filter
                    await _emit_progress(session_id, {"type": "progress", "stage": "filtering"})
                    surviving, timestamps_sec = await asyncio.to_thread(
                        filter_static_frames, frame_paths
                    )
                    await _emit_progress(session_id, {"type": "progress", "stage": "filtering", "surviving": len(surviving), "total": len(frame_paths)})

                    # Create batches
                    batches = create_batches(surviving, timestamps_sec)
                    total_batches = len(batches)
                    completed_count = 0
                    await _emit_progress(session_id, {"type": "progress", "stage": "analyzing", "completed": 0, "total": total_batches})

                    # Process all batches in parallel (no state dependency)
                    async def _process_batch(bp, bt, local_idx, _half, _ctx, _roster, _offset):
                        async with sem:
                            evts, conf, state = await analyze_batch(
                                bp, bt, _ctx, _roster,
                                prev_state=None,
                                half=_half, model="haiku"
                            )
                            gidx = _offset + local_idx
                            for e in evts:
                                e["batch_index"] = gidx
                            return evts, conf, gidx

                    tasks = [
                        asyncio.create_task(
                            _process_batch(bp, bt, li, run_half, match_context, roster, batch_offset)
                        )
                        for bp, bt, li in batches
                    ]

                    # As each batch completes → insert events → commit → signal frontend
                    for coro in asyncio.as_completed(tasks):
                        evts, conf, gidx = await coro
                        completed_count += 1

                        # Apply half-2 timestamp offset before inserting
                        if halftime_ms is not None and run_half == 2:
                            for ed in evts:
                                if ed.get("video_timestamp_ms") is not None:
                                    ed["video_timestamp_ms"] += halftime_ms

                        # Insert this batch's events immediately
                        batch_count = 0
                        for ed in evts:
                            scoring_ctx = ed.get("scoring_context")
                            if ed["event_type"] in ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT"):
                                is_two_pt = ed.get("pitch_zone") in TWO_POINTER_ZONES if ed.get("pitch_zone") else False
                                if scoring_ctx:
                                    scoring_ctx["is_two_pointer"] = is_two_pt
                                else:
                                    scoring_ctx = {"is_two_pointer": is_two_pt, "source": "FROM_PLAY"}

                            player_id = None
                            jn = ed.get("jersey_number")
                            if jn and ed.get("team") == "team_a":
                                player_id = jersey_to_player.get(jn)

                            event = VideoEvent(
                                video_session_id=session.id,
                                match_id=session.match_id,
                                event_type=ed["event_type"],
                                team=ed["team"],
                                half=ed["half"],
                                match_minute=ed["match_minute"],
                                match_second=ed.get("match_second", 0),
                                video_timestamp_ms=ed.get("video_timestamp_ms"),
                                pitch_zone=ed.get("pitch_zone"),
                                player_id=player_id,
                                jersey_number=ed.get("jersey_number"),
                                player_confidence=ed.get("player_confidence"),
                                event_confidence=ed.get("event_confidence", "MEDIUM"),
                                scoring_context=scoring_ctx,
                                kickout_context=ed.get("kickout_context"),
                                possession_team=ed.get("possession_team"),
                                description=ed.get("description"),
                                source="keyframe_auto",
                                is_verified=False,
                                batch_index=ed.get("batch_index"),
                            )
                            db.add(event)
                            batch_count += 1

                        await db.commit()
                        total_created += batch_count
                        total_events_so_far += batch_count

                        await _emit_progress(session_id, {
                            "type": "progress", "stage": "analyzing",
                            "completed": completed_count, "total": total_batches,
                            "events_so_far": total_events_so_far,
                            "batch_complete": True,
                        })

                    # Dedup pass: query all committed events for this half, run dedup, delete losers
                    half_result = await db.execute(
                        select(VideoEvent).where(
                            VideoEvent.video_session_id == session_id,
                            VideoEvent.source == "keyframe_auto",
                            VideoEvent.half == run_half,
                        )
                    )
                    committed_events = half_result.scalars().all()
                    if committed_events:
                        as_dicts = [
                            {"id": str(e.id), "event_type": e.event_type, "team": e.team,
                             "video_timestamp_ms": e.video_timestamp_ms,
                             "event_confidence": e.event_confidence}
                            for e in committed_events
                        ]
                        kept = deduplicate_events(as_dicts)
                        kept_ids = {d["id"] for d in kept}
                        to_delete = [e.id for e in committed_events if str(e.id) not in kept_ids]
                        if to_delete:
                            await db.execute(
                                delete(VideoEvent).where(VideoEvent.id.in_(to_delete))
                            )
                            await db.commit()
                            total_created -= len(to_delete)
                            total_events_so_far -= len(to_delete)
                            logger.info(f"Keyframe-analyze: dedup removed {len(to_delete)} events from half {run_half}")

                    batch_offset += len(batches)
                    logger.info(f"Keyframe-analyze: half {run_half} done — {total_created} events total")

            # 7. Update session
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            session.ai_events_generated = total_created
            session.status = "draft_ready"
            session.error_message = None
            await db.commit()

            logger.info(f"Keyframe-analyze complete: session {session_id}, {total_created} events")
            await _emit_progress(session_id, {"type": "done", "total_events": total_created})

        except Exception as e:
            logger.error(f"Keyframe-analyze failed for session {session_id}: {e}", exc_info=True)
            try:
                result = await db.execute(
                    select(VideoSession).where(VideoSession.id == session_id)
                )
                session = result.scalar_one_or_none()
                if session:
                    session.status = "error"
                    session.error_message = str(e)[:500]
                    await db.commit()
            except Exception:
                logger.error(f"Failed to update session error status for {session_id}")
            await _emit_progress(session_id, {"type": "error", "message": str(e)[:500]})
        finally:
            # Clean up queue after a delay (let SSE consumer read final event)
            await asyncio.sleep(5)
            _progress_queues.pop(str(session_id), None)


async def _run_improve_analysis(
    session_id: UUID,
    video_r2_key: str,
    half: int | None,
    halftime_ms: int | None,
    match_id: UUID,
):
    """
    Background task: re-run low-confidence batches through Sonnet.

    Identifies batches where >50% of events are LOW confidence,
    re-extracts those frames, and replaces the events.
    """
    import tempfile
    from pathlib import Path
    from collections import defaultdict
    from sqlalchemy import delete
    from app.database import async_session_maker
    from app.services.storage_service import storage as storage_svc
    from app.services.video.frame_extractor import extract_frames, filter_static_frames, create_batches
    from app.services.ai.keyframe_video_agent import analyze_batch, deduplicate_events
    from app.models.video_event import VideoEvent, TWO_POINTER_ZONES

    async with async_session_maker() as db:
        try:
            # 1. Get session
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            if not session:
                logger.error(f"Improve-analysis: session {session_id} not found")
                return

            # 2. Find low-confidence batches
            result = await db.execute(
                select(VideoEvent).where(
                    VideoEvent.video_session_id == session_id,
                    VideoEvent.source == "keyframe_auto",
                    VideoEvent.batch_index.isnot(None),
                )
            )
            all_events = result.scalars().all()

            # Group by batch_index
            batches_events: dict[int, list] = defaultdict(list)
            for ev in all_events:
                batches_events[ev.batch_index].append(ev)

            low_confidence_batches = []
            for batch_idx, events in batches_events.items():
                low_count = sum(1 for e in events if e.event_confidence == "LOW")
                if len(events) > 0 and low_count / len(events) > 0.5:
                    low_confidence_batches.append(batch_idx)

            if not low_confidence_batches:
                logger.info(f"Improve-analysis: no low-confidence batches found, nothing to do")
                result = await db.execute(
                    select(VideoSession).where(VideoSession.id == session_id)
                )
                session = result.scalar_one_or_none()
                session.status = "draft_ready"
                await db.commit()
                return

            logger.info(f"Improve-analysis: re-running {len(low_confidence_batches)} batches through Sonnet")

            # 3. Load roster and context
            roster = await _load_roster(db, match_id)
            match_context = await _build_match_context(db, match_id)

            with tempfile.TemporaryDirectory() as tmpdir:
                # 4. Download and extract all frames (same pipeline)
                input_path = str(Path(tmpdir) / "input.mp4")
                ok = await asyncio.to_thread(storage_svc.download_file_to_path, video_r2_key, input_path)
                if not ok:
                    raise RuntimeError("Failed to download video from R2")

                # Determine runs
                if half is not None:
                    analysis_runs = [(input_path, half)]
                elif halftime_ms is not None:
                    from app.services.video.video_splitter import split_video_at_timestamp
                    half1_path, half2_path = await asyncio.to_thread(
                        split_video_at_timestamp, input_path, halftime_ms, tmpdir
                    )
                    Path(input_path).unlink(missing_ok=True)
                    analysis_runs = [(half1_path, 1), (half2_path, 2)]
                else:
                    analysis_runs = [(input_path, 1)]

                total_replaced = 0
                batch_offset = 0
                sem = asyncio.Semaphore(5)

                for run_path, run_half in analysis_runs:
                    frames_dir = str(Path(tmpdir) / f"frames_half{run_half}")
                    frame_paths = await asyncio.to_thread(extract_frames, run_path, frames_dir)
                    Path(run_path).unlink(missing_ok=True)

                    surviving, timestamps_sec = await asyncio.to_thread(
                        filter_static_frames, frame_paths
                    )
                    batches = create_batches(surviving, timestamps_sec)

                    # Parallel re-analysis of low-confidence batches
                    async def _improve_batch(bp, bt, local_idx, _half, _ctx, _roster, _offset):
                        async with sem:
                            evts, conf, state = await analyze_batch(
                                bp, bt, _ctx, _roster,
                                None, _half, model="sonnet"
                            )
                            gidx = _offset + local_idx
                            for e in evts:
                                e["batch_index"] = gidx
                            return evts, conf, gidx

                    tasks_to_run = [
                        (bp, bt, li)
                        for bp, bt, li in batches
                        if (batch_offset + li) in low_confidence_batches
                    ]
                    if tasks_to_run:
                        improve_tasks = [
                            _improve_batch(bp, bt, li, run_half, match_context, roster, batch_offset)
                            for bp, bt, li in tasks_to_run
                        ]
                        results = await asyncio.gather(*improve_tasks)

                        # Delete old events for all re-analyzed batches, then insert new
                        reanalyzed_indices = [gidx for _, _, gidx in results]
                        for gidx in reanalyzed_indices:
                            await db.execute(
                                delete(VideoEvent).where(
                                    VideoEvent.video_session_id == session_id,
                                    VideoEvent.batch_index == gidx,
                                )
                            )

                        # Jersey → player lookup
                        jersey_to_player = {}
                        for r in roster:
                            jn = r.get("jersey_number")
                            if jn is not None:
                                jersey_to_player[jn] = r.get("player_id")

                        for events, conf, global_batch_idx in sorted(results, key=lambda r: r[2]):
                            # Offset half 2 timestamps
                            if halftime_ms is not None and run_half == 2:
                                for ed in events:
                                    if ed.get("video_timestamp_ms") is not None:
                                        ed["video_timestamp_ms"] += halftime_ms

                            for ed in events:
                                scoring_ctx = ed.get("scoring_context")
                                if ed["event_type"] in ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT"):
                                    is_two_pt = ed.get("pitch_zone") in TWO_POINTER_ZONES if ed.get("pitch_zone") else False
                                    if scoring_ctx:
                                        scoring_ctx["is_two_pointer"] = is_two_pt
                                    else:
                                        scoring_ctx = {"is_two_pointer": is_two_pt, "source": "FROM_PLAY"}

                                player_id = None
                                jn = ed.get("jersey_number")
                                if jn and ed.get("team") == "team_a":
                                    player_id = jersey_to_player.get(jn)

                                event = VideoEvent(
                                    video_session_id=session.id,
                                    match_id=session.match_id,
                                    event_type=ed["event_type"],
                                    team=ed["team"],
                                    half=ed["half"],
                                    match_minute=ed["match_minute"],
                                    match_second=ed.get("match_second", 0),
                                    video_timestamp_ms=ed.get("video_timestamp_ms"),
                                    pitch_zone=ed.get("pitch_zone"),
                                    player_id=player_id,
                                    jersey_number=ed.get("jersey_number"),
                                    player_confidence=ed.get("player_confidence"),
                                    event_confidence=ed.get("event_confidence", "MEDIUM"),
                                    scoring_context=scoring_ctx,
                                    kickout_context=ed.get("kickout_context"),
                                    possession_team=ed.get("possession_team"),
                                    description=ed.get("description"),
                                    source="keyframe_auto",
                                    is_verified=False,
                                    batch_index=global_batch_idx,
                                )
                                db.add(event)
                                total_replaced += 1

                            logger.info(f"Improve-analysis: batch {global_batch_idx} re-analyzed — {len(events)} events")

                        await db.commit()

                    batch_offset += len(batches)

            # 5. Update session
            result = await db.execute(
                select(VideoSession).where(VideoSession.id == session_id)
            )
            session = result.scalar_one_or_none()
            session.ai_model_used = "claude-haiku+sonnet-keyframe"
            session.status = "draft_ready"
            session.error_message = None
            # Recount total events
            from sqlalchemy import func
            count_result = await db.execute(
                select(func.count(VideoEvent.id)).where(
                    VideoEvent.video_session_id == session_id
                )
            )
            session.ai_events_generated = count_result.scalar() or 0
            await db.commit()

            logger.info(f"Improve-analysis complete: {total_replaced} events replaced across {len(low_confidence_batches)} batches")

        except Exception as e:
            logger.error(f"Improve-analysis failed for session {session_id}: {e}", exc_info=True)
            try:
                result = await db.execute(
                    select(VideoSession).where(VideoSession.id == session_id)
                )
                session = result.scalar_one_or_none()
                if session:
                    session.status = "error"
                    session.error_message = str(e)[:500]
                    await db.commit()
            except Exception:
                logger.error(f"Failed to update session error status for {session_id}")
