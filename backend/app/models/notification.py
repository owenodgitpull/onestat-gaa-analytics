"""
Notification model.

Tracks all notifications sent to users — push and in-app.
"""

import uuid
import enum
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, Enum, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSON
from app.database import Base


class NotificationType(str, enum.Enum):
    MATCH_REPORT = "match_report"
    GPS_UPLOADED = "gps_uploaded"
    LEADERBOARD_CHANGE = "leaderboard_change"
    TRAINING_REMINDER = "training_reminder"
    FITNESS_RESULTS = "fitness_results"
    WEEKLY_BRIEF = "weekly_brief"


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(Enum(NotificationType, values_callable=lambda x: [e.value for e in x]), nullable=False)
    title = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    data = Column(JSON, nullable=True)  # Extra payload (match_id, player_id, etc.)
    is_read = Column(Boolean, default=False, nullable=False)
    sent_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self):
        return f"<Notification(user_id={self.user_id}, type={self.type}, title='{self.title[:30]}')>"
