"""
PossessionEvent model for tracking ball movement during a match.

Records every time the ball moves to a new area on the pitch.
Used to generate heat maps, possession stats, and flow diagrams.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, DateTime, Float, Integer, Enum, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class PossessionTeam(enum.Enum):
    """Which team has possession."""
    DUNGLOE = "dungloe"
    OPPONENT = "opponent"
    CONTESTED = "contested"  # Ball is loose/contested


class PossessionEvent(Base):
    """
    SQLAlchemy model for a Possession Event.
    
    Tracks ball movement on the pitch during a match.
    Simple tap/drag interface - user updates ball position as it moves.
    
    Coordinates stored as percentages (0-100) for easy scaling:
    - pitch_x: 0 = Dungloe goal line, 100 = Opponent goal line
    - pitch_y: 0 = Left sideline, 100 = Right sideline
    """
    __tablename__ = "possession_events"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Foreign key
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Possession details
    team: Column[PossessionTeam] = Column(Enum(PossessionTeam), nullable=False)
    
    # Timing (minutes and seconds into match)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)
    
    # Pitch coordinates (0-100 scale for percentage positioning)
    # x: 0 = Dungloe goal line, 100 = Opponent goal line
    # y: 0 = Left sideline, 100 = Right sideline (50 = center)
    pitch_x: Column[float] = Column(Float, nullable=False)
    pitch_y: Column[float] = Column(Float, nullable=False)
    
    # Duration (seconds) - how long ball stayed in this position
    # Calculated from time between this event and next event
    duration_seconds: Column[Optional[int]] = Column(Integer, nullable=True)
    
    # Timestamp
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="possession_events")

    def __repr__(self):
        return f"<PossessionEvent(id={self.id}, team='{self.team.value}', x={self.pitch_x:.1f}, y={self.pitch_y:.1f})>"

    @property
    def zone_name(self) -> str:
        """
        Get human-readable zone name based on coordinates.
        
        Zones (horizontal):
        - Own goal area (x: 0-7)
        - Own defense (x: 7-30)
        - Own midfield (x: 30-50)
        - Opposition midfield (x: 50-70)
        - Opposition attack (x: 70-93)
        - Opposition goal area (x: 93-100)
        
        Zones (vertical):
        - Left (y: 0-33)
        - Center (y: 33-67)
        - Right (y: 67-100)
        """
        # Determine horizontal zone
        if self.pitch_x <= 7:
            h_zone = "Own Goal Area"
        elif self.pitch_x <= 30:
            h_zone = "Own Defense"
        elif self.pitch_x <= 50:
            h_zone = "Own Midfield"
        elif self.pitch_x <= 70:
            h_zone = "Opposition Midfield"
        elif self.pitch_x <= 93:
            h_zone = "Opposition Attack"
        else:
            h_zone = "Opposition Goal Area"
        
        # Determine vertical zone
        if self.pitch_y <= 33:
            v_zone = "Left"
        elif self.pitch_y <= 67:
            v_zone = "Center"
        else:
            v_zone = "Right"
        
        return f"{h_zone} ({v_zone})"

    @property
    def is_in_two_point_zone(self) -> bool:
        """
        Check if position is in 2-point zone (40m+ from either goal).
        
        2-point zones:
        - For team attacking toward x=100: x < 60 (40m+ from opponent goal)
        - For team attacking toward x=0: x > 40 (40m+ from own goal)
        """
        # Midfield is always 2-point zone (x: 40-60)
        return 40 <= self.pitch_x <= 60

