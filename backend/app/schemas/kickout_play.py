"""Schemas for kickout play library endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class KickoutPlayCreate(BaseModel):
    name: str = Field(..., max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    diagram: Optional[dict] = None


class KickoutPlayUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = Field(None, max_length=500)
    diagram: Optional[dict] = None
    is_active: Optional[bool] = None


class KickoutPlayResponse(BaseModel):
    id: UUID
    club_id: UUID
    name: str
    description: Optional[str] = None
    diagram: Optional[dict] = None
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class KickoutPlayListResponse(BaseModel):
    plays: List[KickoutPlayResponse]
    total: int
