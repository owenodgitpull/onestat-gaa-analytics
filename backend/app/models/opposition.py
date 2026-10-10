"""
Opposition entities — private to the club that scouts them (inter-county teams only for now).

The opposition never logs in and is not a tenant, so they are NOT clubs. A club keeps its own light directory of the
teams it plays (`OppositionTeam`), the people on them (`OppositionPlayer`, surname only — data minimisation) and who
played in each fixture (`OppositionLineup`). This lets the season agent follow a team and its players across fixtures.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from app.database import Base


class OppositionTeam(Base):
    __tablename__ = "opposition_teams"
    __table_args__ = (UniqueConstraint("club_id", "name_key", name="uq_opposition_team_club_name"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    name_key = Column(String(200), nullable=False)   # normalised (lower-case, no punctuation) so "Tyrone GAA" == "tyrone"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class OppositionPlayer(Base):
    __tablename__ = "opposition_players"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    opposition_team_id = Column(UUID(as_uuid=True), ForeignKey("opposition_teams.id", ondelete="CASCADE"), nullable=False, index=True)
    surname = Column(String(100), nullable=False)
    surname_key = Column(String(100), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class OppositionLineup(Base):
    """Who played for the opposition in one match — same shape as MatchLineup (position slot, bench flag, jersey)."""
    __tablename__ = "opposition_lineup"
    __table_args__ = (UniqueConstraint("match_id", "position_id", name="uq_opposition_lineup_match_slot"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    match_id = Column(UUID(as_uuid=True), ForeignKey("matches.id", ondelete="CASCADE"), nullable=False, index=True)
    opposition_player_id = Column(UUID(as_uuid=True), ForeignKey("opposition_players.id", ondelete="CASCADE"), nullable=False, index=True)
    position_id = Column(String(20), nullable=False)       # 'gk', 'fb-left' ... 'sub-1' — same slot ids as our lineup
    jersey_number = Column(Integer, nullable=True)
    is_substitute = Column(Boolean, default=False, nullable=False)
    is_on_field = Column(Boolean, default=True, nullable=False)

    player = relationship("OppositionPlayer", lazy="joined")
