"""Pydantic schemas for the Presentations API (Phase 11 — video/tactical decks)."""

from pydantic import BaseModel, Field, model_validator
from datetime import datetime
from typing import Optional
from uuid import UUID

from app.models.presentation import SLIDE_TYPES


class PresentationCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)


class PresentationUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)


class SlideCreate(BaseModel):
    slide_type: str

    # clip
    video_session_id: Optional[UUID] = None
    clip_start_ms: Optional[int] = None
    clip_end_ms: Optional[int] = None
    clip_label: Optional[str] = Field(None, max_length=300)

    # animation
    set_piece_routine_id: Optional[UUID] = None

    # text
    text_title: Optional[str] = Field(None, max_length=200)
    text_body: Optional[str] = None

    @model_validator(mode='after')
    def _validate_type_fields(self):
        if self.slide_type not in SLIDE_TYPES:
            raise ValueError(f"slide_type must be one of {sorted(SLIDE_TYPES)}")
        if self.slide_type == 'clip':
            if not self.video_session_id:
                raise ValueError("clip slides require video_session_id")
            if self.clip_start_ms is None or self.clip_end_ms is None:
                raise ValueError("clip slides require clip_start_ms and clip_end_ms")
            if self.clip_end_ms <= self.clip_start_ms:
                raise ValueError("clip_end_ms must be after clip_start_ms")
        if self.slide_type == 'animation' and not self.set_piece_routine_id:
            raise ValueError("animation slides require set_piece_routine_id")
        return self


class SlideUpdate(BaseModel):
    clip_start_ms: Optional[int] = None
    clip_end_ms: Optional[int] = None
    clip_label: Optional[str] = Field(None, max_length=300)
    set_piece_routine_id: Optional[UUID] = None
    text_title: Optional[str] = Field(None, max_length=200)
    text_body: Optional[str] = None


class SlideReorder(BaseModel):
    slide_ids: list[UUID] = Field(..., description="All slide IDs for this presentation, in the new order")


class SlideResponse(BaseModel):
    id: UUID
    slide_order: int
    slide_type: str
    video_session_id: Optional[UUID] = None
    clip_start_ms: Optional[int] = None
    clip_end_ms: Optional[int] = None
    clip_label: Optional[str] = None
    set_piece_routine_id: Optional[UUID] = None
    text_title: Optional[str] = None
    text_body: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class PresentationResponse(BaseModel):
    id: UUID
    title: str
    slides: list[SlideResponse] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class PresentationListItem(BaseModel):
    id: UUID
    title: str
    slide_count: int
    updated_at: datetime

    class Config:
        from_attributes = True


class ClipLibraryEntry(BaseModel):
    """One tagged VideoEvent presented as a candidate clip for a deck."""
    video_event_id: UUID
    video_session_id: UUID
    video_timestamp_ms: int
    event_type: str
    player_id: Optional[UUID] = None
    player_name: Optional[str] = None
    opponent_player_name: Optional[str] = None
    match_id: UUID
    opponent: str
    match_date: Optional[str] = None
    suggested_label: str
