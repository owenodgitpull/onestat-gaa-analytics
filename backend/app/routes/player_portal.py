"""
Player Portal API routes.

All endpoints derive player_id from auth — never from URL params.
"""

import logging
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from datetime import datetime, timedelta

from app.auth.dependencies import AuthenticatedUser, require_club
from app.database import get_db
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.player import Player
from app.models.player_challenge import PlayerChallenge
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.models.player_health import PlayerWorkloadSnapshot
from app.services.leaderboard_service import (
    LeaderboardService,
    SCORING_EVENTS,
    SHOT_EVENTS,
    DEFENSIVE_EVENTS,
    _score_value,
    _format_gaa_score,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

async def _get_player_for_user(
    db: AsyncSession, user: AuthenticatedUser
) -> Player:
    """Resolve authenticated user's linked player. Raises 403 if not linked."""
    if not user.player_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your account is not linked to a player profile. Ask your club admin to invite you.",
        )
    result = await db.execute(
        select(Player).where(Player.id == user.player_id)
    )
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Linked player record not found.",
        )
    return player


async def _get_club_completed_matches(
    db: AsyncSession, club_id: UUID
) -> list:
    result = await db.execute(
        select(Match).where(
            and_(
                Match.club_id == club_id,
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
            )
        ).order_by(Match.match_date.asc())
    )
    return result.scalars().all()


# ------------------------------------------------------------------
# Leaderboard Endpoints
# ------------------------------------------------------------------

