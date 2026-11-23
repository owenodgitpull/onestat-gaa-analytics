"""A ground and its measured pitch (Owen 2026-11-23, after Jim McGuinness saw the GPS dots a few metres out).

Entered once per club, then picked in match setup: the match takes the ground's pitch size, and the GPS placement uses
it (and the pitch's angle, when the corner flags have been read off a map). Club-private.
"""
import uuid
from datetime import datetime

from sqlalchemy import Column, String, Float, DateTime, ForeignKey, JSON, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class Stadium(Base):
    __tablename__ = "stadiums"
    __table_args__ = (UniqueConstraint("club_id", "name", name="uq_stadium_club_name"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(120), nullable=False)
    pitch_length_m = Column(Float, nullable=False)      # goal line to goal line
    pitch_width_m = Column(Float, nullable=False)       # sideline to sideline
    # optional: 2-4 corner flags [[lat, lon], ...] read off a map (two = both ends of one sideline). Gives the pitch's
    # angle exactly; without it the angle is read from the players' positions (within about a degree).
    corners = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
