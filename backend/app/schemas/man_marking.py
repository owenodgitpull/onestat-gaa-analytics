"""Pydantic schemas for Man Marking Assignment API."""

from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional
from uuid import UUID


class ManMarkingAssignmentCreate(BaseModel):
    player_id: UUID = Field(..., description="Our player doing the marking")
    opponent_player_name: str = Field(..., min_length=1, max_length=200, description="Opposition player name")
    notes: Optional[str] = None


class ManMarkingAssignmentUpdate(BaseModel):
    opponent_player_name: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = None


class ManMarkingAssignmentResponse(BaseModel):
    id: UUID
    match_id: UUID
    player_id: UUID
    player_name: Optional[str] = None
    opponent_player_name: str
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class MarkingHistoryEntry(BaseModel):
    """Aggregated marking history for a player."""
    player_id: UUID
    player_name: str
    times_marked_top_scorer: int
    matches_as_marker: int
    assignments: list[ManMarkingAssignmentResponse]
