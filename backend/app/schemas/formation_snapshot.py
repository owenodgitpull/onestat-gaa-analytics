"""Schemas for formation snapshot endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class SnapshotPosition(BaseModel):
    player_id: Optional[UUID] = None  # Nullable for opposition players (not in our DB)
    jersey_number: Optional[int] = None
    player_name: Optional[str] = None  # For opposition players or display name
    team: str = Field(default="own", pattern="^(own|opponent)$")
    x: float = Field(..., ge=0, le=100)
    y: float = Field(..., ge=0, le=100)


class FormationSnapshotCreate(BaseModel):
    match_id: UUID
    half: int = Field(..., ge=1, le=2)
    minute: Optional[int] = None
    label: Optional[str] = None
    positions: List[SnapshotPosition] = Field(..., min_length=2)
    source: str = Field(default="live", max_length=20)
    video_timestamp_ms: Optional[int] = None


class FormationSnapshotResponse(BaseModel):
    id: UUID
    match_id: UUID
    half: int
    minute: Optional[int] = None
    label: Optional[str] = None
    positions: Optional[List[dict]] = None
    source: str
    video_timestamp_ms: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class FormationSnapshotListResponse(BaseModel):
    snapshots: List[FormationSnapshotResponse]
    total: int
