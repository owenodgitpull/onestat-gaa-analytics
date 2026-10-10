"""
PossessionEvent model for tracking ball movement during a match.

Records every time the ball moves to a new area on the pitch.
Used to generate heat maps, possession stats, and flow diagrams.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, DateTime, Float, Integer, String, ForeignKey, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class PossessionTeam(enum.Enum):
    """Which team has possession."""
    OWN = "own"
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
    team: Column[str] = Column(String(20), nullable=False)  # PossessionTeam values: own, opponent, contested
    
    # Timing (minutes and seconds into match)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)
    
    # Pitch coordinates (0-100 scale for percentage positioning)
    # x: 0 = Dungloe goal line, 100 = Opponent goal line
    # y: 0 = Left sideline, 100 = Right sideline (50 = center)
    # Nullable: Simple Scoring's "Possession Changed" button records a
    # possession change with no location step, so these events carry no
    # coordinates — team + duration_seconds are still valid and drive
    # possession % as normal, just not territorial breakdowns.
    pitch_x: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_y: Column[Optional[float]] = Column(Float, nullable=True)
    
    # Duration (seconds) - how long ball stayed in this position
    # Calculated from time between this event and next event
    duration_seconds: Column[Optional[int]] = Column(Integer, nullable=True)
    
    # Video Tagging only: the video time (ms) this point was recorded at — lets Undo to Point
    # remove the possession tracked after a chosen moment. NULL for Live Recording / older rows.
    video_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Game-clock seconds at the moment of the tap (minute*60 + seconds as shown on the match clock). Lets the
    # phase/transition analysis time things to the second. NULL on rows recorded before 2026-10-10.
    match_clock_s: Column[Optional[int]] = Column(Integer, nullable=True)

    # Offline sync — client-generated UUID for idempotent deduplication
    client_event_id: Column[Optional[str]] = Column(String(64), nullable=True, index=True)

    # Timestamp
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="possession_events")

    def __repr__(self):
        coords = f"x={self.pitch_x:.1f}, y={self.pitch_y:.1f}" if self.pitch_x is not None and self.pitch_y is not None else "no coords (Simple Scoring)"
        return f"<PossessionEvent(id={self.id}, team='{self.team}', {coords})>"

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
        - Opposition goal area (x: 95-100)

        Zones (vertical):
        - Left (y: 0-33)
        - Center (y: 33-67)
        - Right (y: 67-100)
        """
        # No coordinates (Simple Scoring possession-change events) — nothing to zone.
        if self.pitch_x is None or self.pitch_y is None:
            return "Unknown"

        # Determine horizontal zone (pitch-area coords: 0=goal, 100=opposite goal)
        if self.pitch_x <= 5:
            h_zone = "Own Goal Area"
        elif self.pitch_x <= 25:
            h_zone = "Own Defense"
        elif self.pitch_x <= 50:
            h_zone = "Own Midfield"
        elif self.pitch_x <= 75:
            h_zone = "Opposition Midfield"
        elif self.pitch_x <= 95:
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
        if self.pitch_x is None:
            return False

        # 2-point zone: outside both 40m arcs (pitch-area ~28% to ~72%)
        return 28 <= self.pitch_x <= 72

