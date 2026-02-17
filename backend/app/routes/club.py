"""
API routes for Club operations.

Provides the active club for the current tenant.
Resolved from authenticated user's club_id.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club
from app.models.club import Club
from app.schemas.club import ClubResponse, ClubUpdate

router = APIRouter()


@router.get("/", response_model=ClubResponse)
async def get_active_club(
    user: AuthenticatedUser = Depends(require_club),
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
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Update club details. Only the user's own club can be updated."""
    from uuid import UUID

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
