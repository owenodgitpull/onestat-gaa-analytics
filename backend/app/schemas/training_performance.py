"""
Pydantic schemas for Training Performance API.

Validates request/response data for GPS tracking and weight training.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from uuid import UUID


# ============ GPS Data Schemas ============

class TrainingGPSDataBase(BaseModel):
    """Base schema for GPS training data."""
    player_id: UUID = Field(..., description="Player UUID")

    # Distance metrics
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

    duration_mins: Optional[float] = Field(None, description="Session duration in minutes")
    notes: Optional[str] = None


class TrainingGPSDataCreate(TrainingGPSDataBase):
    """Schema for creating GPS data."""
    session_id: UUID = Field(..., description="Training session UUID")


class TrainingGPSDataResponse(TrainingGPSDataBase):
    """Response schema for GPS data."""
    id: UUID
    session_id: UUID
    player_name: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class GPSDataBulkCreate(BaseModel):
    """Schema for bulk creating GPS data for a session."""
    session_id: UUID = Field(..., description="Training session UUID")
    records: list[TrainingGPSDataBase] = Field(..., description="List of player GPS records")


# ============ Weight Training Schemas ============

class WeightExerciseBase(BaseModel):
    """Base schema for a weight exercise."""
    exercise_name: str = Field(..., max_length=100, description="Exercise name")
    exercise_category: Optional[str] = Field(None, max_length=50, description="Exercise category")
    sets: int = Field(..., ge=1, description="Number of sets")
    reps_per_set: Optional[str] = Field(None, description="Reps per set (e.g., '8,8,6')")
    weight_kg: Optional[float] = Field(None, ge=0, description="Weight in kg")
    one_rep_max_estimate: Optional[float] = Field(None, description="Estimated 1RM")
    rpe: Optional[float] = Field(None, ge=1, le=10, description="Rate of Perceived Exertion")
    notes: Optional[str] = None


class WeightExerciseCreate(WeightExerciseBase):
    """Schema for creating a weight exercise."""
    pass


class WeightExerciseResponse(WeightExerciseBase):
    """Response schema for a weight exercise."""
    id: UUID
    weight_session_id: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class WeightTrainingSessionBase(BaseModel):
    """Base schema for weight training session."""
    player_id: UUID = Field(..., description="Player UUID")
    total_volume_kg: Optional[float] = Field(None, description="Total volume lifted")
    session_duration_mins: Optional[int] = Field(None, description="Session duration")
    notes: Optional[str] = None


class WeightTrainingSessionCreate(WeightTrainingSessionBase):
    """Schema for creating a weight training session."""
    session_id: UUID = Field(..., description="Training session UUID")
    exercises: list[WeightExerciseCreate] = Field(default=[], description="Exercises performed")


class WeightTrainingSessionResponse(WeightTrainingSessionBase):
    """Response schema for weight training session."""
    id: UUID
    session_id: UUID
    player_name: Optional[str] = None
    exercises: list[WeightExerciseResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True


# ============ Upload Schemas ============

class GPSUploadRequest(BaseModel):
    """Request schema for GPS data upload."""
    session_id: UUID = Field(..., description="Training session to link data to")
    filename: str = Field(..., description="Original filename")


class GPSUploadResponse(BaseModel):
    """Response schema for GPS upload."""
    upload_id: UUID
    status: str
    filename: str
    extracted_player_count: Optional[int] = None
    message: str


class GPSUploadStatus(BaseModel):
    """Status of a GPS upload."""
    id: UUID
    session_id: Optional[UUID]
    filename: str
    status: str
    extracted_player_count: Optional[int]
    error_message: Optional[str]
    created_at: datetime
    processed_at: Optional[datetime]


# ============ Analysis Schemas ============

class PlayerGPSTrend(BaseModel):
    """GPS trends for a player over time."""
    player_id: UUID
    player_name: str
    sessions_count: int
    avg_total_distance: float
    avg_max_speed: float
    avg_sprint_count: float
    distance_trend: str  # "improving", "declining", "stable"
    fitness_score: Optional[float] = None


class TeamGPSSummary(BaseModel):
    """Team-wide GPS summary for a session or time period."""
    session_count: int
    avg_team_distance: float
    avg_team_max_speed: float
    avg_team_sprints: float
    top_distance_players: list[dict]
    top_speed_players: list[dict]
    players_below_threshold: list[dict]  # Players who may need attention
