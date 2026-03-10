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
from app.auth.dependencies import AuthenticatedUser, require_admin
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
    match_id: str


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
    team_score: int
    opponent_score: int
    result: str  # W/L/D


class PlayerMatchStats(BaseModel):
    """Individual player statistics per match."""
    match_id: str
    opponent: str
    match_date: str
    goals: int
    points: int
    two_pointers: int
    total_score: int
    turnovers_won: int
    turnovers_lost: int
    blocks: int = 0
    interceptions: int = 0
    wides: int = 0
    shots_short: int = 0
    shots_saved: int = 0
    frees_won: int = 0
    frees_conceded: int = 0
    yellow_cards: int = 0
    red_cards: int = 0
    kickouts_won: int = 0
    kickouts_lost: int = 0
    assists: int = 0
    minutes_played: Optional[int] = None
    started: bool = False
    accuracy: Optional[float] = None


class DashboardData(BaseModel):
    """Complete dashboard data response."""
    season_summary: SeasonSummary
    top_scorers: List[TopScorer]
    top_turnovers: List[TopTurnover]
    shot_locations: List[ShotLocation]
    possession_zones: List[PossessionZone]
    match_trends: List[MatchTrend]


# Season Dashboard schemas
class PossessionFunnelTotals(BaseModel):
    possessions: int
    attacks: int
    shots: int
    scores: int

class PossessionFunnelMatch(BaseModel):
    match_id: str
    opponent: str
    date: str
    possessions: int
    attacks: int
    shots: int
    scores: int

class PossessionFunnelData(BaseModel):
    season_totals: PossessionFunnelTotals
    opponent_totals: PossessionFunnelTotals
    per_match: List[PossessionFunnelMatch]
    attack_rate: float
    shot_rate: float
    score_rate: float
    opponent_attack_rate: float
    opponent_shot_rate: float
    opponent_score_rate: float

class KickoutTrendMatch(BaseModel):
    match_id: str
    opponent: str
    date: str
    won_clean: int
    won_break: int
    lost_clean: int
    lost_break: int
    won_clean_pct: float
    won_break_pct: float
    lost_clean_pct: float
    lost_break_pct: float

class TurnoverSourcePlayer(BaseModel):
    player_id: str
    player_name: str
    interceptions: int
    blocks: int
    turnovers_won: int
    total: int

class RedZonePlayer(BaseModel):
    player_id: str
    player_name: str
    latest_dsl: float
    avg_dsl_4wk: float
    pct_above: float
    last_match_opponent: str

class WorkhorseRadarData(BaseModel):
    metrics: List[str]
    season_avg: List[float]
    last_game: List[float]
    last_game_opponent: str

class TerritoryZonePcts(BaseModel):
    defensive: float
    midfield: float
    attacking: float

class TerritoryMatchData(BaseModel):
    match_id: str
    opponent: str
    date: str
    team_pcts: TerritoryZonePcts
    opponent_pcts: TerritoryZonePcts
    possession_pct: float

class TerritoryDistributionData(BaseModel):
    season_totals: dict
    season_pcts: TerritoryZonePcts
    opponent_totals: dict
    opponent_pcts: TerritoryZonePcts
    per_match: List[TerritoryMatchData]
    possession_pct: float

class KPICardItem(BaseModel):
    key: str
    label: str
    value: float
    format: str
    color: str
    insight: Optional[str] = None

class KPIMetadata(BaseModel):
    matches_played: int
    win_rate: float
    wins: int
    losses: int
    draws: int

class KPICards(BaseModel):
    metadata: KPIMetadata
    cards: List[KPICardItem]

# Score Timeline schemas
class ScoreTimelineEvent(BaseModel):
    minute: int
    team: str
    event_type: str
    value: int
    cumulative_diff: int
    is_from_play: bool

class ScoreTimelineMatch(BaseModel):
    opponent: str
    date: str
    events: List[ScoreTimelineEvent]

class ScoreTimelineSummary(BaseModel):
    avg_ht_lead: float
    longest_drought_mins: int
    scores_final_10: int
    best_period: str

