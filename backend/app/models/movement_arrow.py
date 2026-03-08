"""
MovementArrow model — Tier 4 off-ball run arrows from video enrichment.

Represents directional player runs drawn during video review.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class MovementArrow(Base):
    __tablename__ = "movement_arrows"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[Optional[uuid.UUID]] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True, index=True)

    jersey_number: Column[Optional[int]] = Column(Integer, nullable=True)

    # Arrow path — JSON array of {x, y} points
    path_points: Column[Optional[list]] = Column(JSON, nullable=True, default=list)

    # Start/end for quick queries
    start_x: Column[Optional[float]] = Column(Float, nullable=True)
    start_y: Column[Optional[float]] = Column(Float, nullable=True)
    end_x: Column[Optional[float]] = Column(Float, nullable=True)
    end_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Label
    label: Column[Optional[str]] = Column(String(30), nullable=True)  # 'decoy_run', 'overlap', 'loop', 'diagonal', custom

    # Timing
    half: Column[Optional[int]] = Column(Integer, nullable=True)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)
    video_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    source: Column[str] = Column(String(20), nullable=False, default="video_enrichment")

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", lazy="selectin")
    player = relationship("Player", lazy="selectin")

    def __repr__(self):
        return f"<MovementArrow(id={self.id}, label='{self.label}', player={self.player_id})>"
