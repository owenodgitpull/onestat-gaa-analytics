"""
Player Portal API routes.

All endpoints derive player_id from auth — never from URL params.
"""

import logging
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert

from datetime import datetime, timedelta, date

from app.auth.dependencies import AuthenticatedUser, require_club, require_admin, require_admin_or_viewer
from app.database import get_db
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.player import Player
from app.models.player_challenge import PlayerChallenge
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.models.player_health import PlayerWorkloadSnapshot
from app.models.season_cache import SeasonCache
from app.services.leaderboard_service import (
    LeaderboardService,
    SCORING_EVENTS,
    SHOT_EVENTS,
    DEFENSIVE_EVENTS,
    KICKOUT_WON_TYPES as _KICKOUT_WON_TYPES,
    _score_value,
    _format_gaa_score,
)
from app.services.player_comparison_service import PlayerComparisonService

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
                Match.is_deleted .is_(False),
            )
        ).order_by(Match.match_date.asc())
    )
    return result.scalars().all()


# ------------------------------------------------------------------
# Competitions (for the portal's competition filter dropdown)
# ------------------------------------------------------------------

@router.get("/competitions")
async def get_competitions(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Distinct competition names for this club's completed matches.

    A player-portal-accessible equivalent of /matches/competitions, which
    is gated to require_admin_or_viewer and so unreachable for a plain
    player account — this powers the portal's own competition filter
    dropdown (leaderboards, stats, etc.) rather than the coach-side
    fixture-entry autocomplete.
    """
    result = await db.execute(
        select(Match.competition).where(
            Match.club_id == user.club_id,
            Match.status == MatchStatus.COMPLETED,
            Match.is_deleted.is_(False),
            Match.competition.isnot(None),
            Match.competition != "",
        ).distinct().order_by(Match.competition.asc())
    )
    return [row[0] for row in result.all()]


# ------------------------------------------------------------------
# Leaderboard Endpoints
# ------------------------------------------------------------------

@router.get("/leaderboards")
async def get_all_leaderboards(
    competition: Optional[str] = Query(None, description="Filter to matches whose competition name contains this"),
    last_n: Optional[int] = Query(None, ge=1, le=50, description="Only the most recent N completed matches"),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """All 8 leaderboard categories with player's rank + context window."""
    # is_preview: an admin "viewing as" a specific player should see exactly
    # what that player would see (including opted-out teammates hidden) —
    # not the real admin's full-visibility view.
    viewer_is_admin = user.role == "club_admin" and not user.is_preview
    boards = await LeaderboardService.get_all_leaderboards(
        db, user.club_id, user.player_id, competition, last_n,
        viewer_is_admin=viewer_is_admin,
    )
    return {"leaderboards": boards}


@router.get("/leaderboards/me/visibility")
async def get_my_leaderboard_visibility(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Whether the current player has opted their own stats out of
    teammate-visible leaderboards."""
    player = await _get_player_for_user(db, user)
    return {"hide_from_leaderboards": player.hide_from_leaderboards}


@router.put("/leaderboards/me/visibility")
async def set_my_leaderboard_visibility(
    body: dict,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """A player's own opt-out from teammate-visible leaderboards — self-
    service only, never settable for someone else here. Their own dashboard
    still shows their own rank either way; this only affects what teammates
    see."""
    hide = body.get("hide_from_leaderboards")
    if not isinstance(hide, bool):
        raise HTTPException(status_code=400, detail="hide_from_leaderboards must be a boolean")
    player = await _get_player_for_user(db, user)
    player.hide_from_leaderboards = hide
    await db.commit()
    return {"hide_from_leaderboards": player.hide_from_leaderboards}


@router.get("/leaderboards/{category}")
async def get_single_leaderboard(
    category: str,
    competition: Optional[str] = Query(None, description="Filter to matches whose competition name contains this"),
    last_n: Optional[int] = Query(None, ge=1, le=50, description="Only the most recent N completed matches"),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Full ranking for a single leaderboard category."""
    if category not in LeaderboardService.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown category: {category}")
    viewer_is_admin = user.role == "club_admin" and not user.is_preview
    ranking = await LeaderboardService.get_single_leaderboard(
        db, user.club_id, category, competition, last_n,
        viewer_is_admin=viewer_is_admin, viewer_player_id=user.player_id,
    )
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
        f_one = sum(1 for e in evts if e.event_type in (EventType.POINT_FREE, EventType.FORTY_FIVE))
        f_two = sum(1 for e in evts if e.event_type == EventType.TWO_POINT_FREE)
        f = f_one + f_two
        w = sum(1 for e in evts if e.event_type in (EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED))
        tw = sum(1 for e in evts if e.event_type == EventType.TURNOVER_WON)
        tl = sum(1 for e in evts if e.event_type == EventType.TURNOVER_LOST)
        bl = sum(1 for e in evts if e.event_type == EventType.BLOCK)
        ic = sum(1 for e in evts if e.event_type == EventType.INTERCEPTION)
        fc = sum(1 for e in evts if e.event_type == EventType.FOUL_COMMITTED)
        kw = sum(1 for e in evts if e.event_type in _KICKOUT_WON_TYPES)
        # 2-point frees are worth 2, not 1 — folding them into the flat "+f"
        # count undercounted total_val for keepers/free-takers with 2pt frees
        total_val = g * 3 + (p + f_one) + (tp + f_two) * 2

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
            "fouls_committed": fc,
            "kickouts_won": kw,
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
        # Was importing from a module that doesn't exist (app.models.training_gps)
        # — silently swallowed by the except below, so this block has never
        # actually returned any training entries in production. The real
        # model lives in training_performance.py, and it has no session_date
        # of its own (only a session_id FK), so that needs a join to
        # TrainingSession to resolve the date at all.
        from app.models.training_performance import TrainingGPSData
        train_result = await db.execute(
            select(TrainingGPSData, TrainingSession.session_date)
            .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
            .where(TrainingGPSData.player_id == player.id)
        )
        for g, session_date in train_result.all():
            entries.append({
                "match_id": None,
                "session_type": "training",
                "opponent_or_label": "Training",
                "date": session_date.isoformat() if session_date else "",
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


@router.get("/my-stats/match-gps-history")
async def get_my_match_gps_history(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Match GPS history, self-scoped — same shape/logic as the coach-facing
    GET /matches/player/{id}/match-gps (which powers Season Physical Trend on
    PlayerView.tsx), reused here via the shared helper so both stay in sync."""
    player = await _get_player_for_user(db, user)

    from app.routes.match_gps import _get_player_match_gps_history
    return await _get_player_match_gps_history(db, player.id, 50, user.club_id)


@router.get("/my-stats/quarter-profile")
async def get_my_quarter_profile(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Fatigue Signature data, self-scoped — see _compute_quarter_profile in
    analytics.py for the shared logic (also used by the coach-facing route)."""
    player = await _get_player_for_user(db, user)

    from app.routes.analytics import _compute_quarter_profile
    return await _compute_quarter_profile(db, user.club_id, player.id)


@router.get("/my-stats/discipline-trend")
async def get_my_discipline_trend(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """"Ball Security" data, self-scoped — see _compute_discipline_trend in
    analytics.py for the shared logic (also used by the coach-facing route)."""
    player = await _get_player_for_user(db, user)

    from app.routes.analytics import _compute_discipline_trend
    return await _compute_discipline_trend(db, user.club_id, player.id)


@router.get("/my-stats/positional-benchmark")
async def get_my_positional_benchmark(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Positional Benchmark data, self-scoped — see _compute_positional_benchmark
    in analytics.py for the shared logic (also used by the coach-facing route)."""
    player = await _get_player_for_user(db, user)

    from app.routes.analytics import _compute_positional_benchmark
    return await _compute_positional_benchmark(db, user.club_id, player.id)


async def _get_goalkeeper_matches(db: AsyncSession, club_id: UUID, player_id: UUID) -> list:
    """Completed matches restricted to the ones where this player actually
    played in goal (lineup position 'gk', on the field) — kickout events
    don't record who took the kick, only who won/lost it, so this is how we
    scope "my kickouts" to a specific goalkeeper rather than the whole team's
    season (which could include a different keeper's matches)."""
    from app.models.match_lineup import MatchLineup
    from app.services.season_dashboard_service import SeasonDashboardService

    matches = await SeasonDashboardService._get_completed_matches(db, club_id)
    if not matches:
        return []
    match_ids = [m.id for m in matches]
    lineup_result = await db.execute(
        select(MatchLineup.match_id).where(
            and_(
                MatchLineup.match_id.in_(match_ids),
                MatchLineup.player_id == player_id,
                MatchLineup.position_id == "gk",
                MatchLineup.is_on_field.is_(True),
            )
        )
    )
    gk_match_ids = {row[0] for row in lineup_result.all()}
    return [m for m in matches if m.id in gk_match_ids]


@router.get("/my-stats/kickout-outcomes")
async def get_my_kickout_outcomes(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Kickout outcomes per match, restricted to matches this player played
    in goal — same chart/logic coaches see on the Season Dashboard, but
    scoped to this goalkeeper's own matches, not the whole team's season."""
    player = await _get_player_for_user(db, user)
    matches = await _get_goalkeeper_matches(db, user.club_id, player.id)

    from app.services.season_dashboard_service import SeasonDashboardService
    return await SeasonDashboardService._kickout_trends(db, matches)


@router.get("/my-stats/kickout-zones")
async def get_my_kickout_zones(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """9-zone kickout landing grid, restricted to matches this player played
    in goal — same chart coaches see on the Season Dashboard, scoped to this
    goalkeeper's own matches."""
    player = await _get_player_for_user(db, user)
    matches = await _get_goalkeeper_matches(db, user.club_id, player.id)

    from app.services.season_dashboard_service import SeasonDashboardService
    return await SeasonDashboardService._kickout_landing_zones(db, matches)


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

    # Get all club sessions (cap at 200 most recent)
    sessions_result = await db.execute(
        select(TrainingSession).where(
            TrainingSession.club_id == user.club_id
        ).order_by(TrainingSession.session_date.desc()).limit(200)
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

PLAYER_AI_CACHE_TTL = timedelta(hours=24)


async def _get_player_ai_cache(
    db: AsyncSession, player_id: UUID, cache_type: str
) -> dict | None:
    """Return cached AI result if fresh (< 24h), else None."""
    result = await db.execute(
        select(SeasonCache).where(
            and_(
                SeasonCache.club_id == player_id,  # reuse club_id col for player_id
                SeasonCache.cache_type == cache_type,
            )
        )
    )
    row = result.scalar_one_or_none()
    if row and row.cached_at and (datetime.utcnow() - row.cached_at) < PLAYER_AI_CACHE_TTL:
        return row.cached_result
    return None


async def _set_player_ai_cache(
    db: AsyncSession, player_id: UUID, cache_type: str, data: dict
) -> None:
    """Upsert cached AI result for a player."""
    result = await db.execute(
        select(SeasonCache).where(
            and_(
                SeasonCache.club_id == player_id,
                SeasonCache.cache_type == cache_type,
            )
        )
    )
    row = result.scalar_one_or_none()
    if row:
        row.cached_result = data
        row.cached_at = datetime.utcnow()
        row.data_fingerprint = "player_ai"
    else:
        db.add(SeasonCache(
            club_id=player_id,
            cache_type=cache_type,
            data_fingerprint="player_ai",
            cached_result=data,
            cached_at=datetime.utcnow(),
        ))
    await db.commit()


@router.get("/my-stats/ai-insights")
async def get_my_ai_insights(
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """AI-powered personal insights for the player (cached 24h)."""
    player = await _get_player_for_user(db, user)

    cached = await _get_player_ai_cache(db, player.id, "player_insights")
    if cached:
        return cached

    from app.services.ai import generate_player_insights
    result = await generate_player_insights(db, player.id, user.club_id)
    if result and result.get("insights"):
        await _set_player_ai_cache(db, player.id, "player_insights", result)
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
        from app.services.ai import generate_player_challenges
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
                # evaluation_window is in matches/sessions (~1 per week)
                # Allow 8 days per match window (7 + buffer), minimum 14 days
                expires_at=now + timedelta(days=max(cd.get("evaluation_window", 3) * 8, 14)),
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
    """AI-generated season narrative for the player (cached 24h)."""
    player = await _get_player_for_user(db, user)

    cached = await _get_player_ai_cache(db, player.id, "player_season_story")
    if cached:
        return cached

    from app.services.ai import generate_season_story
    result = await generate_season_story(db, player.id, user.club_id)
    if result:
        await _set_player_ai_cache(db, player.id, "player_season_story", result)
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

    match_ids = await PlayerComparisonService._get_completed_match_ids(db, user.club_id)

    my_stats = await PlayerComparisonService.compute_player_stats(
        db, user.club_id, player.id, player.name, match_ids
    )
    their_stats = await PlayerComparisonService.compute_player_stats(
        db, user.club_id, other_player.id, other_player.name, match_ids
    )

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
            and_(Player.club_id == user.club_id, Player.active .is_(True))
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
            # p+tp*2 (not p+tp) so 2-point scores count for their real value —
            # this is a bare "G-P" string with no room for a "(N pts)" aside
            best_match_str = f"{g}-{p + tp * 2}"

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


# ------------------------------------------------------------------
# Sleep Tracking
# ------------------------------------------------------------------

class SleepLogBody(BaseModel):
    hours_slept: float = Field(..., ge=0, le=24, description="Hours slept (0-24)")
    quality: Optional[int] = Field(None, ge=1, le=5, description="Sleep quality 1-5")
    notes: Optional[str] = Field(None, max_length=500)


@router.post("/sleep/log")
async def log_sleep(
    body: SleepLogBody,
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """
    Upsert today's sleep entry for the authenticated player.
    Idempotent — calling twice on the same date updates the existing record.
    """
    from app.models.sleep_log import SleepLog

    if user.is_preview:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Preview mode is read-only.",
        )

    player = await _get_player_for_user(db, user)
    today = date.today()

    stmt = (
        pg_insert(SleepLog)
        .values(
            player_id=player.id,
            date=today,
            hours_slept=body.hours_slept,
            quality=body.quality,
            notes=body.notes,
            created_at=datetime.utcnow(),
        )
        .on_conflict_do_update(
            constraint="uq_sleep_player_date",
            set_={
                "hours_slept": body.hours_slept,
                "quality": body.quality,
                "notes": body.notes,
            },
        )
        .returning(SleepLog)
    )
    result = await db.execute(stmt)
    await db.commit()
    row = result.fetchone()

    return {
        "date": str(today),
        "hours_slept": body.hours_slept,
        "quality": body.quality,
        "notes": body.notes,
        "player_id": str(player.id),
    }


@router.get("/sleep/history")
async def get_sleep_history(
    days: int = Query(default=30, ge=1, le=365),
    user: AuthenticatedUser = Depends(require_club),
    db: AsyncSession = Depends(get_db),
):
    """Player's own sleep history — most recent first."""
    from app.models.sleep_log import SleepLog

    player = await _get_player_for_user(db, user)
    cutoff = date.today() - timedelta(days=days)

    result = await db.execute(
        select(SleepLog)
        .where(
            and_(
                SleepLog.player_id == player.id,
                SleepLog.date >= cutoff,
            )
        )
        .order_by(SleepLog.date.desc())
    )
    logs = result.scalars().all()

    return {
        "entries": [
            {
                "date": str(log.date),
                "hours_slept": log.hours_slept,
                "quality": log.quality,
                "notes": log.notes,
            }
            for log in logs
        ]
    }


@router.get("/sleep/squad")
async def get_squad_sleep(
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin-only: last 7 days of sleep data aggregated per player.
    Returns avg_hours, entries_count, and nights_below_7hrs per player.
    """
    from app.models.sleep_log import SleepLog

    cutoff = date.today() - timedelta(days=7)

    # Get all players in this club
    players_result = await db.execute(
        select(Player).where(
            and_(Player.club_id == user.club_id, Player.active.is_(True))
        ).order_by(Player.name)
    )
    players = players_result.scalars().all()
    if not players:
        return {"squad": []}

    player_ids = [p.id for p in players]
    players_map = {p.id: p for p in players}

    # Fetch all sleep logs in the window for this club's players
    logs_result = await db.execute(
        select(SleepLog).where(
            and_(
                SleepLog.player_id.in_(player_ids),
                SleepLog.date >= cutoff,
            )
        )
    )
    logs = logs_result.scalars().all()

    # Group by player_id
    from collections import defaultdict
    by_player: dict[UUID, list] = defaultdict(list)
    for log in logs:
        by_player[log.player_id].append(log)

    squad = []
    for pid, player in players_map.items():
        player_logs = by_player.get(pid, [])
        entries_count = len(player_logs)
        avg_hours = (
            round(sum(l.hours_slept for l in player_logs) / entries_count, 1)
            if entries_count > 0
            else None
        )
        nights_below_7 = sum(1 for l in player_logs if l.hours_slept < 7)
        squad.append({
            "player_id": str(pid),
            "player_name": player.name,
            "avg_hours": avg_hours,
            "entries_count": entries_count,
            "nights_below_7": nights_below_7,
        })

    return {"squad": squad}
