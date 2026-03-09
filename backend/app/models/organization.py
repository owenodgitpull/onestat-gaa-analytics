"""
Organization model for multi-team licensing.

An Organization is the billing entity that owns one or more clubs/teams.
Each org has a subscription tier determining how many teams are allowed.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


# Tier → max_teams mapping
TIER_LIMITS = {
    "free": 1,
    "club": 1,
    "pro": 3,
    "elite": 999,
}


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(200), nullable=False)
    owner_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    subscription_tier = Column(String(20), nullable=False, default="free")
    max_teams = Column(Integer, nullable=False, default=1)
    stripe_customer_id = Column(String(100), unique=True, nullable=True)
    stripe_subscription_id = Column(String(100), nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<Organization(name='{self.name}', tier='{self.subscription_tier}')>"
