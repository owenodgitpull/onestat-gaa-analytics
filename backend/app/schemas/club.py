"""
Pydantic schemas for Club data validation and serialization.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, List
from uuid import UUID


class ClubCreate(BaseModel):
    """Schema for creating a new club."""
    name: str = Field(..., min_length=1, max_length=200, description="Full club name")
    short_name: Optional[str] = Field(None, max_length=50, description="Short display name")
    county: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=50)
    home_ground: Optional[str] = Field(None, max_length=200)
    primary_colour: Optional[str] = Field(None, max_length=7, description="Hex colour code")
    secondary_colour: Optional[str] = Field(None, max_length=7, description="Hex colour code")


class ClubUpdate(BaseModel):
    """Schema for updating a club."""
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    short_name: Optional[str] = Field(None, max_length=50)
    county: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=50)
    home_ground: Optional[str] = Field(None, max_length=200)
    primary_colour: Optional[str] = Field(None, max_length=7)
    secondary_colour: Optional[str] = Field(None, max_length=7)
    logo_url: Optional[str] = Field(None, max_length=500)
    team_aliases: Optional[List[str]] = Field(None, description="Alternative team names (e.g. Irish name)")
    default_half_duration: Optional[int] = Field(None, ge=25, le=40, description="Default minutes per half")


class ClubResponse(BaseModel):
    """Schema for club responses."""
    id: UUID
    name: str
    short_name: Optional[str]
    county: Optional[str]
    province: Optional[str]
    home_ground: Optional[str]
    primary_colour: Optional[str]
    secondary_colour: Optional[str]
    logo_url: Optional[str]
    team_aliases: Optional[List[str]]
    is_active: bool
    onboarding_completed: bool
    default_half_duration: int = 30
    team_level: str = "club"
    features: dict = {}
    created_at: datetime

    class Config:
        from_attributes = True
