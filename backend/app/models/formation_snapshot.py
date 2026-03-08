"""
FormationSnapshot model — Tier 3 point-in-time player positions.

Captures where players are positioned at key moments (after scores, before kickouts, stoppages).
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, ForeignKey, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from app.database import Base


class FormationSnapshot(Base):
    __tablename__ = "formation_snapshots"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    # Timing context
    half: Column[int] = Column(Integer, nullable=False)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)
    timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    # Label for the snapshot
    label: Column[Optional[str]] = Column(String(50), nullable=True)  # 'Defensive Shape', 'Kickout Setup', 'Attacking Press', custom

    # Positions — JSON array of {player_id, jersey_number, x, y}
    positions: Column[Optional[list]] = Column(JSON, nullable=True, default=list)

    # Source tracking
    source: Column[str] = Column(String(20), nullable=False, default="live")
    video_timestamp_ms: Column[Optional[int]] = Column(BigInteger, nullable=True)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", lazy="selectin")

    def __repr__(self):
        count = len(self.positions) if self.positions else 0
        return f"<FormationSnapshot(id={self.id}, label='{self.label}', players={count})>"
