"""
SleepLog model — tracks nightly sleep for players.

Players log their own sleep via the player portal.
Unique per player per date (upsert-safe).
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, Integer, Float, String, Date, ForeignKey, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class SleepLog(Base):
    __tablename__ = "sleep_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    player_id = Column(
        UUID(as_uuid=True),
        ForeignKey("players.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    date = Column(Date, nullable=False)
    hours_slept = Column(Float, nullable=False)
    quality = Column(Integer, nullable=True)  # 1-5 scale
    notes = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("player_id", "date", name="uq_sleep_player_date"),
    )

    def __repr__(self):
        return f"<SleepLog(player_id={self.player_id}, date={self.date}, hours={self.hours_slept})>"