class ScoreTimelineData(BaseModel):
    per_match: dict  # match_id -> ScoreTimelineMatch
    summary: ScoreTimelineSummary

# Dead Ball Breakdown schemas
class FromPlayBreakdown(BaseModel):
    goals: int
    points: int
    two_ptrs: int

class DeadBallCategory(BaseModel):
    scored: int
    missed: int

class MatchDeadBallBreakdown(BaseModel):
    from_play: FromPlayBreakdown
    frees: DeadBallCategory
    forty_fives: DeadBallCategory
    penalties: DeadBallCategory

class DeadBallBreakdownData(BaseModel):
    per_match: dict  # match_id -> {opponent, date, own, opponent}
    season_totals: dict  # {own: MatchDeadBallBreakdown, opponent: MatchDeadBallBreakdown}
    from_play_pct: float

# Defensive Action Zones schemas
class DefensiveEvent(BaseModel):
    match_id: str
    minute: Optional[int]
    player_name: Optional[str]
    action_type: str
    pitch_x: Optional[float]
    pitch_y: Optional[float]

class DefensiveZoneStats(BaseModel):
    interceptions: int
    blocks: int
    turnovers_won: int
    total: int

class DefensiveActionZonesData(BaseModel):
    events: List[DefensiveEvent]
    zones: dict  # zone_name -> DefensiveZoneStats
    totals: dict

# Kickout Landing Zones schemas
class KickoutLandingEvent(BaseModel):
    match_id: str
    minute: Optional[int]
    event_type: str
    is_own_kickout: bool
    won: bool
    pitch_x: Optional[float]
    pitch_y: Optional[float]

class KickoutZoneStats(BaseModel):
    total: int
    won: int
    lost: int
    win_pct: float

class KickoutLandingSummary(BaseModel):
    total: int
    short_pct: float
    mid_pct: float
    long_pct: float
    best_zone: str
    worst_zone: str

class KickoutLandingZonesData(BaseModel):
    zones: dict  # zone_name -> KickoutZoneStats
    events: List[KickoutLandingEvent]
    own_events: List[KickoutLandingEvent]
    opp_events: List[KickoutLandingEvent]
    summary: KickoutLandingSummary

# KPI Sparkline Grid schemas
class KPISparklineValue(BaseModel):
    match_id: str
    value: float

class KPISparklineRow(BaseModel):
    id: str
    name: str
    category: str
    values: List[KPISparklineValue]
    season_avg: float
    last_match: float
    trend: str  # up / down / stable
    min: float
    max: float

class KPISparklineGridData(BaseModel):
    rows: List[KPISparklineRow]


class SeasonDashboardData(BaseModel):
    possession_funnel: PossessionFunnelData
    kickout_trends: List[KickoutTrendMatch]
    turnover_leaderboard: List[TurnoverSourcePlayer]
    red_zone_players: List[RedZonePlayer]
    workhorse_radar: WorkhorseRadarData
    territory_distribution: TerritoryDistributionData
    kpi_cards: Optional[KPICards] = None
    score_timeline: Optional[ScoreTimelineData] = None
    dead_ball_breakdown: Optional[DeadBallBreakdownData] = None
    defensive_action_zones: Optional[DefensiveActionZonesData] = None
    kickout_landing_zones: Optional[KickoutLandingZonesData] = None
    kpi_sparkline_grid: Optional[KPISparklineGridData] = None


# Training Analytics schemas
class LeaderboardPlayer(BaseModel):
    player_id: str
    player_name: str
    avg_total_distance_m: float
    avg_max_speed_ms: float
    avg_high_speed_running_m: float
    avg_sprint_count: float
    avg_dynamic_stress_load: float
    sessions_count: int

class PeakPerformancePoint(BaseModel):
    session_date: str
    avg_distance: float
    avg_max_speed: float
    session_label: Optional[str] = None

class ReadinessPlayer(BaseModel):
    player_id: str
    player_name: str
    readiness_score: float
    status: str  # optimal / fatigued / high_risk
    insight: str

