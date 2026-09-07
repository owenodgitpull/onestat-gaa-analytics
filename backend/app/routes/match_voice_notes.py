"""
Routes for match voice notes — quick spoken reminders captured during live
recording (see app.models.match_voice_note for the feature's intent).
"""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.match import Match
from app.models.match_voice_note import MatchVoiceNote
from app.schemas.match_voice_note import (
    MatchVoiceNoteCreate,
    MatchVoiceNoteResponse,
    MatchVoiceNoteListResponse,
)

router = APIRouter()


async def _verify_match_club(db: AsyncSession, match_id: UUID, club_id: UUID):
    result = await db.execute(select(Match.id).where(and_(Match.id == match_id, Match.club_id == club_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Match not found")


@router.post("/", response_model=MatchVoiceNoteResponse, status_code=status.HTTP_201_CREATED)
async def create_voice_note(
    body: MatchVoiceNoteCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, body.match_id, user.club_id)
    note = MatchVoiceNote(
        match_id=body.match_id,
        text=body.text,
        half=body.half,
        minute=body.minute,
    )
    db.add(note)
    await db.commit()
    await db.refresh(note)
    return MatchVoiceNoteResponse.model_validate(note)


@router.get("/match/{match_id}", response_model=MatchVoiceNoteListResponse)
async def list_voice_notes(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    await _verify_match_club(db, match_id, user.club_id)
    result = await db.execute(
        select(MatchVoiceNote)
        .where(MatchVoiceNote.match_id == match_id)
        .order_by(MatchVoiceNote.created_at.asc())
    )
    notes = result.scalars().all()
    return MatchVoiceNoteListResponse(
        notes=[MatchVoiceNoteResponse.model_validate(n) for n in notes],
        total=len(notes),
    )


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_voice_note(
    note_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(MatchVoiceNote)
        .join(Match, Match.id == MatchVoiceNote.match_id)
        .where(and_(MatchVoiceNote.id == note_id, Match.club_id == user.club_id))
    )
    note = result.scalar_one_or_none()
    if not note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    await db.execute(delete(MatchVoiceNote).where(MatchVoiceNote.id == note_id))
    await db.commit()
