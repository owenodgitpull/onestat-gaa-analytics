"""
BallPositionSample model — lightweight telemetry for continuous ball tracking.

Stores periodic position samples from the minimap during video tagging.
Used for territory charts and possession analytics.
"""

import uuid
from sqlalchemy import Column, Float, BigInteger, String, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class BallPositionSample(Base):
    __tablename__ = "ball_position_samples"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    video_session_id = Column(
        UUID(as_uuid=True),
        ForeignKey("video_sessions.id", ondelete="CASCADE"),
        nullable=False,
    )
    video_timestamp_ms = Column(BigInteger, nullable=False)
    pitch_x = Column(Float, nullable=False)       # 0-100
    pitch_y = Column(Float, nullable=False)       # 0-100
    possession_team = Column(String(20), nullable=False)  # 'team_a' or 'team_b'

    # Relationships
    video_session = relationship("VideoSession", back_populates="ball_samples")

    __table_args__ = (
        Index("ix_ball_samples_session_timestamp", "video_session_id", "video_timestamp_ms"),
    )
