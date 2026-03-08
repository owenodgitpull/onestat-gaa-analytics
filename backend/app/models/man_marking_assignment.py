"""
Man Marking Assignment model — records which player marked which opponent.

Enables the Season Agent to build marking history:
e.g. "McCole has marked the opposition's top scorer in 6 matches —
held them to an average of 0-3."
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class ManMarkingAssignment(Base):
    __tablename__ = "man_marking_assignments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False)

    # Opposition player name (free text — we don't have their roster)
    opponent_player_name = Column(String(200), nullable=False)

    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    player = relationship("Player", lazy="selectin")
    match = relationship("Match", lazy="selectin")
