"""
VideoEvent model for tracking individual events tagged from video analysis.

Uses String columns (not SQLEnum) following the PlayerPosition pattern to avoid
asyncpg enum type codec caching issues.

Supports 37 event types from the universal schema. Two-pointer tracking via
scoring_context JSON field — zone-based detection (DEF/MID/HF = outside 40m arc).
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, Boolean, ForeignKey, Integer, BigInteger, Text
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from app.database import Base


# --- Constants (not SQLEnum, used for validation only) ---

VIDEO_EVENT_TYPES = [
    "POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT", "POST_HIT", "GOAL_CHANCE",
    "KICKOUT_SHORT", "KICKOUT_LONG", "CATCH", "PICKUP",
    "PASS_HAND", "PASS_KICK", "SOLO_RUN", "MARK_CLAIMED",
    "BALL_WON", "TACKLE", "BLOCK_SHOT", "BLOCK_PASS",
    "INTERCEPTION", "HOOK", "SPOIL",
    "TURNOVER_WON", "TURNOVER_LOST",
    "FREE_KICK", "FORTY_FIVE", "SIDELINE_KICK", "SIDELINE_BALL", "PENALTY", "THROW_IN",
    "FOUL_COMMITTED", "YELLOW_CARD", "RED_CARD", "BLACK_CARD",
    "SUB_ON", "SUB_OFF",
    "HALF_TIME", "FULL_TIME", "INJURY_STOPPAGE", "WATER_BREAK",
    # Granular kickouts (own)
    "OWN_KICKOUT_WON", "OWN_KICKOUT_OPPOSITION_WON",
    "OWN_KICKOUT_WON_BREAK", "OWN_KICKOUT_OPPOSITION_WON_BREAK",
    # Granular kickouts (opp)
    "OPP_KICKOUT_WON", "OPP_KICKOUT_OPPOSITION_WON",
    "OPP_KICKOUT_WON_BREAK", "OPP_KICKOUT_OPPOSITION_WON_BREAK",
    # Unforced errors
    "OUR_UNFORCED_ERROR", "OPP_UNFORCED_ERROR",
    # Shot outcomes / defensive events the Video Tagging action bar emits
    # (previously rejected with a 422 — the event silently never saved)
    "SAVED", "HIT_POST", "TACKLE_WON",
    # Long balls (PASS_KICK is kept for older events and maps to LONG_KICK_PASS)
    "LONG_KICK_PASS", "HIGH_BALL",
]

PITCH_ZONES = [
    "DEF_LEFT", "DEF_CENTRE", "DEF_RIGHT",
    "MID_LEFT", "MID_CENTRE", "MID_RIGHT",
    "HF_LEFT", "HF_CENTRE", "HF_RIGHT",
    "FWD_LEFT", "FWD_CENTRE", "FWD_RIGHT",
    "IF_LEFT", "IF_CENTRE", "IF_RIGHT",
    "SQ_LEFT", "SQ_CENTRE", "SQ_RIGHT",
]

# Zones outside the 40m arc (two-pointer territory) — DEF, MID, HF rows
TWO_POINTER_ZONES = [
    "DEF_LEFT", "DEF_CENTRE", "DEF_RIGHT",
    "MID_LEFT", "MID_CENTRE", "MID_RIGHT",
    "HF_LEFT", "HF_CENTRE", "HF_RIGHT",
]

CONFIDENCE_LEVELS = ["HIGH", "MEDIUM", "LOW"]
EVENT_SOURCES = ["human_tag", "gemini_auto", "keyframe_auto"]
POSSESSION_TEAMS = ["team_a", "team_b", "contested", "dead_ball"]

SCORING_EVENT_TYPES = ["POINT_SCORED", "GOAL_SCORED", "FREE_KICK", "FORTY_FIVE", "PENALTY"]


class VideoEvent(Base):
    """
    An event tagged from video analysis.

    Each event has a video timestamp, pitch zone, optional player attribution,
    and context fields (scoring_context, kickout_context) stored as JSON.
    """
    __tablename__ = "video_events"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    video_session_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("video_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    # Event classification (String, not SQLEnum)
    event_type: Column[str] = Column(String(50), nullable=False, index=True)
    # Turnover reason/subtype — mirrors MatchEvent.sub_type. Populated by the
    # turnover-reason picker (Active Dispossession / Unforced Error /
    # Offensive Foul, each with their own subtype list — see
    # frontend/src/constants/turnoverSubtypes.ts) for parity with live
    # match recording's macro/micro turnover framework.
    sub_type: Column[Optional[str]] = Column(String(50), nullable=True)
    team: Column[str] = Column(String(20), nullable=False)  # team_a / team_b
    half: Column[int] = Column(Integer, nullable=False)

    # Timing
    match_minute: Column[int] = Column(Integer, nullable=False)
    match_second: Column[int] = Column(Integer, nullable=False, default=0)
    video_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True, index=True)

    # Location — zone-based (primary for video) + continuous coords (backward compat)
    pitch_zone: Column[Optional[str]] = Column(String(20), nullable=True)
    pitch_x: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_y: Column[Optional[float]] = Column(Float, nullable=True)
    # Where a long kick pass / high ball landed (pitch_x/y = where it was kicked from)
    end_x: Column[Optional[float]] = Column(Float, nullable=True)
    end_y: Column[Optional[float]] = Column(Float, nullable=True)
    # Foul events only: the ref brought the free forward (mirrors MatchEvent.brought_forward*).
    # pitch_x/y = where the foul happened; advanced_position_x/y = where the free was taken.
    brought_forward: Column[bool] = Column(Boolean, default=False, nullable=False, server_default="false")
    brought_forward_reason: Column[Optional[str]] = Column(String(50), nullable=True)  # dissent | interfering_set_piece | breaching_mark
    advanced_position_x: Column[Optional[float]] = Column(Float, nullable=True)
    advanced_position_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Player attribution
    player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)
    # SUBSTITUTION only: player_id = who came off, sub_in_player_id = who
    # came on — mirrors MatchEvent.sub_in_player_id (added for the same
    # reason: computing accurate playing_minutes needs both identities).
    sub_in_player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True)
    # Scoring events only — mirrors MatchEvent.assist_player_id.
    assist_player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True)
    jersey_number: Column[Optional[int]] = Column(Integer, nullable=True)
    player_confidence: Column[Optional[str]] = Column(String(10), nullable=True)  # HIGH/MEDIUM/LOW
    event_confidence: Column[Optional[str]] = Column(String(10), nullable=True)   # HIGH/MEDIUM/LOW

    # Context JSON fields
    # scoring_context: {source, foot, under_pressure, distance_estimate, is_two_pointer}
    scoring_context: Column[Optional[dict]] = Column(JSON, nullable=True)
    # kickout_context: {direction, won_by, clean_catch}
    kickout_context: Column[Optional[dict]] = Column(JSON, nullable=True)

    # Possession chain link
    # The match_events row this tag was written to live (kept in step on
    # edit/delete). NULL = not written yet (e.g. unverified AI draft).
    match_event_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("match_events.id", ondelete="SET NULL"), nullable=True, index=True)

    possession_chain_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("possession_chains.id", ondelete="SET NULL"), nullable=True)
    possession_team: Column[Optional[str]] = Column(String(20), nullable=True)

    # Narrative
    description: Column[Optional[str]] = Column(Text, nullable=True)

    # Opposition player name for a score or a forced-turnover tag — mirrors
    # MatchEvent.opponent_player_name (we don't track a full opposition
    # roster, just the key players a manager enters in Match Prep).
    opponent_player_name: Column[Optional[str]] = Column(String(200), nullable=True)

    # AI batch tracking (for selective Improve Analysis re-runs)
    batch_index: Column[Optional[int]] = Column(Integer, nullable=True)

    # Source & verification
    source: Column[str] = Column(String(20), nullable=False, default="human_tag")
    is_verified: Column[bool] = Column(Boolean, default=False, nullable=False)

    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    video_session = relationship("VideoSession", back_populates="events")
    match = relationship("Match")
    player = relationship("Player", foreign_keys=[player_id], lazy="selectin")
    sub_in_player = relationship("Player", foreign_keys=[sub_in_player_id], lazy="selectin")
    assist_player = relationship("Player", foreign_keys=[assist_player_id], lazy="selectin")
    possession_chain = relationship("PossessionChain", back_populates="events")

    def __repr__(self):
        return f"<VideoEvent(id={self.id}, type='{self.event_type}', min={self.match_minute})>"

    @property
    def is_two_pointer(self) -> bool:
        """Check if this is a two-pointer based on scoring_context."""
        if self.scoring_context and isinstance(self.scoring_context, dict):
            return self.scoring_context.get("is_two_pointer", False)
        return False

    @property
    def is_scoring_event(self) -> bool:
        """Check if this event type is a scoring event."""
        return self.event_type in SCORING_EVENT_TYPES

    @staticmethod
    def zone_is_two_pointer(zone: Optional[str]) -> bool:
        """Check if a pitch zone is outside the 40m arc (two-pointer territory)."""
        return zone in TWO_POINTER_ZONES if zone else False
