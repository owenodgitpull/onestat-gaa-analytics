"""
TacticalTag model — tactical moment markers during a match.

Records moments like high press, blanket defence, formation changes.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class TacticalTag(Base):
    __tablename__ = "tactical_tags"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    # Tag details
    tag_type: Column[str] = Column(String(30), nullable=False)  # 'high_press', 'blanket_defence', 'formation_change', 'custom'
    label: Column[Optional[str]] = Column(String(100), nullable=True)  # Custom text for 'custom' type

    # Timing
    half: Column[int] = Column(Integer, nullable=False)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)
    # Game-clock seconds at the moment of the tap (minute*60 + seconds as shown on the match clock). Lets the
    # phase/transition analysis time things to the second. NULL on rows recorded before 2026-10-10.
    match_clock_s: Column[Optional[int]] = Column(Integer, nullable=True)
    timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Position on pitch (optional)
    pitch_x: Column[Optional[float]] = Column(Float, nullable=True)
    pitch_y: Column[Optional[float]] = Column(Float, nullable=True)

    # Source
    source: Column[str] = Column(String(20), nullable=False, default="live")
    video_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", lazy="selectin")

    def __repr__(self):
        return f"<TacticalTag(id={self.id}, type='{self.tag_type}', minute={self.minute})>"
