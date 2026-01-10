"""
Pydantic schemas for PlayerMatchStats data validation and serialization.

These schemas define the structure of API requests and responses for player match statistics.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID


class PlayerMatchStatsBase(BaseModel):
    """Base schema for PlayerMatchStats data."""
    # Playing time
    minutes_played: Optional[int] = Field(None, ge=0, le=120)
    started: bool = Field(default=False, description="Did player start the match")


class PlayerMatchStatsCreate(PlayerMatchStatsBase):
    """Schema for creating player match stats (usually done automatically)."""
    match_id: UUID
    player_id: UUID


class PlayerMatchStatsUpdate(BaseModel):
    """Schema for manually updating player match stats."""
    minutes_played: Optional[int] = Field(None, ge=0, le=120)
    started: Optional[bool] = None
    ai_insights: Optional[Dict[str, Any]] = Field(None, description="AI-generated insights (JSONB)")


class PlayerMatchStatsResponse(PlayerMatchStatsBase):
    """Schema for player match stats responses."""
    id: UUID
    match_id: UUID
    player_id: UUID
    player_name: str = Field(..., description="Player's name")
    
    # Scoring stats
    goals: int
    points: int
    two_pointers: int
    assists: int
    wides: int
    shots_short: int
    shots_saved: int
    
    # Possession stats
    turnovers_lost: int
    turnovers_won: int
    kickouts_won: int
    kickouts_lost: int
    breaking_balls_won: int
    
    # Defensive stats
    blocks: int
    interceptions: int
    
    # Discipline
    yellow_cards: int
    red_cards: int
    frees_won: int
    frees_conceded: int
    
    # Calculated metrics
    total_score: int
    accuracy: Optional[float]
    turnover_ratio: Optional[float]
    impact_score: float
    
    # AI insights
    ai_insights: Optional[Dict[str, Any]]
    
    # Timestamps
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PlayerMatchStatsListResponse(BaseModel):
    """Schema for list of player match stats (entire team for a match)."""
    stats: List[PlayerMatchStatsResponse]
    match_id: UUID
    total_players: int


class PlayerLeaderboard(BaseModel):
    """
    Schema for player leaderboard for a specific match.
    
    Shows top performers in various categories.
    """
    match_id: UUID
    
    top_scorers: List[Dict[str, Any]] = Field(..., description="Top scorers with {player, total_score}")
    most_assists: List[Dict[str, Any]] = Field(..., description="Most assists")
    best_accuracy: List[Dict[str, Any]] = Field(..., description="Best shooting accuracy")
    most_turnovers_won: List[Dict[str, Any]] = Field(..., description="Most turnovers won")
    highest_impact: List[Dict[str, Any]] = Field(..., description="Highest impact score")
    man_of_the_match: Optional[Dict[str, Any]] = Field(None, description="Overall best performer")

