"""
Match model for storing GAA match information.

Represents a single match with opponent, date, venue, and final scores.
"""

import uuid
from datetime import datetime
from typing import List, Optional, TYPE_CHECKING
from sqlalchemy import Column, String, DateTime, Integer, Boolean, Enum, Text, ForeignKey, JSON, Float, and_
from sqlalchemy.ext.hybrid import hybrid_property
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


# Fixed dropdown of stage values (not free text — see Match.stage below).
# Kept as a plain ordered list rather than an enum column: a coach picking
# the wrong one is a UI mistake to fix by re-picking, not a data-integrity
# problem worth a migration to correct, and league fixtures legitimately
# have no stage at all (nullable).
MATCH_STAGE_OPTIONS = [
    "Preliminary Round",
    *[f"Round {i}" for i in range(1, 16)],  # league fixtures run a round per matchday, up to ~15 in a season
    "Group Stage",
    "Last 16",
    "Quarter-Final",
    "Semi-Final",
    "Final",
]


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

    # Multi-tenancy
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=True, index=True)

    # Match details
    opponent: Column[str] = Column(String, nullable=False, index=True)
    match_date: Column[datetime] = Column(DateTime, nullable=False, index=True)
    venue: Column[MatchVenue] = Column(Enum(MatchVenue), nullable=False)
    status: Column[MatchStatus] = Column(Enum(MatchStatus), default=MatchStatus.SCHEDULED, nullable=False)
    # True while the match is being tagged from video and hasn't been
    # "finished" — season stats / leaderboards skip it (see counts_in_stats).
    video_tagging_in_progress: Column[bool] = Column(Boolean, default=False, nullable=False, server_default="false")

    # Scores (updated as match progresses)
    team_goals: Column[int] = Column(Integer, default=0, nullable=False)
    team_points: Column[int] = Column(Integer, default=0, nullable=False)
    opponent_goals: Column[int] = Column(Integer, default=0, nullable=False)
    opponent_points: Column[int] = Column(Integer, default=0, nullable=False)
    
    # Timing
    started_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    completed_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)

    # Live match phase tracking (for resumable recording)
    current_phase: Column[Optional[str]] = Column(String(20), nullable=True)  # 'first_half', 'half_time', 'second_half'
    second_half_started_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    attacking_right_first_half: Column[Optional[bool]] = Column(Boolean, nullable=True)  # True = Dungloe attacks right in 1st half
    
    # Competition and referee (populated by fixture scraping or manual entry)
    competition: Column[Optional[str]] = Column(String(200), nullable=True)
    # Round/knockout stage within the competition (e.g. "Round 1",
    # "Quarter-Final") — kept separate from `competition` so a championship
    # stays one filterable identity across all its rounds instead of each
    # round being its own distinct competition string.
    stage: Column[Optional[str]] = Column(String(50), nullable=True)
    referee: Column[Optional[str]] = Column(String(200), nullable=True)

    # Optional notes
    notes: Column[Optional[str]] = Column(String, nullable=True)

    # Tactical notes for match prep (surfaced to Live Match Agent)
    tactical_notes: Column[Optional[str]] = Column(Text, nullable=True)

    # AI-generated opposition briefing (cached from streaming generation)
    opposition_briefing: Column[Optional[str]] = Column(Text, nullable=True)

    # Weather and pitch conditions (for pattern analysis)
    # weather_condition (singular) stays populated as the first entry of
    # weather_conditions below — kept in sync server-side purely so the
    # several existing single-icon weather badges around the app (Navigation,
    # match report, live recording badges) keep working unchanged. Any NEW
    # weather-aware code should read weather_conditions, not this field.
    weather_condition: Column[Optional[WeatherCondition]] = Column(Enum(WeatherCondition), nullable=True)
    # Full set of conditions logged for the match (e.g. ["windy", "light_rain"])
    # — real weather is combinatorial, so this is a list rather than adding an
    # ever-growing set of named combo values to the WeatherCondition enum.
    weather_conditions: Column[Optional[list]] = Column(JSON, nullable=True)
    pitch_condition: Column[Optional[PitchCondition]] = Column(Enum(PitchCondition), nullable=True)
    temperature_celsius: Column[Optional[int]] = Column(Integer, nullable=True)  # Temperature in Celsius
    wind_speed_kmh: Column[Optional[int]] = Column(Integer, nullable=True)  # Wind speed in km/h

    # Strip colours (hex, e.g. "#FF0000"). Secondary is the trim/hoop colour —
    # optional, many jerseys are a single solid colour and don't need one.
    team_strip_colour: Column[Optional[str]] = Column(String(7), nullable=True)
    team_strip_secondary_colour: Column[Optional[str]] = Column(String(7), nullable=True)
    opponent_strip_colour: Column[Optional[str]] = Column(String(7), nullable=True)
    opponent_strip_secondary_colour: Column[Optional[str]] = Column(String(7), nullable=True)

    # AI-generated post-match analysis (generated when match completes)
    ai_analysis: Column[Optional[str]] = Column(Text, nullable=True)
    ai_analysis_generated_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)

    # GPS analysis tracking (for re-analysis when GPS data is uploaded post-match)
    ai_analysis_version: Column[int] = Column(Integer, default=1, nullable=False)
    gps_analysis_included: Column[bool] = Column(Boolean, default=False, nullable=False)

    # Simple Scoring — when False, this match was recorded tap-only (no
    # continuous ball-drag tracking), so it has no territorial possession
    # or ball-carry/passing data. Shot maps, kickout charts, scoring
    # timeline and season stats are unaffected.
    precise_tracking_enabled: Column[bool] = Column(Boolean, default=True, nullable=False, server_default='true')

    # Chart insights (cached from analyze_match to avoid separate LLM call)
    chart_insights = Column(JSON, nullable=True)

    # GPS insights cache (avoids re-calling the LLM on every match-result page load)
    gps_insights = Column(JSON, nullable=True)
    gps_insights_fingerprint: Column[Optional[str]] = Column(String(64), nullable=True)
    gps_insights_generated_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)

    # Half duration in minutes (30 for clubs, 35 for inter-county)
    half_duration_mins: Column[int] = Column(Integer, default=30, nullable=False)

    # Optional real dimensions of this specific ground, in metres. GAA
    # regulation allows 130-145m x 80-90m, and real club grounds vary within
    # that — every pitch_x/y-derived distance calculation (Team Volume,
    # Orchestrator carry distance, xP, ball-carrier chains) assumes a fixed
    # 145x90m app-wide when these are null. Optional, set at match creation.
    pitch_length_m: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_width_m: Column[Optional[float]] = Column(Float, nullable=True)

    # Opposition roster (list of player names for opponent scoring attribution)
    opposition_roster = Column(JSON, nullable=True)

    # AI-fetched opponent form (from web search + Haiku parse). Stored as
    # {"results": [...], "fetched_at": "ISO", "dismissed": bool}
    ai_opponent_form = Column(JSON, nullable=True)

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

    video_sessions = relationship(
        "VideoSession",
        back_populates="match",
        lazy="selectin",
        cascade="all, delete-orphan"
    )

    def __repr__(self):
        score = f"{self.team_goals}-{self.team_points} vs {self.opponent_goals}-{self.opponent_points}"
        return f"<Match(id={self.id}, opponent='{self.opponent}', score='{score}', status='{self.status.value}')>"

    @hybrid_property
    def counts_in_stats(self) -> bool:
        """Completed AND not mid video-tagging — what season stats, charts and
        leaderboards should count."""
        return self.status == MatchStatus.COMPLETED and not self.video_tagging_in_progress

    @counts_in_stats.expression
    def counts_in_stats(cls):  # noqa: N805
        return and_(cls.status == MatchStatus.COMPLETED, cls.video_tagging_in_progress.is_(False))

    @property
    def team_total_score(self) -> int:
        """Calculate team's total score (goals worth 3 points)."""
        return (self.team_goals * 3) + self.team_points

    @property
    def opponent_total_score(self) -> int:
        """Calculate opponent's total score (goals worth 3 points)."""
        return (self.opponent_goals * 3) + self.opponent_points

    @property
    def result(self) -> str:
        """Get match result: 'win', 'loss', 'draw', or 'pending'."""
        if self.status != MatchStatus.COMPLETED:
            return "pending"

        team_total = self.team_total_score
        opponent_total = self.opponent_total_score

        if team_total > opponent_total:
            return "win"
        elif team_total < opponent_total:
            return "loss"
        else:
            return "draw"

