"""
PlayerChallenge model — AI-generated weekly challenges for players.

Each challenge tracks a specific metric with a target value over
a sliding window of matches/sessions. Status uses String(20) to
avoid asyncpg enum codec issues (same pattern as PlayerPosition).
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Float, Integer, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PlayerChallenge(Base):
    __tablename__ = "player_challenges"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=False, index=True)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(20), nullable=False)       # scoring / fitness / attendance / defence
    status = Column(String(20), nullable=False, default="active")  # active / completed / failed / expired

    metric_key = Column(String(50), nullable=False)      # e.g. "goals_from_play", "total_distance_m"
    target_value = Column(Float, nullable=False)
    current_value = Column(Float, nullable=False, default=0.0)
    evaluation_window = Column(Integer, nullable=False, default=3)  # "in next N matches/sessions"

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)

    # Relationships
    player = relationship("Player", backref="challenges", lazy="selectin")

    def __repr__(self):
        return f"<PlayerChallenge(title='{self.title}', status={self.status}, progress={self.current_value}/{self.target_value})>"
