"""
PlaybookPush models — track plays pushed to player portals with view receipts.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Boolean, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class PlaybookPush(Base):
    __tablename__ = "playbook_pushes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    routine_id = Column(UUID(as_uuid=True), ForeignKey("set_piece_routines.id", ondelete="CASCADE"), nullable=False, index=True)
    pushed_by = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    message = Column(Text, nullable=True)  # optional coach's note
    is_revoked = Column(Boolean, default=False, nullable=False)
    version = Column(Integer, default=1, nullable=False)  # increments on re-push after edit

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    recipients = relationship("PlaybookPushRecipient", back_populates="push", cascade="all, delete-orphan")
    routine = relationship("SetPieceRoutine", lazy="selectin")


class PlaybookPushRecipient(Base):
    __tablename__ = "playbook_push_recipients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    push_id = Column(UUID(as_uuid=True), ForeignKey("playbook_pushes.id", ondelete="CASCADE"), nullable=False, index=True)
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="CASCADE"), nullable=False)

    viewed_at = Column(DateTime, nullable=True)
    view_count = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    push = relationship("PlaybookPush", back_populates="recipients", lazy="selectin")
    player = relationship("Player", lazy="selectin")