@router.get("/leaderboards")
async def get_all_leaderboards(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """All 8 leaderboard categories with player's rank + context window."""
    boards = await LeaderboardService.get_all_leaderboards(
        db, user.club_id, user.player_id
    )
    return {"leaderboards": boards}


@router.get("/leaderboards/{category}")
async def get_single_leaderboard(
    category: str,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Full ranking for a single leaderboard category."""
    if category not in LeaderboardService.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown category: {category}")
    ranking = await LeaderboardService.get_single_leaderboard(db, user.club_id, category)
    meta = LeaderboardService.CATEGORIES[category]
    return {
        "category": category,
        "display_name": meta["display_name"],
        "unit": meta["unit"],
        "ranking": ranking,
    }


# ------------------------------------------------------------------
# Player Dashboard
# ------------------------------------------------------------------

@router.get("/my-dashboard")
async def get_my_dashboard(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Personal dashboard: season stats, recent form, leaderboard snapshot, highlights."""
    player = await _get_player_for_user(db, user)
    pid = player.id
    pid_str = str(pid)

    matches = await _get_club_completed_matches(db, user.club_id)
    if not matches:
        return {
            "player_name": player.name,
            "jersey_number": player.jersey_number,
            "position": player.position,
            "season_stats": _empty_season_stats(),
            "recent_form": [],
            "leaderboard_positions": [],
            "highlights": [],
        }

    match_ids = [m.id for m in matches]
    matches_map = {str(m.id): m for m in matches}

    # Get all player's events across the season
    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.team == Team.OWN,
                MatchEvent.player_id == pid,
            )
        )
    )
    all_events = events_result.scalars().all()

    # ---- Season Stats ----
    goals = sum(1 for e in all_events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
    points = sum(1 for e in all_events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
    two_ptrs = sum(1 for e in all_events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
    total_pts_value = goals * 3 + points + two_ptrs * 2

    total_shots = sum(1 for e in all_events if e.event_type in SHOT_EVENTS)
    total_scores = sum(1 for e in all_events if e.event_type in SCORING_EVENTS)
    accuracy = round(total_scores / total_shots * 100, 1) if total_shots > 0 else None

    turnovers_won = sum(1 for e in all_events if e.event_type == EventType.TURNOVER_WON)
    turnovers_lost = sum(1 for e in all_events if e.event_type == EventType.TURNOVER_LOST)
    blocks = sum(1 for e in all_events if e.event_type == EventType.BLOCK)
    interceptions = sum(1 for e in all_events if e.event_type == EventType.INTERCEPTION)

    # Matches played = matches where this player has at least one event
    matches_played_ids = set(str(e.match_id) for e in all_events)
    matches_played = len(matches_played_ids)

    season_stats = {
        "matches_played": matches_played,
        "total_score": f"{goals}-{points + two_ptrs}",
        "total_points_value": total_pts_value,
        "goals": goals,
        "points": points,
        "two_pointers": two_ptrs,
        "accuracy_pct": accuracy,
        "turnovers_won": turnovers_won,
        "turnovers_lost": turnovers_lost,
        "blocks": blocks,
        "interceptions": interceptions,
    }

    # ---- Recent Form (last 3 matches they played) ----
    # Group events by match
    events_by_match: dict[str, list] = {}
    for e in all_events:
        events_by_match.setdefault(str(e.match_id), []).append(e)

    # Take last 3 matches (by date) the player was involved in
    played_matches = [
        m for m in reversed(matches) if str(m.id) in matches_played_ids
    ][:3]

    recent_form = []
    for m in played_matches:
        mid = str(m.id)
        p_events = events_by_match.get(mid, [])
        p_goals = sum(1 for e in p_events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        p_pts = sum(1 for e in p_events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        p_2pts = sum(1 for e in p_events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        score_str = f"{p_goals}-{p_pts + p_2pts}"

        # Key stat: best stat from this match
        p_to_won = sum(1 for e in p_events if e.event_type == EventType.TURNOVER_WON)
        p_blocks = sum(1 for e in p_events if e.event_type == EventType.BLOCK)
        key_stat = None
        if p_to_won >= 2:
            key_stat = f"{p_to_won} turnovers won"
        elif p_blocks >= 2:
            key_stat = f"{p_blocks} blocks"

        recent_form.append({
            "match_id": mid,
            "opponent": m.opponent,
            "match_date": m.match_date.isoformat() if m.match_date else "",
            "result": m.result,
            "team_score": f"{m.team_goals}-{m.team_points}",
            "opponent_score": f"{m.opponent_goals}-{m.opponent_points}",
            "personal_score": score_str,
            "key_stat": key_stat,
        })

    # ---- Leaderboard Positions ----
    boards = await LeaderboardService.get_all_leaderboards(db, user.club_id, pid)
    leaderboard_positions = [
        {
            "category": b["category"],
            "display_name": b["display_name"],
            "rank": b["my_rank"],
            "total": b["total_players"],
            "value": b["my_value"],
        }
        for b in boards if b["my_rank"] is not None
    ]

    # ---- Highlights (data-derived, no AI) ----
    highlights = _generate_highlights(
        player, season_stats, played_matches, events_by_match, matches_map
    )

    return {
        "player_name": player.name,
        "jersey_number": player.jersey_number,
        "position": player.position,
        "season_stats": season_stats,
        "recent_form": recent_form,
        "leaderboard_positions": leaderboard_positions,
        "highlights": highlights,
    }


# ------------------------------------------------------------------
# My Stats Endpoints
# ------------------------------------------------------------------

@router.get("/my-stats/matches")
async def get_my_match_stats(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Match-by-match breakdown of player's stats."""
    player = await _get_player_for_user(db, user)
    matches = await _get_club_completed_matches(db, user.club_id)
    if not matches:
        return {"matches": []}

    match_ids = [m.id for m in matches]
    matches_map = {str(m.id): m for m in matches}

    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.team == Team.OWN,
                MatchEvent.player_id == player.id,
            )
        )
    )
    all_events = events_result.scalars().all()

    events_by_match: dict[str, list] = {}
    for e in all_events:
        events_by_match.setdefault(str(e.match_id), []).append(e)

    rows = []
    for m in reversed(matches):
        mid = str(m.id)
        evts = events_by_match.get(mid, [])
        if not evts:
            continue

        g = sum(1 for e in evts if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        p = sum(1 for e in evts if e.event_type in (EventType.POINT,))
        tp = sum(1 for e in evts if e.event_type in (EventType.TWO_POINT,))
        f = sum(1 for e in evts if e.event_type in (EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE))
        w = sum(1 for e in evts if e.event_type in (EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED))
        tw = sum(1 for e in evts if e.event_type == EventType.TURNOVER_WON)
        tl = sum(1 for e in evts if e.event_type == EventType.TURNOVER_LOST)
        bl = sum(1 for e in evts if e.event_type == EventType.BLOCK)
        ic = sum(1 for e in evts if e.event_type == EventType.INTERCEPTION)
        total_val = g * 3 + (p + f) + tp * 2

        rows.append({
            "match_id": mid,
            "opponent": m.opponent,
            "match_date": m.match_date.isoformat() if m.match_date else "",
            "result": m.result,
            "goals": g,
            "points": p + f,
            "two_pointers": tp,
            "frees": f,
            "wides": w,
            "turnovers_won": tw,
            "turnovers_lost": tl,
            "blocks": bl,
            "interceptions": ic,
            "total_score_value": total_val,
        })

    return {"matches": rows}


@router.get("/my-stats/shots")
async def get_my_shots(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """All shot events with pitch coordinates for shot map."""
    player = await _get_player_for_user(db, user)
    matches = await _get_club_completed_matches(db, user.club_id)
    if not matches:
        return {"shots": []}

    match_ids = [m.id for m in matches]
    matches_map = {str(m.id): m for m in matches}

    result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.team == Team.OWN,
                MatchEvent.player_id == player.id,
                MatchEvent.event_type.in_(SHOT_EVENTS),
            )
        )
    )
    events = result.scalars().all()

    shots = []
    for e in events:
        m = matches_map.get(str(e.match_id))
        shots.append({
            "match_id": str(e.match_id),
            "opponent": m.opponent if m else "",
            "event_type": e.event_type.value,
            "pitch_x": e.pitch_x,
            "pitch_y": e.pitch_y,
            "minute": e.minute,
        })

    return {"shots": shots}


@router.get("/my-stats/gps")
async def get_my_gps(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """GPS data across matches (and training if available)."""
    player = await _get_player_for_user(db, user)
    matches = await _get_club_completed_matches(db, user.club_id)

    entries = []

    if matches:
        match_ids = [m.id for m in matches]
        matches_map = {str(m.id): m for m in matches}

        result = await db.execute(
            select(MatchGPSData).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.player_id == player.id,
                )
            )
        )
        gps_rows = result.scalars().all()

        for g in gps_rows:
            m = matches_map.get(str(g.match_id))
            entries.append({
                "match_id": str(g.match_id),
                "session_type": "match",
                "opponent_or_label": m.opponent if m else "Unknown",
                "date": m.match_date.isoformat() if m and m.match_date else "",
                "total_distance_m": g.total_distance_m,
                "high_speed_running_m": g.high_speed_running_m,
                "sprint_count": g.sprint_count,
                "max_speed_ms": g.max_speed_ms,
                "dynamic_stress_load": g.dynamic_stress_load,
                "player_load": g.player_load,
                "playing_minutes": g.playing_minutes,
                "sprint_distance_m": g.sprint_distance_m,
                "hml_distance_m": g.hml_distance_m,
                "avg_speed_ms": g.avg_speed_ms,
                "acceleration_count": g.acceleration_count,
                "deceleration_count": g.deceleration_count,
                "avg_heart_rate": g.avg_heart_rate,
                "max_heart_rate": g.max_heart_rate,
                "time_in_red_zone_mins": g.time_in_red_zone_mins,
            })

    # Training GPS if available
    try:
        from app.models.training_gps import TrainingGPSData
        train_result = await db.execute(
            select(TrainingGPSData).where(
                TrainingGPSData.player_id == player.id
            )
        )
        for g in train_result.scalars().all():
            entries.append({
                "match_id": None,
                "session_type": "training",
                "opponent_or_label": "Training",
                "date": g.session_date.isoformat() if hasattr(g, 'session_date') and g.session_date else "",
                "total_distance_m": g.total_distance_m if hasattr(g, 'total_distance_m') else None,
                "high_speed_running_m": g.high_speed_running_m if hasattr(g, 'high_speed_running_m') else None,
                "sprint_count": g.sprint_count if hasattr(g, 'sprint_count') else None,
                "max_speed_ms": g.max_speed_ms if hasattr(g, 'max_speed_ms') else None,
                "dynamic_stress_load": g.dynamic_stress_load if hasattr(g, 'dynamic_stress_load') else None,
                "player_load": g.player_load if hasattr(g, 'player_load') else None,
                "playing_minutes": None,
                "sprint_distance_m": getattr(g, 'sprint_distance_m', None),
                "hml_distance_m": getattr(g, 'hml_distance_m', None),
                "avg_speed_ms": getattr(g, 'avg_speed_ms', None),
                "acceleration_count": getattr(g, 'acceleration_count', None),
                "deceleration_count": getattr(g, 'deceleration_count', None),
                "avg_heart_rate": getattr(g, 'avg_heart_rate', None),
                "max_heart_rate": getattr(g, 'max_heart_rate', None),
                "time_in_red_zone_mins": getattr(g, 'time_in_red_zone_mins', None),
            })
    except Exception:
        pass  # Training GPS may not exist

    # Sort by date
    entries.sort(key=lambda x: x["date"])
    return {"gps_entries": entries}


@router.get("/my-stats/fitness")
async def get_my_fitness(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Fitness test history for the player."""
    player = await _get_player_for_user(db, user)

    from app.models.fitness_test import FitnessTest
    result = await db.execute(
        select(FitnessTest).where(
            FitnessTest.player_id == player.id
        ).order_by(FitnessTest.test_date.desc())
    )
    tests = result.scalars().all()

    entries = []
    for t in tests:
        entries.append({
            "test_id": str(t.id),
            "test_date": t.test_date.isoformat() if t.test_date else "",
            "weight_kg": t.weight_kg,
            "body_fat_percentage": t.body_fat_percentage,
            "cmj_cm": t.cmj_cm,
            "squat_jump_cm": t.squat_jump_cm,
            "bronco_test_min": t.bronco_test_min,
            "sprint_0_10m_sec": t.sprint_0_10m_sec,
            "press_ups_60s": t.press_ups_60s,
            "pull_ups_60s": t.pull_ups_60s,
        })

    return {"fitness_tests": entries}


@router.get("/my-stats/attendance")
async def get_my_attendance(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Attendance summary + session breakdown."""
    player = await _get_player_for_user(db, user)

    # Get all club sessions
    sessions_result = await db.execute(
        select(TrainingSession).where(
            TrainingSession.club_id == user.club_id
        ).order_by(TrainingSession.session_date.desc())
    )
    sessions = sessions_result.scalars().all()
    if not sessions:
        return {
            "total_sessions": 0,
            "attended": 0,
            "rate_pct": 0,
            "current_streak": 0,
            "longest_streak": 0,
            "by_type": {},
            "sessions": [],
        }

    session_ids = [s.id for s in sessions]
    sessions_map = {str(s.id): s for s in sessions}

    att_result = await db.execute(
        select(Attendance).where(
            and_(
                Attendance.session_id.in_(session_ids),
                Attendance.player_id == player.id,
            )
        )
    )
    records = att_result.scalars().all()
    records_map = {str(r.session_id): r for r in records}

    total = len(sessions)
    attended = sum(
        1 for r in records
        if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE)
    )
    rate = round(attended / total * 100, 1) if total > 0 else 0

    # Streaks (sessions ordered newest first, reverse for chronological)
    current_streak = 0
    longest_streak = 0
    streak = 0
    for s in reversed(sessions):
        r = records_map.get(str(s.id))
        if r and r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
            streak += 1
            longest_streak = max(longest_streak, streak)
        else:
            streak = 0
    current_streak = streak  # streak at the end = current

    # By type
    by_type: dict[str, dict] = {}
    for s in sessions:
        stype = s.session_type.value if s.session_type else "training"
        d = by_type.setdefault(stype, {"total": 0, "attended": 0})
        d["total"] += 1
        r = records_map.get(str(s.id))
        if r and r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE):
            d["attended"] += 1

    # Session-level detail
    session_rows = []
    for s in sessions:
        r = records_map.get(str(s.id))
        session_rows.append({
            "session_id": str(s.id),
            "date": s.session_date.isoformat() if s.session_date else "",
            "type": s.session_type.value if s.session_type else "training",
            "status": r.status.value if r else "absent",
        })

    return {
        "total_sessions": total,
        "attended": attended,
        "rate_pct": rate,
        "current_streak": current_streak,
        "longest_streak": longest_streak,
        "by_type": by_type,
        "sessions": session_rows,
    }


# ------------------------------------------------------------------
# Workload Endpoint
# ------------------------------------------------------------------

@router.get("/my-stats/workload")
async def get_my_workload(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """ACWR and workload data for the last 60 days."""
    player = await _get_player_for_user(db, user)

    from datetime import datetime, timedelta
    cutoff = datetime.utcnow() - timedelta(days=60)

    result = await db.execute(
        select(PlayerWorkloadSnapshot).where(
            and_(
                PlayerWorkloadSnapshot.player_id == player.id,
                PlayerWorkloadSnapshot.snapshot_date >= cutoff,
            )
        ).order_by(PlayerWorkloadSnapshot.snapshot_date.asc())
    )
    snapshots = result.scalars().all()

    entries = []
    for s in snapshots:
        entries.append({
            "date": s.snapshot_date.isoformat() if s.snapshot_date else "",
            "acute_load_7d": s.acute_load_7d,
            "chronic_load_28d": s.chronic_load_28d,
            "acwr": s.acwr,
            "training_load": s.training_load,
            "match_load": s.match_load,
            "total_load": s.total_load,
            "total_distance_m": s.total_distance_m,
            "high_speed_distance_m": s.high_speed_distance_m,
            "sprint_count": s.sprint_count,
        })

    return {"workload_entries": entries}


# ------------------------------------------------------------------
# AI Personal Insights
# ------------------------------------------------------------------

@router.get("/my-stats/ai-insights")
async def get_my_ai_insights(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """AI-powered personal insights for the player."""
    player = await _get_player_for_user(db, user)

    from app.services.ai.player_insights_agent import generate_player_insights
    result = await generate_player_insights(db, player.id, user.club_id)
    return result


# ------------------------------------------------------------------
# Challenges
# ------------------------------------------------------------------

@router.get("/my-stats/challenges")
async def get_my_challenges(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Weekly challenges with live progress evaluation."""
    player = await _get_player_for_user(db, user)
    now = datetime.utcnow()

    # Fetch existing active challenges
    result = await db.execute(
        select(PlayerChallenge).where(
            and_(
                PlayerChallenge.player_id == player.id,
                PlayerChallenge.status == "active",
            )
        )
    )
    active_challenges = list(result.scalars().all())

    # If none active, generate new ones
    if not active_challenges:
        from app.services.ai.challenge_agent import generate_player_challenges
        challenge_defs = await generate_player_challenges(db, player.id, user.club_id)

        for cd in challenge_defs:
            c = PlayerChallenge(
                player_id=player.id,
                club_id=user.club_id,
                title=cd["title"],
                description=cd.get("description"),
                category=cd["category"],
                status="active",
                metric_key=cd["metric_key"],
                target_value=cd["target_value"],
                current_value=0.0,
                evaluation_window=cd["evaluation_window"],
                created_at=now,
                expires_at=now + timedelta(days=7),
            )
            db.add(c)
            active_challenges.append(c)

        await db.flush()

    # Evaluate active challenges against live data
    from app.services.challenge_evaluator import ChallengeEvaluator
    active_challenges = await ChallengeEvaluator.evaluate_challenges(
        db, player.id, user.club_id, active_challenges
    )
    await db.commit()

    # Also fetch recently completed/expired for display
    recent_result = await db.execute(
        select(PlayerChallenge).where(
            and_(
                PlayerChallenge.player_id == player.id,
                PlayerChallenge.status.in_(["completed", "expired", "failed"]),
                PlayerChallenge.expires_at >= now - timedelta(days=7),
            )
        )
    )
    recent_done = list(recent_result.scalars().all())

    all_challenges = active_challenges + recent_done

    return {
        "challenges": [
            {
                "id": str(c.id),
                "title": c.title,
                "description": c.description,
                "category": c.category,
                "status": c.status,
                "metric_key": c.metric_key,
                "target_value": c.target_value,
                "current_value": c.current_value,
                "progress_pct": min(100, round((c.current_value / c.target_value) * 100, 1)) if c.target_value > 0 else 0,
                "expires_at": c.expires_at.isoformat() if c.expires_at else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
            }
            for c in all_challenges
        ]
    }


# ------------------------------------------------------------------
# Season Story
# ------------------------------------------------------------------

@router.get("/my-stats/season-story")
async def get_my_season_story(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """AI-generated season narrative for the player."""
    player = await _get_player_for_user(db, user)

    from app.services.ai.season_story_agent import generate_season_story
    result = await generate_season_story(db, player.id, user.club_id)
    return result


# ------------------------------------------------------------------
# Head-to-Head Comparison
# ------------------------------------------------------------------

@router.get("/head-to-head/{other_player_id}")
async def get_head_to_head(
    other_player_id: UUID,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Side-by-side comparison between the current player and another."""
    player = await _get_player_for_user(db, user)

    # Verify other player exists and is in same club
    other_result = await db.execute(
        select(Player).where(
            and_(Player.id == other_player_id, Player.club_id == user.club_id)
        )
    )
    other_player = other_result.scalar_one_or_none()
    if not other_player:
        raise HTTPException(status_code=404, detail="Player not found in your club.")

    matches = await _get_club_completed_matches(db, user.club_id)
    match_ids = [m.id for m in matches] if matches else []

    async def _player_stats(pid: UUID, pname: str) -> dict:
        """Compute season stats + GPS averages + attendance for one player."""
        stats = {
            "player_id": str(pid),
            "player_name": pname,
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
                    MatchEvent.player_id == pid,
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
                    MatchGPSData.player_id == pid,
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
            select(TrainingSession.id).where(TrainingSession.club_id == user.club_id)
        )
        session_ids = [r[0] for r in sessions_result.all()]
        if session_ids:
            att_result = await db.execute(
                select(Attendance).where(
                    and_(
                        Attendance.session_id.in_(session_ids),
                        Attendance.player_id == pid,
                    )
                )
            )
            records = att_result.scalars().all()
            total_att = len(records)
            present = sum(1 for r in records if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE))
            stats["attendance_rate"] = round(present / total_att * 100, 1) if total_att > 0 else None

        return stats

    my_stats = await _player_stats(player.id, player.name)
    their_stats = await _player_stats(other_player.id, other_player.name)

    # Leaderboard ranks for both
    boards = await LeaderboardService.get_all_leaderboards(db, user.club_id, player.id)
    my_ranks = {}
    their_ranks = {}
    for b in boards:
        cat = b["category"]
        my_ranks[cat] = b["my_rank"]
        # Find other player's rank from context
        for entry in b.get("top_3", []) + b.get("context_window", []):
            if entry["player_id"] == str(other_player_id):
                their_ranks[cat] = entry["rank"]
                break

    # If we didn't find other player in context windows, re-query for them
    if len(their_ranks) < len(boards):
        other_boards = await LeaderboardService.get_all_leaderboards(db, user.club_id, other_player.id)
        for b in other_boards:
            cat = b["category"]
            if cat not in their_ranks:
                their_ranks[cat] = b["my_rank"]

    return {
        "me": my_stats,
        "them": their_stats,
        "my_ranks": my_ranks,
        "their_ranks": their_ranks,
    }


# ------------------------------------------------------------------
# Roster list (for H2H player picker)
# ------------------------------------------------------------------

@router.get("/roster")
async def get_roster(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Active players in the club (for H2H picker)."""
    result = await db.execute(
        select(Player).where(
            and_(Player.club_id == user.club_id, Player.active == True)
        ).order_by(Player.name)
    )
    players = result.scalars().all()
    return {
        "players": [
            {"id": str(p.id), "name": p.name, "jersey_number": p.jersey_number, "position": p.position}
            for p in players
        ]
    }


# ------------------------------------------------------------------
# Highlight generation (data-derived, no AI)
# ------------------------------------------------------------------

def _empty_season_stats() -> dict:
    return {
        "matches_played": 0,
        "total_score": "0-0",
        "total_points_value": 0,
        "goals": 0,
        "points": 0,
        "two_pointers": 0,
        "accuracy_pct": None,
        "turnovers_won": 0,
        "turnovers_lost": 0,
        "blocks": 0,
        "interceptions": 0,
    }


def _generate_highlights(
    player: Player,
    season_stats: dict,
    played_matches: list,
    events_by_match: dict,
    matches_map: dict,
) -> list[str]:
    """Generate data-derived one-liners."""
    highlights = []

    # Best match by personal score
    best_match_score = 0
    best_match_opponent = None
    best_match_str = None
    for m in played_matches:
        mid = str(m.id)
        evts = events_by_match.get(mid, [])
        g = sum(1 for e in evts if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        p = sum(1 for e in evts if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        tp = sum(1 for e in evts if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        val = g * 3 + p + tp * 2
        if val > best_match_score:
            best_match_score = val
            best_match_opponent = m.opponent
            best_match_str = f"{g}-{p + tp}"

    if best_match_str and best_match_opponent:
        highlights.append(f"Best match: {best_match_str} vs {best_match_opponent}")

    if season_stats["goals"] > 0:
        highlights.append(f"{season_stats['goals']} goals this season")

    if season_stats["accuracy_pct"] and season_stats["accuracy_pct"] >= 60:
        highlights.append(f"{season_stats['accuracy_pct']}% shooting accuracy — clinical!")

    if season_stats["turnovers_won"] >= 10:
        highlights.append(f"{season_stats['turnovers_won']} turnovers won — ball hawk")

    if season_stats["blocks"] + season_stats["interceptions"] >= 8:
        total_def = season_stats["blocks"] + season_stats["interceptions"]
        highlights.append(f"{total_def} blocks + interceptions — defensive warrior")

    return highlights[:5]  # Max 5
