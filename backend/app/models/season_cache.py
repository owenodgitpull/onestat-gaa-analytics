"""
Season Cache model — stores cached AI outputs with data fingerprints.

Used to avoid re-running expensive AI calls (KPI insights, dashboard charts,
insight alerts) when the underlying data hasn't changed.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSON
from app.database import Base


class SeasonCache(Base):
    __tablename__ = "season_cache"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    cache_type = Column(String(50), nullable=False)  # "kpi_insights" | "dashboard_charts" | "insight_alerts"
    data_fingerprint = Column(String(64), nullable=False)  # SHA256 of data state
    cached_result = Column(JSON, nullable=True)
    cached_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("club_id", "cache_type", name="uq_season_cache_club_type"),
    )
