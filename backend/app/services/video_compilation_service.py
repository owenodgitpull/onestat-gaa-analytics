"""
Video Compilation service (Phase 10) — stitches tagged clips from one or
more source match videos into a single downloadable MP4.

Extraction reads each source clip directly from a presigned R2 URL via
FFmpeg's own HTTP range-seeking (empirically verified against real
production videos: a 5s clip from a 2.4GB file, seeking 40 minutes in,
took ~11s — nowhere near what a full download would cost) — no source
video is ever downloaded in full. The final concat step re-encodes
(rather than a raw stream-copy) since clips can come from different
matches/devices with different codecs/resolutions, which a copy-concat
would produce a broken file for.
"""

import asyncio
import logging
import os
import subprocess
import tempfile
from datetime import datetime
from pathlib import Path
from uuid import UUID

from sqlalchemy import select

from app.database import async_session_maker
from app.services.storage_service import storage
from app.services.video.video_splitter import _find_ffmpeg

logger = logging.getLogger(__name__)

# Same clip window Presentations uses (DEFAULT_CLIP_LEAD_MS/TAIL_MS in
# presentationsApi.ts) — a wide needs the buildup, not just the miss.
CLIP_LEAD_MS = 6000
CLIP_TAIL_MS = 4000

# Cost/scope guard. Empirically measured against real production video
# (2026-09-18): 2 clips from a single 2.4GB source, including deep-seek
# extraction + full re-encode at concat, took ~71s end to end — the
# re-encode step (needed for cross-source safety, see _concat_clips) is
# the real cost, not the seek/extract. 40 clips at that rate could run well
# past 10 minutes; capped lower here to keep a realistic worst case in the
# few-minutes range. The agent tool caps search results before a job is
# even created — this is a second backstop in case a row is ever created
# with more clips than intended.
MAX_CLIPS_PER_COMPILATION = 20

_background_tasks: set = set()


def fire_and_forget(coro) -> asyncio.Task:
    """Runs a coroutine without the caller awaiting it, keeping a reference
    so it isn't garbage-collected mid-flight (a well-known asyncio footgun
    for fire-and-forget tasks) — needed here because create_video_compilation
    is called from deep inside the agent tool-dispatch loop, not a FastAPI
    route handler, so there's no BackgroundTasks object available to use
    instead."""
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
    return task


async def run_compilation(compilation_id: UUID) -> None:
    """Background job: extract each locked-in clip from its source video via
    presigned-URL range-seeking, concatenate into one MP4, upload to R2,
    notify the requester. Runs in its own DB session since the request
    that kicked this off has already returned."""
    from app.models.video_compilation import VideoCompilation, VideoCompilationStatus
    from app.models.video_event import VideoEvent
    from app.models.video_session import VideoSession
    from app.models.match import Match

    async with async_session_maker() as db:
        result = await db.execute(select(VideoCompilation).where(VideoCompilation.id == compilation_id))
        compilation = result.scalar_one_or_none()
        if not compilation:
            logger.error(f"Video compilation {compilation_id} not found")
            return

        compilation.status = VideoCompilationStatus.PROCESSING
        await db.commit()

        try:
            event_ids = [UUID(e) if isinstance(e, str) else e for e in compilation.video_event_ids]
            rows_result = await db.execute(
                select(VideoEvent, VideoSession.video_r2_key, Match.match_date)
                .join(VideoSession, VideoSession.id == VideoEvent.video_session_id)
                .join(Match, Match.id == VideoEvent.match_id)
                .where(VideoEvent.id.in_(event_ids))
            )
            rows = rows_result.all()
            # Chronological order (earliest match first) — reads as a real
            # highlight reel progression, not the "most recent first"
            # ordering the search/browse UI uses.
            rows.sort(key=lambda r: (r[2] or datetime.min, r[0].video_timestamp_ms or 0))

            ffmpeg = _find_ffmpeg()
            if not ffmpeg:
                raise RuntimeError("FFmpeg is not installed on this machine")

            club_id = str(compilation.club_id)

            with tempfile.TemporaryDirectory() as tmpdir:
                clip_paths: list[str] = []
                for i, (event, r2_key, _match_date) in enumerate(rows):
                    if not r2_key or event.video_timestamp_ms is None:
                        continue
                    url = storage.get_download_url(r2_key, expires_in=1800, club_id=club_id)
                    if not url:
                        logger.warning(f"Compilation {compilation_id}: no download URL for clip {i}, skipping")
                        continue

                    start_sec = max(0, event.video_timestamp_ms - CLIP_LEAD_MS) / 1000
                    duration_sec = (CLIP_LEAD_MS + CLIP_TAIL_MS) / 1000
                    clip_path = str(Path(tmpdir) / f"clip_{i:03d}.mp4")

                    ok = await asyncio.to_thread(
                        _extract_clip, ffmpeg, url, start_sec, duration_sec, clip_path
                    )
                    if ok:
                        clip_paths.append(clip_path)
                    else:
                        logger.warning(f"Compilation {compilation_id}: extraction failed for clip {i}, skipping")

                if not clip_paths:
                    raise RuntimeError("No clips could be extracted (all source videos unreachable or extraction failed)")

                output_path = str(Path(tmpdir) / "compilation.mp4")
                await asyncio.to_thread(_concat_clips, ffmpeg, clip_paths, output_path)

                output_size_mb = os.path.getsize(output_path) / 1024 / 1024
                logger.info(f"Compilation {compilation_id}: {len(clip_paths)} clips concatenated, {output_size_mb:.1f} MB")

                duration_ms = await asyncio.to_thread(_probe_duration_ms, ffmpeg, output_path)

                with open(output_path, "rb") as f:
                    output_key = await asyncio.to_thread(
                        storage.upload_file, f, "compilations", f"{compilation_id}.mp4",
                        "video/mp4", None, club_id,
                    )
                if not output_key:
                    raise RuntimeError("Failed to upload compiled video to R2")

            compilation.status = VideoCompilationStatus.COMPLETED
            compilation.output_r2_key = output_key
            compilation.output_duration_ms = duration_ms
            compilation.completed_at = datetime.utcnow()
            await db.commit()
            logger.info(f"Compilation {compilation_id} completed: {output_key}")

            await _notify_ready(db, compilation)

        except Exception as e:
            logger.error(f"Compilation {compilation_id} failed: {e}")
            compilation.status = VideoCompilationStatus.FAILED
            compilation.error_message = str(e)[:1000]
            await db.commit()


