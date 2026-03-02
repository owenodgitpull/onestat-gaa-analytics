"""
Player Comparison Service.

Shared stat computation used by both the manager comparison endpoint
and the player-portal head-to-head endpoint.
"""

from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.player import Player
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.services.leaderboard_service import SCORING_EVENTS, SHOT_EVENTS


class PlayerComparisonService:
    """Static methods for computing player comparison stats."""

    @staticmethod
    async def _get_completed_match_ids(db: AsyncSession, club_id: UUID) -> list[UUID]:
        result = await db.execute(
            select(Match.id).where(
                and_(
                    Match.club_id == club_id,
                    Match.status == MatchStatus.COMPLETED,
                    Match.is_deleted == False,
                )
            )
        )
        return [r[0] for r in result.all()]

    @staticmethod
    async def compute_player_stats(
        db: AsyncSession, club_id: UUID, player_id: UUID, player_name: str, match_ids: list[UUID]
    ) -> dict:
        """Compute season stats + GPS averages + attendance for one player."""
        stats = {
            "player_id": str(player_id),
            "player_name": player_name,
            "goals": 0, "points": 0, "two_pointers": 0,
            "total_score_value": 0, "accuracy_pct": None,
            "turnovers_won": 0, "turnovers_lost": 0,
            "blocks": 0, "interceptions": 0,
            "matches_played": 0,
            "avg_distance_km": None, "avg_sprints": None,
            "avg_max_speed_kmh": None,
            "attendance_rate": None,
        }
        if not match_ids:
            return stats

        # Events
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
        matches_played_ids = set(str(e.match_id) for e in events)
        stats["matches_played"] = len(matches_played_ids)

        goals = sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        pts = sum(1 for e in events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        tp = sum(1 for e in events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        stats["goals"] = goals
        stats["points"] = pts
        stats["two_pointers"] = tp
        stats["total_score_value"] = goals * 3 + pts + tp * 2

        total_shots = sum(1 for e in events if e.event_type in SHOT_EVENTS)
        total_scores = sum(1 for e in events if e.event_type in SCORING_EVENTS)
        stats["accuracy_pct"] = round(total_scores / total_shots * 100, 1) if total_shots > 0 else None

        stats["turnovers_won"] = sum(1 for e in events if e.event_type == EventType.TURNOVER_WON)
        stats["turnovers_lost"] = sum(1 for e in events if e.event_type == EventType.TURNOVER_LOST)
        stats["blocks"] = sum(1 for e in events if e.event_type == EventType.BLOCK)
        stats["interceptions"] = sum(1 for e in events if e.event_type == EventType.INTERCEPTION)

        # GPS averages
        gps_result = await db.execute(
            select(MatchGPSData).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.player_id == player_id,
                )
            )
        )
        gps_rows = gps_result.scalars().all()
        if gps_rows:
            dists = [g.total_distance_m for g in gps_rows if g.total_distance_m]
            sprints = [g.sprint_count for g in gps_rows if g.sprint_count]
            speeds = [g.max_speed_ms for g in gps_rows if g.max_speed_ms]
            if dists:
                stats["avg_distance_km"] = round(sum(dists) / len(dists) / 1000, 2)
            if sprints:
                stats["avg_sprints"] = round(sum(sprints) / len(sprints), 1)
            if speeds:
                stats["avg_max_speed_kmh"] = round(max(speeds) * 3.6, 1)

        # Attendance
        sessions_result = await db.execute(
            select(TrainingSession.id).where(TrainingSession.club_id == club_id)
        )
        session_ids = [r[0] for r in sessions_result.all()]
        if session_ids:
            att_result = await db.execute(
                select(Attendance).where(
                    and_(
                        Attendance.session_id.in_(session_ids),
                        Attendance.player_id == player_id,
                    )
                )
            )
            records = att_result.scalars().all()
            total_att = len(records)
            present = sum(1 for r in records if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE))
            stats["attendance_rate"] = round(present / total_att * 100, 1) if total_att > 0 else None

        return stats

    @staticmethod
    async def compare_players(
        db: AsyncSession, club_id: UUID, player_a_id: UUID, player_b_id: UUID
    ) -> dict:
        """Compare two players side-by-side. Returns { player_a: {...}, player_b: {...} }."""
        # Validate both players exist in the club
        for pid, label in [(player_a_id, "Player A"), (player_b_id, "Player B")]:
            result = await db.execute(
                select(Player).where(and_(Player.id == pid, Player.club_id == club_id))
            )
            player = result.scalar_one_or_none()
            if not player:
                from fastapi import HTTPException
                raise HTTPException(status_code=404, detail=f"{label} not found in your club.")

        # Get player names
        result_a = await db.execute(select(Player.name).where(Player.id == player_a_id))
        name_a = result_a.scalar_one()
        result_b = await db.execute(select(Player.name).where(Player.id == player_b_id))
        name_b = result_b.scalar_one()

        match_ids = await PlayerComparisonService._get_completed_match_ids(db, club_id)

        stats_a = await PlayerComparisonService.compute_player_stats(
            db, club_id, player_a_id, name_a, match_ids
        )
        stats_b = await PlayerComparisonService.compute_player_stats(
            db, club_id, player_b_id, name_b, match_ids
        )

        return {
            "player_a": stats_a,
            "player_b": stats_b,
        }
