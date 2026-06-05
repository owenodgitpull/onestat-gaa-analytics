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


class SeasonHMLDMatch(BaseModel):
    match_id: str
    opponent: str
    date: str
    hmld_density: Optional[float] = None
    total_hml_m: Optional[float] = None
    hsr_m: Optional[float] = None
    sprint_m: Optional[float] = None
    player_count: int
    is_estimate: bool


class SeasonHMLDSeasonAvg(BaseModel):
    hmld_density: Optional[float] = None
    total_hml_m: Optional[float] = None
    hsr_m: Optional[float] = None
    sprint_m: Optional[float] = None


class SeasonHMLDPeak(BaseModel):
    opponent: str
    hmld_density: float


class SeasonHMLDData(BaseModel):
    per_match: List[SeasonHMLDMatch]
    season_avg: SeasonHMLDSeasonAvg
    peak_match: Optional[SeasonHMLDPeak] = None
    trend_pct: Optional[float] = None


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
    season_hmld: Optional[SeasonHMLDData] = None


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
                Match.is_deleted.is_(False),
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
        EventType.WIDE, EventType.SHORT, EventType.SAVED, EventType.HIT_POST,
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
                Match.is_deleted.is_(False),
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

    shot_miss_events = {EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED, EventType.HIT_POST, EventType.FORTY_FIVE_MISSED}

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
            'wides': 0, 'shots_short': 0, 'shots_saved': 0, 'shots_hit_post': 0,
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
            elif event.event_type == EventType.HIT_POST:
                match_stats[mid]['shots_hit_post'] += 1
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
        EventType.SHORT, EventType.SAVED, EventType.HIT_POST,
    ]

    # Get completed matches
    matches_result = await db.execute(
        select(Match).where(
            and_(
                Match.status == MatchStatus.COMPLETED,
                Match.is_deleted.is_(False),
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
            if event.minute and event.minute > (match.half_duration_mins or 30):
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

    season_hmld = None
    if data.get("season_hmld") and data["season_hmld"].get("per_match"):
        sh = data["season_hmld"]
        season_hmld = SeasonHMLDData(
            per_match=[SeasonHMLDMatch(**m) for m in sh["per_match"]],
            season_avg=SeasonHMLDSeasonAvg(**sh["season_avg"]),
            peak_match=SeasonHMLDPeak(**sh["peak_match"]) if sh.get("peak_match") else None,
            trend_pct=sh.get("trend_pct"),
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
        season_hmld=season_hmld,
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


# ============================================================================
# Reports Hub Endpoints
# ============================================================================

class MatchReportScorer(BaseModel):
    player_id: Optional[str] = None
    player_name: str
    goals: int
    points: int
    two_pointers: int
    total: int
    is_from_play: bool


class MatchReportKeyStats(BaseModel):
    team_shots: int
    team_wides: int
    team_turnovers_won: int
    team_turnovers_lost: int
    team_possession_pct: float
    opp_shots: int
    opp_wides: int
    opp_turnovers_won: int
    opp_turnovers_lost: int
    own_kickouts_won_pct: float
    opp_kickouts_won_pct: float


class ScoringTimelinePoint(BaseModel):
    minute: int
    team_cumulative: int
    opp_cumulative: int
    team_event: Optional[str] = None
    opp_event: Optional[str] = None


class MatchReportGPSSummary(BaseModel):
    player_id: str
    player_name: str
    total_distance_km: Optional[float]
    high_speed_running_m: Optional[float]
    sprint_count: Optional[int]
    max_speed_kmh: Optional[float]
    dynamic_stress_load: Optional[float]


class MatchReportPlayerRating(BaseModel):
    player_id: str
    player_name: str
    goals: int
    points: int
    two_pointers: int
    turnovers_won: int
    turnovers_lost: int
    score_value: int


class MatchReportData(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    venue: str
    is_home: bool
    competition: Optional[str]
    team_goals: int
    team_points: int
    opponent_goals: int
    opponent_points: int
    team_total: int
    opponent_total: int
    result: str
    scorers: List[MatchReportScorer]
    key_stats: MatchReportKeyStats
    scoring_timeline: List[ScoringTimelinePoint]
    top_players: List[MatchReportPlayerRating]
    gps_summary: List[MatchReportGPSSummary]
    ai_analysis: Optional[str]


@router.get("/match-report/{match_id}", response_model=MatchReportData)
async def get_match_report(
    match_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Aggregated single-match report data."""
    from uuid import UUID as _UUID
    from app.models.match_gps import MatchGPSData

    try:
        match_uuid = _UUID(match_id)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Match not found")

    match_result = await db.execute(
        select(Match).where(
            and_(Match.id == match_uuid, Match.club_id == user.club_id, Match.is_deleted.is_(False))
        )
    )
    match = match_result.scalar_one_or_none()
    if not match:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Match not found")

    events_result = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == match_uuid)
    )
    events = events_result.scalars().all()

    # Get GPS data
    gps_result = await db.execute(
        select(MatchGPSData).where(MatchGPSData.match_id == match_uuid)
    )
    gps_rows = gps_result.scalars().all()

    # Get player names for GPS
    gps_player_ids = [g.player_id for g in gps_rows]
    gps_player_map: dict = {}
    if gps_player_ids:
        p_result = await db.execute(select(Player).where(Player.id.in_(gps_player_ids)))
        for p in p_result.scalars():
            gps_player_map[p.id] = p.name

    # Collect player IDs from events
    event_player_ids = list({e.player_id for e in events if e.player_id})
    player_map: dict = {}
    if event_player_ids:
        p_result = await db.execute(select(Player).where(Player.id.in_(event_player_ids)))
        for p in p_result.scalars():
            player_map[p.id] = p.name

    scoring_event_types = {
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
        EventType.PENALTY_GOAL,
    }
    from_play_types = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT}
    wide_types = {EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED, EventType.PENALTY_MISS}
    own_kickout_won = {EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK, EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON}
    own_kickout_lost = {EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST}
    opp_kickout_won = {EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK}
    opp_kickout_lost = {EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK}

    team_shots = team_wides = team_to_won = team_to_lost = 0
    opp_shots = opp_wides = opp_to_won = opp_to_lost = 0
    own_ko_won = own_ko_total = opp_ko_won = opp_ko_total = 0
    possession_own = possession_opp = 0

    scorer_map: dict = {}
    timeline_team: list = []
    timeline_opp: list = []

    shot_types_all = {
        EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SHORT, EventType.SAVED, EventType.HIT_POST,
        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.WIDE_FREE, EventType.FORTY_FIVE, EventType.FORTY_FIVE_MISSED,
        EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
    }

    for e in events:
        is_own = e.team == Team.OWN

        # Possession proxy from possession events? use kickouts
        # Shots
        if e.event_type in shot_types_all:
            if is_own:
                team_shots += 1
            else:
                opp_shots += 1

        if e.event_type in wide_types:
            if is_own:
                team_wides += 1
            else:
                opp_wides += 1

        if e.event_type == EventType.TURNOVER_WON:
            if is_own:
                team_to_won += 1
            else:
                opp_to_won += 1

        if e.event_type == EventType.TURNOVER_LOST:
            if is_own:
                team_to_lost += 1
            else:
                opp_to_lost += 1

        if e.event_type in own_kickout_won:
            own_ko_won += 1
            own_ko_total += 1
        elif e.event_type in own_kickout_lost:
            own_ko_total += 1
        elif e.event_type in opp_kickout_won:
            opp_ko_won += 1
            opp_ko_total += 1
        elif e.event_type in opp_kickout_lost:
            opp_ko_total += 1

        # Scorers
        if e.event_type in scoring_event_types and is_own:
            pid = str(e.player_id) if e.player_id else "__unknown__"
            if pid not in scorer_map:
                scorer_map[pid] = {"goals": 0, "points": 0, "two_pointers": 0, "from_play": True}
            if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}:
                scorer_map[pid]["goals"] += 1
            elif e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
                scorer_map[pid]["points"] += 1
            elif e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
                scorer_map[pid]["two_pointers"] += 1
            if e.event_type not in from_play_types:
                scorer_map[pid]["from_play"] = False

        # Timeline
        if e.event_type in scoring_event_types:
            val = 3 if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL} else (2 if e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE} else 1)
            minute = e.minute or 0
            if is_own:
                timeline_team.append((minute, val, e.event_type.value))
            else:
                timeline_opp.append((minute, val, e.event_type.value))

    scorers = []
    for pid, s in scorer_map.items():
        if pid == "__unknown__":
            pname = "Unknown"
        else:
            from uuid import UUID as _UUID2
            try:
                pname = player_map.get(_UUID2(pid), "Unknown")
            except Exception:
                pname = "Unknown"
        total = s["goals"] * 3 + s["points"] + s["two_pointers"] * 2
        scorers.append(MatchReportScorer(
            player_id=pid if pid != "__unknown__" else None,
            player_name=pname,
            goals=s["goals"],
            points=s["points"],
            two_pointers=s["two_pointers"],
            total=total,
            is_from_play=s.get("from_play", True),
        ))
    scorers.sort(key=lambda x: x.total, reverse=True)

    # Build scoring timeline (cumulative)
    all_scoring_events = sorted(
        [(m, v, "team") for m, v, _ in timeline_team] + [(m, v, "opp") for m, v, _ in timeline_opp],
        key=lambda x: x[0]
    )
    team_cum = opp_cum = 0
    scoring_timeline = []
    for minute, val, side in all_scoring_events:
        if side == "team":
            team_cum += val
        else:
            opp_cum += val
        scoring_timeline.append(ScoringTimelinePoint(
            minute=minute,
            team_cumulative=team_cum,
            opp_cumulative=opp_cum,
        ))

    # Player ratings from events
    player_ratings: dict = {}
    for e in events:
        if not e.player_id or e.team != Team.OWN:
            continue
        pid = str(e.player_id)
        if pid not in player_ratings:
            player_ratings[pid] = {"goals": 0, "points": 0, "two_pointers": 0, "turnovers_won": 0, "turnovers_lost": 0}
        if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}:
            player_ratings[pid]["goals"] += 1
        elif e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
            player_ratings[pid]["points"] += 1
        elif e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
            player_ratings[pid]["two_pointers"] += 1
        elif e.event_type == EventType.TURNOVER_WON:
            player_ratings[pid]["turnovers_won"] += 1
        elif e.event_type == EventType.TURNOVER_LOST:
            player_ratings[pid]["turnovers_lost"] += 1

    top_players = []
    for pid, r in player_ratings.items():
        score_val = r["goals"] * 3 + r["points"] + r["two_pointers"] * 2 + r["turnovers_won"]
        if score_val > 0:
            from uuid import UUID as _UUID3
            try:
                pname = player_map.get(_UUID3(pid), "Unknown")
            except Exception:
                pname = "Unknown"
            top_players.append(MatchReportPlayerRating(
                player_id=pid,
                player_name=pname,
                goals=r["goals"],
                points=r["points"],
                two_pointers=r["two_pointers"],
                turnovers_won=r["turnovers_won"],
                turnovers_lost=r["turnovers_lost"],
                score_value=score_val,
            ))
    top_players.sort(key=lambda x: x.score_value, reverse=True)
    top_players = top_players[:5]

    gps_summary = []
    for g in gps_rows:
        gps_summary.append(MatchReportGPSSummary(
            player_id=str(g.player_id),
            player_name=gps_player_map.get(g.player_id, "Unknown"),
            total_distance_km=round(g.total_distance_m / 1000, 2) if g.total_distance_m else None,
            high_speed_running_m=g.high_speed_running_m,
            sprint_count=g.sprint_count,
            max_speed_kmh=round(g.max_speed_ms * 3.6, 1) if g.max_speed_ms else None,
            dynamic_stress_load=g.dynamic_stress_load,
        ))

    possession_pct = 50.0
    if possession_own + possession_opp > 0:
        possession_pct = round(possession_own / (possession_own + possession_opp) * 100, 1)

    key_stats = MatchReportKeyStats(
        team_shots=team_shots,
        team_wides=team_wides,
        team_turnovers_won=team_to_won,
        team_turnovers_lost=team_to_lost,
        team_possession_pct=possession_pct,
        opp_shots=opp_shots,
        opp_wides=opp_wides,
        opp_turnovers_won=opp_to_won,
        opp_turnovers_lost=opp_to_lost,
        own_kickouts_won_pct=round(own_ko_won / own_ko_total * 100, 1) if own_ko_total > 0 else 0,
        opp_kickouts_won_pct=round(opp_ko_won / opp_ko_total * 100, 1) if opp_ko_total > 0 else 0,
    )

    venue_str = match.venue.value if hasattr(match.venue, 'value') else str(match.venue)

    return MatchReportData(
        match_id=str(match.id),
        opponent=match.opponent,
        match_date=match.match_date.isoformat() if match.match_date else "",
        venue=venue_str,
        is_home=match.venue.value == "home" if hasattr(match.venue, 'value') else False,
        competition=match.competition,
        team_goals=match.team_goals or 0,
        team_points=match.team_points or 0,
        opponent_goals=match.opponent_goals or 0,
        opponent_points=match.opponent_points or 0,
        team_total=match.team_total_score,
        opponent_total=match.opponent_total_score,
        result=match.result,
        scorers=scorers,
        key_stats=key_stats,
        scoring_timeline=scoring_timeline,
        top_players=top_players,
        gps_summary=gps_summary,
        ai_analysis=match.ai_analysis,
    )


class PlayerFormMatchRow(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    result: str
    team_score: str
    opp_score: str
    goals: int
    points: int
    two_pointers: int
    score_contribution: int
    turnovers_won: int
    turnovers_lost: int
    gps_distance_km: Optional[float]


class PlayerFormRadar(BaseModel):
    scoring: float
    defence: float
    workload: float
    attendance: float
    fitness: float
    scoring_squad_avg: float
    defence_squad_avg: float
    workload_squad_avg: float
    attendance_squad_avg: float
    fitness_squad_avg: float


class PlayerFormData(BaseModel):
    player_id: str
    player_name: str
    position: str
    form_trend: str  # up / stable / down
    last_5_matches: List[PlayerFormMatchRow]
    radar: PlayerFormRadar
    match_ready: bool
    attendance_rate_pct: float


@router.get("/player-form/{player_id}", response_model=PlayerFormData)
async def get_player_form(
    player_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Per-player form report with last 5 matches and radar data."""
    from uuid import UUID as _UUID
    from app.models.match_gps import MatchGPSData
    from app.models.attendance import Attendance, AttendanceStatus, TrainingSession

    try:
        player_uuid = _UUID(player_id)
    except ValueError:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Player not found")

    player_result = await db.execute(select(Player).where(Player.id == player_uuid))
    player = player_result.scalar_one_or_none()
    if not player:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Player not found")

    # Get completed matches
    matches_result = await db.execute(
        select(Match).where(
            and_(Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False), Match.club_id == user.club_id)
        ).order_by(Match.match_date.desc())
    )
    matches = matches_result.scalars().all()
    match_ids = [m.id for m in matches]
    matches_map = {m.id: m for m in matches}

    # Get player events
    player_events_result = await db.execute(
        select(MatchEvent).where(
            and_(MatchEvent.match_id.in_(match_ids), MatchEvent.player_id == player_uuid, MatchEvent.team == Team.OWN)
        )
    )
    player_events = player_events_result.scalars().all()

    # Aggregate per match
    scoring_event_types = {
        EventType.GOAL, EventType.PENALTY_GOAL, EventType.POINT, EventType.POINT_FREE,
        EventType.FORTY_FIVE, EventType.TWO_POINT, EventType.TWO_POINT_FREE,
    }

    per_match: dict = {}
    for e in player_events:
        mid = e.match_id
        if mid not in per_match:
            per_match[mid] = {"goals": 0, "points": 0, "two_pointers": 0, "to_won": 0, "to_lost": 0}
        if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}:
            per_match[mid]["goals"] += 1
        elif e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
            per_match[mid]["points"] += 1
        elif e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
            per_match[mid]["two_pointers"] += 1
        elif e.event_type == EventType.TURNOVER_WON:
            per_match[mid]["to_won"] += 1
        elif e.event_type == EventType.TURNOVER_LOST:
            per_match[mid]["to_lost"] += 1

    # GPS per match
    gps_result = await db.execute(
        select(MatchGPSData).where(
            and_(MatchGPSData.player_id == player_uuid, MatchGPSData.match_id.in_(match_ids))
        )
    )
    gps_rows = {g.match_id: g for g in gps_result.scalars().all()}

    # Attendance rate (last 8 weeks)
    from datetime import datetime as _dt, timedelta as _td
    eight_weeks_ago = _dt.utcnow().date() - _td(weeks=8)
    sessions_result = await db.execute(
        select(TrainingSession).where(
            and_(TrainingSession.club_id == user.club_id, TrainingSession.session_date >= eight_weeks_ago)
        )
    )
    sessions = sessions_result.scalars().all()
    session_ids = [s.id for s in sessions]
    att_rate = 0.0
    if session_ids:
        att_result = await db.execute(
            select(Attendance).where(
                and_(Attendance.session_id.in_(session_ids), Attendance.player_id == player_uuid)
            )
        )
        att_records = att_result.scalars().all()
        present = sum(1 for a in att_records if a.status in {AttendanceStatus.PRESENT, AttendanceStatus.LATE})
        att_rate = round(present / len(session_ids) * 100, 1) if session_ids else 0.0

    # Build last_5_matches
    participated_match_ids = sorted(per_match.keys(), key=lambda mid: matches_map[mid].match_date if mid in matches_map else "", reverse=True)
    last_5_ids = participated_match_ids[:5]
    last_5_rows = []
    for mid in last_5_ids:
        m = matches_map.get(mid)
        if not m:
            continue
        s = per_match[mid]
        gps = gps_rows.get(mid)
        contribution = s["goals"] * 3 + s["points"] + s["two_pointers"] * 2
        last_5_rows.append(PlayerFormMatchRow(
            match_id=str(mid),
            opponent=m.opponent,
            match_date=m.match_date.isoformat() if m.match_date else "",
            result="W" if m.team_total_score > m.opponent_total_score else ("L" if m.team_total_score < m.opponent_total_score else "D"),
            team_score=f"{m.team_goals}-{m.team_points:02d}",
            opp_score=f"{m.opponent_goals}-{m.opponent_points:02d}",
            goals=s["goals"],
            points=s["points"],
            two_pointers=s["two_pointers"],
            score_contribution=contribution,
            turnovers_won=s["to_won"],
            turnovers_lost=s["to_lost"],
            gps_distance_km=round(gps.total_distance_m / 1000, 2) if gps and gps.total_distance_m else None,
        ))

    # Form trend: compare avg score from last 3 vs previous 2
    scores_all = [per_match[mid]["goals"] * 3 + per_match[mid]["points"] + per_match[mid]["two_pointers"] * 2 for mid in participated_match_ids[:5]]
    form_trend = "stable"
    if len(scores_all) >= 3:
        recent_avg = sum(scores_all[:3]) / 3
        older_avg = sum(scores_all[3:]) / len(scores_all[3:]) if scores_all[3:] else recent_avg
        if recent_avg > older_avg + 0.5:
            form_trend = "up"
        elif recent_avg < older_avg - 0.5:
            form_trend = "down"

    # Radar: per-player averages vs squad averages (simplified from available data)
    player_score_avg = sum(scores_all) / len(scores_all) if scores_all else 0.0
    # Squad avg scoring (per match)
    all_events_result = await db.execute(
        select(MatchEvent).where(
            and_(MatchEvent.match_id.in_(match_ids), MatchEvent.team == Team.OWN)
        )
    )
    all_own_events = all_events_result.scalars().all()

    # Count unique players with scoring events
    all_scorers: dict = {}
    for e in all_own_events:
        if e.event_type in scoring_event_types and e.player_id:
            pid = e.player_id
            if pid not in all_scorers:
                all_scorers[pid] = 0
            if e.event_type in {EventType.GOAL, EventType.PENALTY_GOAL}:
                all_scorers[pid] += 3
            elif e.event_type in {EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE}:
                all_scorers[pid] += 1
            elif e.event_type in {EventType.TWO_POINT, EventType.TWO_POINT_FREE}:
                all_scorers[pid] += 2

    squad_score_avg = sum(all_scorers.values()) / len(all_scorers) if all_scorers else 1.0

    # Defence: turnovers won
    player_def = sum(per_match[mid]["to_won"] for mid in participated_match_ids[:5]) / max(len(participated_match_ids[:5]), 1)
    squad_def_total = sum(1 for e in all_own_events if e.event_type == EventType.TURNOVER_WON)
    squad_def_avg = squad_def_total / max(len(all_scorers), 1)

    # GPS workload
    player_gps_vals = [gps_rows[mid].total_distance_m for mid in participated_match_ids[:5] if mid in gps_rows and gps_rows[mid].total_distance_m]
    player_workload = sum(player_gps_vals) / len(player_gps_vals) / 1000 if player_gps_vals else 0.0

    # Squad GPS avg
    all_gps_result = await db.execute(
        select(MatchGPSData).where(MatchGPSData.match_id.in_(match_ids))
    )
    all_gps = all_gps_result.scalars().all()
    gps_distances = [g.total_distance_m / 1000 for g in all_gps if g.total_distance_m]
    squad_workload = sum(gps_distances) / len(gps_distances) if gps_distances else player_workload or 8.0

    # Normalise radar values to 0-100 scale
    def norm(val: float, avg: float) -> float:
        if avg == 0:
            return 50.0
        return min(100.0, round(val / avg * 50, 1))

    radar = PlayerFormRadar(
        scoring=norm(player_score_avg, squad_score_avg),
        defence=norm(player_def, max(squad_def_avg, 0.1)),
        workload=norm(player_workload, squad_workload),
        attendance=att_rate,
        fitness=50.0,  # placeholder
        scoring_squad_avg=50.0,
        defence_squad_avg=50.0,
        workload_squad_avg=50.0,
        attendance_squad_avg=70.0,
        fitness_squad_avg=50.0,
    )

    match_ready = att_rate >= 50 and (per_match.get(participated_match_ids[0]) is not None if participated_match_ids else False)

    pos = player.position if isinstance(player.position, str) else (player.position.value if hasattr(player.position, 'value') else str(player.position))

    return PlayerFormData(
        player_id=str(player.id),
        player_name=player.name,
        position=pos,
        form_trend=form_trend,
        last_5_matches=last_5_rows,
        radar=radar,
        match_ready=match_ready,
        attendance_rate_pct=att_rate,
    )


class DisciplinePlayerRow(BaseModel):
    player_id: str
    player_name: str
    yellow_cards: int
    black_cards: int
    red_cards: int
    fouls_committed: int
    total_card_value: int  # yellow=1, black=2, red=3


class DisciplineMatchRow(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    result: str
    yellow_cards: int
    black_cards: int
    red_cards: int
    fouls_committed: int
    opp_yellow_cards: int
    opp_red_cards: int


class DisciplineSummaryData(BaseModel):
    players: List[DisciplinePlayerRow]
    per_match: List[DisciplineMatchRow]
    season_totals: dict


@router.get("/discipline-summary", response_model=DisciplineSummaryData)
async def get_discipline_summary(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Cards and fouls discipline summary for the season."""
    from uuid import UUID as _UUID

    matches_result = await db.execute(
        select(Match).where(
            and_(Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False), Match.club_id == user.club_id)
        ).order_by(Match.match_date.asc())
    )
    matches = matches_result.scalars().all()
    if not matches:
        return DisciplineSummaryData(players=[], per_match=[], season_totals={})

    match_ids = [m.id for m in matches]
    matches_map = {m.id: m for m in matches}

    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.event_type.in_([
                    EventType.YELLOW_CARD, EventType.BLACK_CARD, EventType.RED_CARD,
                    EventType.FOUL_COMMITTED, EventType.FREE_CONCEDED,
                ])
            )
        )
    )
    events = events_result.scalars().all()

    player_ids = list({e.player_id for e in events if e.player_id})
    player_map: dict = {}
    if player_ids:
        p_result = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in p_result.scalars():
            player_map[p.id] = p.name

    player_disc: dict = {}
    match_disc: dict = {}

    for e in events:
        mid = e.match_id
        is_own = e.team == Team.OWN

        if mid not in match_disc:
            match_disc[mid] = {"yellow": 0, "black": 0, "red": 0, "fouls": 0, "opp_yellow": 0, "opp_red": 0}

        if e.event_type == EventType.YELLOW_CARD:
            if is_own:
                match_disc[mid]["yellow"] += 1
            else:
                match_disc[mid]["opp_yellow"] += 1
        elif e.event_type == EventType.BLACK_CARD:
            if is_own:
                match_disc[mid]["black"] += 1
        elif e.event_type == EventType.RED_CARD:
            if is_own:
                match_disc[mid]["red"] += 1
            else:
                match_disc[mid]["opp_red"] += 1
        elif e.event_type in {EventType.FOUL_COMMITTED, EventType.FREE_CONCEDED}:
            if is_own:
                match_disc[mid]["fouls"] += 1

        # Player level (own team only)
        if is_own and e.player_id:
            pid = str(e.player_id)
            if pid not in player_disc:
                player_disc[pid] = {"yellow": 0, "black": 0, "red": 0, "fouls": 0}
            if e.event_type == EventType.YELLOW_CARD:
                player_disc[pid]["yellow"] += 1
            elif e.event_type == EventType.BLACK_CARD:
                player_disc[pid]["black"] += 1
            elif e.event_type == EventType.RED_CARD:
                player_disc[pid]["red"] += 1
            elif e.event_type in {EventType.FOUL_COMMITTED, EventType.FREE_CONCEDED}:
                player_disc[pid]["fouls"] += 1

    players_out = []
    for pid, d in player_disc.items():
        try:
            pname = player_map.get(_UUID(pid), "Unknown")
        except Exception:
            pname = "Unknown"
        card_val = d["yellow"] + d["black"] * 2 + d["red"] * 3
        players_out.append(DisciplinePlayerRow(
            player_id=pid,
            player_name=pname,
            yellow_cards=d["yellow"],
            black_cards=d["black"],
            red_cards=d["red"],
            fouls_committed=d["fouls"],
            total_card_value=card_val,
        ))
    players_out.sort(key=lambda x: x.total_card_value, reverse=True)

    per_match_out = []
    for mid, d in match_disc.items():
        m = matches_map.get(mid)
        if not m:
            continue
        per_match_out.append(DisciplineMatchRow(
            match_id=str(mid),
            opponent=m.opponent,
            match_date=m.match_date.isoformat() if m.match_date else "",
            result="W" if m.team_total_score > m.opponent_total_score else ("L" if m.team_total_score < m.opponent_total_score else "D"),
            yellow_cards=d["yellow"],
            black_cards=d["black"],
            red_cards=d["red"],
            fouls_committed=d["fouls"],
            opp_yellow_cards=d["opp_yellow"],
            opp_red_cards=d["opp_red"],
        ))
    per_match_out.sort(key=lambda x: x.match_date)

    season_totals = {
        "yellow_cards": sum(d["yellow"] for d in match_disc.values()),
        "black_cards": sum(d["black"] for d in match_disc.values()),
        "red_cards": sum(d["red"] for d in match_disc.values()),
        "fouls_committed": sum(d["fouls"] for d in match_disc.values()),
    }

    return DisciplineSummaryData(players=players_out, per_match=per_match_out, season_totals=season_totals)


class KickoutMatchRow(BaseModel):
    match_id: str
    opponent: str
    match_date: str
    result: str
    own_won: int
    own_total: int
    own_won_pct: float
    opp_won: int
    opp_total: int
    opp_won_pct: float


class KickoutSummaryData(BaseModel):
    per_match: List[KickoutMatchRow]
    season_own_won_pct: float
    season_opp_won_pct: float
    best_own_match: Optional[str]
    worst_own_match: Optional[str]
    correlation_note: str


@router.get("/kickout-summary", response_model=KickoutSummaryData)
async def get_kickout_summary(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Kickout retention per match with correlation to results."""
    matches_result = await db.execute(
        select(Match).where(
            and_(Match.status == MatchStatus.COMPLETED, Match.is_deleted.is_(False), Match.club_id == user.club_id)
        ).order_by(Match.match_date.asc())
    )
    matches = matches_result.scalars().all()
    if not matches:
        return KickoutSummaryData(
            per_match=[], season_own_won_pct=0, season_opp_won_pct=0,
            best_own_match=None, worst_own_match=None, correlation_note="No data"
        )

    match_ids = [m.id for m in matches]
    matches_map = {m.id: m for m in matches}

    kickout_won_types = {EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK, EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON}
    kickout_lost_types = {EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST}
    opp_kickout_won_types = {EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK}
    opp_kickout_lost_types = {EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK}

    events_result = await db.execute(
        select(MatchEvent).where(
            and_(
                MatchEvent.match_id.in_(match_ids),
                MatchEvent.event_type.in_(
                    list(kickout_won_types) + list(kickout_lost_types) +
                    list(opp_kickout_won_types) + list(opp_kickout_lost_types)
                )
            )
        )
    )
    events = events_result.scalars().all()

    ko_stats: dict = {}
    for e in events:
        mid = e.match_id
        if mid not in ko_stats:
            ko_stats[mid] = {"own_won": 0, "own_total": 0, "opp_won": 0, "opp_total": 0}
        if e.event_type in kickout_won_types:
            ko_stats[mid]["own_won"] += 1
            ko_stats[mid]["own_total"] += 1
        elif e.event_type in kickout_lost_types:
            ko_stats[mid]["own_total"] += 1
        elif e.event_type in opp_kickout_won_types:
            ko_stats[mid]["opp_won"] += 1
            ko_stats[mid]["opp_total"] += 1
        elif e.event_type in opp_kickout_lost_types:
            ko_stats[mid]["opp_total"] += 1

    per_match_out = []
    wins_with_high_ko = wins_total = losses_with_high_ko = 0
    for mid, s in ko_stats.items():
        m = matches_map.get(mid)
        if not m:
            continue
        own_pct = round(s["own_won"] / s["own_total"] * 100, 1) if s["own_total"] > 0 else 0
        opp_pct = round(s["opp_won"] / s["opp_total"] * 100, 1) if s["opp_total"] > 0 else 0
        result = "W" if m.team_total_score > m.opponent_total_score else ("L" if m.team_total_score < m.opponent_total_score else "D")
        if result == "W":
            wins_total += 1
            if own_pct >= 60:
                wins_with_high_ko += 1
        elif result == "L" and own_pct >= 60:
            losses_with_high_ko += 1

        per_match_out.append(KickoutMatchRow(
            match_id=str(mid),
            opponent=m.opponent,
            match_date=m.match_date.isoformat() if m.match_date else "",
            result=result,
            own_won=s["own_won"],
            own_total=s["own_total"],
            own_won_pct=own_pct,
            opp_won=s["opp_won"],
            opp_total=s["opp_total"],
            opp_won_pct=opp_pct,
        ))
    per_match_out.sort(key=lambda x: x.match_date)

    total_own_won = sum(s["own_won"] for s in ko_stats.values())
    total_own = sum(s["own_total"] for s in ko_stats.values())
    total_opp_won = sum(s["opp_won"] for s in ko_stats.values())
    total_opp = sum(s["opp_total"] for s in ko_stats.values())

    best_match = max(per_match_out, key=lambda x: x.own_won_pct, default=None)
    worst_match = min(per_match_out, key=lambda x: x.own_won_pct, default=None)

    if wins_total > 0:
        pct = round(wins_with_high_ko / wins_total * 100)
        correlation_note = f"{pct}% of wins had own kickout retention ≥60%."
    else:
        correlation_note = "Insufficient match data for correlation."

    return KickoutSummaryData(
        per_match=per_match_out,
        season_own_won_pct=round(total_own_won / total_own * 100, 1) if total_own > 0 else 0,
        season_opp_won_pct=round(total_opp_won / total_opp * 100, 1) if total_opp > 0 else 0,
        best_own_match=best_match.opponent if best_match else None,
        worst_own_match=worst_match.opponent if worst_match else None,
        correlation_note=correlation_note,
    )


class TrainingLoadSessionRow(BaseModel):
    session_id: str
    session_date: str
    session_type: str
    location: Optional[str]
    present_count: int
    total_invited: int
    attendance_pct: float
    absent_players: List[str]


class TrainingLoadPlayerRow(BaseModel):
    player_id: str
    player_name: str
    total_distance_km: Optional[float]
    high_speed_running_m: Optional[float]
    sprint_count: Optional[int]
    dynamic_stress_load: Optional[float]
    sessions_attended: int


class TrainingLoadData(BaseModel):
    sessions: List[TrainingLoadSessionRow]
    player_loads: List[TrainingLoadPlayerRow]
    date_from: str
    date_to: str


@router.get("/training-load", response_model=TrainingLoadData)
async def get_training_load(
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Training load report: sessions, attendance, GPS load per player."""
    from datetime import datetime as _dt, timedelta as _td, date as _date
    from app.models.attendance import TrainingSession, Attendance, AttendanceStatus
    from app.models.training_performance import TrainingGPSData

    # Default: current week Mon-Sun
    today = _dt.utcnow().date()
    if date_from:
        try:
            d_from = _date.fromisoformat(date_from)
        except ValueError:
            d_from = today - _td(days=today.weekday())
    else:
        d_from = today - _td(days=today.weekday())

    if date_to:
        try:
            d_to = _date.fromisoformat(date_to)
        except ValueError:
            d_to = d_from + _td(days=6)
    else:
        d_to = d_from + _td(days=6)

    sessions_result = await db.execute(
        select(TrainingSession).where(
            and_(
                TrainingSession.club_id == user.club_id,
                TrainingSession.session_date >= d_from,
                TrainingSession.session_date <= d_to,
            )
        ).order_by(TrainingSession.session_date.asc())
    )
    sessions = sessions_result.scalars().all()

    if not sessions:
        return TrainingLoadData(sessions=[], player_loads=[], date_from=str(d_from), date_to=str(d_to))

    session_ids = [s.id for s in sessions]

    # Get all attendance
    att_result = await db.execute(
        select(Attendance).where(Attendance.session_id.in_(session_ids))
    )
    all_attendance = att_result.scalars().all()

    # Get player names
    player_ids = list({a.player_id for a in all_attendance})
    player_map: dict = {}
    if player_ids:
        p_result = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        for p in p_result.scalars():
            player_map[p.id] = p.name

    # Get GPS for these sessions
    gps_result = await db.execute(
        select(TrainingGPSData).where(TrainingGPSData.session_id.in_(session_ids))
    )
    gps_rows = gps_result.scalars().all()

    # Build session rows
    sessions_out = []
    for s in sessions:
        session_att = [a for a in all_attendance if a.session_id == s.id]
        present = [a for a in session_att if a.status in {AttendanceStatus.PRESENT, AttendanceStatus.LATE}]
        absent_ids = {a.player_id for a in session_att if a.status == AttendanceStatus.ABSENT}
        absent_names = [player_map.get(pid, "Unknown") for pid in absent_ids]
        total = len(session_att)
        sessions_out.append(TrainingLoadSessionRow(
            session_id=str(s.id),
            session_date=str(s.session_date),
            session_type=s.session_type.value if hasattr(s.session_type, 'value') else str(s.session_type),
            location=s.location,
            present_count=len(present),
            total_invited=total,
            attendance_pct=round(len(present) / total * 100, 1) if total > 0 else 0,
            absent_players=sorted(absent_names),
        ))

    # Aggregate GPS per player
    player_gps: dict = {}
    for g in gps_rows:
        pid = str(g.player_id)
        if pid not in player_gps:
            player_gps[pid] = {"distance": [], "hsr": [], "sprints": [], "dsl": [], "sessions": 0}
        player_gps[pid]["sessions"] += 1
        if g.total_distance_m:
            player_gps[pid]["distance"].append(g.total_distance_m / 1000)
        if g.high_speed_running_m:
            player_gps[pid]["hsr"].append(g.high_speed_running_m)
        if g.sprint_count:
            player_gps[pid]["sprints"].append(g.sprint_count)
        if g.dynamic_stress_load:
            player_gps[pid]["dsl"].append(g.dynamic_stress_load)

    player_loads = []
    from uuid import UUID as _UUID
    for pid, g in player_gps.items():
        try:
            pname = player_map.get(_UUID(pid), "Unknown")
        except Exception:
            pname = "Unknown"
        player_loads.append(TrainingLoadPlayerRow(
            player_id=pid,
            player_name=pname,
            total_distance_km=round(sum(g["distance"]), 2) if g["distance"] else None,
            high_speed_running_m=round(sum(g["hsr"]), 1) if g["hsr"] else None,
            sprint_count=sum(g["sprints"]) if g["sprints"] else None,
            dynamic_stress_load=round(sum(g["dsl"]), 1) if g["dsl"] else None,
            sessions_attended=g["sessions"],
        ))
    player_loads.sort(key=lambda x: x.total_distance_km or 0, reverse=True)

    return TrainingLoadData(
        sessions=sessions_out,
        player_loads=player_loads,
        date_from=str(d_from),
        date_to=str(d_to),
    )
