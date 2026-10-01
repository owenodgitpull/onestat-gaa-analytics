"""
Dashboard layout routes - save/load dashboard chart order per club.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.auth import require_admin_or_viewer, AuthenticatedUser
from app.models.dashboard_layout import DashboardLayout

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


class DashboardLayoutRequest(BaseModel):
    layout_data: dict


class DashboardLayoutResponse(BaseModel):
    layout_data: dict
    updated_at: datetime


@router.get("/layout", response_model=DashboardLayoutResponse | None)
async def get_dashboard_layout(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Get the dashboard layout for the user's club."""
    result = await db.execute(
        select(DashboardLayout).where(DashboardLayout.club_id == user.club_id)
    )
    layout = result.scalar_one_or_none()

    if not layout:
        return None

    return DashboardLayoutResponse(
        layout_data=layout.layout_data,
        updated_at=layout.updated_at
    )


@router.post("/layout", response_model=DashboardLayoutResponse)
async def save_dashboard_layout(
    request: DashboardLayoutRequest,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Save the dashboard layout for the user's club."""
    result = await db.execute(
        select(DashboardLayout).where(DashboardLayout.club_id == user.club_id)
    )
    layout = result.scalar_one_or_none()

    if layout:
        # Update existing
        layout.layout_data = request.layout_data
        layout.updated_at = datetime.utcnow()
    else:
        # Create new
        layout = DashboardLayout(
            club_id=user.club_id,
            layout_data=request.layout_data
        )
        db.add(layout)

    await db.commit()
    await db.refresh(layout)

    return DashboardLayoutResponse(
        layout_data=layout.layout_data,
        updated_at=layout.updated_at
    )
