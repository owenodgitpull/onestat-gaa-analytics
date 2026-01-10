"""
Pydantic schemas for Players API.

These schemas:
- Validate request/response data
- Provide automatic API documentation
- Enable type checking
- Serialize/deserialize data
"""

from pydantic import BaseModel, Field, field_validator
from datetime import date
from typing import Optional
from uuid import UUID
from app.models.player import PlayerStatus, PlayerPosition


class PlayerBase(BaseModel):
    """Base schema with common player fields."""
    name: str = Field(..., min_length=2, max_length=100, description="Player's full name")
    position: Optional[PlayerPosition] = Field(None, description="Primary playing position")
    jersey_number: Optional[int] = Field(None, ge=1, le=99, description="Jersey number (1-99)")
    date_of_birth: Optional[date] = Field(None, description="Date of birth for age calculation")
    status: PlayerStatus = Field(default=PlayerStatus.ACTIVE, description="Current availability status")
    
    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: str) -> str:
        """Validate name is not just whitespace."""
        if not v or not v.strip():
            raise ValueError('Name cannot be empty')
        return v.strip()


class PlayerCreate(PlayerBase):
    """Schema for creating a new player."""
    pass


class PlayerUpdate(BaseModel):
    """
    Schema for updating a player.
    
    All fields optional - only update what's provided.
    """
    name: Optional[str] = Field(None, min_length=2, max_length=100)
    position: Optional[PlayerPosition] = None
    jersey_number: Optional[int] = Field(None, ge=1, le=99)
    date_of_birth: Optional[date] = None
    status: Optional[PlayerStatus] = None
    active: Optional[bool] = None
    
    @field_validator('name')
    @classmethod
    def name_must_not_be_empty(cls, v: Optional[str]) -> Optional[str]:
        """Validate name if provided."""
        if v is not None and (not v or not v.strip()):
            raise ValueError('Name cannot be empty')
        return v.strip() if v else None


class PlayerResponse(PlayerBase):
    """
    Schema for player responses.
    
    Includes database-generated fields like ID.
    """
    id: UUID = Field(..., description="Unique player identifier")
    active: bool = Field(..., description="Whether player is active (soft delete flag)")
    
    class Config:
        from_attributes = True  # Allows creating from SQLAlchemy models


class PlayerDetail(PlayerResponse):
    """
    Extended player schema with additional calculated fields.
    
    Used for detailed player view with stats summary.
    """
    age: Optional[int] = Field(None, description="Current age calculated from DOB")
    
    # These will be populated from relationships/calculations
    total_fitness_tests: int = Field(0, description="Number of fitness tests completed")
    total_matches_played: int = Field(0, description="Number of matches played")
    current_season_goals: int = Field(0, description="Goals scored this season")
    current_season_points: int = Field(0, description="Points scored this season")


class PlayerListResponse(BaseModel):
    """
    Schema for paginated player list responses.
    
    Includes metadata for pagination.
    """
    players: list[PlayerResponse] = Field(..., description="List of players")
    total: int = Field(..., description="Total number of players")
    page: int = Field(..., description="Current page number")
    page_size: int = Field(..., description="Number of players per page")
    pages: int = Field(..., description="Total number of pages")

