"""
Leaderboard Service.

Computes 8 competitive leaderboard categories for the Player Portal.
All methods are static, following the SeasonDashboardService pattern.
"""

from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case, or_
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.player import Player
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession

# Try importing TrainingGPSData for speed demon cross-source
try:
    from app.models.training_gps import TrainingGPSData
except ImportError:
    TrainingGPSData = None


# MOTM weights — canonical, matches frontend motm.ts
MOTM_WEIGHTS = {
    EventType.GOAL: 10,
    EventType.TWO_POINT: 5,
    EventType.POINT: 3,
    EventType.POINT_FREE: 3,
    EventType.TWO_POINT_FREE: 5,
    EventType.FORTY_FIVE: 3,
    EventType.PENALTY_GOAL: 10,
    EventType.TURNOVER_WON: 2,
    EventType.KICKOUT_WON: 2,
    EventType.OWN_KICKOUT_WON: 2,
    EventType.OPP_KICKOUT_WON: 2,
    EventType.OWN_KICKOUT_WON_BREAK: 2,
    EventType.OPP_KICKOUT_WON_BREAK: 2,
    EventType.TURNOVER_LOST: -1,
    EventType.UNFORCED_ERROR: -1,
}

SCORING_EVENTS = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE,
    EventType.FORTY_FIVE, EventType.PENALTY_GOAL,
]

SHOT_EVENTS = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.WIDE, EventType.SHORT, EventType.SAVED,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE,
    EventType.WIDE_FREE, EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
    EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
]

DEFENSIVE_EVENTS = [
    EventType.BLOCK, EventType.INTERCEPTION, EventType.TURNOVER_WON,
]


def _score_value(event_type: EventType) -> int:
    """Points value of a scoring event for Top Scorer leaderboard."""
    if event_type in (EventType.GOAL, EventType.PENALTY_GOAL):
        return 3
    elif event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE):
        return 2
    elif event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE):
        return 1
    return 0


