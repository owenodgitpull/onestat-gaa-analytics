"""
Playbook Push API Routes.

Push tactical plays to player portals with read receipt tracking.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from uuid import UUID
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
import logging

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer, require_club
from app.models.set_piece_routine import SetPieceRoutine
from app.models.playbook_push import PlaybookPush, PlaybookPushRecipient
from app.models.player import Player

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemas ────────────────────────────────────────────────────────────────

class PlaybookPushCreate(BaseModel):
    routine_id: UUID
    player_ids: list[UUID] = Field(..., min_length=1)
    message: Optional[str] = Field(None, max_length=500)


class PushRecipientInfo(BaseModel):
    player_id: UUID
    player_name: str
    viewed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class PlaybookPushResponse(BaseModel):
    id: UUID
    routine_id: UUID
    routine_name: str
    routine_category: str
    message: Optional[str]
    is_revoked: bool
    version: int
    recipient_count: int
    viewed_count: int
    recipients: list[PushRecipientInfo] = []
    created_at: datetime

    class Config:
        from_attributes = True


class PlayerPlaybookItem(BaseModel):
    push_id: UUID
    routine_id: UUID
    routine_name: str
    routine_category: str
    elements: list
    animation_settings: Optional[dict] = None
    has_voiceover: bool = False
    coach_message: Optional[str] = None
    pushed_at: datetime
    viewed_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Admin endpoints ────────────────────────────────────────────────────────

@router.post("/push", status_code=201)
async def push_playbook(
    data: PlaybookPushCreate,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Push a playbook routine to selected players."""
    # Verify routine belongs to club
    result = await db.execute(
        select(SetPieceRoutine).where(
            SetPieceRoutine.id == data.routine_id,
            SetPieceRoutine.club_id == user.club_id,
        )
    )
    routine = result.scalar_one_or_none()
    if not routine:
        raise HTTPException(status_code=404, detail="Routine not found")

    # Verify all players belong to club
    for pid in data.player_ids:
        p_result = await db.execute(
            select(Player.id).where(Player.id == pid, Player.club_id == user.club_id)
        )
        if not p_result.scalar_one_or_none():
            raise HTTPException(status_code=400, detail=f"Player {pid} not found in your club")

    # Create push record
    push = PlaybookPush(
        club_id=user.club_id,
        routine_id=data.routine_id,
        pushed_by=user.user_id,
        message=data.message,
    )
    db.add(push)
    await db.flush()

    # Create recipient records
    for pid in data.player_ids:
        recipient = PlaybookPushRecipient(
            push_id=push.id,
            player_id=pid,
        )
        db.add(recipient)

    await db.commit()
    await db.refresh(push)

    # Send push notifications (best-effort)
    try:
        from app.services.notification_service import NotificationService
        from app.models.notification import NotificationType
        from app.models.user import User
        # Find users linked to these players
        user_result = await db.execute(
            select(User.id).where(
                User.player_id.in_(data.player_ids),
                User.club_id == user.club_id,
            )
        )
        user_ids = [row[0] for row in user_result.all()]
        for uid in user_ids:
            await NotificationService.send_push(
                db=db,
                user_id=uid,
                title=f"New play: {routine.name}",
                body=data.message or "The manager has shared a tactical play with you.",
                notification_type=NotificationType.MATCH_REPORT,  # reuse existing type
                data={"push_id": str(push.id), "routine_id": str(routine.id)},
            )
    except Exception as e:
        logger.warning(f"Failed to send push notifications: {e}")

    return {
        "id": push.id,
        "routine_name": routine.name,
        "recipient_count": len(data.player_ids),
        "message": "Play pushed successfully",
    }


