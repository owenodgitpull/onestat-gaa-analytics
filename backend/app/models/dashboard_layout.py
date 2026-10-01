"""
DashboardLayout model - stores dashboard chart order and layout preferences per club.
"""
from sqlalchemy import Column, UUID, ForeignKey, DateTime, func, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from app.database import Base
import uuid


class DashboardLayout(Base):
    __tablename__ = "dashboard_layout"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    layout_data = Column(JSONB, nullable=False)  # Stores the full layout JSON
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    updated_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("club_id", name="uq_dashboard_layout_club_id"),
    )
