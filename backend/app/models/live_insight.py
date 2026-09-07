"""
Live Insight model for storing AI-generated insights during matches.

Stores tactical insights generated during live match recording,
triggered by time intervals and significant events.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSON
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class InsightTrigger(enum.Enum):
    """What triggered this insight."""
    INTERVAL = "interval"  # Regular 5-minute interval
    GOAL_SCORED = "goal_scored"  # Goal scored (either team)
    SCORING_RUN = "scoring_run"  # 3+ scores without reply
    SCORING_DROUGHT = "scoring_drought"  # 10+ minutes without score
    CARD_ISSUED = "card_issued"  # Yellow/Black/Red card
    SUBSTITUTION = "substitution"  # Player substitution
    HALF_TIME = "half_time"  # Half-time analysis
    TURNOVER_CRISIS = "turnover_crisis"  # 5+ turnovers in 10 mins
    MOMENTUM_SHIFT = "momentum_shift"  # Detected momentum change


class LiveInsight(Base):
    """
    SQLAlchemy model for Live Match Insights.

    Stores AI-generated tactical insights during a live match.
    Each insight has a trigger type and the minute it was generated.
    """
    __tablename__ = "live_insights"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign key to match
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    # When and why this insight was generated
    minute: Column[int] = Column(Integer, nullable=False)  # Match minute
    half: Column[int] = Column(Integer, nullable=False, default=1)  # 1 or 2
    trigger: Column[str] = Column(String(30), nullable=False)  # InsightTrigger.value — uses String to avoid asyncpg enum caching

    # The AI-generated insight text
    insight: Column[str] = Column(Text, nullable=False)

    # Optional context about what triggered it
    trigger_context: Column[Optional[str]] = Column(String, nullable=True)  # e.g., "Dungloe 3 scores without reply"

    # Player+concern combos this insight actually named, with the count in
    # effect at the time — e.g. [{"player_id": "...", "player_name": "Darren
    # Curran", "concern": "turnovers_lost", "count": 2}]. Lets the next
    # interval check suppress re-raising the same concern unless the count
    # has since gone up. See live_insights_service._compute_concern_snapshot.
    flagged_concerns: Column[Optional[list]] = Column(JSON, nullable=True)

    # Timestamp
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationship
    match = relationship("Match", backref="live_insights")

    def __repr__(self):
        return f"<LiveInsight(match_id={self.match_id}, minute={self.minute}, trigger={self.trigger})>"
