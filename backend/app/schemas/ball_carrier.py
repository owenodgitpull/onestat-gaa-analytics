"""Schemas for ball carrier segment endpoints."""

from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class PathPoint(BaseModel):
    x: float = Field(..., ge=0, le=100)
    y: float = Field(..., ge=0, le=100)


class BallCarrierSegmentCreate(BaseModel):
    match_id: UUID
    # Exactly one of: our player, or an opposition player from the match's opposition lineup (inter-county)
    player_id: Optional[UUID] = None
    opposition_player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    team: str = Field(..., max_length=20)
    half: int = Field(..., ge=1, le=2)
    minute: Optional[int] = None
    match_clock_s: Optional[int] = None
    start_x: Optional[float] = None
    start_y: Optional[float] = None
    source: str = Field(default="live", max_length=20)
    client_event_id: Optional[str] = Field(None, max_length=64)
    # Video Tagging: video time (ms) the carry started at — lets Undo to Point cut carries exactly
    video_timestamp_ms: Optional[int] = None

    @model_validator(mode="after")
    def _exactly_one_player(self):
        if (self.player_id is None) == (self.opposition_player_id is None):
            raise ValueError("exactly one of player_id / opposition_player_id is required")
        return self


class BallCarrierSegmentUpdate(BaseModel):
    path_points: Optional[List[PathPoint]] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    end_time_ms: Optional[int] = None
    ended_by: Optional[str] = None


class AppendPathPointsRequest(BaseModel):
    points: List[PathPoint]


class BallCarrierSegmentResponse(BaseModel):
    id: UUID
    match_id: UUID
    player_id: Optional[UUID] = None
    opposition_player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None
    team: str
    half: int
    minute: Optional[int] = None
    match_clock_s: Optional[int] = None
    path_points: Optional[List[dict]] = None
    start_x: Optional[float] = None
    start_y: Optional[float] = None
    end_x: Optional[float] = None
    end_y: Optional[float] = None
    start_time_ms: Optional[int] = None
    end_time_ms: Optional[int] = None
    ended_by: Optional[str] = None
    source: str
    sequence_number: int
    created_at: datetime
    player_name: Optional[str] = None

    class Config:
        from_attributes = True


class BallCarrierSegmentListResponse(BaseModel):
    segments: List[BallCarrierSegmentResponse]
    total: int
