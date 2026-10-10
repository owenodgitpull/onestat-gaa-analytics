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
    HIT_POST = "hit_post"  # Shot hits the post or crossbar (on target, no score)
    
    # Turnovers - Opposition forced
    TURNOVER_LOST = "turnover_lost"  # Lost possession due to opposition pressure
    TURNOVER_WON = "turnover_won"  # Won possession back via tackle/pressure
    TACKLE_WON = "tackle_won"  # Won possession via a tackle specifically
    
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
    FREE_SHORT_PASS = "free_short_pass"  # Free played short/quick instead of a shot at goal
    FREE_HIGH_BALL = "free_high_ball"  # Free played long/high (contestable ball) instead of a shot at goal
    LONG_KICK_PASS = "long_kick_pass"  # Direct long kick to a team-mate (pitch_x/y = kicked from, end_x/y = landed)
    HIGH_BALL = "high_ball"  # Contestable high ball into a crowd (end_x/y = where it landed)
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
    # Who a kickout was aimed at — distinct from player_id (who ended up winning it,
    # which may differ on a break). Only meaningful on own_kickout_* events; optional,
    # captured via a non-blocking jersey tap during live recording (never required —
    # the pitch-position tap alone is always sufficient to complete a kickout event).
    kickout_target_player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)
    # Who came ON in a SUBSTITUTION event — player_id on that same event is
    # who came OFF. Only meaningful on event_type=SUBSTITUTION. Needed to
    # compute an accurate playing_minutes for substitutes (full match length
    # minus their entry minute) — previously only the outgoing player's
    # identity was captured structurally, the incoming player only ever
    # appeared in a free-text notes string.
    sub_in_player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)

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
    # Game-clock seconds at the moment of the tap (minute*60 + seconds as shown on the match clock). Lets the
    # phase/transition analysis time things to the second. NULL on rows recorded before 2026-10-10.
    match_clock_s: Column[Optional[int]] = Column(Integer, nullable=True)
    
    # Pitch coordinates (0-100 scale for percentage positioning)
    # x: 0 = Dungloe goal line, 100 = Opponent goal line
    # y: 0 = Left sideline, 100 = Right sideline
    pitch_x: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_y: Column[Optional[float]] = Column(Float, nullable=True)
    
    # Optional notes
    notes: Column[Optional[str]] = Column(String, nullable=True)

    # Opposition player name (for opponent scoring events)
    opponent_player_name: Column[Optional[str]] = Column(String(200), nullable=True)
    # Inter-county: the lineup player behind opponent_player_name (the text stays as the fallback / older rows)
    opposition_player_id = Column(UUID(as_uuid=True), ForeignKey("opposition_players.id", ondelete="SET NULL"), nullable=True, index=True)

    # Was the shot taken under defensive pressure — optional, human-tagged
    # (live recording's post-hoc "Under pressure?" pill, video tagging's
    # inline Scored/Missed-style toggle). None = not recorded, which the
    # xP formula treats as a neutral no-op, not "definitely not pressured" —
    # this preserves identical xP for every shot logged before this field
    # existed. See expected_points_service.py's PRESSURE_MULTIPLIER.
    under_pressure: Column[Optional[bool]] = Column(Boolean, nullable=True)

    # Which foot an opposition player's shot/key pass was taken with — 'L'/
    # 'R', optional, tagged via the same opposition name-chip banner used
    # for opponent_player_name (a further optional sub-step there, not a
    # separate flow).
    opposition_foot: Column[Optional[str]] = Column(String(1), nullable=True)

    # Where a long kick pass / high ball LANDED (pitch_x/pitch_y = where it was kicked from)
    end_x: Column[Optional[float]] = Column(Float, nullable=True)
    end_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Sub-type for unforced errors and fouls (e.g. 'stray_pass', 'pushing')
    sub_type: Column[Optional[str]] = Column(String(50), nullable=True)

    # Foul brought forward — when a free kick is advanced due to dissent,
    # interfering with set pieces, or breaching the Mark
    brought_forward: Column[bool] = Column(Boolean, default=False, nullable=False)
    brought_forward_reason: Column[Optional[str]] = Column(String(50), nullable=True)  # 'dissent', 'interfering_set_piece', 'breaching_mark'
    advanced_position_x: Column[Optional[float]] = Column(Float, nullable=True)
    advanced_position_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Which half this event occurred in (1 or 2)
    half: Column[Optional[int]] = Column(Integer, nullable=True)

    # Offline sync — client-generated UUID for idempotent deduplication
    client_event_id: Column[Optional[str]] = Column(String(64), nullable=True, index=True)

    # Timestamp
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="events")
    player = relationship("Player", foreign_keys=[player_id], lazy="selectin")
    assist_player = relationship("Player", foreign_keys=[assist_player_id], lazy="selectin")
    kickout_target_player = relationship("Player", foreign_keys=[kickout_target_player_id], lazy="selectin")
    sub_in_player = relationship("Player", foreign_keys=[sub_in_player_id], lazy="selectin")

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

