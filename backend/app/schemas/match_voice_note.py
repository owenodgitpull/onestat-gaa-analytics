"""Schemas for match voice note endpoints."""

from pydantic import BaseModel, Field
from datetime import datetime
from uuid import UUID
from typing import Optional, List


class MatchVoiceNoteCreate(BaseModel):
    match_id: UUID
    text: str = Field(..., min_length=1, max_length=1000)
    half: Optional[int] = Field(None, ge=1, le=2)
    minute: Optional[int] = Field(None, ge=0, le=120)


class MatchVoiceNoteResponse(BaseModel):
    id: UUID
    match_id: UUID
    text: str
    half: Optional[int] = None
    minute: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True


class MatchVoiceNoteListResponse(BaseModel):
    notes: List[MatchVoiceNoteResponse]
    total: int
