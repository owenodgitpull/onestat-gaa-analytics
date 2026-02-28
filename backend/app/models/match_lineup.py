"""
MatchLineup model for storing starting lineups and substitutes.

Records which players started the match and which were on the bench.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class MatchLineup(Base):
    """
    SQLAlchemy model for Match Lineup.

    Records the starting lineup and substitutes for a match.
    Tracks which position each player was assigned.
    """
    __tablename__ = "match_lineups"

    # Primary key
    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # Foreign keys
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False, index=True)

    # Position details
    position_id: Column[str] = Column(String, nullable=False)  # e.g. 'gk', 'fb-left', 'sub-1'
    is_substitute: Column[bool] = Column(Boolean, default=False, nullable=False)  # True if on bench
    is_on_field: Column[bool] = Column(Boolean, default=True, nullable=False)  # Current status during match
    jersey_number: Column[Optional[int]] = Column(Integer, nullable=True)  # Match-day override

    # Timestamps
    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    # Relationships
    match = relationship("Match", back_populates="lineup")
    player = relationship("Player", lazy="selectin")

    def __repr__(self):
        player_name = self.player.name if self.player else "Unknown"
        return f"<MatchLineup(match={self.match_id}, player='{player_name}', position='{self.position_id}')>"
