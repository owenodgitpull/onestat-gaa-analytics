"""
KickoutPlay model — named kickout play library per club.

Allows teams to define and tag kickout plays during matches.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSON
from app.database import Base


class KickoutPlay(Base):
    __tablename__ = "kickout_plays"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)

    name: Column[str] = Column(String(100), nullable=False)
    description: Column[Optional[str]] = Column(String(500), nullable=True)

    # Optional diagram — JSON array of player positions/arrows
    diagram: Column[Optional[dict]] = Column(JSON, nullable=True)

    is_active: Column[bool] = Column(Boolean, default=True, nullable=False)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<KickoutPlay(id={self.id}, name='{self.name}')>"
