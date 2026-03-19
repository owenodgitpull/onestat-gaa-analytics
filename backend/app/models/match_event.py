"""
MatchEvent model for tracking individual actions during a match.

Records every significant event: goals, points, turnovers, kickouts, etc.
Includes player attribution and exact pitch coordinates.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, Boolean, Enum, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class EventType(enum.Enum):
    """Types of events that can occur during a match."""
    GOAL = "goal"  # Goal scored (3 points)
    POINT = "point"  # Point scored (1 point)
    TWO_POINT = "two_point"  # Point from 40m+ (2 points)
    WIDE = "wide"  # Shot that goes wide
    SHORT = "short"  # Shot that falls short
    SAVED = "saved"  # Shot saved by goalkeeper
    
    # Turnovers - Opposition forced
    TURNOVER_LOST = "turnover_lost"  # Lost possession due to opposition pressure
    TURNOVER_WON = "turnover_won"  # Won possession back via tackle/pressure
    
    # Unforced Errors - Own mistakes (NO opposition pressure)
    UNFORCED_ERROR = "unforced_error"  # Player's own mistake (drop, bad pass)
    
    # Kickouts (legacy simplified types — kept for backward compat with old data)
    KICKOUT_WON = "kickout_won"
    KICKOUT_LOST = "kickout_lost"
    BREAKING_BALL_WON = "breaking_ball_won"
    BREAKING_BALL_LOST = "breaking_ball_lost"

    # Kickouts (detailed — own kickout = our team kicking out)
    OWN_KICKOUT_WON = "own_kickout_won"
    OWN_KICKOUT_OPPOSITION_WON = "own_kickout_opposition_won"
    OWN_KICKOUT_WON_BREAK = "own_kickout_won_break"
    OWN_KICKOUT_OPPOSITION_WON_BREAK = "own_kickout_opposition_won_break"
    # Kickouts (detailed — opp kickout = Opposition kicking out)
    OPP_KICKOUT_WON = "opp_kickout_won"
    OPP_KICKOUT_OPPOSITION_WON = "opp_kickout_opposition_won"
    OPP_KICKOUT_WON_BREAK = "opp_kickout_won_break"
    OPP_KICKOUT_OPPOSITION_WON_BREAK = "opp_kickout_opposition_won_break"
    # Kickout over sideline (kicking team loses possession)
    OWN_KICKOUT_SIDELINE = "own_kickout_sideline"
    OPP_KICKOUT_SIDELINE = "opp_kickout_sideline"

    # Sideline ball (ball out of play — no automatic possession change)
    SIDELINE_BALL = "sideline_ball"

    # Cards
    YELLOW_CARD = "yellow_card"  # Player booked
    BLACK_CARD = "black_card"  # Player sin-binned (10 minutes)
    RED_CARD = "red_card"  # Player sent off
    
    # Frees
    FREE_WON = "free_won"  # Won a free kick
    FREE_CONCEDED = "free_conceded"  # Conceded a free kick
    POINT_FREE = "point_free"  # Point scored from free kick
    TWO_POINT_FREE = "two_point_free"  # 2-pointer scored from free kick
    WIDE_FREE = "wide_free"  # Free kick went wide
    FORTY_FIVE = "forty_five"  # 45m free kick scored (always 1 point)
    FORTY_FIVE_MISSED = "forty_five_missed"  # 45m free kick missed
    PENALTY_GOAL = "penalty_goal"  # Penalty scored (counts as goal = 3 points)
    PENALTY_MISS = "penalty_miss"  # Penalty missed (wide/saved)
    FOUL_COMMITTED = "foul_committed"  # Player committed a foul
    FOUL_WON = "foul_won"  # Player was fouled

    # Defensive
    BLOCK = "block"  # Blocked shot/pass
    INTERCEPTION = "interception"  # Intercepted pass

    # Substitutions
    SUBSTITUTION = "substitution"  # Player substitution

    OTHER = "other"  # Other event type


class Team(enum.Enum):
    """Which team the event belongs to."""
    OWN = "own"
    OPPONENT = "opponent"


class MatchEvent(Base):
    """
    SQLAlchemy model for a Match Event.
    
    Records every significant action during a match with:
    - Event type (goal, point, turnover, etc.)
    - Player attribution (who did it)
    - Assist attribution (who assisted)
    - Exact pitch coordinates
    - Timestamp during match
    """
    __tablename__ = "match_events"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    
    # Foreign keys
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)
    assist_player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # Event details
    # Use values_callable to ensure SQLAlchemy uses enum VALUES (lowercase) not NAMES (uppercase)
    event_type: Column[EventType] = Column(
        Enum(EventType, values_callable=lambda x: [e.value for e in x]),
        nullable=False, 
        index=True
    )
    team: Column[Team] = Column(
        Enum(Team, values_callable=lambda x: [e.value for e in x]),
        nullable=False
    )
    
    # Timing (minutes and seconds into match)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)  # e.g., 23 for 23rd minute
    
    # Pitch coordinates (0-100 scale for percentage positioning)
    # x: 0 = Dungloe goal line, 100 = Opponent goal line
    # y: 0 = Left sideline, 100 = Right sideline
    pitch_x: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_y: Column[Optional[float]] = Column(Float, nullable=True)
    
    # Optional notes
    notes: Column[Optional[str]] = Column(String, nullable=True)

    # Opposition player name (for opponent scoring events)
    opponent_player_name: Column[Optional[str]] = Column(String(200), nullable=True)

    # Offline sync — client-generated UUID for idempotent deduplication
    client_event_id: Column[Optional[str]] = Column(String(64), nullable=True, index=True)

    # Timestamp
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="events")
    player = relationship("Player", foreign_keys=[player_id], lazy="selectin")
    assist_player = relationship("Player", foreign_keys=[assist_player_id], lazy="selectin")

    def __repr__(self):
        player_name = self.player.name if self.player else "Unknown"
        return f"<MatchEvent(id={self.id}, type='{self.event_type.value}', player='{player_name}')>"

    @property
    def is_score(self) -> bool:
        """Check if this event is a scoring event."""
        return self.event_type in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]

    @property
    def points_value(self) -> int:
        """Get the point value of this event."""
        if self.event_type == EventType.GOAL:
            return 3
        elif self.event_type == EventType.TWO_POINT:
            return 2
        elif self.event_type == EventType.POINT:
            return 1
        else:
            return 0

    @property
    def is_in_two_point_zone(self) -> bool:
        """
        Check if event occurred in 2-point zone (40m+ from goal).
        
        Pitch coordinates: x from 0-100 (0 = Dungloe goal, 100 = opponent goal)
        40m from goal ≈ 40% from either end
        
        Pitch-area coords: 0=goal line, 100=opposite goal
        40m arc at centerline ≈ 27.7% from each goal

        For Dungloe attacking toward x=100:
        - 2-point zone if x < 72.3 (outside 40m arc)

        For opponent attacking toward x=0:
        - 2-point zone if x > 27.7 (outside 40m arc)
        """
        if self.pitch_x is None:
            return False

        if self.team == Team.OWN:
            # Own team attacking toward x=100
            # 2-point if shooting from outside 40m arc
            return self.pitch_x < 72.3
        else:
            # Opponent attacking toward x=0
            # 2-point if shooting from outside 40m arc
            return self.pitch_x > 27.7

