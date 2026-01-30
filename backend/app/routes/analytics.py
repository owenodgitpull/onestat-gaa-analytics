"""
API routes for Season Analytics and Dashboard data.

Aggregates data across all matches for dashboard visualizations.
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, case, and_
from typing import List, Optional
from datetime import datetime
from pydantic import BaseModel
from app.database import get_db
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.player import Player

router = APIRouter()


# ============================================================================
# Response Schemas
# ============================================================================

class SeasonSummary(BaseModel):
    """Overall season statistics."""
    matches_played: int
    wins: int
    losses: int
    draws: int
    win_rate: float
    total_goals_scored: int
    total_points_scored: int
    total_goals_conceded: int
    total_points_conceded: int
    avg_score_per_match: float
    avg_conceded_per_match: float


class TopScorer(BaseModel):
    """Player scoring statistics."""
    player_id: str
    player_name: str
    goals: int
    points: int
    two_pointers: int
    total_score: int  # goals*3 + points + two_pointers*2
    matches_played: int


class TopTurnover(BaseModel):
    """Player turnover statistics."""
    player_id: str
    player_name: str
    turnovers_won: int
    turnovers_lost: int
    net_turnovers: int  # won - lost


class ShotLocation(BaseModel):
    """Shot location data for heat maps."""
    x: float
    y: float
    event_type: str
    is_score: bool
    team: str


class PossessionZone(BaseModel):
    """Possession lost/won by pitch zone."""
    zone: str
    turnovers_lost: int
    turnovers_won: int
    unforced_errors: int


class MatchTrend(BaseModel):
    """Match-by-match trend data."""
    match_id: str
    opponent: str
    match_date: str
    dungloe_score: int
    opponent_score: int
    result: str  # W/L/D


class DashboardData(BaseModel):
    """Complete dashboard data response."""
    season_summary: SeasonSummary
    top_scorers: List[TopScorer]
    top_turnovers: List[TopTurnover]
    shot_locations: List[ShotLocation]
    possession_zones: List[PossessionZone]
    match_trends: List[MatchTrend]


# ============================================================================
# Helper Functions
# ============================================================================

def get_pitch_zone(x: float, y: float) -> str:
    """Convert x,y coordinates to pitch zone name."""
    if x is None or y is None:
        return "unknown"

    # Horizontal zones
    if x < 22:
        h_zone = "defensive"
    elif x < 45:
        h_zone = "defensive_45"
    elif x < 55:
        h_zone = "midfield"
    elif x < 78:
        h_zone = "attacking_45"
    else:
        h_zone = "attacking"

    # Lateral zones
    if y < 33:
        l_zone = "left"
    elif y < 67:
        l_zone = "center"
    else:
        l_zone = "right"

    return f"{h_zone}_{l_zone}"


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/dashboard", response_model=DashboardData)
async def get_dashboard_data(
    db: AsyncSession = Depends(get_db)
):
    """
    Get all dashboard data in a single request.

    Returns season summary, top scorers, shot locations, and trends.
    """
    # Get all completed matches
    matches_result = await db.execute(
        select(Match).where(
            and_(
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False
            )
        ).order_by(Match.match_date.desc())
    )
    matches = matches_result.scalars().all()

    # Calculate season summary
    wins = sum(1 for m in matches if m.dungloe_total_score > m.opponent_total_score)
    losses = sum(1 for m in matches if m.dungloe_total_score < m.opponent_total_score)
    draws = sum(1 for m in matches if m.dungloe_total_score == m.opponent_total_score)

    total_goals_scored = sum(m.dungloe_goals or 0 for m in matches)
    total_points_scored = sum(m.dungloe_points or 0 for m in matches)
    total_goals_conceded = sum(m.opponent_goals or 0 for m in matches)
    total_points_conceded = sum(m.opponent_points or 0 for m in matches)

    matches_played = len(matches)

    season_summary = SeasonSummary(
        matches_played=matches_played,
        wins=wins,
        losses=losses,
        draws=draws,
        win_rate=round((wins / matches_played * 100) if matches_played > 0 else 0, 1),
        total_goals_scored=total_goals_scored,
        total_points_scored=total_points_scored,
        total_goals_conceded=total_goals_conceded,
        total_points_conceded=total_points_conceded,
        avg_score_per_match=round(
            (total_goals_scored * 3 + total_points_scored) / matches_played if matches_played > 0 else 0, 1
        ),
        avg_conceded_per_match=round(
            (total_goals_conceded * 3 + total_points_conceded) / matches_played if matches_played > 0 else 0, 1
        )
    )

    # Get all events for completed matches
    match_ids = [m.id for m in matches]

    if match_ids:
        events_result = await db.execute(
            select(MatchEvent).where(MatchEvent.match_id.in_(match_ids))
        )
        all_events = events_result.scalars().all()
    else:
        all_events = []

    # Calculate top scorers
    player_scores = {}
    player_matches = {}

    scoring_events = [
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE
    ]

    for event in all_events:
        if event.player_id and event.team == Team.DUNGLOE and event.event_type in scoring_events:
            pid = str(event.player_id)
            if pid not in player_scores:
                player_scores[pid] = {'goals': 0, 'points': 0, 'two_pointers': 0}
                player_matches[pid] = set()

            player_matches[pid].add(str(event.match_id))

            if event.event_type == EventType.GOAL:
                player_scores[pid]['goals'] += 1
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE]:
                player_scores[pid]['points'] += 1
            elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                player_scores[pid]['two_pointers'] += 1

    # Get player names
    player_ids = list(player_scores.keys())
    players_map = {}
    if player_ids:
        from uuid import UUID
        players_result = await db.execute(
            select(Player).where(Player.id.in_([UUID(pid) for pid in player_ids]))
        )
        for p in players_result.scalars():
            players_map[str(p.id)] = p.name

    top_scorers = []
    for pid, scores in player_scores.items():
        total = scores['goals'] * 3 + scores['points'] + scores['two_pointers'] * 2
        top_scorers.append(TopScorer(
            player_id=pid,
            player_name=players_map.get(pid, "Unknown"),
            goals=scores['goals'],
            points=scores['points'],
            two_pointers=scores['two_pointers'],
            total_score=total,
            matches_played=len(player_matches.get(pid, set()))
        ))

    top_scorers.sort(key=lambda x: x.total_score, reverse=True)
    top_scorers = top_scorers[:10]  # Top 10

    # Calculate top turnovers
    player_turnovers = {}

    for event in all_events:
        if event.player_id and event.team == Team.DUNGLOE:
            pid = str(event.player_id)
            if pid not in player_turnovers:
                player_turnovers[pid] = {'won': 0, 'lost': 0}

            if event.event_type == EventType.TURNOVER_WON:
                player_turnovers[pid]['won'] += 1
            elif event.event_type == EventType.TURNOVER_LOST:
                player_turnovers[pid]['lost'] += 1

    top_turnovers = []
    for pid, to in player_turnovers.items():
        if to['won'] > 0 or to['lost'] > 0:
            top_turnovers.append(TopTurnover(
                player_id=pid,
                player_name=players_map.get(pid, "Unknown"),
                turnovers_won=to['won'],
                turnovers_lost=to['lost'],
                net_turnovers=to['won'] - to['lost']
            ))

    top_turnovers.sort(key=lambda x: x.turnovers_won, reverse=True)
    top_turnovers = top_turnovers[:10]

    # Shot locations for heat map
    shot_events = [
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
        EventType.WIDE, EventType.SHORT, EventType.SAVED,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.WIDE_FREE
    ]

    shot_locations = []
    for event in all_events:
        if event.event_type in shot_events and event.pitch_x is not None:
            is_score = event.event_type in [
                EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                EventType.POINT_FREE, EventType.TWO_POINT_FREE
            ]
            shot_locations.append(ShotLocation(
                x=float(event.pitch_x),
                y=float(event.pitch_y) if event.pitch_y else 50,
                event_type=event.event_type.value,
                is_score=is_score,
                team=event.team.value
            ))

    # Possession zones (turnovers by area)
    zone_stats = {}

    for event in all_events:
        if event.pitch_x is not None and event.team == Team.DUNGLOE:
            zone = get_pitch_zone(float(event.pitch_x), float(event.pitch_y) if event.pitch_y else 50)
            if zone not in zone_stats:
                zone_stats[zone] = {'lost': 0, 'won': 0, 'errors': 0}

            if event.event_type == EventType.TURNOVER_LOST:
                zone_stats[zone]['lost'] += 1
            elif event.event_type == EventType.TURNOVER_WON:
                zone_stats[zone]['won'] += 1
            elif event.event_type == EventType.OUR_UNFORCED_ERROR:
                zone_stats[zone]['errors'] += 1

    possession_zones = [
        PossessionZone(
            zone=zone,
            turnovers_lost=stats['lost'],
            turnovers_won=stats['won'],
            unforced_errors=stats['errors']
        )
        for zone, stats in zone_stats.items()
    ]

    # Match trends
    match_trends = [
        MatchTrend(
            match_id=str(m.id),
            opponent=m.opponent,
            match_date=m.match_date.isoformat() if m.match_date else "",
            dungloe_score=m.dungloe_total_score,
            opponent_score=m.opponent_total_score,
            result="W" if m.dungloe_total_score > m.opponent_total_score else (
                "L" if m.dungloe_total_score < m.opponent_total_score else "D"
            )
        )
        for m in matches
    ]

    return DashboardData(
        season_summary=season_summary,
        top_scorers=top_scorers,
        top_turnovers=top_turnovers,
        shot_locations=shot_locations,
        possession_zones=possession_zones,
        match_trends=match_trends
    )


@router.get("/season-summary", response_model=SeasonSummary)
async def get_season_summary(
    db: AsyncSession = Depends(get_db)
):
    """Get season summary statistics only."""
    dashboard = await get_dashboard_data(db)
    return dashboard.season_summary


@router.get("/top-scorers", response_model=List[TopScorer])
async def get_top_scorers(
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """Get top scorers leaderboard."""
    dashboard = await get_dashboard_data(db)
    return dashboard.top_scorers[:limit]


@router.get("/shot-locations", response_model=List[ShotLocation])
async def get_shot_locations(
    team: Optional[str] = Query(None, description="Filter by team: dungloe or opponent"),
    db: AsyncSession = Depends(get_db)
):
    """Get all shot locations for heat map visualization."""
    dashboard = await get_dashboard_data(db)
    locations = dashboard.shot_locations

    if team:
        locations = [l for l in locations if l.team == team]

    return locations
