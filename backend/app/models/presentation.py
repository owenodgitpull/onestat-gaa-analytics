"""
Presentation model — coach-built video/tactical decks for team meetings.

A club-wide library (NOT scoped to a single match) of slide decks, each
slide independently a video clip, tactical animation, or text card. Mirrors
how Framesports' reference slide-deck builder works — a coach pulls clips
from a shared library spanning any match into one deck (e.g. "our press
triggers all season"), rather than being confined to one match's video
session.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, BigInteger
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base

SLIDE_TYPES = {"clip", "animation", "text"}


class Presentation(Base):
    __tablename__ = "presentations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)

    title = Column(String(200), nullable=False)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    slides = relationship(
        "PresentationSlide",
        back_populates="presentation",
        lazy="selectin",
        cascade="all, delete-orphan",
        order_by="PresentationSlide.slide_order",
    )


class PresentationSlide(Base):
    __tablename__ = "presentation_slides"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    presentation_id = Column(UUID(as_uuid=True), ForeignKey("presentations.id", ondelete="CASCADE"), nullable=False, index=True)

    # Position in the deck. Named slide_order (not `order`) to sidestep the
    # SQL reserved word entirely rather than rely on SQLAlchemy's auto-quoting.
    slide_order = Column(Integer, nullable=False, default=0)
    slide_type = Column(String(20), nullable=False)  # one of SLIDE_TYPES

    # slide_type == "clip"
    video_session_id = Column(UUID(as_uuid=True), ForeignKey("video_sessions.id", ondelete="SET NULL"), nullable=True)
    clip_start_ms = Column(BigInteger, nullable=True)
    clip_end_ms = Column(BigInteger, nullable=True)
    # Denormalized display label (e.g. "High Ball — Conor Greene (v St Mary's)")
    # captured at add-time so Present mode and the deck list never need to
    # re-join VideoEvent/Player/Match just to show what a clip slide is.
    clip_label = Column(String(300), nullable=True)

    # slide_type == "animation" — references an existing club Set-Piece Routine,
    # rendered via the same PlaybackEngine Match Prep already uses.
    set_piece_routine_id = Column(UUID(as_uuid=True), ForeignKey("set_piece_routines.id", ondelete="SET NULL"), nullable=True)

    # slide_type == "text"
    text_title = Column(String(200), nullable=True)
    text_body = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    presentation = relationship("Presentation", back_populates="slides")
