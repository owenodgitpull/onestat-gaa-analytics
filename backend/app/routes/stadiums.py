"""Stadiums: a ground's measured pitch, entered once per club and picked in match setup."""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import require_admin, require_admin_or_viewer, AuthenticatedUser
from app.database import get_db
from app.models.match import Match
from app.models.stadium import Stadium

router = APIRouter()


def _check_corners(v):
    if v is None or v == []:
        return None
    if not isinstance(v, list) or not (2 <= len(v) <= 4):
        raise ValueError("give 2 to 4 corner points")
    out = []
    for c in v:
        if not isinstance(c, (list, tuple)) or len(c) != 2:
            raise ValueError("each corner is [latitude, longitude]")
        lat, lon = float(c[0]), float(c[1])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError("a corner is not a latitude / longitude")
        out.append([lat, lon])
    return out


class StadiumIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    pitch_length_m: float = Field(..., ge=100, le=160, description="Goal line to goal line, metres")
    pitch_width_m: float = Field(..., ge=60, le=100, description="Sideline to sideline, metres")
    corners: Optional[list] = Field(None, description="Optional 2-4 corner flags [[lat, lon], ...] read off a map")

    @field_validator("corners")
    @classmethod
    def _corners(cls, v):
        return _check_corners(v)

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("name is required")
        return v


class StadiumUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=120)
    pitch_length_m: Optional[float] = Field(None, ge=100, le=160)
    pitch_width_m: Optional[float] = Field(None, ge=60, le=100)
    corners: Optional[list] = None

    @field_validator("corners")
    @classmethod
    def _corners(cls, v):
        return _check_corners(v)


class StadiumOut(BaseModel):
    id: UUID
    name: str
    pitch_length_m: float
    pitch_width_m: float
    corners: Optional[list] = None
    matches: int = 0
    updated_at: Optional[datetime] = None


def _out(st: Stadium, n: int = 0) -> StadiumOut:
    return StadiumOut(id=st.id, name=st.name, pitch_length_m=st.pitch_length_m, pitch_width_m=st.pitch_width_m,
                      corners=st.corners, matches=n, updated_at=st.updated_at)


async def _count(db: AsyncSession, st: Stadium) -> int:
    return (await db.execute(select(func.count()).select_from(Match).where(Match.stadium_id == st.id, Match.is_deleted.is_(False)))).scalar() or 0


async def _mine(db: AsyncSession, stadium_id: UUID, user: AuthenticatedUser) -> Stadium:
    st = await db.get(Stadium, stadium_id)
    if st is None or st.club_id != user.club_id:
        raise HTTPException(status_code=404, detail="Stadium not found")
    return st


@router.get("", response_model=List[StadiumOut])
async def list_stadiums(user: AuthenticatedUser = Depends(require_admin_or_viewer), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Stadium).where(Stadium.club_id == user.club_id).order_by(func.lower(Stadium.name)))).scalars().all()
    counts = dict((await db.execute(
        select(Match.stadium_id, func.count()).where(Match.club_id == user.club_id, Match.stadium_id.isnot(None), Match.is_deleted.is_(False))
        .group_by(Match.stadium_id))).all())
    return [_out(st, counts.get(st.id, 0)) for st in rows]


@router.post("", response_model=StadiumOut, status_code=201)
async def create_stadium(body: StadiumIn, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    dup = (await db.execute(select(Stadium).where(Stadium.club_id == user.club_id, func.lower(Stadium.name) == body.name.lower()))).scalars().first()
    if dup is not None:
        raise HTTPException(status_code=409, detail=f"{dup.name} is already saved. Pick it from the list, or edit its size.")
    st = Stadium(club_id=user.club_id, name=body.name, pitch_length_m=body.pitch_length_m, pitch_width_m=body.pitch_width_m, corners=body.corners)
    db.add(st)
    await db.commit()
    await db.refresh(st)
    return _out(st, 0)


@router.patch("/{stadium_id}", response_model=StadiumOut)
async def update_stadium(stadium_id: UUID, body: StadiumUpdate, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Changing a ground's size or corners updates every match played there and redoes their GPS placement."""
    st = await _mine(db, stadium_id, user)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        name = data["name"].strip()
        dup = (await db.execute(select(Stadium).where(Stadium.club_id == user.club_id, func.lower(Stadium.name) == name.lower(),
                                                      Stadium.id != st.id))).scalars().first()
        if dup is not None:
            raise HTTPException(status_code=409, detail=f"Another saved ground is already called {dup.name}.")
        st.name = name
    before = (st.pitch_length_m, st.pitch_width_m, st.corners)
    for k in ("pitch_length_m", "pitch_width_m"):
        if data.get(k) is not None:
            setattr(st, k, data[k])
    if "corners" in data:
        st.corners = data["corners"]
    changed = before != (st.pitch_length_m, st.pitch_width_m, st.corners)
    matches = []
    if changed:
        matches = (await db.execute(select(Match).where(Match.stadium_id == st.id, Match.club_id == user.club_id))).scalars().all()
        for m in matches:
            m.pitch_length_m = st.pitch_length_m
            m.pitch_width_m = st.pitch_width_m
    await db.commit()
    await db.refresh(st)
    if changed:
        from app.services.gps_timeseries import service as gps
        for m in matches:
            await gps.resync_if_synced(db, m)
    return _out(st, await _count(db, st))


@router.delete("/{stadium_id}", status_code=204)
async def delete_stadium(stadium_id: UUID, user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Matches played there keep their pitch size; they just no longer name the ground."""
    st = await _mine(db, stadium_id, user)
    await db.delete(st)
    await db.commit()
