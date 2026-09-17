"""
VideoCompilation model — Phase 10. A downloadable single video file stitched
from tagged clips matching a player/event-type query ("show me Conor
Greene's wides this season"), built by the AI agent's
create_video_compilation tool.

Distinct from Presentations (Phase 11): a Presentation's clip slides never
create a new video file, they just play a trimmed range of the original
source live. This produces one real, standalone MP4 in R2 — needed for
something a coach can download and send directly (e.g. over WhatsApp),
which a Presentation deck can't do.
"""

import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Text, Integer, BigInteger, JSON, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class VideoCompilationStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class VideoCompilation(Base):
    __tablename__ = "video_compilations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    requested_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    title = Column(String(300), nullable=False)

    # Filters the request was built from — kept for display/debugging, not
    # re-queried at run time (see video_event_ids below).
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True)
    event_type = Column(String(50), nullable=True)

    # The exact set of VideoEvent ids resolved at request time, locked in
    # immediately rather than re-running the search when the background job
    # actually executes — so what gets compiled can never drift from what
    # the agent told the user it found, even if new events get tagged in
    # the meantime.
    video_event_ids = Column(JSON, nullable=False)
    clip_count = Column(Integer, nullable=False)

    status = Column(SQLEnum(VideoCompilationStatus), default=VideoCompilationStatus.PENDING, nullable=False, index=True)
    output_r2_key = Column(String(500), nullable=True)
    output_duration_ms = Column(BigInteger, nullable=True)
    error_message = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    completed_at = Column(DateTime, nullable=True)
