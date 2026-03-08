"""
Set-Piece Routine model — club-level library of set-piece plays.

Stores pitch diagrams with player positions and movement arrows
for sideline plays, close-in frees, penalty setups, kickout routines, etc.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class SetPieceRoutine(Base):
    __tablename__ = "set_piece_routines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)

    name = Column(String(200), nullable=False)
    category = Column(String(50), nullable=False)  # attacking, defensive, kickout
    description = Column(Text, nullable=True)

    # JSON: list of elements — each is either a player dot or an arrow
    # Player dot: { "type": "player", "x": 45.2, "y": 60.1, "jerseyNumber": 14, "label": "CF" }
    # Arrow: { "type": "arrow", "points": [{"x": 45, "y": 60}, {"x": 55, "y": 40}], "color": "#10B981" }
    elements = Column(JSON, nullable=False, default=list)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
