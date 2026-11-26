"""
Dashboard layout routes - save/load the season dashboard setup (chart order, hidden charts, section order, pinned AI
charts, which KPI cards are shown).

The club has ONE default setup (the top level of layout_data): it is what a person sees until they change something, so a
new user (a new coach) starts from the club's own setup. From their first change on, a person has a setup of their own,
kept under layout_data["perUser"][user_id], so one user's changes never move another's dashboard.
Saved in the same JSON column as before: no schema change.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from datetime import datetime

from app.database import get_db
from app.auth.dependencies import require_admin_or_viewer, AuthenticatedUser
from app.models.dashboard_layout import DashboardLayout

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

PER_USER = "perUser"


class DashboardLayoutRequest(BaseModel):
    layout_data: dict


class DashboardLayoutResponse(BaseModel):
    layout_data: dict
    updated_at: datetime
    personal: bool = False      # True once this person has a setup of their own (False: the club's default is showing)


def _club_default(data: dict) -> dict:
    return {k: v for k, v in (data or {}).items() if k != PER_USER}


@router.get("/layout", response_model=DashboardLayoutResponse | None)
async def get_dashboard_layout(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """The person's own dashboard setup, or the club's default when they have not changed anything yet."""
    result = await db.execute(
        select(DashboardLayout).where(DashboardLayout.club_id == user.club_id)
    )
    layout = result.scalar_one_or_none()

    if not layout:
        return None

    mine = ((layout.layout_data or {}).get(PER_USER) or {}).get(str(user.user_id))
    return DashboardLayoutResponse(
        layout_data=mine if isinstance(mine, dict) and mine else _club_default(layout.layout_data),
        updated_at=layout.updated_at,
        personal=bool(mine),
    )


@router.post("/layout", response_model=DashboardLayoutResponse)
async def save_dashboard_layout(
    request: DashboardLayoutRequest,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Save this person's dashboard setup. The club's default is only written when the club has none yet."""
    result = await db.execute(
        select(DashboardLayout).where(DashboardLayout.club_id == user.club_id).with_for_update()   # two people saving at once must not overwrite each other
    )
    layout = result.scalar_one_or_none()
    mine = _club_default(request.layout_data)

    if layout:
        data = dict(layout.layout_data or {})
        per = dict(data.get(PER_USER) or {})
        per[str(user.user_id)] = mine
        data[PER_USER] = per
        layout.layout_data = data
        layout.updated_at = datetime.utcnow()
    else:
        layout = DashboardLayout(
            club_id=user.club_id,
            layout_data={**mine, PER_USER: {str(user.user_id): mine}},
        )
        db.add(layout)

    await db.commit()
    await db.refresh(layout)

    return DashboardLayoutResponse(
        layout_data=mine,
        updated_at=layout.updated_at,
        personal=True,
    )
