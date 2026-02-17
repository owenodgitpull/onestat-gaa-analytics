"""
Pydantic schemas for Match data validation and serialization.

These schemas define the structure of API requests and responses for matches.
"""

from pydantic import BaseModel, Field, validator, field_validator
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from app.models.match import MatchVenue, MatchStatus, WeatherCondition, PitchCondition


class MatchBase(BaseModel):
    """Base schema for Match data."""
    opponent: str = Field(..., min_length=1, max_length=100, description="Name of the opposing team")
    match_date: datetime = Field(..., description="Date and time of the match")
    venue: MatchVenue = Field(..., description="Match venue (home/away/neutral)")
    notes: Optional[str] = Field(None, max_length=1000, description="Optional match notes")

    # Weather and pitch conditions (optional, for pattern analysis)
    weather_condition: Optional[WeatherCondition] = Field(None, description="Weather during match")
    pitch_condition: Optional[PitchCondition] = Field(None, description="Pitch/ground condition")
    temperature_celsius: Optional[int] = Field(None, ge=-20, le=45, description="Temperature in Celsius")
    wind_speed_kmh: Optional[int] = Field(None, ge=0, le=150, description="Wind speed in km/h")
    
    @field_validator('match_date', mode='before')
    @classmethod
    def remove_timezone(cls, v):
        """Remove timezone info to match database TIMESTAMP WITHOUT TIME ZONE."""
        if v is None:
            return v
        if isinstance(v, str):
            # Parse ISO string first
            v = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class MatchCreate(MatchBase):
    """Schema for creating a new match."""
    pass


class MatchUpdate(BaseModel):
    """Schema for updating an existing match."""
    opponent: Optional[str] = Field(None, min_length=1, max_length=100)
    match_date: Optional[datetime] = None
    venue: Optional[MatchVenue] = None
    status: Optional[MatchStatus] = None
    team_goals: Optional[int] = Field(None, ge=0)
    team_points: Optional[int] = Field(None, ge=0)
    opponent_goals: Optional[int] = Field(None, ge=0)
    opponent_points: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=1000)

    # Weather and pitch conditions
    weather_condition: Optional[WeatherCondition] = None
    pitch_condition: Optional[PitchCondition] = None
    temperature_celsius: Optional[int] = Field(None, ge=-20, le=45)
    wind_speed_kmh: Optional[int] = Field(None, ge=0, le=150)
    
    @field_validator('match_date', mode='before')
    @classmethod
    def remove_timezone(cls, v):
        """Remove timezone info to match database TIMESTAMP WITHOUT TIME ZONE."""
        if v is None:
            return v
        if isinstance(v, str):
            # Parse ISO string first
            v = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class MatchResponse(MatchBase):
    """Schema for match responses."""
    id: UUID
    status: MatchStatus
    team_goals: int
    team_points: int
    opponent_goals: int
    opponent_points: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    # Weather/pitch (inherited from MatchBase but explicitly listed for clarity)
    weather_condition: Optional[WeatherCondition] = None
    pitch_condition: Optional[PitchCondition] = None
    temperature_celsius: Optional[int] = None
    wind_speed_kmh: Optional[int] = None

    # AI analysis (generated when match completes)
    ai_analysis: Optional[str] = Field(None, description="AI-generated post-match analysis")
    ai_analysis_generated_at: Optional[datetime] = Field(None, description="When AI analysis was generated")

    # Live match phase tracking
    current_phase: Optional[str] = Field(None, description="Current match phase: first_half, half_time, second_half")
    second_half_started_at: Optional[datetime] = Field(None, description="When second half started")
    attacking_right_first_half: Optional[bool] = Field(None, description="True if own team attacks right in 1st half")

    # Computed fields
    team_total_score: int = Field(..., description="Total team score (goals*3 + points)")
    opponent_total_score: int = Field(..., description="Total opponent score (goals*3 + points)")
    result: str = Field(..., description="Match result: win/loss/draw/pending")

    class Config:
        from_attributes = True  # Allows creation from ORM models


class MatchStartRequest(BaseModel):
    """Schema for starting a match (changes status to IN_PROGRESS)."""
    started_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Match start time")
    
    @field_validator('started_at', mode='before')
    @classmethod
    def remove_timezone(cls, v):
        """Remove timezone info to match database TIMESTAMP WITHOUT TIME ZONE."""
        if v is None:
            return v
        if isinstance(v, str):
            # Parse ISO string first
            v = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class MatchCompleteRequest(BaseModel):
    """Schema for completing a match (changes status to COMPLETED)."""
    completed_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Match completion time")
    notes: Optional[str] = Field(None, max_length=1000, description="Post-match notes")
    
    @field_validator('completed_at', mode='before')
    @classmethod
    def remove_timezone(cls, v):
        """Remove timezone info to match database TIMESTAMP WITHOUT TIME ZONE."""
        if v is None:
            return v
        if isinstance(v, str):
            # Parse ISO string first
            v = datetime.fromisoformat(v.replace('Z', '+00:00'))
        if isinstance(v, datetime) and v.tzinfo is not None:
            return v.replace(tzinfo=None)
        return v


class MatchPhaseUpdate(BaseModel):
    """Schema for updating match phase (for resumable recording)."""
    phase: str = Field(..., description="Match phase: first_half, half_time, second_half")
    attacking_right_first_half: Optional[bool] = Field(None, description="True if team attacks right in 1st half")


class MatchScoreUpdate(BaseModel):
    """Schema for quickly updating match scores."""
    team_goals: int = Field(..., ge=0)
    team_points: int = Field(..., ge=0)
    opponent_goals: int = Field(..., ge=0)
    opponent_points: int = Field(..., ge=0)


class MatchListResponse(BaseModel):
    """Schema for paginated list of matches."""
    matches: List[MatchResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class MatchStatsResponse(BaseModel):
    """Schema for match statistics summary."""
    match_id: UUID
    
    # Possession stats
    team_possession_percentage: float
    opponent_possession_percentage: float
    
    # Shot stats
    team_total_shots: int
    team_scores: int
    team_wides: int
    team_accuracy: float
    
    opponent_total_shots: int
    opponent_scores: int
    opponent_wides: int
    opponent_accuracy: float
    
    # Turnover stats
    team_turnovers_won: int
    team_turnovers_lost: int
    opponent_turnovers_won: int
    opponent_turnovers_lost: int
    
    # Kickout stats
    team_kickouts_won: int
    team_kickouts_lost: int
    opponent_kickouts_won: int
    opponent_kickouts_lost: int
    
    # Card stats
    team_yellow_cards: int
    team_red_cards: int
    opponent_yellow_cards: int
    opponent_red_cards: int

