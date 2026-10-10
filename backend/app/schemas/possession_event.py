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
    # Optional: Simple Scoring's "Possession Changed" button records a team +
    # duration possession change with no location step, so coordinates may
    # be absent — possession % still works, territorial breakdowns don't.
    pitch_x: Optional[float] = Field(None, ge=0, le=100, description="X coordinate (0=own goal, 100=opponent goal)")
    pitch_y: Optional[float] = Field(None, ge=0, le=100, description="Y coordinate (0=left, 100=right)")
    minute: Optional[int] = Field(None, ge=0, le=120, description="Minute of match")
    match_clock_s: Optional[int] = Field(None, ge=0, le=7500, description="Game-clock seconds at the tap (minute*60 + seconds)")
    half: Optional[int] = Field(None, ge=1, le=2, description="Half the tap was recorded in (1 or 2)")


class PossessionEventCreate(PossessionEventBase):
    """Schema for creating a new possession event."""
    match_id: UUID = Field(..., description="Match this possession belongs to")
    client_event_id: Optional[str] = Field(None, max_length=64, description="Client-generated UUID for offline deduplication")
    # Video Tagging only: possession time measured in VIDEO time (play-time
    # accumulated client-side while the footage was playing and not in a
    # dead-ball state). When set, this event's own duration is stored as-is
    # and the previous event's duration is NOT chained from wall-clock
    # created_at gaps — those gaps are meaningless for video (pauses, 0.5x
    # playback, scrubbing and tagging time would all be counted as possession).
    duration_seconds: Optional[int] = Field(None, ge=0, le=3600, description="Explicit possession duration (video time)")


class PossessionEventBulkCreate(BaseModel):
    """Schema for bulk-creating possession events (e.g., from a drag path)."""
    match_id: UUID = Field(..., description="Match these possessions belong to")
    team: PossessionTeam = Field(..., description="Which team has possession")
    minute: Optional[int] = Field(None, ge=0, le=120, description="Minute of match")
    match_clock_s: Optional[int] = Field(None, ge=0, le=7500, description="Game-clock seconds at the tap (minute*60 + seconds)")
    half: Optional[int] = Field(None, ge=1, le=2, description="Half the tap was recorded in (1 or 2)")
    waypoints: List[dict] = Field(..., description="List of {x, y} coordinates", min_length=1, max_length=50)


class PossessionVideoPoint(BaseModel):
    """One video-time possession point (Video Tagging)."""
    team: PossessionTeam
    pitch_x: Optional[float] = Field(None, ge=0, le=100)
    pitch_y: Optional[float] = Field(None, ge=0, le=100)
    minute: Optional[int] = Field(None, ge=0, le=120)
    match_clock_s: Optional[int] = Field(None, ge=0, le=7500, description="Game-clock seconds at the tap (minute*60 + seconds)")
    half: Optional[int] = Field(None, ge=1, le=2, description="Half the tap was recorded in (1 or 2)")
    # Seconds of VIDEO time this point represents (0 for pure path/location points)
    duration_seconds: int = Field(0, ge=0, le=3600)
    # Video time (ms) the point was recorded at (enables Undo to Point)
    video_ms: Optional[int] = Field(None, ge=0)


class PossessionVideoBatch(BaseModel):
    """Batched video-time possession points — one request instead of one per
    tap/drag. Durations are final as sent: no wall-clock chaining."""
    match_id: UUID
    points: List[PossessionVideoPoint] = Field(..., min_length=1, max_length=500)


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