class SpeedZoneBucket(BaseModel):
    session_date: str
    low_m: float
    hsr_m: float
    sprint_m: float
    low_pct: float
    hsr_pct: float
    sprint_pct: float
    total_m: float

class MonotonyPoint(BaseModel):
    session_date: str
    avg_dsl: float
    avg_duration_mins: float
    session_label: Optional[str] = None

class TrainingOverviewKPIs(BaseModel):
    squad_availability: str
    untracked_players: int = 0
    top_speed_player: str
    top_speed_value: float
    hmld_density: Optional[float] = None
    hmld_is_estimate: bool = False
    team_balance_left_pct: float

class TrainingOverviewData(BaseModel):
    leaderboard: List[LeaderboardPlayer]
    squad_averages: dict
    peak_performance: List[PeakPerformancePoint]
    readiness: List[ReadinessPlayer]
    speed_zones: List[SpeedZoneBucket]
    monotony: List[MonotonyPoint]
    overview_kpis: TrainingOverviewKPIs


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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all dashboard data in a single request.

    Returns season summary, top scorers, shot locations, and trends.
    """
    # Get completed matches that have at least one event tagged
    event_count = (
        select(func.count(MatchEvent.id))
        .where(MatchEvent.match_id == Match.id)
        .correlate(Match)
        .scalar_subquery()
    )
    matches_result = await db.execute(
        select(Match).where(
            and_(
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
                Match.club_id == user.club_id,
                event_count > 0,
            )
        ).order_by(Match.match_date.desc())
    )
    matches = matches_result.scalars().all()

    # Calculate season summary
    wins = sum(1 for m in matches if m.team_total_score > m.opponent_total_score)
    losses = sum(1 for m in matches if m.team_total_score < m.opponent_total_score)
    draws = sum(1 for m in matches if m.team_total_score == m.opponent_total_score)

    total_goals_scored = sum(m.team_goals or 0 for m in matches)
    total_points_scored = sum(m.team_points or 0 for m in matches)
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
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE
    ]

    for event in all_events:
        if event.player_id and event.team == Team.OWN and event.event_type in scoring_events:
            pid = str(event.player_id)
            if pid not in player_scores:
                player_scores[pid] = {'goals': 0, 'points': 0, 'two_pointers': 0}
                player_matches[pid] = set()

            player_matches[pid].add(str(event.match_id))

            if event.event_type == EventType.GOAL:
                player_scores[pid]['goals'] += 1
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                player_scores[pid]['points'] += 1  # 45s count as points (1 point)
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
        if event.player_id and event.team == Team.OWN:
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
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.WIDE_FREE,
        EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
    ]

    shot_locations = []
    for event in all_events:
        if event.event_type in shot_events and event.pitch_x is not None:
            is_score = event.event_type in [
                EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE
            ]
            shot_locations.append(ShotLocation(
                x=float(event.pitch_x),
                y=float(event.pitch_y) if event.pitch_y else 50,
                event_type=event.event_type.value,
                is_score=is_score,
                team=event.team.value,
                match_id=str(event.match_id),
            ))

    # Possession zones (turnovers by area)
    zone_stats = {}

    for event in all_events:
        if event.pitch_x is not None and event.team == Team.OWN:
            zone = get_pitch_zone(float(event.pitch_x), float(event.pitch_y) if event.pitch_y else 50)
            if zone not in zone_stats:
                zone_stats[zone] = {'lost': 0, 'won': 0, 'errors': 0}

            if event.event_type == EventType.TURNOVER_LOST:
                zone_stats[zone]['lost'] += 1
            elif event.event_type == EventType.TURNOVER_WON:
                zone_stats[zone]['won'] += 1
            elif event.event_type == EventType.UNFORCED_ERROR:
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
            team_score=m.team_total_score,
            opponent_score=m.opponent_total_score,
            result="W" if m.team_total_score > m.opponent_total_score else (
                "L" if m.team_total_score < m.opponent_total_score else "D"
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get season summary statistics only."""
    dashboard = await get_dashboard_data(user=user, db=db)
    return dashboard.season_summary


