"""
API routes for club onboarding wizard.

Step 1+2: Create club (details + branding)
Step 3: Upload and confirm player roster (CSV/XLSX/manual)
Step 4: Mark onboarding complete
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, get_current_user
from app.database import get_db
from app.models.user import User
from app.schemas.club import ClubResponse
from app.schemas.onboarding import (
    ClubOnboardingCreate,
    PlayerFilePreview,
    PlayerBulkCreateRequest,
    PlayerBulkCreateResponse,
)
from app.models.user_club_membership import UserClubMembership
from app.services.onboarding_service import OnboardingService

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/club", response_model=ClubResponse, status_code=status.HTTP_201_CREATED)
async def create_club(
    data: ClubOnboardingCreate,
    db: AsyncSession = Depends(get_db),
    user: AuthenticatedUser = Depends(get_current_user),
):
    """
    Step 1+2: Create a new club with basic details and branding.
    Links the authenticated user to the club immediately so state survives page refresh.
    """
    club = await OnboardingService.create_club(db, data)

    # Link user to club immediately so onboarding state survives page refresh
    if not user.club_id:
        result = await db.execute(select(User).where(User.id == user.user_id))
        db_user = result.scalar_one_or_none()
        if db_user:
            db_user.club_id = club.id
            # Create organization and membership for the new club
            from app.models.organization import Organization
            org = Organization(name=club.name, owner_user_id=db_user.id)
            db.add(org)
            await db.flush()
            club.organization_id = org.id
            db.add(UserClubMembership(
                user_id=db_user.id, club_id=club.id, role="club_admin",
            ))
            await db.commit()
            logger.info(f"Linked user {user.email} to club {club.id} during onboarding (org={org.id})")

    return club


@router.post("/club/{club_id}/logo", response_model=ClubResponse)
async def upload_club_logo(
    club_id: UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2: Upload club logo image. Stores in R2 under club prefix.
    """
    import logging
    logger = logging.getLogger(__name__)

    allowed_types = {"image/png", "image/jpeg", "image/svg+xml", "image/webp"}
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"Invalid file type: {file.content_type}. Allowed: {', '.join(allowed_types)}")

    file_bytes = await file.read()
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "png"

    from app.services.storage_service import storage
    r2_key = storage.upload_bytes(
        data=file_bytes,
        folder="logos",
        filename=f"club-logo.{ext}",
        content_type=file.content_type,
        club_id=str(club_id),
    )

    if not r2_key:
        raise HTTPException(500, "Failed to upload logo to storage")

    logger.info(f"Onboarding logo uploaded to R2: {r2_key}")
    club = await OnboardingService.update_club_logo(db, club_id, r2_key)
    return club


@router.post("/club/{club_id}/players/preview", response_model=PlayerFilePreview)
async def preview_player_file(
    club_id: UUID,
    file: UploadFile = File(...),
):
    """
    Step 3a: Parse a CSV/XLSX file and return a preview of players.

    Does NOT create players — just returns parsed data with warnings.
    The frontend displays this for user review before confirming.
    """
    allowed_types = {
        "text/csv", "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/octet-stream",  # Some browsers send this for .csv
    }
    # Be lenient with content type — rely on extension
    content = await file.read()

    if not content:
        raise HTTPException(400, "Empty file")

    if len(content) > 5 * 1024 * 1024:  # 5MB limit
        raise HTTPException(400, "File too large (max 5MB)")

    filename = file.filename or "upload.csv"
    preview = OnboardingService.parse_player_file(content, filename)
    return preview


@router.post("/club/{club_id}/players/confirm", response_model=PlayerBulkCreateResponse)
async def confirm_players(
    club_id: UUID,
    request: PlayerBulkCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 3b: Bulk create players from the confirmed preview data.
    """
    if not request.players:
        raise HTTPException(400, "No players to create")

    players = await OnboardingService.bulk_create_players(db, club_id, request.players)
    return PlayerBulkCreateResponse(
        created_count=len(players),
        player_ids=[str(p.id) for p in players],
    )


@router.patch("/club/{club_id}/complete", response_model=ClubResponse)
async def complete_onboarding(
    club_id: UUID,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 4: Mark club onboarding as completed.
    """
    try:
        club = await OnboardingService.complete_onboarding(db, club_id)
        return club
    except ValueError as e:
        raise HTTPException(404, str(e))
