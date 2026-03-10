"""
BallCarrierSegment model — Tier 1 player movement tracking.

Records who carried the ball, with timestamped path points.
Each segment represents one player's possession of the ball.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class BallCarrierSegment(Base):
    __tablename__ = "ball_carrier_segments"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    # Jersey number snapshot (historical accuracy — player may change numbers)
    jersey_number: Column[Optional[int]] = Column(Integer, nullable=True)

    # Carrier details
    team: Column[str] = Column(String(20), nullable=False)  # 'own' / 'opponent'
    half: Column[int] = Column(Integer, nullable=False)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)

    # Path — JSON array of {x, y} points (0-100 pitch coordinates)
    path_points: Column[Optional[list]] = Column(JSON, nullable=True, default=list)

    # Start/end positions
    start_x: Column[Optional[float]] = Column(Float, nullable=True)
    start_y: Column[Optional[float]] = Column(Float, nullable=True)
    end_x: Column[Optional[float]] = Column(Float, nullable=True)
    end_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Timing
    start_time_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)
    end_time_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # How the segment ended
    ended_by: Column[Optional[str]] = Column(String(30), nullable=True)  # 'pass', 'score', 'turnover', 'wide', 'free', 'kickout', 'manual'

    # Source tracking
    source: Column[str] = Column(String(20), nullable=False, default="live")  # 'live' / 'video_enrichment'
    video_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Offline sync — client-generated UUID for idempotent deduplication
    client_event_id: Column[Optional[str]] = Column(String(64), nullable=True, index=True)

    # Sequence within the match for ordering
    sequence_number: Column[int] = Column(Integer, nullable=False, default=0)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", lazy="selectin")
    player = relationship("Player", lazy="selectin")

    def __repr__(self):
        return f"<BallCarrierSegment(id={self.id}, player={self.player_id}, jersey={self.jersey_number})>"
