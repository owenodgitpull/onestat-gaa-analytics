"""Pydantic schemas for Set-Piece Routine API."""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional, Any
from uuid import UUID

VALID_CATEGORIES = {"attacking", "defensive", "kickout"}


class SetPieceRoutineCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., description="attacking, defensive, or kickout")
    description: Optional[str] = None
    elements: list[Any] = Field(default_factory=list, description="Player dots and arrows")


class SetPieceRoutineUpdate(BaseModel):
    name: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = None
    description: Optional[str] = None
    elements: Optional[list[Any]] = None


class SetPieceRoutineResponse(BaseModel):
    id: UUID
    name: str
    category: str
    description: Optional[str]
    elements: list[Any]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
