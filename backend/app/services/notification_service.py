"""
Notification Service.

Handles Web Push subscriptions and notification delivery.
"""

import json
import logging
import os
from uuid import UUID

from sqlalchemy import select, and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.notification import Notification, NotificationType
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.models.match_gps import MatchGPSData
from app.models.match_event import MatchEvent, Team
from app.models.match import Match

logger = logging.getLogger(__name__)

def _normalise_pem(key: str) -> str:
    """A PEM key needs its line breaks. Stored as a one-line secret (breaks lost, or written as literal \n) it could
    not be read - "Could not deserialize key data" - and every push failed. Rebuild header / 64-char body / footer."""
    import re
    nl = chr(10)
    k = (key or "").strip().strip('"').strip("'").replace(chr(92) + "n", nl)   # literal backslash-n -> newline
    if not k.startswith("-----BEGIN") or nl in k:
        return k
    m = re.match(r"^(-----BEGIN [A-Z ]+-----)(.*?)(-----END [A-Z ]+-----)$", k, re.S)
    if not m:
        return k
    body = re.sub(r"\s+", "", m.group(2))
    lines = [body[i:i + 64] for i in range(0, len(body), 64)]
    return nl.join([m.group(1), *lines, m.group(3)]) + nl


VAPID_PRIVATE_KEY = _normalise_pem(os.getenv("VAPID_PRIVATE_KEY", ""))
VAPID_CLAIMS = {"sub": os.getenv("VAPID_MAILTO", "mailto:admin@onestat.app")}
_VAPID_OBJ = None


def _vapid_key():
    """The key as a loaded Vapid object: given a PEM *string*, pywebpush reads it with Vapid.from_string, which only
    takes the raw base64 form, so a PEM key never loaded. Loaded once with from_pem; the string is a fallback."""
    global _VAPID_OBJ
    if _VAPID_OBJ is None and VAPID_PRIVATE_KEY.startswith("-----BEGIN"):
        try:
            from py_vapid import Vapid
            _VAPID_OBJ = Vapid.from_pem(VAPID_PRIVATE_KEY.encode())
        except Exception as e:
            logger.warning(f"VAPID key could not be loaded from PEM: {e}")
    return _VAPID_OBJ or VAPID_PRIVATE_KEY


