"""
Pydantic schemas for MatchEvent data validation and serialization.

These schemas define the structure of API requests and responses for match events.
"""

from pydantic import BaseModel, Field, validator, field_validator
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from app.models.match_event import EventType, Team


class MatchEventBase(BaseModel):
    """Base schema for MatchEvent data."""
    event_type: EventType = Field(..., description="Type of event (goal, point, turnover, etc.)")
    team: Team = Field(..., description="Which team (own/opponent)")
    player_id: Optional[UUID] = Field(None, description="Player who performed the action")
    assist_player_id: Optional[UUID] = Field(None, description="Player who assisted (for scores)")
    minute: Optional[int] = Field(None, ge=0, le=120, description="Minute of match (0-120)")
    pitch_x: Optional[float] = Field(None, ge=0, le=100, description="X coordinate (0=own goal, 100=opponent goal)")
    pitch_y: Optional[float] = Field(None, ge=0, le=100, description="Y coordinate (0=left, 100=right)")
    notes: Optional[str] = Field(None, max_length=500, description="Optional event notes")
    opponent_player_name: Optional[str] = Field(None, max_length=200, description="Opposition player name for opponent scoring events")
    sub_type: Optional[str] = Field(None, max_length=50, description="Sub-category (e.g. 'stray_pass' for unforced errors, 'pushing' for fouls)")

    @field_validator('event_type', mode='before')
    @classmethod
    def parse_event_type(cls, v):
        """Parse event_type by enum VALUE, not name."""
        if isinstance(v, str):
            # Try to find enum by value (e.g., "unforced_error")
            for member in EventType:
                if member.value == v.lower():
                    return member
            # If not found by value, try by name (e.g., "UNFORCED_ERROR")
            try:
                return EventType[v.upper()]
            except KeyError:
                raise ValueError(f"Invalid event_type: {v}")
        return v

    @field_validator('team', mode='before')
    @classmethod
    def parse_team(cls, v):
        """Parse team by enum VALUE, not name."""
        if isinstance(v, str):
            # Try to find enum by value (e.g., "dungloe")
            for member in Team:
                if member.value == v.lower():
                    return member
            # If not found by value, try by name (e.g., "DUNGLOE")
            try:
                return Team[v.upper()]
            except KeyError:
                raise ValueError(f"Invalid team: {v}")
        return v


class MatchEventCreate(MatchEventBase):
    """Schema for creating a new match event."""
    match_id: UUID = Field(..., description="Match this event belongs to")
    client_event_id: Optional[str] = Field(None, max_length=64, description="Client-generated UUID for offline deduplication")
    
    @validator('assist_player_id')
    def validate_assist(cls, v, values):
        """Ensure assist is only provided for scoring events."""
        if v is not None:
            event_type = values.get('event_type')
            scoring_events = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
            if event_type not in scoring_events:
                raise ValueError('Assists can only be recorded for scoring events')
        return v


class MatchEventUpdate(BaseModel):
    """Schema for updating an existing match event."""
    event_type: Optional[EventType] = None
    team: Optional[Team] = None
    player_id: Optional[UUID] = None
    assist_player_id: Optional[UUID] = None
    minute: Optional[int] = Field(None, ge=0, le=120)
    pitch_x: Optional[float] = Field(None, ge=0, le=100)
    pitch_y: Optional[float] = Field(None, ge=0, le=100)
    notes: Optional[str] = Field(None, max_length=500)


class MatchEventResponse(MatchEventBase):
    """Schema for match event responses."""
    id: UUID
    match_id: UUID
    created_at: datetime
    
    # Computed fields
    is_score: bool = Field(..., description="Whether this event resulted in a score")
    points_value: int = Field(..., description="Point value (0, 1, 2, or 3)")
    is_in_two_point_zone: bool = Field(..., description="Whether event occurred in 2-point zone")
    
    # Player details (if available)
    player_name: Optional[str] = Field(None, description="Name of player")
    assist_player_name: Optional[str] = Field(None, description="Name of assist player")

    class Config:
        from_attributes = True


class MatchEventListResponse(BaseModel):
    """Schema for paginated list of match events."""
    events: List[MatchEventResponse]
    total: int
    page: int
    page_size: int


class QuickScoreRequest(BaseModel):
    """
    Schema for quickly recording a score with current ball position.
    
    Used when user taps 'Goal' or 'Point' button during live match.
    The ball position is already set from possession tracking.
    """
    match_id: UUID
    event_type: EventType = Field(..., description="GOAL, POINT, or TWO_POINT")
    team: Team = Field(default=Team.OWN, description="Usually own team")
    player_id: UUID = Field(..., description="Who scored")
    assist_player_id: Optional[UUID] = Field(None, description="Who assisted (optional)")
    pitch_x: float = Field(..., ge=0, le=100, description="Current ball X position")
    pitch_y: float = Field(..., ge=0, le=100, description="Current ball Y position")
    minute: Optional[int] = Field(None, ge=0, le=120)
    
    @validator('event_type')
    def validate_score_type(cls, v):
        """Ensure event type is a scoring event."""
        if v not in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]:
            raise ValueError('QuickScore only for GOAL, POINT, or TWO_POINT events')
        return v


class QuickEventRequest(BaseModel):
    """
    Schema for quickly recording non-scoring events.
    
    Used for turnovers, kickouts, cards, etc. during live match.
    """
    match_id: UUID
    event_type: EventType = Field(..., description="Type of event")
    team: Team = Field(..., description="Which team")
    player_id: Optional[UUID] = Field(None, description="Player involved (optional)")
    pitch_x: Optional[float] = Field(None, ge=0, le=100)
    pitch_y: Optional[float] = Field(None, ge=0, le=100)
    minute: Optional[int] = Field(None, ge=0, le=120)

