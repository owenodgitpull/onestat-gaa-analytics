"""
Leaderboard Service.

Computes 8 competitive leaderboard categories for the Player Portal.
All methods are static, following the SeasonDashboardService pattern.
"""

from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, case, or_
from sqlalchemy.orm import lazyload
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.match_lineup import MatchLineup
from app.models.player import Player
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.models.ball_carrier_segment import BallCarrierSegment

# Try importing TrainingGPSData for speed demon cross-source
try:
    from app.models.training_gps import TrainingGPSData
except ImportError:
    TrainingGPSData = None


# Pitch is standardized at 145m x 90m app-wide (see docs/pitch-svg-geometry.md
# and GAA_ESSENTIALS in ai/_shared.py). BallCarrierSegment start_x/end_x/
# start_y/end_y are all 0-100 (percent of pitch length / width respectively)
# — length and width need separate scale factors, they're not the same
# distance per percentage point.
_PITCH_LENGTH_M = 145.0
_PITCH_WIDTH_M = 90.0

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
    EventType.BLOCK: 2,
    EventType.INTERCEPTION: 2,
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
    EventType.WIDE, EventType.SHORT, EventType.SAVED, EventType.HIT_POST,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE,
    EventType.WIDE_FREE, EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
    EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
]

DEFENSIVE_EVENTS = [
    EventType.BLOCK, EventType.INTERCEPTION, EventType.TURNOVER_WON, EventType.TACKLE_WON,
]

# Same threshold MatchResult.tsx uses to flag a GPS max-speed reading as a
# likely sensor spike rather than a real achievement (GPS_SPIKE_THRESHOLD_MS
# there) — kept in sync so "genuine top speed" means the same thing on the
# leaderboard as it does on the match page. Readings above this are excluded
# from Speed Demon entirely, so a player's leaderboard entry is their best
# *plausible* reading, not whatever their highest sensor glitch happened to be.
# 10.6 m/s ≈ 38 km/h — typical GAA match max is around 8.3-10.0 m/s.
GPS_SPIKE_THRESHOLD_MS = 10.6