class NotificationService:
    """Static methods for push notification management."""

    @staticmethod
    async def subscribe(
        db: AsyncSession, user_id: UUID, endpoint: str, p256dh: str, auth: str
    ) -> PushSubscription:
        """Register a Web Push subscription for a user."""
        # Upsert by endpoint
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.endpoint == endpoint)
        )
        existing = result.scalar_one_or_none()

        if existing:
            existing.user_id = user_id
            existing.p256dh_key = p256dh
            existing.auth_key = auth
        else:
            existing = PushSubscription(
                user_id=user_id,
                endpoint=endpoint,
                p256dh_key=p256dh,
                auth_key=auth,
            )
            db.add(existing)

        await db.commit()
        return existing

    @staticmethod
    async def unsubscribe(db: AsyncSession, user_id: UUID, endpoint: str):
        """Remove a push subscription."""
        await db.execute(
            delete(PushSubscription).where(
                and_(
                    PushSubscription.user_id == user_id,
                    PushSubscription.endpoint == endpoint,
                )
            )
        )
        await db.commit()

    @staticmethod
    async def _get_user_subscriptions(
        db: AsyncSession, user_id: UUID
    ) -> list[PushSubscription]:
        result = await db.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
        return result.scalars().all()

    @staticmethod
    async def send_push(
        db: AsyncSession,
        user_id: UUID,
        notification_type: NotificationType,
        title: str,
        body: str,
        data: dict | None = None,
    ):
        """Create notification record and send via Web Push."""
        # Save notification record
        notif = Notification(
            user_id=user_id,
            type=notification_type,
            title=title,
            body=body,
            data=data,
        )
        db.add(notif)
        await db.commit()

        # Send to all user's subscriptions
        subs = await NotificationService._get_user_subscriptions(db, user_id)
        if not subs or not VAPID_PRIVATE_KEY:
            return

        payload = json.dumps({
            "title": title,
            "body": body,
            "data": data or {},
            "tag": notification_type.value,
        })

        try:
            from pywebpush import webpush, WebPushException

            for sub in subs:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": sub.endpoint,
                            "keys": {
                                "p256dh": sub.p256dh_key,
                                "auth": sub.auth_key,
                            },
                        },
                        data=payload,
                        vapid_private_key=_vapid_key(),
                        vapid_claims=VAPID_CLAIMS,
                    )
                except WebPushException as e:
                    if e.response and e.response.status_code in (404, 410):
                        # Subscription expired — remove it
                        await db.delete(sub)
                        await db.commit()
                        logger.info(f"Removed expired subscription: {sub.endpoint[:50]}")
                    else:
                        logger.warning(f"Push failed for {sub.endpoint[:50]}: {e}")
                except Exception as e:
                    logger.warning(f"Push send error: {e}")
        except ImportError:
            logger.warning("pywebpush not installed — skipping push delivery")

    @staticmethod
    async def notify_match_report(db: AsyncSession, match_id: UUID):
        """Notify all players who played in the match that the report is ready."""
        # Get match
        match_result = await db.execute(select(Match).where(Match.id == match_id))
        match = match_result.scalar_one_or_none()
        if not match:
            return

        # Get player IDs who had events in this match
        events_result = await db.execute(
            select(MatchEvent.player_id).where(
                and_(
                    MatchEvent.match_id == match_id,
                    MatchEvent.team == Team.OWN,
                    MatchEvent.player_id.isnot(None),
                )
            ).distinct()
        )
        player_ids = [row[0] for row in events_result.all()]

        # Find users linked to these players
        if player_ids:
            users_result = await db.execute(
                select(User).where(
                    and_(User.player_id.in_(player_ids), User.role == "player")
                )
            )
            users = users_result.scalars().all()

            for u in users:
                await NotificationService.send_push(
                    db, u.id,
                    NotificationType.MATCH_REPORT,
                    f"Match Report: vs {match.opponent}",
                    "Your post-match analysis is ready. Check your stats!",
                    {"match_id": str(match_id)},
                )

    @staticmethod
    async def notify_gps_uploaded(db: AsyncSession, match_id: UUID):
        """Notify players whose GPS data was just uploaded."""
        match_result = await db.execute(select(Match).where(Match.id == match_id))
        match = match_result.scalar_one_or_none()
        if not match:
            return

        gps_result = await db.execute(
            select(MatchGPSData.player_id).where(
                MatchGPSData.match_id == match_id
            ).distinct()
        )
        player_ids = [row[0] for row in gps_result.all()]

        if player_ids:
            users_result = await db.execute(
                select(User).where(
                    and_(User.player_id.in_(player_ids), User.role == "player")
                )
            )
            for u in users_result.scalars().all():
                await NotificationService.send_push(
                    db, u.id,
                    NotificationType.GPS_UPLOADED,
                    f"GPS Data: vs {match.opponent}",
                    "Your GPS performance data has been uploaded. View your stats!",
                    {"match_id": str(match_id)},
                )

    @staticmethod
    async def notify_fitness_results(
        db: AsyncSession, player_ids: list[UUID]
    ):
        """Notify players that their fitness test results are available."""
        if not player_ids:
            return

        users_result = await db.execute(
            select(User).where(
                and_(User.player_id.in_(player_ids), User.role == "player")
            )
        )
        for u in users_result.scalars().all():
            await NotificationService.send_push(
                db, u.id,
                NotificationType.FITNESS_RESULTS,
                "Fitness Results Available",
                "Your latest fitness test results have been uploaded.",
                {},
            )

    @staticmethod
    async def notify_weekly_brief(db: AsyncSession, club_id: UUID, headline: str):
        """Send weekly brief push notification to all club admins."""
        users_result = await db.execute(
            select(User).where(
                and_(User.club_id == club_id, User.role == "admin")
            )
        )
        for u in users_result.scalars().all():
            await NotificationService.send_push(
                db, u.id,
                NotificationType.WEEKLY_BRIEF,
                "Weekly Brief Ready",
                headline,
                {"type": "weekly_brief"},
            )

    @staticmethod
    async def notify_sleep_reminder(db: AsyncSession, club_id: UUID):
        """Send morning sleep log reminder to all subscribed players in a club."""
        users_result = await db.execute(
            select(User).where(
                and_(User.club_id == club_id, User.role == "player")
            )
        )
        for u in users_result.scalars().all():
            await NotificationService.send_push(
                db, u.id,
                NotificationType.SLEEP_REMINDER,
                "Log last night's sleep",
                "How many hours did you sleep? Takes 10 seconds.",
                {"type": "sleep_reminder"},
            )

    @staticmethod
    async def get_notifications(
        db: AsyncSession, user_id: UUID, limit: int = 50
    ) -> list[Notification]:
        result = await db.execute(
            select(Notification)
            .where(Notification.user_id == user_id)
            .order_by(Notification.sent_at.desc())
            .limit(limit)
        )
        return result.scalars().all()

    @staticmethod
    async def mark_read(db: AsyncSession, notification_id: UUID, user_id: UUID):
        result = await db.execute(
            select(Notification).where(
                and_(Notification.id == notification_id, Notification.user_id == user_id)
            )
        )
        notif = result.scalar_one_or_none()
        if notif:
            notif.is_read = True
            await db.commit()

    @staticmethod
    async def mark_all_read(db: AsyncSession, user_id: UUID):
        result = await db.execute(
            select(Notification).where(
                and_(Notification.user_id == user_id, Notification.is_read .is_(False))
            )
        )
        for n in result.scalars().all():
            n.is_read = True
        await db.commit()