def _extract_clip(ffmpeg: str, source_url: str, start_sec: float, duration_sec: float, output_path: str) -> bool:
    """Single-source stream-copy extraction — fast, no re-encoding, safe
    since it's always one clip from one source file."""
    cmd = [ffmpeg, "-y", "-ss", str(start_sec), "-i", source_url, "-t", str(duration_sec), "-c", "copy", output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=60)
        return result.returncode == 0 and os.path.exists(output_path) and os.path.getsize(output_path) > 0
    except subprocess.TimeoutExpired:
        return False


def _concat_clips(ffmpeg: str, clip_paths: list[str], output_path: str) -> None:
    """Concat via filter_complex (re-encodes) rather than the concat demuxer's
    -c copy — clips can come from different source matches/devices with
    different resolutions/codecs, which a raw stream-copy concat would
    produce a broken or glitchy file for. Re-encoding is slower but
    guarantees a correctly-playing single output regardless of source
    variance."""
    cmd = [ffmpeg, "-y"]
    for p in clip_paths:
        cmd += ["-i", p]
    filter_parts = "".join(f"[{i}:v:0][{i}:a:0]" for i in range(len(clip_paths)))
    filter_complex = f"{filter_parts}concat=n={len(clip_paths)}:v=1:a=1[outv][outa]"
    cmd += [
        "-filter_complex", filter_complex,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, timeout=600)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")[-800:]
        raise RuntimeError(f"FFmpeg concat failed: {stderr}")


def _probe_duration_ms(ffmpeg: str, path: str) -> int | None:
    """Best-effort duration read via ffprobe (same install as ffmpeg)."""
    ffprobe = ffmpeg.replace("ffmpeg", "ffprobe")
    try:
        result = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
            capture_output=True, timeout=30,
        )
        return int(float(result.stdout.decode().strip()) * 1000)
    except Exception:
        return None


async def _notify_ready(db, compilation) -> None:
    if not compilation.requested_by_user_id:
        return
    try:
        from app.services.notification_service import NotificationService
        from app.models.notification import NotificationType
        await NotificationService.send_push(
            db=db,
            user_id=compilation.requested_by_user_id,
            notification_type=NotificationType.VIDEO_COMPILATION_READY,
            title="Video ready",
            body=f'"{compilation.title}" is ready to download ({compilation.clip_count} clips).',
            data={"compilation_id": str(compilation.id)},
        )
    except Exception as e:
        logger.warning(f"Failed to send compilation-ready notification: {e}")
