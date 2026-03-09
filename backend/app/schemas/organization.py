"""
Pydantic schemas for Organization and multi-team operations.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from uuid import UUID


class OrganizationResponse(BaseModel):
    id: UUID
    name: str
    subscription_tier: str
    max_teams: int
    current_team_count: int = 0
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class ClubMembershipResponse(BaseModel):
    """A club the user belongs to, with their role in it."""
    club_id: UUID
    club_name: str
    club_short_name: Optional[str] = None
    club_logo_url: Optional[str] = None
    role: str
    is_active: bool


class SwitchClubRequest(BaseModel):
    club_id: UUID


class SwitchClubResponse(BaseModel):
    club_id: UUID
    role: str
    player_id: Optional[UUID] = None


class CreateTeamRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    short_name: Optional[str] = Field(None, max_length=50)
    county: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=50)
    primary_colour: Optional[str] = Field(None, max_length=7)
    secondary_colour: Optional[str] = Field(None, max_length=7)
