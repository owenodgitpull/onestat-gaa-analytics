"""
Notification routes — Web Push subscriptions + notification history.
"""

from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, require_club
from app.database import get_db
from app.services.notification_service import NotificationService

router = APIRouter()


class PushSubscribeRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushUnsubscribeRequest(BaseModel):
    endpoint: str


@router.post("/subscribe")
async def subscribe_push(
    body: PushSubscribeRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Register a Web Push subscription."""
    await NotificationService.subscribe(
        db, user.user_id, body.endpoint, body.p256dh, body.auth
    )
    return {"success": True}


@router.delete("/unsubscribe")
async def unsubscribe_push(
    body: PushUnsubscribeRequest,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Remove a Web Push subscription."""
    await NotificationService.unsubscribe(db, user.user_id, body.endpoint)
    return {"success": True}


@router.get("/")
async def get_notifications(
    limit: int = 50,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Get notification history for the current user."""
    notifs = await NotificationService.get_notifications(db, user.user_id, limit)
    return {
        "notifications": [
            {
                "id": str(n.id),
                "type": n.type.value if n.type else None,
                "title": n.title,
                "body": n.body,
                "data": n.data,
                "is_read": n.is_read,
                "sent_at": n.sent_at.isoformat() if n.sent_at else None,
            }
            for n in notifs
        ]
    }


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Mark a single notification as read."""
    await NotificationService.mark_read(db, notification_id, user.user_id)
    return {"success": True}


@router.post("/mark-all-read")
async def mark_all_read(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Mark all notifications as read."""
    await NotificationService.mark_all_read(db, user.user_id)
    return {"success": True}
