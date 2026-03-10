"""
InsightAlert model for storing AI-generated cross-cutting pattern insights.

Persists proactive insights generated after GPS/match data uploads,
displayed on season and training dashboards.
"""

import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import Column, String, DateTime, Boolean, Text, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base
import enum


class AlertCategory(enum.Enum):
    WARNING = "warning"
    POSITIVE = "positive"
    TACTICAL = "tactical"
    WORKLOAD = "workload"


class AlertSource(enum.Enum):
    TRAINING_GPS = "training_gps"
    MATCH_GPS = "match_gps"
    MANUAL = "manual"
    VIDEO_SYNC = "video_sync"


class InsightAlert(Base):
    """
    AI-generated cross-cutting insight alert.

    Created automatically after GPS uploads when the AI detects
    noteworthy patterns across training and match data.
    """
    __tablename__ = "insight_alerts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=True, index=True)
    category = Column(Enum(AlertCategory), nullable=False)
    source = Column(Enum(AlertSource), nullable=False)
    title = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    severity = Column(String(20), nullable=False, default="info")  # info | watch | action

    # Optional links to source data
    session_id = Column(UUID(as_uuid=True), ForeignKey("training_sessions.id", ondelete="CASCADE"), nullable=True, index=True)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=True)

    # Which dashboard(s) to show on
    dashboard = Column(String(30), nullable=False, default="both")  # season | training | both

    # Dismissal
    is_dismissed = Column(Boolean, default=False, nullable=False)
    dismissed_at = Column(DateTime, nullable=True)

    # Timestamp
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    session = relationship("TrainingSession", backref="insight_alerts", lazy="selectin")
    match = relationship("Match", backref="insight_alerts", lazy="selectin")

    def __repr__(self):
        return f"<InsightAlert(title='{self.title}', category={self.category.value}, severity={self.severity})>"
