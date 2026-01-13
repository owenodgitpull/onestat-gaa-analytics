"""
Pydantic schemas for Match data validation and serialization.

These schemas define the structure of API requests and responses for matches.
"""

from pydantic import BaseModel, Field, validator, field_validator
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from app.models.match import MatchVenue, MatchStatus


class MatchBase(BaseModel):
    """Base schema for Match data."""
    opponent: str = Field(..., min_length=1, max_length=100, description="Name of the opposing team")
    match_date: datetime = Field(..., description="Date and time of the match")
    venue: MatchVenue = Field(..., description="Match venue (home/away/neutral)")
    notes: Optional[str] = Field(None, max_length=1000, description="Optional match notes")
    
    @field_validator('match_date')
    @classmethod
    def remove_timezone(cls, v: datetime) -> datetime:
        """Remove timezone info to match database TIMESTAMP WITHOUT TIME ZONE."""
        if v and v.tzinfo is not None:
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
    dungloe_goals: Optional[int] = Field(None, ge=0)
    dungloe_points: Optional[int] = Field(None, ge=0)
    opponent_goals: Optional[int] = Field(None, ge=0)
    opponent_points: Optional[int] = Field(None, ge=0)
    notes: Optional[str] = Field(None, max_length=1000)


class MatchResponse(MatchBase):
    """Schema for match responses."""
    id: UUID
    status: MatchStatus
    dungloe_goals: int
    dungloe_points: int
    opponent_goals: int
    opponent_points: int
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    
    # Computed fields
    dungloe_total_score: int = Field(..., description="Total Dungloe score (goals*3 + points)")
    opponent_total_score: int = Field(..., description="Total opponent score (goals*3 + points)")
    result: str = Field(..., description="Match result: win/loss/draw/pending")

    class Config:
        from_attributes = True  # Allows creation from ORM models


class MatchStartRequest(BaseModel):
    """Schema for starting a match (changes status to IN_PROGRESS)."""
    started_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Match start time")


class MatchCompleteRequest(BaseModel):
    """Schema for completing a match (changes status to COMPLETED)."""
    completed_at: Optional[datetime] = Field(default_factory=datetime.utcnow, description="Match completion time")
    notes: Optional[str] = Field(None, max_length=1000, description="Post-match notes")


class MatchScoreUpdate(BaseModel):
    """Schema for quickly updating match scores."""
    dungloe_goals: int = Field(..., ge=0)
    dungloe_points: int = Field(..., ge=0)
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
    dungloe_possession_percentage: float
    opponent_possession_percentage: float
    
    # Shot stats
    dungloe_total_shots: int
    dungloe_scores: int
    dungloe_wides: int
    dungloe_accuracy: float
    
    opponent_total_shots: int
    opponent_scores: int
    opponent_wides: int
    opponent_accuracy: float
    
    # Turnover stats
    dungloe_turnovers_won: int
    dungloe_turnovers_lost: int
    opponent_turnovers_won: int
    opponent_turnovers_lost: int
    
    # Kickout stats
    dungloe_kickouts_won: int
    dungloe_kickouts_lost: int
    opponent_kickouts_won: int
    opponent_kickouts_lost: int
    
    # Card stats
    dungloe_yellow_cards: int
    dungloe_red_cards: int
    opponent_yellow_cards: int
    opponent_red_cards: int

