"""
Tactical Analysis Snapshot model.

Stores bird's-eye view snapshots from video analysis with
calibration data, detected players, and tactical annotations.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSON
from app.database import Base


class TacticalAnalysisSnapshot(Base):
    __tablename__ = "tactical_analysis_snapshots"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    video_session_id = Column(UUID(as_uuid=True), ForeignKey("video_sessions.id", ondelete="CASCADE"), nullable=True)
    video_timestamp_ms = Column(Integer, nullable=True)
    calibration_points = Column(JSON, nullable=True)
    homography_matrix = Column(JSON, nullable=True)
    detected_players = Column(JSON, nullable=True)
    annotations = Column(JSON, nullable=True)
    warped_image_key = Column(String(500), nullable=True)
    original_frame_key = Column(String(500), nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
