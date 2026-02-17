"""
Pydantic schemas for club onboarding wizard.
"""

from pydantic import BaseModel, Field
from typing import Optional, List
from uuid import UUID


class ClubOnboardingCreate(BaseModel):
    """Schema for creating a club during onboarding (Step 1+2)."""
    name: str = Field(..., min_length=1, max_length=200)
    short_name: Optional[str] = Field(None, max_length=50)
    county: Optional[str] = Field(None, max_length=100)
    province: Optional[str] = Field(None, max_length=50)
    home_ground: Optional[str] = Field(None, max_length=200)
    primary_colour: Optional[str] = Field(None, max_length=7)
    secondary_colour: Optional[str] = Field(None, max_length=7)


class PlayerPreviewRow(BaseModel):
    """A single row from a parsed player file."""
    row_number: int
    name: str
    position: Optional[str] = None
    jersey_number: Optional[int] = None
    date_of_birth: Optional[str] = None
    warnings: List[str] = Field(default_factory=list)


class PlayerFilePreview(BaseModel):
    """Result of parsing a player CSV/XLSX file."""
    parsed_count: int
    valid_count: int
    warnings: List[str] = Field(default_factory=list)
    rows: List[PlayerPreviewRow]


class PlayerConfirmRow(BaseModel):
    """A player row confirmed by the user for bulk creation."""
    name: str = Field(..., min_length=1, max_length=100)
    position: Optional[str] = None
    jersey_number: Optional[int] = Field(None, ge=1, le=99)
    date_of_birth: Optional[str] = None


class PlayerBulkCreateRequest(BaseModel):
    """Request to bulk-create players from confirmed preview."""
    players: List[PlayerConfirmRow]


class PlayerBulkCreateResponse(BaseModel):
    """Response from bulk player creation."""
    created_count: int
    player_ids: List[str]
