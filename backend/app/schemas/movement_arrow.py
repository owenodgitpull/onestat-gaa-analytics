"""Schemas for movement arrow endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class MovementArrowCreate(BaseModel):
    match_id: UUID
    player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    path_points: Optional[List[dict]] = None
    start_x: Optional[float] = None
    start_y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    label: Optional[str] = Field(None, max_length=30)
    half: Optional[int] = None
    minute: Optional[int] = None
    video_timestamp_ms: Optional[int] = None
    source: str = Field(default="video_enrichment", max_length=20)


class MovementArrowResponse(BaseModel):
    id: UUID
    match_id: UUID
    player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    path_points: Optional[List[dict]] = None
    start_x: Optional[float] = None
    start_y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    label: Optional[str] = None
    half: Optional[int] = None
    minute: Optional[int] = None
    source: str
    created_at: datetime

    class Config:
        from_attributes = True


class MovementArrowListResponse(BaseModel):
    arrows: List[MovementArrowResponse]
    total: int