@router.get("/pushes")
async def list_pushes(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """List all playbook pushes for the club."""
    result = await db.execute(
        select(PlaybookPush).where(
            PlaybookPush.club_id == user.club_id,
        ).order_by(PlaybookPush.created_at.desc())
    )
    pushes = result.scalars().all()

    response = []
    for push in pushes:
        # Count recipients and views
        count_result = await db.execute(
            select(
                func.count(PlaybookPushRecipient.id),
                func.count(PlaybookPushRecipient.viewed_at),
            ).where(PlaybookPushRecipient.push_id == push.id)
        )
        total, viewed = count_result.one()

        # Get recipient details
        recip_result = await db.execute(
            select(PlaybookPushRecipient).where(
                PlaybookPushRecipient.push_id == push.id
            )
        )
        recipients = recip_result.scalars().all()
        recip_info = []
        for r in recipients:
            player_name = r.player.name if r.player else "Unknown"
            recip_info.append(PushRecipientInfo(
                player_id=r.player_id,
                player_name=player_name,
                viewed_at=r.viewed_at,
            ))

        routine_name = push.routine.name if push.routine else "Deleted"
        routine_category = push.routine.category if push.routine else ""

        response.append(PlaybookPushResponse(
            id=push.id,
            routine_id=push.routine_id,
            routine_name=routine_name,
            routine_category=routine_category,
            message=push.message,
            is_revoked=push.is_revoked,
            version=push.version,
            recipient_count=total,
            viewed_count=viewed,
            recipients=recip_info,
            created_at=push.created_at,
        ))

    return response


@router.delete("/pushes/{push_id}", status_code=204)
async def revoke_push(
    push_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Revoke a playbook push — removes it from player portals."""
    result = await db.execute(
        select(PlaybookPush).where(
            PlaybookPush.id == push_id,
            PlaybookPush.club_id == user.club_id,
        )
    )
    push = result.scalar_one_or_none()
    if not push:
        raise HTTPException(status_code=404, detail="Push not found")

    push.is_revoked = True
    await db.commit()


# ── Player portal endpoints ────────────────────────────────────────────────

@router.get("/player/playbooks")
async def get_player_playbooks(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get playbook pushes for the current player (player portal)."""
    if not user.player_id:
        raise HTTPException(status_code=403, detail="No player profile linked")

    result = await db.execute(
        select(PlaybookPushRecipient).where(
            PlaybookPushRecipient.player_id == user.player_id,
        ).order_by(PlaybookPushRecipient.created_at.desc())
    )
    recipients = result.scalars().all()

    items = []
    for r in recipients:
        push = r.push
        if not push or push.is_revoked:
            continue
        routine = push.routine
        if not routine:
            continue

        # Generate voiceover URL if exists
        voiceover_url = None
        if routine.voiceover_key:
            try:
                from app.services.storage_service import storage
                voiceover_url = storage.generate_presigned_download_url(
                    key=routine.voiceover_key,
                    expires_in=3600,
                    club_id=str(push.club_id),
                )
            except Exception:
                pass

        items.append({
            "push_id": r.push_id,
            "routine_id": routine.id,
            "routine_name": routine.name,
            "routine_category": routine.category,
            "elements": routine.elements,
            "animation_settings": routine.animation_settings,
            "has_voiceover": bool(routine.voiceover_key),
            "voiceover_url": voiceover_url,
            "coach_message": push.message,
            "pushed_at": push.created_at.isoformat(),
            "viewed_at": r.viewed_at.isoformat() if r.viewed_at else None,
        })

    return items


@router.post("/player/playbooks/{push_id}/viewed")
async def mark_playbook_viewed(
    push_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Mark a playbook push as viewed by the player."""
    if not user.player_id:
        raise HTTPException(status_code=403, detail="No player profile linked")

    result = await db.execute(
        select(PlaybookPushRecipient).where(
            PlaybookPushRecipient.push_id == push_id,
            PlaybookPushRecipient.player_id == user.player_id,
        )
    )
    recipient = result.scalar_one_or_none()
    if not recipient:
        raise HTTPException(status_code=404, detail="Push not found")

    if not recipient.viewed_at:
        recipient.viewed_at = datetime.utcnow()
    recipient.view_count = (recipient.view_count or 0) + 1
    await db.commit()

    return {"viewed": True}
