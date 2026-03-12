"""
Tactical Analysis Routes.

Provides endpoints for:
- Claude Vision player detection from video frames
- Saving/loading tactical analysis snapshots
- Presigned upload URLs for warped images
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
import json
import logging
import base64
import os
import re

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.tactical_snapshot import TacticalAnalysisSnapshot

logger = logging.getLogger(__name__)

router = APIRouter()


# Request/Response Models

class DetectPlayersRequest(BaseModel):
    frame_base64: str
    roster: List[dict] = []  # [{jersey_number, name, position}]
    team_colors: Optional[dict] = None  # {own: "green and gold", opponent: "red and white"}


class DetectedPlayer(BaseModel):
    jersey_number: Optional[int] = None
    team: str  # "own" or "opponent"
    pixel_x: float
    pixel_y: float
    confidence: float


class DetectPlayersResponse(BaseModel):
    players: List[dict]
    raw_analysis: Optional[str] = None


class SaveSnapshotRequest(BaseModel):
    match_id: str
    video_session_id: Optional[str] = None
    video_timestamp_ms: Optional[int] = None
    calibration_points: Optional[list] = None
    homography_matrix: Optional[list] = None
    detected_players: Optional[list] = None
    annotations: Optional[list] = None
    warped_image_key: Optional[str] = None
    original_frame_key: Optional[str] = None
    notes: Optional[str] = None


class SnapshotResponse(BaseModel):
    id: str
    match_id: str
    video_session_id: Optional[str] = None
    video_timestamp_ms: Optional[int] = None
    calibration_points: Optional[list] = None
    homography_matrix: Optional[list] = None
    detected_players: Optional[list] = None
    annotations: Optional[list] = None
    warped_image_key: Optional[str] = None
    original_frame_key: Optional[str] = None
    notes: Optional[str] = None
    created_at: Optional[str] = None


# Endpoints

@router.post("/detect-players", response_model=DetectPlayersResponse)
async def detect_players(
    request: DetectPlayersRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Use Claude Vision to detect players in a video frame.

    Accepts a base64-encoded frame and optional roster info.
    Returns detected player positions in pixel coordinates.
    """
    try:
        import anthropic

        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

        # Build roster context
        roster_text = ""
        if request.roster:
            roster_lines = []
            for p in request.roster:
                line = f"#{p.get('jersey_number', '?')} {p.get('name', 'Unknown')}"
                if p.get('position'):
                    line += f" ({p['position']})"
                roster_lines.append(line)
            roster_text = f"\n\nRoster:\n" + "\n".join(roster_lines)

        color_text = ""
        if request.team_colors:
            own = request.team_colors.get("own", "unknown")
            opp = request.team_colors.get("opponent", "unknown")
            color_text = f"\n\nOwn team wears: {own}\nOpponents wear: {opp}"

        prompt = f"""Identify all visible GAA football players in this image. For each player you can see, provide their approximate position in the image.
{roster_text}{color_text}

Return ONLY a valid JSON array. Each element:
{{"jersey_number": <int or null if unreadable>, "team": "own" or "opponent", "pixel_x": <float 0-1 normalized>, "pixel_y": <float 0-1 normalized>, "confidence": <float 0-1>}}

pixel_x and pixel_y should be normalized coordinates where (0,0) is top-left and (1,1) is bottom-right, representing the center of the player.

If you cannot identify any players, return an empty array [].
Only return the JSON array, no other text."""

        # Detect media type from base64 header or default to jpeg
        media_type = "image/jpeg"
        frame_data = request.frame_base64
        if frame_data.startswith("data:"):
            parts = frame_data.split(",", 1)
            if len(parts) == 2:
                media_type = parts[0].split(":")[1].split(";")[0]
                frame_data = parts[1]

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2000,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": frame_data,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }],
        )

        raw_text = response.content[0].text.strip()

        # Parse JSON from response
        json_match = re.search(r'\[[\s\S]*\]', raw_text)
        if json_match:
            players = json.loads(json_match.group())
        else:
            players = []

        return DetectPlayersResponse(players=players, raw_analysis=raw_text)

    except Exception as e:
        logger.error(f"Player detection failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Player detection failed: {str(e)}")


@router.post("/snapshots", response_model=SnapshotResponse)
async def save_snapshot(
    request: SaveSnapshotRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Save a tactical analysis snapshot."""
    snapshot = TacticalAnalysisSnapshot(
        match_id=request.match_id,
        video_session_id=request.video_session_id,
        video_timestamp_ms=request.video_timestamp_ms,
        calibration_points=request.calibration_points,
        homography_matrix=request.homography_matrix,
        detected_players=request.detected_players,
        annotations=request.annotations,
        warped_image_key=request.warped_image_key,
        original_frame_key=request.original_frame_key,
        notes=request.notes,
        created_by=user.user_id,
    )
    db.add(snapshot)
    await db.commit()
    await db.refresh(snapshot)

    return _snapshot_to_response(snapshot)


@router.get("/snapshots")
async def list_snapshots(
    match_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List tactical snapshots for a match."""
    result = await db.execute(
        select(TacticalAnalysisSnapshot)
        .where(TacticalAnalysisSnapshot.match_id == match_id)
        .order_by(TacticalAnalysisSnapshot.created_at.desc())
    )
    snapshots = result.scalars().all()
    return [_snapshot_to_response(s) for s in snapshots]


@router.get("/snapshots/{snapshot_id}", response_model=SnapshotResponse)
async def get_snapshot(
    snapshot_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a specific tactical snapshot."""
    result = await db.execute(
        select(TacticalAnalysisSnapshot).where(TacticalAnalysisSnapshot.id == snapshot_id)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    return _snapshot_to_response(snapshot)


@router.delete("/snapshots/{snapshot_id}")
async def delete_snapshot(
    snapshot_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a tactical snapshot."""
    result = await db.execute(
        select(TacticalAnalysisSnapshot).where(TacticalAnalysisSnapshot.id == snapshot_id)
    )
    snapshot = result.scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    await db.delete(snapshot)
    await db.commit()
    return {"success": True}


@router.post("/upload-warped")
async def get_warped_upload_url(
    user: AuthenticatedUser = Depends(require_admin),
):
    """Get a presigned URL for uploading a warped bird's-eye image to R2."""
    try:
        from app.services.storage_service import StorageService
        import uuid

        key = f"{user.club_id}/tactical/{uuid.uuid4().hex}.png"
        url = StorageService.generate_presigned_upload_url(key, content_type="image/png")
        return {"upload_url": url, "key": key}
    except Exception as e:
        logger.error(f"Upload URL generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _snapshot_to_response(s: TacticalAnalysisSnapshot) -> dict:
    return {
        "id": str(s.id),
        "match_id": str(s.match_id),
        "video_session_id": str(s.video_session_id) if s.video_session_id else None,
        "video_timestamp_ms": s.video_timestamp_ms,
        "calibration_points": s.calibration_points,
        "homography_matrix": s.homography_matrix,
        "detected_players": s.detected_players,
        "annotations": s.annotations,
        "warped_image_key": s.warped_image_key,
        "original_frame_key": s.original_frame_key,
        "notes": s.notes,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    }
