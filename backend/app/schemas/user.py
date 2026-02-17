"""
Pydantic schemas for User data validation and serialization.
"""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from uuid import UUID


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: str
    club_id: Optional[UUID] = None
    role: str
    player_id: Optional[UUID] = None
    is_active: bool
    last_login_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


class UserUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    club_id: Optional[UUID] = None
    player_id: Optional[UUID] = None


class SetupProfileRequest(BaseModel):
    """Request to set user's club after onboarding or joining."""
    club_id: UUID
    name: Optional[str] = Field(None, max_length=200)
