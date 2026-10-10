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
    competition: Optional[str] = Field(None, max_length=200, description="Competition name")
    stage: Optional[str] = Field(None, max_length=50, description="Round/knockout stage within the competition, e.g. Round 1, Quarter-Final")
    referee: Optional[str] = Field(None, max_length=200, description="Referee name")
    notes: Optional[str] = Field(None, max_length=1000, description="Optional match notes")
    tactical_notes: Optional[str] = Field(None, max_length=5000, description="Tactical notes for match day reference")
    half_duration_mins: Optional[int] = Field(30, ge=25, le=40, description="Minutes per half (30 for clubs, 35 for inter-county)")
    precise_tracking_enabled: bool = Field(True, description="False = Simple Scoring (tap-only, no territorial possession or ball-carry data)")
    # Optional real dimensions of this ground (GAA regulation: 130-145m x
    # 80-90m). When unset, every pitch-derived distance for this match uses
    # the app-wide 145x90m default.
    pitch_length_m: Optional[float] = Field(None, ge=100, le=160, description="Actual pitch length in metres, if known (GAA regulation 130-145m)")
    pitch_width_m: Optional[float] = Field(None, ge=60, le=100, description="Actual pitch width in metres, if known (GAA regulation 80-90m)")

    # Weather and pitch conditions (optional, for pattern analysis)
    weather_condition: Optional[WeatherCondition] = Field(None, description="Weather during match (legacy single value — auto-synced from weather_conditions[0])")
    weather_conditions: Optional[List[WeatherCondition]] = Field(None, description="Full set of weather conditions logged for the match, e.g. [windy, light_rain]")
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
    id: Optional[UUID] = Field(None, description="Client-provided UUID (for offline-created matches)")
    client_event_id: Optional[str] = Field(None, max_length=64, description="Client-generated UUID for offline deduplication")


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
    competition: Optional[str] = Field(None, max_length=200)
    stage: Optional[str] = Field(None, max_length=50)
    referee: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)
    tactical_notes: Optional[str] = Field(None, max_length=5000)
    half_duration_mins: Optional[int] = Field(None, ge=25, le=40)
    pitch_length_m: Optional[float] = Field(None, ge=100, le=160)
    pitch_width_m: Optional[float] = Field(None, ge=60, le=100)
    # NOTE: MatchUpdate does not inherit MatchBase, so precise_tracking_enabled
    # must be declared here explicitly too — the "Use Simple Scoring" button
    # PUTs this field via api.matches.update() and would otherwise be silently
    # dropped by the update endpoint.
    precise_tracking_enabled: Optional[bool] = Field(None, description="False = Simple Scoring (tap-only, no territorial possession or ball-carry data)")

    # Weather and pitch conditions
    weather_condition: Optional[WeatherCondition] = None
    weather_conditions: Optional[List[WeatherCondition]] = Field(None, description="Full set of weather conditions logged for the match")
    pitch_condition: Optional[PitchCondition] = None
    temperature_celsius: Optional[int] = Field(None, ge=-20, le=45)
    wind_speed_kmh: Optional[int] = Field(None, ge=0, le=150)

    # Strip colours (secondary = trim/hoop colour, optional)
    team_strip_colour: Optional[str] = Field(None, max_length=7)
    team_strip_secondary_colour: Optional[str] = Field(None, max_length=7)
    opponent_strip_colour: Optional[str] = Field(None, max_length=7)
    opponent_strip_secondary_colour: Optional[str] = Field(None, max_length=7)

    # Live match state — used to persist stoppage/resume across page refreshes
    current_phase: Optional[str] = Field(None, description="e.g. first_half, stopped_first_half:734, half_time, second_half")
    started_at: Optional[datetime] = None
    second_half_started_at: Optional[datetime] = None

    @field_validator('match_date', 'started_at', 'second_half_started_at', mode='before')
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
    # True while the match is being tagged from video and not yet finished
    video_tagging_in_progress: bool = False
    team_goals: int
    team_points: int
    opponent_goals: int
    opponent_points: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    # Competition and referee
    competition: Optional[str] = Field(None, description="Competition name")
    stage: Optional[str] = Field(None, description="Round/knockout stage within the competition")
    referee: Optional[str] = Field(None, description="Referee name")

    # Weather/pitch (inherited from MatchBase but explicitly listed for clarity)
    weather_condition: Optional[WeatherCondition] = None
    weather_conditions: Optional[List[WeatherCondition]] = None
    pitch_condition: Optional[PitchCondition] = None
    temperature_celsius: Optional[int] = None
    wind_speed_kmh: Optional[int] = None

    # Strip colours (secondary = trim/hoop colour, optional)
    team_strip_colour: Optional[str] = Field(None, description="Team strip colour hex")
    team_strip_secondary_colour: Optional[str] = Field(None, description="Team trim colour hex")
    opponent_strip_colour: Optional[str] = Field(None, description="Opponent strip colour hex")
    opponent_strip_secondary_colour: Optional[str] = Field(None, description="Opponent trim colour hex")

    # Tactical notes
    tactical_notes: Optional[str] = Field(None, description="Tactical notes for match day reference")
    half_duration_mins: int = Field(30, description="Minutes per half (30 for clubs, 35 for inter-county)")
    pitch_length_m: Optional[float] = Field(None, description="Actual pitch length in metres, if known")
    pitch_width_m: Optional[float] = Field(None, description="Actual pitch width in metres, if known")
    opposition_roster: Optional[list] = Field(None, description="List of opposition player names")
    opposition_team_id: Optional[UUID] = Field(None, description="Scouted opposition team (inter-county only)")
    opposition_lineup: Optional[list] = Field(None, description="Opposition lineup incl. subs (inter-county only; set by GET /matches/{id})")

    # AI analysis (generated when match completes)
    ai_analysis: Optional[str] = Field(None, description="AI-generated post-match analysis")
    ai_analysis_generated_at: Optional[datetime] = Field(None, description="When AI analysis was generated")

    # Live match phase tracking
    current_phase: Optional[str] = Field(None, description="Current match phase: first_half, half_time, second_half")
    second_half_started_at: Optional[datetime] = Field(None, description="When second half started")
    attacking_right_first_half: Optional[bool] = Field(None, description="True if own team attacks right in 1st half")

    # Data availability flags
    has_gps: bool = Field(False, description="Whether GPS data exists for this match")
    has_video: bool = Field(False, description="Whether video sessions exist")
    has_events: bool = Field(False, description="Whether manually recorded events exist")

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
    team_possession_count: int = 0
    opponent_possession_count: int = 0
    team_poss_converted_to_shots_pct: float = 0.0
    opponent_poss_converted_to_shots_pct: float = 0.0

    # Shot stats
    team_total_shots: int
    team_scores: int
    team_wides: int
    team_dropped_short: int = 0
    team_goal_chances: int = 0
    team_accuracy: float

    opponent_total_shots: int
    opponent_scores: int
    opponent_wides: int
    opponent_dropped_short: int = 0
    opponent_goal_chances: int = 0
    opponent_accuracy: float
    
    # Turnover stats
    team_turnovers_won: int
    team_turnovers_lost: int
    team_unforced_errors: int = 0
    opponent_turnovers_won: int
    opponent_turnovers_lost: int
    opponent_unforced_errors: int = 0
    
    # Kickout stats
    team_kickouts_won: int
    team_kickouts_lost: int
    opponent_kickouts_won: int
    opponent_kickouts_lost: int
    
    # Foul stats
    team_fouls: int = 0
    opponent_fouls: int = 0

    # Card stats
    team_yellow_cards: int
    team_black_cards: int = 0
    team_red_cards: int
    opponent_yellow_cards: int
    opponent_black_cards: int = 0
    opponent_red_cards: int

    # Ball recovery time (avg minutes to win back possession after losing it)
    team_ball_recovery_avg_min: Optional[float] = None
    opponent_ball_recovery_avg_min: Optional[float] = None

