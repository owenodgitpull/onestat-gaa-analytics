"""
Pydantic schemas for Match GPS API.

Validates request/response data for match GPS data upload and retrieval.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from uuid import UUID


# ============ Match GPS Data Schemas ============

class MatchGPSDataBase(BaseModel):
    """Base schema for match GPS data."""
    player_id: UUID = Field(..., description="Player UUID")

    # Distance metrics (same as TrainingGPSData)
    total_distance_m: Optional[float] = Field(None, description="Total distance in meters")
    high_speed_running_m: Optional[float] = Field(None, description="High speed running distance")
    sprint_distance_m: Optional[float] = Field(None, description="Sprint distance")
    hml_distance_m: Optional[float] = Field(None, description="High metabolic load distance")

    # Speed metrics
    max_speed_ms: Optional[float] = Field(None, description="Maximum speed in m/s")
    avg_speed_ms: Optional[float] = Field(None, description="Average speed in m/s")

    # Effort counts
    sprint_count: Optional[int] = Field(None, description="Number of sprints")
    acceleration_count: Optional[int] = Field(None, description="Number of accelerations")
    deceleration_count: Optional[int] = Field(None, description="Number of decelerations")

    # Load metrics
    dynamic_stress_load: Optional[float] = Field(None, description="Dynamic stress load")
    player_load: Optional[float] = Field(None, description="Player load metric")

    # Heart rate
    avg_heart_rate: Optional[int] = Field(None, description="Average heart rate")
    max_heart_rate: Optional[int] = Field(None, description="Maximum heart rate")
    time_in_red_zone_mins: Optional[float] = Field(None, description="Time in HR red zone")

    # Match-specific fields
    playing_minutes: Optional[int] = Field(None, description="Minutes played in match")
    started_as_sub: Optional[bool] = Field(False, description="Whether player started as sub")

    duration_mins: Optional[float] = Field(None, description="Total time on pitch")
    notes: Optional[str] = None


class MatchGPSDataCreate(MatchGPSDataBase):
    """Schema for creating match GPS data."""
    pass


class MatchGPSDataResponse(MatchGPSDataBase):
    """Response schema for match GPS data."""
    id: UUID
    match_id: UUID
    player_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MatchGPSBulkCreate(BaseModel):
    """Schema for bulk creating match GPS data."""
    records: list[MatchGPSDataBase] = Field(..., description="List of player GPS records")


# ============ Upload Schemas ============

class MatchGPSUploadResponse(BaseModel):
    """Response schema for match GPS upload."""
    upload_id: UUID
    match_id: UUID
    status: str
    filename: str
    extracted_player_count: Optional[int] = None
    message: str


class MatchGPSUploadStatus(BaseModel):
    """Status of a match GPS upload."""
    id: UUID
    match_id: UUID
    filename: str
    status: str
    extracted_player_count: Optional[int]
    error_message: Optional[str]
    created_at: datetime
    processed_at: Optional[datetime]


# ============ Analysis Schemas ============

class MatchGPSSummary(BaseModel):
    """Summary of GPS data for a match."""
    match_id: UUID
    opponent: str
    match_date: datetime
    players_with_data: int
    team_total_distance: float
    team_avg_distance: float
    team_avg_max_speed: float
    team_total_sprints: int
    top_distance_player: Optional[dict] = None
    top_speed_player: Optional[dict] = None
    gps_analysis_included: bool


class PlayerMatchGPSHistory(BaseModel):
    """GPS history for a player across matches."""
    player_id: UUID
    player_name: str
    matches_with_gps: int
    avg_distance_per_match: float
    avg_sprints_per_match: float
    avg_max_speed: float
    recent_matches: list[MatchGPSDataResponse]


class MatchReanalysisResponse(BaseModel):
    """Response when match is re-analyzed with GPS data."""
    match_id: UUID
    ai_analysis_version: int
    gps_analysis_included: bool
    analysis_updated: bool
    message: str
