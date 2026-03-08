"""Schemas for formation snapshot endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class SnapshotPosition(BaseModel):
    player_id: UUID
    jersey_number: Optional[int] = None
    x: float = Field(..., ge=0, le=100)
    y: float = Field(..., ge=0, le=100)


class FormationSnapshotCreate(BaseModel):
    match_id: UUID
    half: int = Field(..., ge=1, le=2)
    minute: Optional[int] = None
    label: Optional[str] = None
    positions: List[SnapshotPosition] = Field(..., min_length=2)
    source: str = Field(default="live", max_length=20)


class FormationSnapshotResponse(BaseModel):
    id: UUID
    match_id: UUID
    half: int
    minute: Optional[int] = None
    label: Optional[str] = None
    positions: Optional[List[dict]] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True


class FormationSnapshotListResponse(BaseModel):
    snapshots: List[FormationSnapshotResponse]
    total: int
