"""
API routes for Club operations.

Provides the active club for the current tenant.
Resolved from authenticated user's club_id.
"""

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from uuid import UUID

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.club import Club
from app.schemas.club import ClubResponse, ClubUpdate

router = APIRouter()


@router.get("/", response_model=ClubResponse)
async def get_active_club(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the authenticated user's club.
    """
    result = await db.execute(
        select(Club).where(Club.id == user.club_id, Club.is_active == True)
    )
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No active club found",
        )
    return club


@router.patch("/{club_id}", response_model=ClubResponse)
async def update_club(
    club_id: str,
    club_data: ClubUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update club details. Only the user's own club can be updated."""

    target_id = UUID(club_id)
    if target_id != user.club_id:
        raise HTTPException(status_code=403, detail="Cannot update another club")

    result = await db.execute(select(Club).where(Club.id == target_id))
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")

    update_data = club_data.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(club, field, value)

    await db.commit()
    await db.refresh(club)
    return club


@router.post("/logo", response_model=ClubResponse)
async def upload_club_logo(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Upload or replace the club logo. Stores in R2 under club prefix."""
    import logging
    logger = logging.getLogger(__name__)

    allowed_types = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"Invalid file type: {file.content_type}. Allowed: png, jpg, svg, webp")

    result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(404, "Club not found")

    file_bytes = await file.read()
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"

    from app.services.storage_service import storage
    r2_key = storage.upload_bytes(
        data=file_bytes,
        folder="logos",
        filename=f"club-logo.{ext}",
        content_type=file.content_type,
        club_id=str(user.club_id),
    )

    if not r2_key:
        raise HTTPException(500, "Failed to upload logo to storage")

    # Store R2 key as logo_url (served via /club/logo/serve endpoint)
    club.logo_url = r2_key
    await db.commit()
    await db.refresh(club)

    logger.info(f"Club {club.id} logo uploaded: {r2_key}")
    return club


@router.get("/logo/serve")
async def serve_club_logo(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Redirect to a presigned R2 URL for the club logo."""
    result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = result.scalar_one_or_none()
    if not club or not club.logo_url:
        raise HTTPException(404, "No logo found")

    from app.services.storage_service import storage
    url = storage.get_download_url(club.logo_url, expires_in=86400, club_id=str(user.club_id))
    if not url:
        raise HTTPException(500, "Failed to generate logo URL")

    return RedirectResponse(url=url, status_code=302)
