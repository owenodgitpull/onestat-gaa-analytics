"""
Match model for storing GAA match information.

Represents a single match with opponent, date, venue, and final scores.
"""

import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Enum, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, Mapped
from app.database import Base
import enum

if TYPE_CHECKING:
    from app.models.match_event import MatchEvent
    from app.models.possession_event import PossessionEvent
    from app.models.player_match_stats import PlayerMatchStats
    from app.models.match_gps import MatchGPSData


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


class WeatherCondition(enum.Enum):
    """Weather conditions during the match."""
    SUNNY = "sunny"
    CLOUDY = "cloudy"
    OVERCAST = "overcast"
    LIGHT_RAIN = "light_rain"
    HEAVY_RAIN = "heavy_rain"
    WINDY = "windy"
    COLD = "cold"
    FOGGY = "foggy"


class PitchCondition(enum.Enum):
    """Pitch/ground condition."""
    EXCELLENT = "excellent"  # Perfect playing surface
    GOOD = "good"  # Normal conditions
    SOFT = "soft"  # Slightly soft underfoot
    HEAVY = "heavy"  # Waterlogged/very soft
    HARD = "hard"  # Dry and firm
    FROZEN = "frozen"  # Icy/frozen ground


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

    # Live match phase tracking (for resumable recording)
    current_phase: Column[Optional[str]] = Column(String(20), nullable=True)  # 'first_half', 'half_time', 'second_half'
    second_half_started_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    attacking_right_first_half: Column[Optional[bool]] = Column(Boolean, nullable=True)  # True = Dungloe attacks right in 1st half
    
    # Optional notes
    notes: Column[Optional[str]] = Column(String, nullable=True)

    # Weather and pitch conditions (for pattern analysis)
    weather_condition: Column[Optional[WeatherCondition]] = Column(Enum(WeatherCondition), nullable=True)
    pitch_condition: Column[Optional[PitchCondition]] = Column(Enum(PitchCondition), nullable=True)
    temperature_celsius: Column[Optional[int]] = Column(Integer, nullable=True)  # Temperature in Celsius
    wind_speed_kmh: Column[Optional[int]] = Column(Integer, nullable=True)  # Wind speed in km/h

    # AI-generated post-match analysis (generated when match completes)
    ai_analysis: Column[Optional[str]] = Column(Text, nullable=True)
    ai_analysis_generated_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)

    # GPS analysis tracking (for re-analysis when GPS data is uploaded post-match)
    ai_analysis_version: Column[int] = Column(Integer, default=1, nullable=False)
    gps_analysis_included: Column[bool] = Column(Boolean, default=False, nullable=False)

    # Soft delete
    is_deleted: Column[bool] = Column(Boolean, default=False, nullable=False)
    
    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    events = relationship(
        "MatchEvent",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )
    
    possession_events = relationship(
        "PossessionEvent",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )
    
    player_stats = relationship(
        "PlayerMatchStats",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    lineup = relationship(
        "MatchLineup",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    gps_data = relationship(
        "MatchGPSData",
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