class LeaderboardService:
    """Static methods for computing player leaderboards."""

    @staticmethod
    async def _get_club_matches(db: AsyncSession, club_id: UUID) -> list:
        result = await db.execute(
            select(Match).where(
                and_(
                    Match.club_id == club_id,
                    Match.status == MatchStatus.COMPLETED,
                    Match.is_deleted.is_(False),
                )
            ).order_by(Match.match_date.asc())
        )
        return result.scalars().all()

    @staticmethod
    async def _get_club_players(db: AsyncSession, club_id: UUID) -> dict:
        """Returns {player_id_str: Player} for all active club players."""
        result = await db.execute(
            select(Player).where(
                and_(Player.club_id == club_id, Player.active.is_(True))
            )
        )
        return {str(p.id): p for p in result.scalars().all()}

    # ------------------------------------------------------------------
    # 1. Top Scorer
    # ------------------------------------------------------------------
    @staticmethod
    async def top_scorer(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(SCORING_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = result.scalars().all()

        scores: dict[str, int] = {}
        details: dict[str, dict] = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in players:
                continue
            scores[pid] = scores.get(pid, 0) + _score_value(e.event_type)
            d = details.setdefault(pid, {"goals": 0, "points": 0, "two_ptrs": 0, "frees": 0})
            if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL):
                d["goals"] += 1
            elif e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE):
                d["two_ptrs"] += 1
            elif e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE):
                d["points"] += 1
            if e.event_type in (EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE):
                d["frees"] += 1

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": val,
                "detail": _format_gaa_score(details.get(pid, {})),
            }
            for i, (pid, val) in enumerate(ranked)
        ]

    # ------------------------------------------------------------------
    # 2. Clinical Rating (accuracy %)
    # ------------------------------------------------------------------
    @staticmethod
    async def clinical_rating(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(SHOT_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = result.scalars().all()

        shots: dict[str, int] = {}
        scores: dict[str, int] = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in players:
                continue
            shots[pid] = shots.get(pid, 0) + 1
            if e.event_type in SCORING_EVENTS:
                scores[pid] = scores.get(pid, 0) + 1

        # Minimum 10 shots to qualify
        ratings = []
        for pid, total_shots in shots.items():
            if total_shots < 10:
                continue
            pct = round(scores.get(pid, 0) / total_shots * 100, 1)
            ratings.append((pid, pct, total_shots))

        ratings.sort(key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": pct,
                "detail": f"{scores.get(pid, 0)}/{total_shots} shots",
            }
            for i, (pid, pct, total_shots) in enumerate(ratings)
        ]

    # ------------------------------------------------------------------
    # 3. The Wall (defensive)
    # ------------------------------------------------------------------
    @staticmethod
    async def the_wall(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(DEFENSIVE_EVENTS),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = result.scalars().all()

        stats: dict[str, dict] = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in players:
                continue
            d = stats.setdefault(pid, {"blocks": 0, "interceptions": 0, "turnovers_won": 0})
            if e.event_type == EventType.BLOCK:
                d["blocks"] += 1
            elif e.event_type == EventType.INTERCEPTION:
                d["interceptions"] += 1
            elif e.event_type == EventType.TURNOVER_WON:
                d["turnovers_won"] += 1

        ranked = sorted(
            stats.items(),
            key=lambda x: sum(x[1].values()),
            reverse=True,
        )
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": sum(d.values()),
                "detail": f"{d['blocks']}B {d['interceptions']}I {d['turnovers_won']}TO",
            }
            for i, (pid, d) in enumerate(ranked)
        ]

    # ------------------------------------------------------------------
    # 4. Workhorse (avg total_distance_m per match)
    # ------------------------------------------------------------------
    @staticmethod
    async def workhorse(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.avg(MatchGPSData.total_distance_m).label("avg_dist"),
                func.count(MatchGPSData.id).label("match_count"),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.total_distance_m.isnot(None),
                )
            ).group_by(MatchGPSData.player_id)
        )
        rows = result.all()

        data = []
        for row in rows:
            pid = str(row.player_id)
            if pid not in players:
                continue
            avg_km = round(float(row.avg_dist) / 1000, 2)
            data.append((pid, avg_km, int(row.match_count)))

        data.sort(key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": avg_km,
                "detail": f"{mc} matches",
            }
            for i, (pid, avg_km, mc) in enumerate(data)
        ]

    # ------------------------------------------------------------------
    # 5. Speed Demon (highest max_speed ever)
    # ------------------------------------------------------------------
    @staticmethod
    async def speed_demon(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        # Match GPS max speed
        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.max(MatchGPSData.max_speed_ms).label("top_speed"),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.max_speed_ms.isnot(None),
                )
            ).group_by(MatchGPSData.player_id)
        )
        speed_map: dict[str, float] = {}
        for row in result:
            pid = str(row.player_id)
            if pid in players:
                speed_map[pid] = float(row.top_speed)

        # Also check training GPS if available
        if TrainingGPSData is not None:
            player_ids = [UUID(pid) for pid in players.keys()]
            try:
                train_result = await db.execute(
                    select(
                        TrainingGPSData.player_id,
                        func.max(TrainingGPSData.max_speed_ms).label("top_speed"),
                    ).where(
                        and_(
                            TrainingGPSData.player_id.in_(player_ids),
                            TrainingGPSData.max_speed_ms.isnot(None),
                        )
                    ).group_by(TrainingGPSData.player_id)
                )
                for row in train_result:
                    pid = str(row.player_id)
                    if pid in players:
                        existing = speed_map.get(pid, 0)
                        speed_map[pid] = max(existing, float(row.top_speed))
            except Exception:
                pass  # Training GPS table may not exist yet

        ranked = sorted(speed_map.items(), key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": round(speed, 2),
                "detail": f"{round(speed * 3.6, 1)} km/h",
            }
            for i, (pid, speed) in enumerate(ranked)
        ]

    # ------------------------------------------------------------------
    # 6. Sprint King (avg sprint_count per match)
    # ------------------------------------------------------------------
    @staticmethod
    async def sprint_king(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.avg(MatchGPSData.sprint_count).label("avg_sprints"),
                func.count(MatchGPSData.id).label("match_count"),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.sprint_count.isnot(None),
                )
            ).group_by(MatchGPSData.player_id)
        )
        rows = result.all()

        data = []
        for row in rows:
            pid = str(row.player_id)
            if pid not in players:
                continue
            data.append((pid, round(float(row.avg_sprints), 1), int(row.match_count)))

        data.sort(key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": avg_sp,
                "detail": f"{mc} matches",
            }
            for i, (pid, avg_sp, mc) in enumerate(data)
        ]

    # ------------------------------------------------------------------
    # 7. Iron Man (attendance rate %)
    # ------------------------------------------------------------------
    @staticmethod
    async def iron_man(db: AsyncSession, club_id: UUID) -> list[dict]:
        players = await LeaderboardService._get_club_players(db, club_id)
        if not players:
            return []

        # Get all sessions for this club
        sessions_result = await db.execute(
            select(TrainingSession.id).where(TrainingSession.club_id == club_id)
        )
        session_ids = [r[0] for r in sessions_result.all()]
        if not session_ids:
            return []

        total_sessions = len(session_ids)

        # Get attendance records
        att_result = await db.execute(
            select(Attendance).where(
                Attendance.session_id.in_(session_ids)
            )
        )
        records = att_result.scalars().all()

        player_att: dict[str, dict] = {}
        for r in records:
            pid = str(r.player_id)
            if pid not in players:
                continue
            d = player_att.setdefault(pid, {"present": 0, "total": 0})
            d["total"] += 1
            if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
                d["present"] += 1

        data = []
        for pid, d in player_att.items():
            if d["total"] == 0:
                continue
            rate = round(d["present"] / d["total"] * 100, 1)
            data.append((pid, rate, d["present"], d["total"]))

        data.sort(key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": rate,
                "detail": f"{present}/{total} sessions",
            }
            for i, (pid, rate, present, total) in enumerate(data)
        ]

    # ------------------------------------------------------------------
    # 8. MOTM Points (weighted accumulation)
    # ------------------------------------------------------------------
    @staticmethod
    async def motm_points(db: AsyncSession, club_id: UUID) -> list[dict]:
        matches = await LeaderboardService._get_club_matches(db, club_id)
        if not matches:
            return []

        match_ids = [m.id for m in matches]
        players = await LeaderboardService._get_club_players(db, club_id)

        weighted_types = list(MOTM_WEIGHTS.keys())
        result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(weighted_types),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = result.scalars().all()

        scores: dict[str, int] = {}
        match_counts: dict[str, set] = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in players:
                continue
            w = MOTM_WEIGHTS.get(e.event_type, 0)
            scores[pid] = scores.get(pid, 0) + w
            match_counts.setdefault(pid, set()).add(str(e.match_id))

        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": val,
                "detail": f"{len(match_counts.get(pid, set()))} matches",
            }
            for i, (pid, val) in enumerate(ranked)
        ]

    # ------------------------------------------------------------------
    # All categories
    # ------------------------------------------------------------------

    CATEGORIES = {
        "top_scorer": {
            "display_name": "Top Scorer",
            "unit": "pts",
            "method": "top_scorer",
        },
        "clinical_rating": {
            "display_name": "Clinical Rating",
            "unit": "%",
            "method": "clinical_rating",
        },
        "the_wall": {
            "display_name": "The Wall",
            "unit": "actions",
            "method": "the_wall",
        },
        "workhorse": {
            "display_name": "Workhorse",
            "unit": "km/match",
            "method": "workhorse",
        },
        "speed_demon": {
            "display_name": "Speed Demon",
            "unit": "m/s",
            "method": "speed_demon",
        },
        "sprint_king": {
            "display_name": "Sprint King",
            "unit": "sprints/match",
            "method": "sprint_king",
        },
        "iron_man": {
            "display_name": "Iron Man",
            "unit": "%",
            "method": "iron_man",
        },
        "motm_points": {
            "display_name": "MOTM Points",
            "unit": "pts",
            "method": "motm_points",
        },
    }

    @staticmethod
    async def get_all_leaderboards(
        db: AsyncSession, club_id: UUID, player_id: UUID | None = None
    ) -> list[dict]:
        """Compute all 8 leaderboards. Returns top 3 + player context for each."""
        results = []
        for key, meta in LeaderboardService.CATEGORIES.items():
            method = getattr(LeaderboardService, meta["method"])
            full_ranking = await method(db, club_id)
            results.append(
                _build_context(key, meta, full_ranking, str(player_id) if player_id else None)
            )
        return results

    @staticmethod
    async def get_single_leaderboard(
        db: AsyncSession, club_id: UUID, category: str
    ) -> list[dict]:
        """Return full ranking for one category."""
        meta = LeaderboardService.CATEGORIES.get(category)
        if not meta:
            return []
        method = getattr(LeaderboardService, meta["method"])
        return await method(db, club_id)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _format_gaa_score(d: dict) -> str:
    """Format as GAA-style e.g. '2-5 (1f, 1×2pt)'."""
    goals = d.get("goals", 0)
    pts = d.get("points", 0)
    two_ptrs = d.get("two_ptrs", 0)
    frees = d.get("frees", 0)
    base = f"{goals}-{pts + two_ptrs}"
    extras = []
    if frees:
        extras.append(f"{frees}f")
    if two_ptrs:
        extras.append(f"{two_ptrs}×2pt")
    if extras:
        return f"{base} ({', '.join(extras)})"
    return base


def _build_context(
    key: str, meta: dict, full_ranking: list[dict], player_id_str: str | None
) -> dict:
    """Build LeaderboardContext dict with top 3 + player's context window."""
    top_3 = full_ranking[:3]
    total = len(full_ranking)

    my_rank = None
    my_value = None
    context_window = []

    if player_id_str:
        for entry in full_ranking:
            if entry["player_id"] == player_id_str:
                my_rank = entry["rank"]
                my_value = entry["value"]
                break

        if my_rank is not None:
            # Context: 2 above, self, 2 below
            idx = my_rank - 1  # 0-based
            start = max(0, idx - 2)
            end = min(total, idx + 3)
            context_window = full_ranking[start:end]

    return {
        "category": key,
        "display_name": meta["display_name"],
        "unit": meta["unit"],
        "my_rank": my_rank,
        "my_value": my_value,
        "total_players": total,
        "top_3": top_3,
        "context_window": context_window,
    }
