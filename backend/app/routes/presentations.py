"""
Presentations API (Phase 11) — coach-built video/tactical decks.

Club-wide library, not scoped to a single match — a deck's clip slides can
pull from any tagged match video. Mirrors the Framesports reference: a
searchable clip library (here, tagged VideoEvents) feeds a slide-deck
builder, which plays back in a distraction-free "Present" mode.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_
from typing import Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.models.presentation import Presentation, PresentationSlide, SLIDE_TYPES
from app.models.video_event import VideoEvent
from app.models.video_session import VideoSession
from app.models.match import Match
from app.models.player import Player
from app.schemas.presentation import (
    PresentationCreate, PresentationUpdate, PresentationResponse, PresentationListItem,
    SlideCreate, SlideUpdate, SlideReorder, SlideResponse, ClipLibraryEntry,
)

router = APIRouter()


# ============ Presentations (deck-level) ============

@router.post("", response_model=PresentationResponse, status_code=201)
async def create_presentation(
    data: PresentationCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    presentation = Presentation(club_id=user.club_id, title=data.title)
    db.add(presentation)
    await db.commit()
    await db.refresh(presentation)
    return presentation


@router.get("", response_model=list[PresentationListItem])
async def list_presentations(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Presentation.id, Presentation.title, Presentation.updated_at, func.count(PresentationSlide.id).label("slide_count"))
        .outerjoin(PresentationSlide, PresentationSlide.presentation_id == Presentation.id)
        .where(Presentation.club_id == user.club_id)
        .group_by(Presentation.id)
        .order_by(Presentation.updated_at.desc())
    )
    return [
        PresentationListItem(id=row.id, title=row.title, slide_count=row.slide_count, updated_at=row.updated_at)
        for row in result.all()
    ]


async def _get_presentation_or_404(db: AsyncSession, presentation_id: UUID, club_id) -> Presentation:
    result = await db.execute(
        select(Presentation).where(Presentation.id == presentation_id, Presentation.club_id == club_id)
    )
    presentation = result.scalar_one_or_none()
    if not presentation:
        raise HTTPException(status_code=404, detail="Presentation not found")
    return presentation


@router.get("/{presentation_id}", response_model=PresentationResponse)
async def get_presentation(
    presentation_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    return await _get_presentation_or_404(db, presentation_id, user.club_id)


@router.patch("/{presentation_id}", response_model=PresentationResponse)
async def update_presentation(
    presentation_id: UUID,
    data: PresentationUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    presentation = await _get_presentation_or_404(db, presentation_id, user.club_id)
    if data.title is not None:
        presentation.title = data.title
    presentation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(presentation)
    return presentation


@router.delete("/{presentation_id}", status_code=204)
async def delete_presentation(
    presentation_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    presentation = await _get_presentation_or_404(db, presentation_id, user.club_id)
    await db.delete(presentation)
    await db.commit()


# ============ Slides ============

@router.post("/{presentation_id}/slides", response_model=SlideResponse, status_code=201)
async def add_slide(
    presentation_id: UUID,
    data: SlideCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    presentation = await _get_presentation_or_404(db, presentation_id, user.club_id)

    max_order_result = await db.execute(
        select(func.max(PresentationSlide.slide_order)).where(PresentationSlide.presentation_id == presentation_id)
    )
    next_order = (max_order_result.scalar() or 0) + 1

    slide = PresentationSlide(
        presentation_id=presentation_id,
        slide_order=next_order,
        slide_type=data.slide_type,
        video_session_id=data.video_session_id,
        clip_start_ms=data.clip_start_ms,
        clip_end_ms=data.clip_end_ms,
        clip_label=data.clip_label,
        set_piece_routine_id=data.set_piece_routine_id,
        text_title=data.text_title,
        text_body=data.text_body,
    )
    db.add(slide)
    presentation.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(slide)
    return slide


async def _get_slide_or_404(db: AsyncSession, presentation_id: UUID, slide_id: UUID, club_id) -> PresentationSlide:
    await _get_presentation_or_404(db, presentation_id, club_id)
    result = await db.execute(
        select(PresentationSlide).where(
            PresentationSlide.id == slide_id, PresentationSlide.presentation_id == presentation_id
        )
    )
    slide = result.scalar_one_or_none()
    if not slide:
        raise HTTPException(status_code=404, detail="Slide not found")
    return slide


@router.patch("/{presentation_id}/slides/{slide_id}", response_model=SlideResponse)
async def update_slide(
    presentation_id: UUID,
    slide_id: UUID,
    data: SlideUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    slide = await _get_slide_or_404(db, presentation_id, slide_id, user.club_id)

    if data.clip_start_ms is not None:
        slide.clip_start_ms = data.clip_start_ms
    if data.clip_end_ms is not None:
        slide.clip_end_ms = data.clip_end_ms
    if slide.slide_type == 'clip' and slide.clip_start_ms is not None and slide.clip_end_ms is not None:
        if slide.clip_end_ms <= slide.clip_start_ms:
            raise HTTPException(status_code=400, detail="clip_end_ms must be after clip_start_ms")
    if data.clip_label is not None:
        slide.clip_label = data.clip_label
    if data.set_piece_routine_id is not None:
        slide.set_piece_routine_id = data.set_piece_routine_id
    if data.text_title is not None:
        slide.text_title = data.text_title
    if data.text_body is not None:
        slide.text_body = data.text_body

    await db.commit()
    await db.refresh(slide)
    return slide


@router.delete("/{presentation_id}/slides/{slide_id}", status_code=204)
async def delete_slide(
    presentation_id: UUID,
    slide_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    slide = await _get_slide_or_404(db, presentation_id, slide_id, user.club_id)
    await db.delete(slide)
    await db.commit()


@router.put("/{presentation_id}/slides/reorder", response_model=list[SlideResponse])
async def reorder_slides(
    presentation_id: UUID,
    data: SlideReorder,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    presentation = await _get_presentation_or_404(db, presentation_id, user.club_id)
    result = await db.execute(
        select(PresentationSlide).where(PresentationSlide.presentation_id == presentation_id)
    )
    slides_by_id = {s.id: s for s in result.scalars().all()}

    if set(data.slide_ids) != set(slides_by_id.keys()):
        raise HTTPException(status_code=400, detail="slide_ids must exactly match this presentation's current slides")

    for i, sid in enumerate(data.slide_ids):
        slides_by_id[sid].slide_order = i

    presentation.updated_at = datetime.utcnow()
    await db.commit()
    return [slides_by_id[sid] for sid in data.slide_ids]


# ============ Clip library — searchable source for "clip" slides ============

@router.get("/clip-library/search", response_model=list[ClipLibraryEntry])
async def search_clip_library(
    player_id: Optional[UUID] = Query(None),
    event_type: Optional[str] = Query(None),
    match_id: Optional[UUID] = Query(None),
    search: Optional[str] = Query(None, description="Matches opponent name or player name"),
    limit: int = Query(50, le=200),
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """Every tagged VideoEvent with a video position, presented as a candidate
    clip — the shared source both Presentation clip slides and (per Phase 10,
    once built) AI-driven compilations should query, rather than duplicating
    this join elsewhere."""
    query = (
        select(VideoEvent, Match.opponent, Match.match_date, Player.name)
        .join(Match, Match.id == VideoEvent.match_id)
        .outerjoin(Player, Player.id == VideoEvent.player_id)
        .where(
            Match.club_id == user.club_id,
            VideoEvent.video_timestamp_ms.isnot(None),
        )
    )
    if player_id:
        query = query.where(VideoEvent.player_id == player_id)
    if event_type:
        query = query.where(VideoEvent.event_type == event_type)
    if match_id:
        query = query.where(VideoEvent.match_id == match_id)
    if search:
        like = f"%{search}%"
        query = query.where(or_(Match.opponent.ilike(like), Player.name.ilike(like)))

    query = query.order_by(Match.match_date.desc(), VideoEvent.video_timestamp_ms.asc()).limit(limit)
    result = await db.execute(query)

    entries = []
    for ve, opponent, match_date, player_name in result.all():
        label_bits = [ve.event_type.replace('_', ' ').title()]
        if player_name:
            label_bits.append(f"— {player_name}")
        elif ve.opponent_player_name:
            label_bits.append(f"— {ve.opponent_player_name} (opp)")
        label_bits.append(f"(v {opponent})")
        entries.append(ClipLibraryEntry(
            video_event_id=ve.id,
            video_session_id=ve.video_session_id,
            video_timestamp_ms=ve.video_timestamp_ms,
            event_type=ve.event_type,
            player_id=ve.player_id,
            player_name=player_name,
            opponent_player_name=ve.opponent_player_name,
            match_id=ve.match_id,
            opponent=opponent,
            match_date=match_date.strftime('%d %b %Y') if match_date else None,
            suggested_label=" ".join(label_bits),
        ))
    return entries
