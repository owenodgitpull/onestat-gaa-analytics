"""
MatchVoiceNote model — quick spoken reminders captured during live recording.

The mic button on the recording screen transcribes speech client-side (Web
Speech API — no audio is ever uploaded or stored) and saves just the resulting
text here, tagged with when it was said. Meant for exactly one thing: letting
whoever's recording flag a mistake the moment they notice it mid-action
("change turnover won for St Mary's at 21, not us") without breaking off to
fix it there and then — the note surfaces later so they can go make the
correction using the event edit UI once there's a lull.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class MatchVoiceNote(Base):
    __tablename__ = "match_voice_notes"

    id: Column[uuid.UUID] = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id: Column[uuid.UUID] = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)

    text: Column[str] = Column(String(1000), nullable=False)

    # Timing — when the note was taken, not when any mistake it refers to
    # happened (the transcript itself carries that, e.g. "at 21 min").
    half: Column[Optional[int]] = Column(Integer, nullable=True)
    minute: Column[Optional[int]] = Column(Integer, nullable=True)

    created_at: Column[datetime] = Column(DateTime, default=datetime.utcnow, nullable=False)

    match = relationship("Match", lazy="selectin")

    def __repr__(self):
        return f"<MatchVoiceNote(id={self.id}, minute={self.minute}, text='{self.text[:30]}...')>"
