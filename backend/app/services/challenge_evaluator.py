"""
Challenge Evaluator — pure data, no AI.

Evaluates active player challenges against live match/GPS/attendance data.
Updates current_value and sets status to completed/failed as appropriate.
"""

import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.models.player_challenge import PlayerChallenge
from app.services.leaderboard_service import SCORING_EVENTS, SHOT_EVENTS

logger = logging.getLogger(__name__)


class ChallengeEvaluator:
    """Evaluates active challenges against live data."""

    @staticmethod
    async def evaluate_challenges(
        db: AsyncSession, player_id: UUID, club_id: UUID,
        challenges: list[PlayerChallenge],
    ) -> list[PlayerChallenge]:
        """
        For each active challenge, query data since created_at,
        update current_value, and set status if complete/failed/expired.
        Returns the updated challenges.
        """
        now = datetime.utcnow()
        active = [c for c in challenges if c.status == "active"]
        if not active:
            return challenges

        # Pre-fetch all completed matches for the club
        match_result = await db.execute(
            select(Match).where(
                and_(
                    Match.club_id == club_id,
                    Match.counts_in_stats,
                    Match.is_deleted.is_(False),
                )
            ).order_by(Match.match_date.asc())
        )
        all_matches = match_result.scalars().all()

        for challenge in active:
            # Check expiration first
            if challenge.expires_at and now > challenge.expires_at:
                challenge.status = "expired" if challenge.current_value < challenge.target_value else "completed"
                continue

            # Get matches since challenge was created
            since = challenge.created_at
            recent_matches = [m for m in all_matches if m.match_date and m.match_date >= since]

            # Limit to evaluation window
            recent_matches = recent_matches[:challenge.evaluation_window]

            if not recent_matches:
                continue

            match_ids = [m.id for m in recent_matches]

            value = await _compute_metric(
                db, player_id, match_ids, club_id, challenge.metric_key, since
            )

            challenge.current_value = value

            # Check completion
            if value >= challenge.target_value:
                challenge.status = "completed"

        await db.flush()
        return challenges


async def _compute_metric(
    db: AsyncSession,
    player_id: UUID,
    match_ids: list,
    club_id: UUID,
    metric_key: str,
    since: datetime,
) -> float:
    """Compute the current value for a metric_key across given matches."""

    if metric_key in (
        "goals_from_play", "points_from_play", "total_score_value",
        "turnovers_won", "blocks", "shooting_accuracy",
    ):
        ev_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.player_id == player_id,
                )
            )
        )
        events = ev_result.scalars().all()

        if metric_key == "goals_from_play":
            return float(sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL)))

        if metric_key == "points_from_play":
            return float(sum(1 for e in events if e.event_type == EventType.POINT))

        if metric_key == "total_score_value":
            goals = sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
            pts = sum(1 for e in events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
            two_pt = sum(1 for e in events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
            return float(goals * 3 + pts + two_pt * 2)

        if metric_key == "turnovers_won":
            return float(sum(1 for e in events if e.event_type == EventType.TURNOVER_WON))

        if metric_key == "blocks":
            return float(sum(1 for e in events if e.event_type == EventType.BLOCK))

        if metric_key == "shooting_accuracy":
            total_shots = sum(1 for e in events if e.event_type in SHOT_EVENTS)
            total_scores = sum(1 for e in events if e.event_type in SCORING_EVENTS)
            return round(total_scores / total_shots * 100, 1) if total_shots > 0 else 0.0

    if metric_key in ("total_distance_m", "sprint_count"):
        gps_result = await db.execute(
            select(MatchGPSData).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.player_id == player_id,
                )
            )
        )
        gps_rows = gps_result.scalars().all()

        if metric_key == "total_distance_m":
            return float(sum(g.total_distance_m or 0 for g in gps_rows))

        if metric_key == "sprint_count":
            return float(sum(g.sprint_count or 0 for g in gps_rows))

    if metric_key == "attendance_streak":
        sessions_result = await db.execute(
            select(TrainingSession).where(
                and_(
                    TrainingSession.club_id == club_id,
                    TrainingSession.session_date >= since,
                )
            ).order_by(TrainingSession.session_date.asc())
        )
        sessions = sessions_result.scalars().all()
        if not sessions:
            return 0.0

        session_ids = [s.id for s in sessions]
        att_result = await db.execute(
            select(Attendance).where(
                and_(
                    Attendance.session_id.in_(session_ids),
                    Attendance.player_id == player_id,
                )
            )
        )
        records = {str(r.session_id): r for r in att_result.scalars().all()}

        # Count consecutive present sessions from most recent
        streak = 0
        for s in reversed(sessions):
            r = records.get(str(s.id))
            if r and r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
                streak += 1
            else:
                break
        return float(streak)

    logger.warning(f"Unknown metric_key: {metric_key}")
    return 0.0
