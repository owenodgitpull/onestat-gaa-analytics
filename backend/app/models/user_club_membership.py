"""
UserClubMembership model — many-to-many between users and clubs.

Stores per-club role and player_id. The User model's club_id, role,
and player_id are denormalized caches of the active membership.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class UserClubMembership(Base):
    __tablename__ = "user_club_memberships"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(50), nullable=False, default="player")
    player_id = Column(UUID(as_uuid=True), ForeignKey("players.id", ondelete="SET NULL"), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    joined_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("user_id", "club_id", name="uq_user_club"),
    )

    def __repr__(self) -> str:
        return f"<UserClubMembership(user={self.user_id}, club={self.club_id}, role='{self.role}')>"