@router.get("/top-scorers", response_model=List[TopScorer])
async def get_top_scorers(
    limit: int = Query(10, ge=1, le=50),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get top scorers leaderboard."""
    dashboard = await get_dashboard_data(user=user, db=db)
    return dashboard.top_scorers[:limit]


@router.get("/shot-locations", response_model=List[ShotLocation])
async def get_shot_locations(
    team: Optional[str] = Query(None, description="Filter by team: own or opponent"),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get all shot locations for heat map visualization."""
    dashboard = await get_dashboard_data(user=user, db=db)
    locations = dashboard.shot_locations

    if team:
        locations = [l for l in locations if l.team == team]

    return locations


@router.get("/player/{player_id}/matches", response_model=List[PlayerMatchStats])
async def get_player_match_stats(
    player_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get match-by-match statistics for a specific player.

    Returns scoring and turnover data for each match the player participated in.
    """
    from uuid import UUID

    try:
        player_uuid = UUID(player_id)
    except ValueError:
        return []

    # Get completed matches
    matches_result = await db.execute(
        select(Match).where(
            and_(
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
                Match.club_id == user.club_id,
            )
        ).order_by(Match.match_date.desc())
    )
    matches = matches_result.scalars().all()

    if not matches:
        return []

    match_ids = [m.id for m in matches]
    matches_map = {m.id: m for m in matches}

    # Get all events for this player
    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.player_id == player_uuid,
                MatchEvent.team == Team.OWN
            )
        )
    )
    player_events = events_result.scalars().all()

    # Also check for assists (events where this player is the assist_player)
    assists_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.assist_player_id == player_uuid,
                MatchEvent.team == Team.OWN
            )
        )
    )
    assist_events = assists_result.scalars().all()

    # Aggregate by match
    match_stats = {}

    scoring_events = {
        EventType.GOAL: 'goals',
        EventType.POINT: 'points',
        EventType.POINT_FREE: 'points',
        EventType.FORTY_FIVE: 'points',
        EventType.TWO_POINT: 'two_pointers',
        EventType.TWO_POINT_FREE: 'two_pointers'
    }

    shot_miss_events = {EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED, EventType.FORTY_FIVE_MISSED}

    event_field_map = {
        EventType.TURNOVER_WON: 'turnovers_won',
        EventType.TURNOVER_LOST: 'turnovers_lost',
        EventType.BLOCK: 'blocks',
        EventType.INTERCEPTION: 'interceptions',
        EventType.FREE_WON: 'frees_won',
        EventType.FOUL_WON: 'frees_won',
        EventType.FREE_CONCEDED: 'frees_conceded',
        EventType.FOUL_COMMITTED: 'frees_conceded',
        EventType.YELLOW_CARD: 'yellow_cards',
        EventType.RED_CARD: 'red_cards',
    }

    kickout_won_events = {
        EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON,
        EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
        EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
    }

    kickout_lost_events = {
        EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST,
        EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
        EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
    }

    def init_stats():
        return {
            'goals': 0, 'points': 0, 'two_pointers': 0,
            'turnovers_won': 0, 'turnovers_lost': 0,
            'blocks': 0, 'interceptions': 0,
            'wides': 0, 'shots_short': 0, 'shots_saved': 0,
            'frees_won': 0, 'frees_conceded': 0,
            'yellow_cards': 0, 'red_cards': 0,
            'kickouts_won': 0, 'kickouts_lost': 0,
            'assists': 0,
            'total_shots': 0,  # for accuracy calc
        }

    for event in player_events:
        mid = str(event.match_id)
        if mid not in match_stats:
            match_stats[mid] = init_stats()

        if event.event_type in scoring_events:
            match_stats[mid][scoring_events[event.event_type]] += 1
            match_stats[mid]['total_shots'] += 1
        elif event.event_type in shot_miss_events:
            if event.event_type in (EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED):
                match_stats[mid]['wides'] += 1
            elif event.event_type == EventType.SHORT:
                match_stats[mid]['shots_short'] += 1
            elif event.event_type == EventType.SAVED:
                match_stats[mid]['shots_saved'] += 1
            match_stats[mid]['total_shots'] += 1
        elif event.event_type in event_field_map:
            match_stats[mid][event_field_map[event.event_type]] += 1
        elif event.event_type in kickout_won_events:
            match_stats[mid]['kickouts_won'] += 1
        elif event.event_type in kickout_lost_events:
            match_stats[mid]['kickouts_lost'] += 1

    # Count assists
    for event in assist_events:
        mid = str(event.match_id)
        if mid not in match_stats:
            match_stats[mid] = init_stats()
        match_stats[mid]['assists'] += 1

    # Build response
    result = []
    for mid, stats in match_stats.items():
        match = matches_map.get(UUID(mid))
        if match:
            total_score = stats['goals'] * 3 + stats['points'] + stats['two_pointers'] * 2
            total_shots = stats['total_shots']
            scores = stats['goals'] + stats['points'] + stats['two_pointers']
            accuracy = round(scores / total_shots * 100, 1) if total_shots > 0 else None

            result.append(PlayerMatchStats(
                match_id=mid,
                opponent=match.opponent,
                match_date=match.match_date.isoformat() if match.match_date else "",
                goals=stats['goals'],
                points=stats['points'],
                two_pointers=stats['two_pointers'],
                total_score=total_score,
                turnovers_won=stats['turnovers_won'],
                turnovers_lost=stats['turnovers_lost'],
                blocks=stats['blocks'],
                interceptions=stats['interceptions'],
                wides=stats['wides'],
                shots_short=stats['shots_short'],
                shots_saved=stats['shots_saved'],
                frees_won=stats['frees_won'],
                frees_conceded=stats['frees_conceded'],
                yellow_cards=stats['yellow_cards'],
                red_cards=stats['red_cards'],
                kickouts_won=stats['kickouts_won'],
                kickouts_lost=stats['kickouts_lost'],
                assists=stats['assists'],
                accuracy=accuracy,
            ))

    # Sort by match date descending
    result.sort(key=lambda x: x.match_date, reverse=True)
    return result


class PlayerShotEvent(BaseModel):
    """Individual shot event for spatial plot."""
    match_id: str
    opponent: str
    event_type: str
    pitch_x: Optional[float] = None
    pitch_y: Optional[float] = None
    minute: Optional[int] = None
    half: int = 1


@router.get("/player/{player_id}/shot-events", response_model=List[PlayerShotEvent])
async def get_player_shot_events(
    player_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all shot events for a specific player with pitch coordinates.
    Powers the Shot Map spatial plot on the player page.
    """
    from uuid import UUID

    try:
        player_uuid = UUID(player_id)
    except ValueError:
        return []

    shot_event_types = [
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
        EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED,
        EventType.SHORT, EventType.SAVED,
    ]

    # Get completed matches
    matches_result = await db.execute(
        select(Match).where(
            and_(
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted == False,
                Match.club_id == user.club_id,
            )
        )
    )
    matches = matches_result.scalars().all()
    if not matches:
        return []

    match_ids = [m.id for m in matches]
    matches_map = {m.id: m for m in matches}

    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.player_id == player_uuid,
                MatchEvent.team == Team.OWN,
                MatchEvent.event_type.in_(shot_event_types)
            )
        )
    )
    shot_events = events_result.scalars().all()

    result = []
    for event in shot_events:
        match = matches_map.get(event.match_id)
        if match:
            half = 1
            if event.minute and event.minute > 35:
                half = 2
            result.append(PlayerShotEvent(
                match_id=str(event.match_id),
                opponent=match.opponent,
                event_type=event.event_type.value,
                pitch_x=float(event.pitch_x) if event.pitch_x is not None else None,
                pitch_y=float(event.pitch_y) if event.pitch_y is not None else None,
                minute=event.minute,
                half=half,
            ))

    return result


