"""
Cron job endpoints — protected by a shared secret header.

These are called by an external scheduler (e.g. Vercel Cron, GitHub Actions, etc.)
and must NOT require user auth. Instead they verify the X-Cron-Secret header.
"""

import os
import logging
from fastapi import APIRouter, Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.database import get_db
from app.models.club import Club

logger = logging.getLogger(__name__)

router = APIRouter()

CRON_SECRET = os.getenv("CRON_SECRET", "")


def _verify_cron_secret(x_cron_secret: str = Header(...)):
    """Dependency: verify X-Cron-Secret matches env var."""
    if not CRON_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CRON_SECRET not configured on server.",
        )
    if x_cron_secret != CRON_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid cron secret.",
        )


@router.post("/sleep-reminder", dependencies=[Depends(_verify_cron_secret)])
async def cron_sleep_reminder(db: AsyncSession = Depends(get_db)):
    """
    Send sleep log reminder push notifications to all player-role users
    across all clubs. Call this each morning (e.g. 08:00 UTC).

    Protected by X-Cron-Secret header.
    """
    from app.services.notification_service import NotificationService

    clubs_result = await db.execute(select(Club))
    clubs = clubs_result.scalars().all()

    sent_count = 0
    for club in clubs:
        try:
            await NotificationService.notify_sleep_reminder(db, club.id)
            sent_count += 1
        except Exception as exc:
            logger.warning(f"Sleep reminder failed for club {club.id}: {exc}")

    return {"status": "ok", "clubs_notified": sent_count}