# Any kickout won by an own-team player, whether it was our own restart or the
# opposition's, clean or off a break — shared between the Match Log stat and
# the "Kickout Kings" leaderboard so both count the exact same thing.
KICKOUT_WON_TYPES = [
    EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
    EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
    EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON,
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
        # Same overfetch fix as _compute_all_rankings_fresh — callers of this
        # helper use match.id/match_date, never the relationships.
        result = await db.execute(
            select(Match).where(
                and_(
                    Match.club_id == club_id,
                    Match.counts_in_stats,
                    Match.is_deleted.is_(False),
                )
            ).options(
                lazyload(Match.events),
                lazyload(Match.possession_events),
                lazyload(Match.player_stats),
                lazyload(Match.lineup),
                lazyload(Match.gps_data),
                lazyload(Match.video_sessions),
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
            # TACKLE_WON is deliberately not tallied here — tackles were
            # removed from The Wall's scoring and detail line.

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

        # Joined to MatchLineup.is_on_field so an unused substitute's GPS
        # device — which keeps recording during warm-up even though they
        # never took the field — can't inflate their average. Only matches
        # where the player actually started or came on count.
        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.avg(MatchGPSData.total_distance_m).label("avg_dist"),
                func.count(MatchGPSData.id).label("match_count"),
            ).select_from(MatchGPSData).join(
                MatchLineup,
                and_(
                    MatchLineup.match_id == MatchGPSData.match_id,
                    MatchLineup.player_id == MatchGPSData.player_id,
                ),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.total_distance_m.isnot(None),
                    MatchLineup.is_on_field.is_(True),
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

        # Match GPS max speed — readings above GPS_SPIKE_THRESHOLD_MS are
        # excluded outright (same threshold MatchResult.tsx flags as a likely
        # sensor spike), so a player's entry is their best genuine reading,
        # not a glitch. This naturally surfaces their next-highest real speed
        # for anyone whose true max got thrown out. Also joined to
        # MatchLineup.is_on_field, same reason as Workhorse/Sprint King — an
        # unused substitute's bench/warm-up GPS session shouldn't count.
        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.max(MatchGPSData.max_speed_ms).label("top_speed"),
            ).select_from(MatchGPSData).join(
                MatchLineup,
                and_(
                    MatchLineup.match_id == MatchGPSData.match_id,
                    MatchLineup.player_id == MatchGPSData.player_id,
                ),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.max_speed_ms.isnot(None),
                    MatchGPSData.max_speed_ms <= GPS_SPIKE_THRESHOLD_MS,
                    MatchLineup.is_on_field.is_(True),
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
                            TrainingGPSData.max_speed_ms <= GPS_SPIKE_THRESHOLD_MS,
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

        # Joined to MatchLineup.is_on_field for the same reason as Workhorse —
        # an unused substitute's bench/warm-up GPS session shouldn't count.
        result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.avg(MatchGPSData.sprint_count).label("avg_sprints"),
                func.count(MatchGPSData.id).label("match_count"),
            ).select_from(MatchGPSData).join(
                MatchLineup,
                and_(
                    MatchLineup.match_id == MatchGPSData.match_id,
                    MatchLineup.player_id == MatchGPSData.player_id,
                ),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.sprint_count.isnot(None),
                    MatchLineup.is_on_field.is_(True),
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

        # Denominator is total_sessions (every training session the CLUB held),
        # the same number for every player — not how many Attendance rows
        # happen to exist for that individual player. A coach who only logs a
        # row when someone actually shows up (no explicit "absent" row for
        # the sessions they missed) previously made a player's own row-count
        # both the numerator source AND the denominator, so anyone who only
        # ever had a handful of sessions recorded showed 100% regardless of
        # how many club sessions they'd actually missed — e.g. 2/2, 10/10.
        # Comparing everyone against the same real total is the whole point
        # of a ladder.
        player_present: dict[str, int] = {}
        seen_players: set[str] = set()
        for r in records:
            pid = str(r.player_id)
            if pid not in players:
                continue
            seen_players.add(pid)
            if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
                player_present[pid] = player_present.get(pid, 0) + 1

        data = []
        for pid in seen_players:
            present = player_present.get(pid, 0)
            rate = round(present / total_sessions * 100, 1)
            data.append((pid, rate, present, total_sessions))

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
    # 9. Kickout King (kickouts won — clean or off a break, ours or theirs)
    # ------------------------------------------------------------------
    @staticmethod
    async def kickout_king(db: AsyncSession, club_id: UUID) -> list[dict]:
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
                    MatchEvent.event_type.in_(KICKOUT_WON_TYPES),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        events = result.scalars().all()

        counts: dict[str, dict] = {}
        for e in events:
            pid = str(e.player_id)
            if pid not in players:
                continue
            d = counts.setdefault(pid, {"clean": 0, "break": 0})
            if e.event_type in (EventType.OWN_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_WON_BREAK, EventType.BREAKING_BALL_WON):
                d["break"] += 1
            else:
                d["clean"] += 1

        ranked = sorted(counts.items(), key=lambda x: x[1]["clean"] + x[1]["break"], reverse=True)
        return [
            {
                "rank": i + 1,
                "player_id": pid,
                "player_name": players[pid].name,
                "value": d["clean"] + d["break"],
                "detail": f"{d['clean']} clean, {d['break']} break",
            }
            for i, (pid, d) in enumerate(ranked)
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
        "kickout_king": {
            "display_name": "Kickout Kings",
            "unit": "won",
            "method": "kickout_king",
        },
        # Carry distance (metres, from ball-carrier segments) + passes made
        # (segments ended by 'pass'), combined and averaged per match — a
        # driving carry that drags defenders out of position counts for
        # more than a short give-and-go, unlike a flat touch/possession
        # count. Only populated for matches recorded with Tier 1
        # ball-carrier tracking active — a player with zero tracked matches
        # simply doesn't appear, same as Workhorse/Speed Demon/Sprint King
        # not showing untracked GPS players.
        "orchestrator": {
            "display_name": "Orchestrator",
            "unit": "drive+pass/match",
            "method": "orchestrator",
        },
    }

    @staticmethod
    async def get_all_leaderboards(
        db: AsyncSession, club_id: UUID, player_id: UUID | None = None,
        competition: str | None = None, last_n: int | None = None,
        viewer_is_admin: bool = False,
    ) -> list[dict]:
        """Build top-3/context-window previews for the portal home screen.

        The expensive part (scanning every match/event/GPS/attendance row and
        ranking all 8 categories) is cached and shared with get_single_leaderboard
        via _compute_all_rankings — this just does the cheap per-viewer slicing.
        """
        all_rankings = await LeaderboardService._compute_all_rankings(db, club_id, competition, last_n)
        pid_str = str(player_id) if player_id else None
        opted_out = set() if viewer_is_admin else await LeaderboardService._opted_out_player_ids(db, club_id)
        return [
            _build_context(
                key, meta,
                _visible_ranking(all_rankings.get(key, []), opted_out, pid_str),
                pid_str,
            )
            for key, meta in LeaderboardService.CATEGORIES.items()
        ]

    @staticmethod
    async def _opted_out_player_ids(db: AsyncSession, club_id: UUID) -> set[str]:
        """Players who've opted their own stats out of teammate-visible
        leaderboards — see Player.hide_from_leaderboards."""
        result = await db.execute(
            select(Player.id).where(Player.club_id == club_id, Player.hide_from_leaderboards.is_(True))
        )
        return {str(pid) for (pid,) in result.all()}

    @staticmethod
    async def _compute_all_rankings(
        db: AsyncSession, club_id: UUID,
        competition: str | None = None, last_n: int | None = None,
    ) -> dict[str, list[dict]]:
        """Compute all 8 leaderboards in ~7 DB queries (was 24+), cached per club.

        Standings only change when a match/GPS/training result is recorded, so
        this is gated by the same data-fingerprint pattern used for SeasonCache
        elsewhere — a fresh full-squad scan only runs when something actually
        changed, instead of on every leaderboard view/tab-switch for every player.

        A competition/last_n filter bypasses this cache entirely and always
        computes fresh — filtered views are a small subset of the unfiltered
        one (cheaper to compute, not more expensive) and are used far less
        often than the default all-matches view, so caching every distinct
        filter combination isn't worth the cache-key complexity it'd need.
        """
        if competition or last_n:
            return await LeaderboardService._compute_all_rankings_fresh(db, club_id, competition, last_n)

        from sqlalchemy import select as _select
        from app.models.season_cache import SeasonCache
        from app.services.season_dashboard_service import _compute_data_fingerprint

        fingerprint = await _compute_data_fingerprint(db, club_id)
        # Include the category set in the cache key so adding/removing/renaming
        # a leaderboard category (a code change) invalidates old cached blobs
        # automatically — the data fingerprint alone doesn't change just because
        # the code changed, which silently served a stale 8-category cache
        # missing "kickout_king" the first time this was deployed. Python's
        # built-in hash() is randomized per-process (PYTHONHASHSEED), so a
        # real digest is used instead of hash() to stay stable across restarts.
        # LEADERBOARD_SCHEMA_VERSION bumps for a shape/unit change within an
        # existing category (e.g. speed_demon switching from km/h back to
        # m/s) — the category *names* wouldn't change, so categories_sig alone
        # wouldn't catch it and old cached blobs would keep serving km/h values.
        import hashlib as _hashlib
        # v3: Orchestrator switched from possession-spell COUNT to carry
        # DISTANCE (metres) + pass count, 2026-09-09.
        # v4: Orchestrator carry distance switched from x-axis-only net
        # displacement to full 2D straight-line distance (both axes,
        # correctly scaled per pitch length vs width) — the v3 formula
        # undercounted carries with real lateral movement, 2026-09-09.
        LEADERBOARD_SCHEMA_VERSION = "v4"
        categories_sig = ",".join(sorted(LeaderboardService.CATEGORIES.keys())) + f"|{LEADERBOARD_SCHEMA_VERSION}"
        categories_hash = _hashlib.md5(categories_sig.encode()).hexdigest()[:8]
        cache_type = f"leaderboard_rankings_{categories_hash}"

        cache_result = await db.execute(
            _select(SeasonCache).where(
                SeasonCache.club_id == club_id,
                SeasonCache.cache_type == cache_type,
            )
        )
        cache = cache_result.scalar_one_or_none()
        if cache and cache.data_fingerprint == fingerprint and cache.cached_result is not None:
            return cache.cached_result

        all_rankings = await LeaderboardService._compute_all_rankings_fresh(db, club_id)

        if cache:
            cache.cached_result = all_rankings
            cache.data_fingerprint = fingerprint
            cache.cached_at = datetime.utcnow()
        else:
            db.add(SeasonCache(
                club_id=club_id,
                cache_type=cache_type,
                data_fingerprint=fingerprint,
                cached_result=all_rankings,
            ))
        await db.commit()

        return all_rankings

    @staticmethod
    async def _compute_all_rankings_fresh(
        db: AsyncSession, club_id: UUID,
        competition: str | None = None, last_n: int | None = None,
    ) -> dict[str, list[dict]]:
        """The actual full-squad scan — only called on a cache miss."""
        import asyncio
        from uuid import UUID as _UUID

        # --- 1. Fetch matches ---
        # Only match.id is used below (per-category queries re-fetch events
        # directly by match_id) — skip the model's default eager (selectin)
        # loading of events/possession_events/player_stats/lineup/gps_data/
        # video_sessions, same fix already applied in
        # season_dashboard_service.py's _get_completed_matches for the same
        # reason (6 redundant queries per call otherwise).
        _conditions = [
            Match.club_id == club_id,
            Match.counts_in_stats,
            Match.is_deleted.is_(False),
        ]
        if competition:
            _conditions.append(Match.competition.ilike(f"%{competition}%"))
        matches_result = await db.execute(
            select(Match).where(and_(*_conditions))
            .options(
                lazyload(Match.events),
                lazyload(Match.possession_events),
                lazyload(Match.player_stats),
                lazyload(Match.lineup),
                lazyload(Match.gps_data),
                lazyload(Match.video_sessions),
            )
            .order_by(Match.match_date.asc())
        )
        matches = matches_result.scalars().all()
        if last_n:
            # Sliced in Python rather than a SQL LIMIT — matches are already
            # fetched ascending by date for the trend logic elsewhere, and
            # "last N" wants descending, so this keeps that ordering intact
            # for anything that relies on it while still narrowing the set.
            matches = matches[-last_n:]
        if not matches:
            return {key: [] for key in LeaderboardService.CATEGORIES}

        match_ids = [m.id for m in matches]
        # Per-match pitch dimensions, when the club has recorded them for a
        # specific ground — falls back to the app-wide 145x90m default for
        # any match without an override. Used by the Orchestrator carry
        # distance calc below.
        pitch_dims_by_match = {
            m.id: (m.pitch_length_m or _PITCH_LENGTH_M, m.pitch_width_m or _PITCH_WIDTH_M)
            for m in matches
        }

        # --- 2. Fetch active players ---
        players_result = await db.execute(
            select(Player).where(and_(Player.club_id == club_id, Player.active.is_(True)))
        )
        players = {str(p.id): p for p in players_result.scalars().all()}

        # Union of all event types needed across all categories
        all_needed_types = list(
            set(SCORING_EVENTS) | set(SHOT_EVENTS) | set(DEFENSIVE_EVENTS) | set(MOTM_WEIGHTS.keys()) | set(KICKOUT_WON_TYPES)
        )

        # --- 3. Fetch all match events in one query ---
        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(all_needed_types),
                    MatchEvent.player_id.isnot(None),
                )
            )
        )
        all_events = events_result.scalars().all()

        # --- 4. GPS aggregates (distance + sprints) — joined to MatchLineup
        # so an unused substitute's bench/warm-up GPS session (device stays
        # on even though they never took the field) can't inflate Workhorse
        # or Sprint King. Top speed is deliberately NOT pulled from this same
        # query — a spike reading needs to be dropped from the max-speed calc
        # without also throwing away that row's otherwise-valid distance/
        # sprint numbers, so it gets its own query below. ---
        gps_result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.avg(MatchGPSData.total_distance_m).label("avg_dist"),
                func.avg(MatchGPSData.sprint_count).label("avg_sprints"),
                func.count(MatchGPSData.id).label("match_count"),
            ).select_from(MatchGPSData).join(
                MatchLineup,
                and_(
                    MatchLineup.match_id == MatchGPSData.match_id,
                    MatchLineup.player_id == MatchGPSData.player_id,
                ),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchLineup.is_on_field.is_(True),
                )
            ).group_by(MatchGPSData.player_id)
        )
        gps_rows = gps_result.all()

        # --- 5. Match + training GPS max speed (optional), spike-filtered
        # and joined to MatchLineup.is_on_field (unused subs excluded) ---
        speed_result = await db.execute(
            select(
                MatchGPSData.player_id,
                func.max(MatchGPSData.max_speed_ms).label("top_speed"),
            ).select_from(MatchGPSData).join(
                MatchLineup,
                and_(
                    MatchLineup.match_id == MatchGPSData.match_id,
                    MatchLineup.player_id == MatchGPSData.player_id,
                ),
            ).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.max_speed_ms.isnot(None),
                    MatchGPSData.max_speed_ms <= GPS_SPIKE_THRESHOLD_MS,
                    MatchLineup.is_on_field.is_(True),
                )
            ).group_by(MatchGPSData.player_id)
        )
        speed_map: dict[str, float] = {}
        for row in speed_result:
            pid = str(row.player_id)
            if pid in players and row.top_speed is not None:
                speed_map[pid] = float(row.top_speed)

        if TrainingGPSData is not None:
            player_ids_list = [_UUID(pid) for pid in players.keys()]
            try:
                train_result = await db.execute(
                    select(
                        TrainingGPSData.player_id,
                        func.max(TrainingGPSData.max_speed_ms).label("top_speed"),
                    ).where(
                        and_(
                            TrainingGPSData.player_id.in_(player_ids_list),
                            TrainingGPSData.max_speed_ms.isnot(None),
                            TrainingGPSData.max_speed_ms <= GPS_SPIKE_THRESHOLD_MS,
                        )
                    ).group_by(TrainingGPSData.player_id)
                )
                for row in train_result:
                    pid = str(row.player_id)
                    if pid in players:
                        speed_map[pid] = max(speed_map.get(pid, 0), float(row.top_speed))
            except Exception:
                pass

        # --- 5b. Ball-carrier segments (possessions + passes) for Orchestrator ---
        # Only own-team, player-attributed segments — opponent carriers (if
        # ever tagged) and unattributed segments don't belong on a squad
        # leaderboard, same filtering convention as the event queries above.
        carrier_result = await db.execute(
            select(
                BallCarrierSegment.player_id,
                BallCarrierSegment.match_id,
                BallCarrierSegment.ended_by,
                BallCarrierSegment.start_x,
                BallCarrierSegment.end_x,
                BallCarrierSegment.start_y,
                BallCarrierSegment.end_y,
            ).where(
                and_(
                    BallCarrierSegment.match_id.in_(match_ids),
                    BallCarrierSegment.team == 'own',
                    BallCarrierSegment.player_id.isnot(None),
                )
            )
        )
        carrier_rows = carrier_result.all()

        # --- 6. Training sessions + 7. Attendance in two queries ---
        sessions_result = await db.execute(
            select(TrainingSession.id).where(TrainingSession.club_id == club_id)
        )
        session_ids = [r[0] for r in sessions_result.all()]

        total_sessions = len(session_ids)
        # Denominator is total_sessions (every session the club held) for
        # every player, not each player's own Attendance-row count — see the
        # matching comment in the standalone iron_man() above for why.
        att_by_player: dict[str, dict] = {}
        if session_ids:
            att_result = await db.execute(
                select(Attendance).where(Attendance.session_id.in_(session_ids))
            )
            for r in att_result.scalars().all():
                pid = str(r.player_id)
                if pid not in players:
                    continue
                d = att_by_player.setdefault(pid, {"present": 0, "total": total_sessions})
                if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
                    d["present"] += 1

        # ----------------------------------------------------------------
        # Compute all 8 rankings from shared in-memory data
        # ----------------------------------------------------------------

        # 1. Top Scorer
        scorer_scores: dict[str, int] = {}
        scorer_details: dict[str, dict] = {}
        for e in all_events:
            if e.event_type not in SCORING_EVENTS:
                continue
            pid = str(e.player_id)
            if pid not in players:
                continue
            scorer_scores[pid] = scorer_scores.get(pid, 0) + _score_value(e.event_type)
            d = scorer_details.setdefault(pid, {"goals": 0, "points": 0, "two_ptrs": 0, "frees": 0})
            if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL):
                d["goals"] += 1
            elif e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE):
                d["two_ptrs"] += 1
            elif e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE):
                d["points"] += 1
            if e.event_type in (EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE):
                d["frees"] += 1
        top_scorer_ranking = sorted(scorer_scores.items(), key=lambda x: x[1], reverse=True)
        top_scorer = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": val, "detail": _format_gaa_score(scorer_details.get(pid, {}))}
            for i, (pid, val) in enumerate(top_scorer_ranking)
        ]

        # 2. Clinical Rating
        shot_counts: dict[str, int] = {}
        score_counts: dict[str, int] = {}
        for e in all_events:
            if e.event_type not in SHOT_EVENTS:
                continue
            pid = str(e.player_id)
            if pid not in players:
                continue
            shot_counts[pid] = shot_counts.get(pid, 0) + 1
            if e.event_type in SCORING_EVENTS:
                score_counts[pid] = score_counts.get(pid, 0) + 1
        clinical_data = []
        for pid, total in shot_counts.items():
            if total < 10:
                continue
            pct = round(score_counts.get(pid, 0) / total * 100, 1)
            clinical_data.append((pid, pct, total))
        clinical_data.sort(key=lambda x: x[1], reverse=True)
        clinical_rating = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": pct, "detail": f"{score_counts.get(pid, 0)}/{total} shots"}
            for i, (pid, pct, total) in enumerate(clinical_data)
        ]

        # 3. The Wall
        defensive_stats: dict[str, dict] = {}
        for e in all_events:
            if e.event_type not in DEFENSIVE_EVENTS:
                continue
            pid = str(e.player_id)
            if pid not in players:
                continue
            d = defensive_stats.setdefault(pid, {"blocks": 0, "interceptions": 0, "turnovers_won": 0})
            if e.event_type == EventType.BLOCK:
                d["blocks"] += 1
            elif e.event_type == EventType.INTERCEPTION:
                d["interceptions"] += 1
            elif e.event_type == EventType.TURNOVER_WON:
                d["turnovers_won"] += 1
            # TACKLE_WON is deliberately not tallied here — tackles were
            # removed from The Wall's scoring and detail line.
        the_wall_ranked = sorted(defensive_stats.items(), key=lambda x: sum(x[1].values()), reverse=True)
        the_wall = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": sum(d.values()),
             "detail": f"{d['blocks']}B {d['interceptions']}I {d['turnovers_won']}TO"}
            for i, (pid, d) in enumerate(the_wall_ranked)
        ]

        # 4. Workhorse (GPS avg distance)
        workhorse_data = []
        for row in gps_rows:
            pid = str(row.player_id)
            if pid not in players or row.avg_dist is None:
                continue
            avg_km = round(float(row.avg_dist) / 1000, 2)
            workhorse_data.append((pid, avg_km, int(row.match_count)))
        workhorse_data.sort(key=lambda x: x[1], reverse=True)
        workhorse = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": avg_km, "detail": f"{mc} matches"}
            for i, (pid, avg_km, mc) in enumerate(workhorse_data)
        ]

        # 5. Speed Demon (max speed ever)
        speed_ranked = sorted(speed_map.items(), key=lambda x: x[1], reverse=True)
        speed_demon = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": round(spd, 2)}
            for i, (pid, spd) in enumerate(speed_ranked)
        ]

        # 6. Sprint King (avg sprints per match)
        sprint_data = []
        for row in gps_rows:
            pid = str(row.player_id)
            if pid not in players or row.avg_sprints is None:
                continue
            sprint_data.append((pid, round(float(row.avg_sprints), 1), int(row.match_count)))
        sprint_data.sort(key=lambda x: x[1], reverse=True)
        sprint_king = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": avg_sp, "detail": f"{mc} matches"}
            for i, (pid, avg_sp, mc) in enumerate(sprint_data)
        ]

        # 7. Iron Man (attendance rate)
        iron_data = []
        for pid, d in att_by_player.items():
            if d["total"] == 0:
                continue
            rate = round(d["present"] / d["total"] * 100, 1)
            iron_data.append((pid, rate, d["present"], d["total"]))
        iron_data.sort(key=lambda x: x[1], reverse=True)
        iron_man = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": rate, "detail": f"{present}/{total} sessions"}
            for i, (pid, rate, present, total) in enumerate(iron_data)
        ]

        # 8. MOTM Points
        motm_scores: dict[str, int] = {}
        motm_match_counts: dict[str, set] = {}
        motm_types = frozenset(MOTM_WEIGHTS.keys())
        for e in all_events:
            if e.event_type not in motm_types:
                continue
            pid = str(e.player_id)
            if pid not in players:
                continue
            w = MOTM_WEIGHTS.get(e.event_type, 0)
            motm_scores[pid] = motm_scores.get(pid, 0) + w
            motm_match_counts.setdefault(pid, set()).add(str(e.match_id))
        motm_ranked = sorted(motm_scores.items(), key=lambda x: x[1], reverse=True)
        motm_points = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": val, "detail": f"{len(motm_match_counts.get(pid, set()))} matches"}
            for i, (pid, val) in enumerate(motm_ranked)
        ]

        # 9. Kickout King
        kickout_counts: dict[str, dict] = {}
        kickout_break_types = (EventType.OWN_KICKOUT_WON_BREAK, EventType.OPP_KICKOUT_WON_BREAK, EventType.BREAKING_BALL_WON)
        for e in all_events:
            if e.event_type not in KICKOUT_WON_TYPES:
                continue
            pid = str(e.player_id)
            if pid not in players:
                continue
            d = kickout_counts.setdefault(pid, {"clean": 0, "break": 0})
            if e.event_type in kickout_break_types:
                d["break"] += 1
            else:
                d["clean"] += 1
        kickout_ranked = sorted(kickout_counts.items(), key=lambda x: x[1]["clean"] + x[1]["break"], reverse=True)
        kickout_king = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": d["clean"] + d["break"], "detail": f"{d['clean']} clean, {d['break']} break"}
            for i, (pid, d) in enumerate(kickout_ranked)
        ]

        # 10. Orchestrator (carry distance + passes made, combined, avg/match)
        # Was possession-spell COUNT + pass count — changed 2026-09-09 per
        # the user's own reasoning: a raw touch count treats a one-yard
        # give-and-go the same as a driving carry that drags defenders out
        # of position, which is the actual "orchestrating" behaviour this
        # leaderboard is meant to reward. Carry distance (metres actually
        # covered while carrying) replaces possession count; pass count is
        # unchanged. Both tallied per player PER MATCH first, then averaged
        # across matches — same "average of per-match totals" shape as
        # Workhorse/Sprint King — so a player only tracked for 2 matches
        # isn't penalised against one tracked for 10.
        # Straight-line distance uses BOTH axes (Pythagorean, each scaled by
        # its own real-world dimension — x is pitch LENGTH 145m, y is pitch
        # WIDTH 90m, not the same scale) — not x-axis-only net displacement,
        # which was the first version of this fix and undercounted real
        # carries: confirmed against live data (2026-09-09) that carries
        # often move MORE side-to-side than forward (e.g. one real segment:
        # 9.5% of pitch length forward but 20.3% of pitch width sideways),
        # exactly the "dragging defenders left and right" behaviour the user
        # specifically wants this metric to credit, which an x-only formula
        # was silently throwing away.
        # Metres and a raw pass count are different scales (a single good
        # carry can be 20-40m; a big passing match might be 10-15 passes),
        # so metres are compressed by /10 before combining — "10m carried"
        # reads as roughly one unit of involvement, the same order of
        # magnitude as one pass — rather than distance swamping the passing
        # side of the score entirely.
        orch_by_player: dict[str, dict[str, dict]] = {}
        for pid_raw, mid_raw, ended_by, start_x, end_x, start_y, end_y in carrier_rows:
            pid = str(pid_raw)
            if pid not in players:
                continue
            mid = str(mid_raw)
            per_match = orch_by_player.setdefault(pid, {})
            d = per_match.setdefault(mid, {"carry_m": 0.0, "passes": 0})
            if start_x is not None and end_x is not None:
                match_length_m, match_width_m = pitch_dims_by_match.get(mid_raw, (_PITCH_LENGTH_M, _PITCH_WIDTH_M))
                dx_m = (end_x - start_x) / 100 * match_length_m
                dy_m = (end_y - start_y) / 100 * match_width_m if start_y is not None and end_y is not None else 0.0
                d["carry_m"] += (dx_m ** 2 + dy_m ** 2) ** 0.5
            if ended_by == "pass":
                d["passes"] += 1

        orchestrator_data = []
        for pid, by_match in orch_by_player.items():
            match_count = len(by_match)
            avg_carry_m = round(sum(d["carry_m"] for d in by_match.values()) / match_count, 1)
            avg_passes = round(sum(d["passes"] for d in by_match.values()) / match_count, 1)
            combined = round(avg_carry_m / 10 + avg_passes, 1)
            orchestrator_data.append((pid, combined, avg_carry_m, avg_passes, match_count))
        orchestrator_data.sort(key=lambda x: x[1], reverse=True)
        orchestrator = [
            {"rank": i + 1, "player_id": pid, "player_name": players[pid].name,
             "value": combined, "detail": f"{avg_carry_m}m carried + {avg_passes} pass /match · {mc} matches"}
            for i, (pid, combined, avg_carry_m, avg_passes, mc) in enumerate(orchestrator_data)
        ]

        return {
            "top_scorer": top_scorer,
            "clinical_rating": clinical_rating,
            "the_wall": the_wall,
            "workhorse": workhorse,
            "speed_demon": speed_demon,
            "sprint_king": sprint_king,
            "iron_man": iron_man,
            "motm_points": motm_points,
            "kickout_king": kickout_king,
            "orchestrator": orchestrator,
        }

    @staticmethod
    async def get_single_leaderboard(
        db: AsyncSession, club_id: UUID, category: str,
        competition: str | None = None, last_n: int | None = None,
        viewer_is_admin: bool = False, viewer_player_id: UUID | None = None,
    ) -> list[dict]:
        """
        Return full ranking for one category.

        Previously called its own standalone per-category method, which redid
        the ENTIRE squad-wide matches/events/GPS/attendance scan independently
        of get_all_leaderboards (used for the portal home screen) — meaning
        every tab tap recomputed a ranking that had usually already been
        computed once already, for every player, on every visit. Now shares
        the same cached _compute_all_rankings() result as get_all_leaderboards.
        """
        if category not in LeaderboardService.CATEGORIES:
            return []
        all_rankings = await LeaderboardService._compute_all_rankings(db, club_id, competition, last_n)
        ranking = all_rankings.get(category, [])
        if viewer_is_admin:
            return ranking
        opted_out = await LeaderboardService._opted_out_player_ids(db, club_id)
        pid_str = str(viewer_player_id) if viewer_player_id else None
        return _visible_ranking(ranking, opted_out, pid_str)


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _visible_ranking(ranking: list[dict], opted_out_ids: set[str], viewer_player_id_str: str | None) -> list[dict]:
    """Drop opted-out players from what a non-admin viewer sees — except the
    viewer's own row, which stays so they can always see their own rank/value
    on their own dashboard even after opting out. rank numbers are left as
    originally computed (not renumbered), so a gap is possible — that's more
    honest than silently promoting a neighbour into a rank they didn't earn."""
    if not opted_out_ids:
        return ranking
    return [
        e for e in ranking
        if e["player_id"] not in opted_out_ids or e["player_id"] == viewer_player_id_str
    ]


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
