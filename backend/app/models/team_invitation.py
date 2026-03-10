"""
Team invitation model.

Tracks invitations to join a club/team. Supports accept/decline flow
with expiring tokens sent via email.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class TeamInvitation(Base):
    __tablename__ = "team_invitations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    inviter_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    invitee_email = Column(String(255), nullable=False)
    club_id = Column(UUID(as_uuid=True), ForeignKey("clubs.id", ondelete="CASCADE"), nullable=False)
    role = Column(String(50), nullable=False, default="club_admin")
    status = Column(String(20), nullable=False, default="pending")  # pending, accepted, declined, expired
    token = Column(String(64), unique=True, nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        Index("ix_invitation_email_club", "invitee_email", "club_id"),
    )

    @property
    def is_expired(self) -> bool:
        return self.status == "pending" and datetime.utcnow() > self.expires_at

    def __repr__(self):
        return f"<TeamInvitation(email={self.invitee_email}, club={self.club_id}, status={self.status})>"
