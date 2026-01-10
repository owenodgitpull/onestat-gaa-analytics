"""
Match model for storing GAA match information.

Represents a single match with opponent, date, venue, and final scores.
"""

import uuid
from datetime import datetime
from typing import List, Optional
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class MatchVenue(enum.Enum):
    """Venue type for the match."""
    HOME = "home"
    AWAY = "away"
    NEUTRAL = "neutral"


class MatchStatus(enum.Enum):
    """Current status of the match."""
    SCHEDULED = "scheduled"  # Not started yet
    IN_PROGRESS = "in_progress"  # Currently being played
    COMPLETED = "completed"  # Finished
    CANCELLED = "cancelled"  # Cancelled


class Match(Base):
    """
    SQLAlchemy model for a GAA Match.
    
    Stores basic match information including opponent, scores, and timing.
    Related to MatchEvent for individual actions and PossessionEvent for ball tracking.
    """
    __tablename__ = "matches"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Match details
    opponent: Column[str] = Column(String, nullable=False, index=True)
    match_date: Column[datetime] = Column(DateTime, nullable=False, index=True)
    venue: Column[MatchVenue] = Column(Enum(MatchVenue), nullable=False)
    status: Column[MatchStatus] = Column(Enum(MatchStatus), default=MatchStatus.SCHEDULED, nullable=False)
    
    # Scores (updated as match progresses)
    dungloe_goals: Column[int] = Column(Integer, default=0, nullable=False)
    dungloe_points: Column[int] = Column(Integer, default=0, nullable=False)
    opponent_goals: Column[int] = Column(Integer, default=0, nullable=False)
    opponent_points: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Timing
    started_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    completed_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    
    # Optional notes
    notes: Column[Optional[str]] = Column(String, nullable=True)
    
    # Soft delete
    is_deleted: Column[bool] = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    events: List["MatchEvent"] = relationship(
        "MatchEvent",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )
    
    possession_events: List["PossessionEvent"] = relationship(
        "PossessionEvent",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )
    
    player_stats: List["PlayerMatchStats"] = relationship(
        "PlayerMatchStats",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        score = f"{self.dungloe_goals}-{self.dungloe_points} vs {self.opponent_goals}-{self.opponent_points}"
        return f"<Match(id={self.id}, opponent='{self.opponent}', score='{score}', status='{self.status.value}')>"

    @property
    def dungloe_total_score(self) -> int:
        """Calculate Dungloe's total score (goals worth 3 points)."""
        return (self.dungloe_goals * 3) + self.dungloe_points

    @property
    def opponent_total_score(self) -> int:
        """Calculate opponent's total score (goals worth 3 points)."""
        return (self.opponent_goals * 3) + self.opponent_points

    @property
    def result(self) -> str:
        """Get match result: 'win', 'loss', 'draw', or 'pending'."""
        if self.status != MatchStatus.COMPLETED:
            return "pending"
        
        dungloe_total = self.dungloe_total_score
        opponent_total = self.opponent_total_score
        
        if dungloe_total > opponent_total:
            return "win"
        elif dungloe_total < opponent_total:
            return "loss"
        else:
            return "draw"

