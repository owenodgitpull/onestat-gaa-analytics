"""
ScrapedFixture model for storing fixtures/results scraped from donegalgaa.ie.

Stores all scraped results — both Dungloe's games and other teams' games
(needed for opponent form lookups).
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Integer, Boolean, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class ScrapedFixture(Base):
    __tablename__ = "scraped_fixtures"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id"), nullable=True, index=True)

    home_team = Column(String(200), nullable=False, index=True)
    away_team = Column(String(200), nullable=False, index=True)
    match_date = Column(DateTime, nullable=False, index=True)
    competition = Column(String(200), nullable=True)
    venue = Column(String(200), nullable=True)
    referee = Column(String(200), nullable=True)

    # Scores — null means not yet played
    home_goals = Column(Integer, nullable=True)
    home_points = Column(Integer, nullable=True)
    away_goals = Column(Integer, nullable=True)
    away_points = Column(Integer, nullable=True)

    is_result = Column(Boolean, default=False, nullable=False)
    source_url = Column(String(500), nullable=True)
    scraped_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # SHA256 of home_team + away_team + match_date + competition — prevents duplicates
    external_hash = Column(String(64), unique=True, nullable=False, index=True)

    def __repr__(self):
        return f"<ScrapedFixture({self.home_team} vs {self.away_team}, {self.match_date})>"
