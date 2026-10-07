"""
VideoSession model for tracking video analysis sessions.

Each session represents one video upload (typically one half of a match).
Supports multiple analysis modes: human tagging, Gemini full-video, keyframe pipeline.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, BigInteger, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class VideoSession(Base):
    """
    A video analysis session tied to a match.

    Status flow: pending → uploading → uploaded → processing → draft_ready
                 → review_in_progress → completed → failed (from any state)
    """
    __tablename__ = "video_sessions"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    club_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=False, index=True)

    # Session info
    title: Column[str] = Column(String(200), nullable=False)
    half: Column[Optional[int]] = Column(Integer, nullable=True)

    # Video file (stored in R2)
    video_r2_key: Column[Optional[str]] = Column(String(500), nullable=True)
    video_duration_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)
    video_size_bytes: Column[Optional[int]] = Column(BigInteger, nullable=True)
    halftime_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)
    first_half_start_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)
    second_half_start_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)
    # Match clock (ms) at first_half_start_ms. 0 = marked at the real throw-in;
    # >0 when the footage joins mid-match (e.g. TV clock already at 2:05).
    first_half_clock_offset_ms: Column[int] = Column(BigInteger, nullable=False, default=0, server_default="0")
    full_time_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Tracking-mode state: setup (none set) -> tracking (started, not completed)
    # -> edit (completed). tracking_progress_ms is a monotonic high-water mark
    # used to clamp forward-scrubbing while tracking is in progress, so events
    # are always logged in chronological order.
    tracking_started_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    tracking_completed_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)
    tracking_progress_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Processing status
    status: Column[str] = Column(String(30), nullable=False, default="pending")

    # AI analysis metadata
    ai_model_used: Column[Optional[str]] = Column(String(50), nullable=True)
    ai_events_generated: Column[Optional[int]] = Column(Integer, nullable=True)
    ai_events_accepted: Column[Optional[int]] = Column(Integer, nullable=True)

    # Review tracking
    reviewed_by_user_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at: Column[Optional[datetime]] = Column(DateTime, nullable=True)

    # Error tracking
    error_message: Column[Optional[str]] = Column(Text, nullable=True)

    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="video_sessions")
    events = relationship("VideoEvent", back_populates="video_session", lazy="selectin", cascade="all, delete-orphan")
    possession_chains = relationship("PossessionChain", back_populates="video_session", lazy="selectin", cascade="all, delete-orphan")
    ball_samples = relationship("BallPositionSample", back_populates="video_session", cascade="all, delete-orphan")
    reviewed_by = relationship("User", foreign_keys=[reviewed_by_user_id], lazy="selectin")

    def __repr__(self):
        return f"<VideoSession(id={self.id}, title='{self.title}', status='{self.status}')>"
