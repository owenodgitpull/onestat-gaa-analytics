"""
Match Prep API Routes.

Handles:
- Tactical notes (save/load on Match)
- Set-piece routines (club-level CRUD)
- Man marking assignments (per-match CRUD + history)
- Opposition briefing (AI-generated)
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
from uuid import UUID
import json
import logging

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_club, require_admin
from app.models.match import Match
from app.models.player import Player
from app.models.set_piece_routine import SetPieceRoutine
from app.models.man_marking_assignment import ManMarkingAssignment
from app.schemas.set_piece_routine import (
    SetPieceRoutineCreate, SetPieceRoutineUpdate, SetPieceRoutineResponse, VALID_CATEGORIES,
)
from app.schemas.man_marking import (
    ManMarkingAssignmentCreate, ManMarkingAssignmentUpdate, ManMarkingAssignmentResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============ Tactical Notes ============

@router.put("/matches/{match_id}/tactical-notes")
async def save_tactical_notes(
    match_id: UUID,
    body: dict,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Save tactical notes for a match."""
    result = await db.execute(
        select(Match).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    match.tactical_notes = body.get("tactical_notes", "")
    await db.commit()
    return {"tactical_notes": match.tactical_notes}


@router.get("/matches/{match_id}/tactical-notes")
async def get_tactical_notes(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get tactical notes for a match."""
    result = await db.execute(
        select(Match.tactical_notes).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    notes = result.scalar_one_or_none()
    return {"tactical_notes": notes or ""}


# ============ Set-Piece Routines (Club-level) ============

@router.post("/set-pieces", response_model=SetPieceRoutineResponse, status_code=201)
async def create_set_piece(
    data: SetPieceRoutineCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if data.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(VALID_CATEGORIES)}")
    routine = SetPieceRoutine(
        club_id=user.club_id,
        name=data.name,
        category=data.category,
        description=data.description,
        elements=data.elements,
    )
    db.add(routine)
    await db.commit()
    await db.refresh(routine)
    return routine


@router.get("/set-pieces", response_model=list[SetPieceRoutineResponse])
async def list_set_pieces(
    category: Optional[str] = Query(None),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    query = select(SetPieceRoutine).where(SetPieceRoutine.club_id == user.club_id)
    if category:
        query = query.where(SetPieceRoutine.category == category)
    query = query.order_by(SetPieceRoutine.updated_at.desc())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/set-pieces/{routine_id}", response_model=SetPieceRoutineResponse)
async def get_set_piece(
    routine_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SetPieceRoutine).where(
            SetPieceRoutine.id == routine_id, SetPieceRoutine.club_id == user.club_id
        )
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")
    return routine


@router.put("/set-pieces/{routine_id}", response_model=SetPieceRoutineResponse)
async def update_set_piece(
    routine_id: UUID,
    data: SetPieceRoutineUpdate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SetPieceRoutine).where(
            SetPieceRoutine.id == routine_id, SetPieceRoutine.club_id == user.club_id
        )
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")

    if data.name is not None:
        routine.name = data.name
    if data.category is not None:
        if data.category not in VALID_CATEGORIES:
            raise HTTPException(status_code=400, detail=f"Category must be one of: {', '.join(VALID_CATEGORIES)}")
        routine.category = data.category
    if data.description is not None:
        routine.description = data.description
    if data.elements is not None:
        routine.elements = data.elements

    await db.commit()
    await db.refresh(routine)
    return routine


@router.delete("/set-pieces/{routine_id}", status_code=204)
async def delete_set_piece(
    routine_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(SetPieceRoutine).where(
            SetPieceRoutine.id == routine_id, SetPieceRoutine.club_id == user.club_id
        )
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")
    await db.delete(routine)
    await db.commit()


# ============ Man Marking Assignments ============

@router.post("/matches/{match_id}/marking", response_model=ManMarkingAssignmentResponse, status_code=201)
async def create_marking_assignment(
    match_id: UUID,
    data: ManMarkingAssignmentCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Verify match belongs to club
    match_result = await db.execute(
        select(Match.id).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    if not match_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Match not found")

    # Get player name
    player_result = await db.execute(select(Player.name).where(Player.id == data.player_id))
    player_name = player_result.scalar_one_or_none()

    assignment = ManMarkingAssignment(
        match_id=match_id,
        club_id=user.club_id,
        player_id=data.player_id,
        opponent_player_name=data.opponent_player_name,
        notes=data.notes,
    )
    db.add(assignment)
    await db.commit()
    await db.refresh(assignment)

    return ManMarkingAssignmentResponse(
        id=assignment.id,
        match_id=assignment.match_id,
        player_id=assignment.player_id,
        player_name=player_name,
        opponent_player_name=assignment.opponent_player_name,
        notes=assignment.notes,
        created_at=assignment.created_at,
    )


@router.get("/matches/{match_id}/marking", response_model=list[ManMarkingAssignmentResponse])
async def list_marking_assignments(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ManMarkingAssignment).where(
            ManMarkingAssignment.match_id == match_id,
            ManMarkingAssignment.club_id == user.club_id,
        ).order_by(ManMarkingAssignment.created_at)
    )
    assignments = result.scalars().all()

    response = []
    for a in assignments:
        player_result = await db.execute(select(Player.name).where(Player.id == a.player_id))
        player_name = player_result.scalar_one_or_none()
        response.append(ManMarkingAssignmentResponse(
            id=a.id,
            match_id=a.match_id,
            player_id=a.player_id,
            player_name=player_name,
            opponent_player_name=a.opponent_player_name,
            notes=a.notes,
            created_at=a.created_at,
        ))
    return response


@router.delete("/marking/{assignment_id}", status_code=204)
async def delete_marking_assignment(
    assignment_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ManMarkingAssignment).where(
            ManMarkingAssignment.id == assignment_id,
            ManMarkingAssignment.club_id == user.club_id,
        )
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")
    await db.delete(assignment)
    await db.commit()


# ============ Opposition Briefing (AI-generated) ============

@router.get("/matches/{match_id}/opposition-briefing")
async def generate_opposition_briefing(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate an AI opposition briefing via streaming SSE.
    Uses the Chat Agent with web search capability to research the opponent.
    """
    # Get match details
    result = await db.execute(
        select(Match).where(Match.id == match_id, Match.club_id == user.club_id)
    )
    match = result.scalar_one_or_none()
    if not match:
        raise HTTPException(status_code=404, detail="Match not found")

    from app.services.ai._shared import get_club_context
    club_name, club_context = await get_club_context(db, user.club_id)

    # Build the briefing prompt
    opponent = match.opponent
    match_date = match.match_date.strftime("%d %B %Y") if match.match_date else "upcoming"
    competition = match.competition or "league match"
    venue = match.venue.value if match.venue else "TBC"

    prompt = (
        f"Generate a concise PRE-MATCH OPPOSITION BRIEFING for our upcoming {competition} "
        f"match against {opponent} on {match_date} ({venue}).\n\n"
        f"Research {opponent} using web search to find:\n"
        f"1. Their recent form and results (last 5 matches if available)\n"
        f"2. Key scorers and dangermen\n"
        f"3. Known tactical tendencies (kickout strategy, defensive shape, attacking patterns)\n"
        f"4. Any previous encounters between {club_name} and {opponent} this season\n\n"
        f"Also use your tools to check if we have any historical match data against {opponent} in our system.\n\n"
        f"Format as a clear one-page briefing the manager can reference. "
        f"Use headers: Recent Form, Key Players, Tactical Tendencies, Previous Encounters, Recommendations."
    )

    from app.services.ai.chat_agent import chat_with_analyst_stream

    async def stream_briefing():
        async for chunk in chat_with_analyst_stream(
            db=db,
            conversation_history=[],
            user_message=prompt,
            club_id=user.club_id,
        ):
            yield f"data: {json.dumps({'text': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        stream_briefing(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
