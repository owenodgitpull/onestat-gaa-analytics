"""
PossessionChain model for grouping sequential video events into possession sequences.

Links related events (e.g., kickout → catch → pass → solo → point) into a single
chain with outcome tracking.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Float, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PossessionChain(Base):
    """
    A sequence of events forming one possession.

    Tracks start/end zones, outcome, and basic stats (passes, solos, duration).
    """
    __tablename__ = "possession_chains"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    video_session_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("video_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    # Possession details
    team: Column[str] = Column(String(20), nullable=False)  # team_a / team_b
    start_zone: Column[Optional[str]] = Column(String(20), nullable=True)
    end_zone: Column[Optional[str]] = Column(String(20), nullable=True)
    outcome: Column[Optional[str]] = Column(String(30), nullable=True)  # score/wide/turnover/free_won/etc

    # Stats
    duration_seconds: Column[Optional[float]] = Column(Float, nullable=True)
    pass_count: Column[Optional[int]] = Column(Integer, nullable=True, default=0)
    solo_count: Column[Optional[int]] = Column(Integer, nullable=True, default=0)

    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    video_session = relationship("VideoSession", back_populates="possession_chains")
    events = relationship("VideoEvent", back_populates="possession_chain", lazy="selectin")

    def __repr__(self):
        return f"<PossessionChain(id={self.id}, team='{self.team}', outcome='{self.outcome}')>"