@router.get("/season-dashboard", response_model=SeasonDashboardData)
async def get_season_dashboard(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get season dashboard data for canonical charts.

    Returns possession funnel, kickout trends, turnover leaderboard,
    red zone players, and workhorse radar data.
    """
    from app.services.season_dashboard_service import SeasonDashboardService

    data = await SeasonDashboardService.get_all(db, user.club_id)

    td = data["territory_distribution"]
    kpi_raw = data.get("kpi_cards")
    kpi = None
    if kpi_raw:
        kpi = KPICards(
            metadata=KPIMetadata(**kpi_raw["metadata"]),
            cards=[KPICardItem(**c) for c in kpi_raw["cards"]],
        )

    # Serialize new chart data
    score_timeline = None
    if data.get("score_timeline"):
        st = data["score_timeline"]
        score_timeline = ScoreTimelineData(
            per_match=st["per_match"],
            summary=ScoreTimelineSummary(**st["summary"]),
        )

    dead_ball = None
    if data.get("dead_ball_breakdown"):
        dead_ball = DeadBallBreakdownData(**data["dead_ball_breakdown"])

    def_zones = None
    if data.get("defensive_action_zones"):
        dz = data["defensive_action_zones"]
        def_zones = DefensiveActionZonesData(
            events=[DefensiveEvent(**e) for e in dz["events"]],
            zones=dz["zones"],
            totals=dz["totals"],
        )

    kickout_zones = None
    if data.get("kickout_landing_zones"):
        kz = data["kickout_landing_zones"]
        kickout_zones = KickoutLandingZonesData(
            zones=kz["zones"],
            events=[KickoutLandingEvent(**e) for e in kz["events"]],
            own_events=[KickoutLandingEvent(**e) for e in kz.get("own_events", [])],
            opp_events=[KickoutLandingEvent(**e) for e in kz.get("opp_events", [])],
            summary=KickoutLandingSummary(**kz["summary"]),
        )

    kpi_sparkline = None
    if data.get("kpi_sparkline_grid"):
        ks = data["kpi_sparkline_grid"]
        kpi_sparkline = KPISparklineGridData(
            rows=[KPISparklineRow(**r) for r in ks["rows"]],
        )

    return SeasonDashboardData(
        possession_funnel=PossessionFunnelData(**data["possession_funnel"]),
        kickout_trends=[KickoutTrendMatch(**k) for k in data["kickout_trends"]],
        turnover_leaderboard=[TurnoverSourcePlayer(**t) for t in data["turnover_leaderboard"]],
        red_zone_players=[RedZonePlayer(**r) for r in data["red_zone_players"]],
        workhorse_radar=WorkhorseRadarData(**data["workhorse_radar"]),
        territory_distribution=TerritoryDistributionData(
            season_totals=td["season_totals"],
            season_pcts=TerritoryZonePcts(**td["season_pcts"]),
            opponent_totals=td["opponent_totals"],
            opponent_pcts=TerritoryZonePcts(**td["opponent_pcts"]),
            per_match=[TerritoryMatchData(**m) for m in td["per_match"]],
            possession_pct=td["possession_pct"],
        ),
        kpi_cards=kpi,
        score_timeline=score_timeline,
        dead_ball_breakdown=dead_ball,
        defensive_action_zones=def_zones,
        kickout_landing_zones=kickout_zones,
        kpi_sparkline_grid=kpi_sparkline,
    )


@router.get("/training-overview", response_model=TrainingOverviewData)
async def get_training_overview(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get training analytics overview data.

    Returns leaderboard, peak performance trend, readiness table,
    speed zone distribution, monotony scatter, and overview KPIs.
    """
    from app.services.training_analytics_service import TrainingAnalyticsService

    data = await TrainingAnalyticsService.get_all(db, club_id=user.club_id)

    return TrainingOverviewData(
        leaderboard=[LeaderboardPlayer(**p) for p in data["leaderboard"]],
        squad_averages=data["squad_averages"],
        peak_performance=[PeakPerformancePoint(**p) for p in data["peak_performance"]],
        readiness=[ReadinessPlayer(**r) for r in data["readiness"]],
        speed_zones=[SpeedZoneBucket(**s) for s in data["speed_zones"]],
        monotony=[MonotonyPoint(**m) for m in data["monotony"]],
        overview_kpis=TrainingOverviewKPIs(**data["overview_kpis"]),
    )
