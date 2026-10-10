"""
Club model for multi-tenancy support.

Each club is a tenant in the system. All root models
(Player, Match, TrainingSession, etc.) belong to a club.
"""

import uuid
from datetime import datetime, timedelta
from sqlalchemy import Column, String, Boolean, DateTime, JSON, ForeignKey, Integer
from sqlalchemy.dialects.postgresql import UUID
from app.database import Base


class Club(Base):
    """
    Club model - Root tenant entity.

    Attributes:
        id: UUID primary key
        name: Full club name (e.g., "Dungloe GAA")
        short_name: Short display name (e.g., "Dungloe")
        county: County the club belongs to
        province: Province (Ulster, Munster, Leinster, Connacht)
        home_ground: Name of home grounds
        primary_colour: Hex colour code for primary kit colour
        secondary_colour: Hex colour code for secondary kit colour
        logo_url: URL/path to club logo image
        is_active: Whether the club is active
        onboarding_completed: Whether the club has finished onboarding
    """

    __tablename__ = "clubs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    name = Column(String(200), nullable=False)
    short_name = Column(String(50), nullable=True)
    county = Column(String(100), nullable=True)
    province = Column(String(50), nullable=True)
    home_ground = Column(String(200), nullable=True)
    primary_colour = Column(String(7), nullable=True)
    secondary_colour = Column(String(7), nullable=True)
    logo_url = Column(String(500), nullable=True)
    team_aliases = Column(JSON, nullable=True, default=list)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True, index=True)
    invite_code = Column(String(8), unique=True, nullable=True, index=True)
    is_active = Column(Boolean, default=True, nullable=False)
    onboarding_completed = Column(Boolean, default=False, nullable=False)
    default_half_duration = Column(Integer, default=30, nullable=False)
    # What kind of team this is: 'club' (default) or 'inter_county'. A domain fact set by platform admin; features are
    # derived from it in app/utils/features.py so no code branches on the raw value.
    team_level = Column(String(20), default="club", server_default="club", nullable=False)
    # Billing: NULL trial_ends_at = grandfathered (no restrictions). Set on new club creation.
    trial_ends_at = Column(DateTime, nullable=True)
    # 'club', 'pro', 'elite' = paid plan. NULL = on trial.
    subscription_tier = Column(String(20), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    @property
    def features(self) -> dict:
        from app.utils.features import features_for_level
        return features_for_level(self.team_level)

    def __repr__(self) -> str:
        return f"<Club(name='{self.name}', county='{self.county}')>"
