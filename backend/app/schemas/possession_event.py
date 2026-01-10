"""
Pydantic schemas for PossessionEvent data validation and serialization.

These schemas define the structure of API requests and responses for ball possession tracking.
"""

from pydantic import BaseModel, Field, validator
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from app.models.possession_event import PossessionTeam


class PossessionEventBase(BaseModel):
    """Base schema for PossessionEvent data."""
    team: PossessionTeam = Field(..., description="Which team has possession")
    pitch_x: float = Field(..., ge=0, le=100, description="X coordinate (0=Dungloe goal, 100=opponent goal)")
    pitch_y: float = Field(..., ge=0, le=100, description="Y coordinate (0=left, 100=right)")
    minute: Optional[int] = Field(None, ge=0, le=120, description="Minute of match")


class PossessionEventCreate(PossessionEventBase):
    """Schema for creating a new possession event."""
    match_id: UUID = Field(..., description="Match this possession belongs to")


class PossessionEventUpdate(BaseModel):
    """Schema for updating an existing possession event."""
    team: Optional[PossessionTeam] = None
    pitch_x: Optional[float] = Field(None, ge=0, le=100)
    pitch_y: Optional[float] = Field(None, ge=0, le=100)
    minute: Optional[int] = Field(None, ge=0, le=120)
    duration_seconds: Optional[int] = Field(None, ge=0)


class PossessionEventResponse(PossessionEventBase):
    """Schema for possession event responses."""
    id: UUID
    match_id: UUID
    duration_seconds: Optional[int]
    created_at: datetime
    
    # Computed fields
    zone_name: str = Field(..., description="Human-readable zone name")
    is_in_two_point_zone: bool = Field(..., description="Whether position is in 2-point zone")

    class Config:
        from_attributes = True


class PossessionEventListResponse(BaseModel):
    """Schema for paginated list of possession events."""
    events: List[PossessionEventResponse]
    total: int
    page: int
    page_size: int


class BallPositionUpdate(BaseModel):
    """
    Schema for updating ball position during live match.
    
    Simple schema for when user taps/drags ball on pitch.
    Automatically creates a new PossessionEvent.
    """
    match_id: UUID
    team: PossessionTeam = Field(..., description="Which team has possession")
    pitch_x: float = Field(..., ge=0, le=100, description="X coordinate")
    pitch_y: float = Field(..., ge=0, le=100, description="Y coordinate")
    minute: Optional[int] = Field(None, ge=0, le=120)


class PossessionHeatMapData(BaseModel):
    """
    Schema for heat map data response.
    
    Returns aggregated possession data for visualization.
    """
    match_id: UUID
    team: PossessionTeam
    zones: List[dict] = Field(..., description="List of {zone, x, y, duration, percentage}")
    total_duration_seconds: int
    total_possession_percentage: float


class PossessionFlowData(BaseModel):
    """
    Schema for possession flow diagram data.
    
    Shows how ball moved between zones during match.
    """
    match_id: UUID
    flows: List[dict] = Field(..., description="List of {from_zone, to_zone, count, team}")

