"""Schemas for tactical tag endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


VALID_TAG_TYPES = {"high_press", "blanket_defence", "formation_change", "custom"}


class TacticalTagCreate(BaseModel):
    match_id: UUID
    tag_type: str = Field(..., max_length=30)
    label: Optional[str] = Field(None, max_length=100)
    half: int = Field(..., ge=1, le=2)
    minute: Optional[int] = None
    match_clock_s: Optional[int] = None
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    source: str = Field(default="live", max_length=20)


class TacticalTagResponse(BaseModel):
    id: UUID
    match_id: UUID
    tag_type: str
    label: Optional[str] = None
    half: int
    minute: Optional[int] = None
    match_clock_s: Optional[int] = None
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True


class TacticalTagListResponse(BaseModel):
    tags: List[TacticalTagResponse]
    total: int
