import PossessionFunnel from '@/components/charts/PossessionFunnel'
import SeasonHMLDChart from '@/components/charts/SeasonHMLDChart'
import KickoutTrend from '@/components/charts/KickoutTrend'
import TurnoverLeaderboard from '@/components/charts/TurnoverLeaderboard'
import TerritoryDistribution from '@/components/charts/TerritoryDistribution'
import AttackingThirds from '@/components/charts/AttackingThirds'
import ShotMapCard from '@/components/charts/ShotMapCard'
import ShootingEfficiencyHeatmap from '@/components/charts/ShootingEfficiencyHeatmap'
import RedZoneList from '@/components/charts/RedZoneList'
import WorkhorseRadar from '@/components/charts/WorkhorseRadar'
import ScoreMomentumChart from '@/components/charts/ScoreMomentumChart'
import DeadBallBreakdownChart from '@/components/charts/DeadBallBreakdownChart'
import DefensiveActionZones from '@/components/charts/DefensiveActionZones'
import KickoutLandingZones from '@/components/charts/KickoutLandingZones'
import KPISparklineGrid from '@/components/charts/KPISparklineGrid'
import SeasonExpectedPoints from '@/components/charts/SeasonExpectedPoints'
import TransitionSpeedChart from '@/components/charts/TransitionSpeedChart'
import DynamicChart from '@/components/DynamicChart'
import type { SeasonDashboardData, DashboardData, AIChartSpec, SeasonExpectedPointsData, AttackingThirdsData } from '@/services/api'

// Fallback shape when seasonDashboard has loaded but expected_points_season
// itself is missing/empty — lets SeasonExpectedPoints show its own honest
// "no data yet" message instead of the generic loading placeholder.
const EMPTY_SEASON_XP: SeasonExpectedPointsData = {
  season_team_expected_points: 0,
  season_team_actual_points: 0,
  season_opponent_expected_points: 0,
  season_opponent_actual_points: 0,
  per_match: [],
  players: [],
}

const EMPTY_ATTACKING_THIRDS: AttackingThirdsData = {
  season_totals: { left: 0, centre: 0, right: 0 },
  season_pcts: { left: 0, centre: 0, right: 0 },
  opponent_totals: { left: 0, centre: 0, right: 0 },
  opponent_pcts: { left: 0, centre: 0, right: 0 },
  season_threat: { left: 0, centre: 0, right: 0 },
  opponent_threat: { left: 0, centre: 0, right: 0 },
  season_threat_basis: 'volume',
  opponent_threat_basis: 'volume',
  per_match: [],
  excluded_match_count: 0,
}

export interface ChartRegistryEntry {
  id: string
  label: string
  description?: string
  category?: string
  colSpan?: 1 | 2
  requiresGps?: boolean
  render: (props: ChartRenderProps) => React.ReactNode | null
}

export interface ChartRenderProps {
  seasonDashboard: SeasonDashboardData | null
  dashboardData: DashboardData
  pinnedAiChart?: AIChartSpec
  onUnpin?: (chartId: string) => void
}

export const CANONICAL_CHARTS: ChartRegistryEntry[] = [
  {
    id: 'possession-funnel',
    label: 'Possession Funnel',
    description: 'How possessions convert through attacks, shots, and scores',
    category: 'Possession',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <PossessionFunnel data={seasonDashboard.possession_funnel} insight={seasonDashboard.possession_funnel?.insight} matchesInView={seasonDashboard.matches_in_view} /> : null,
  },
  {
    id: 'kickout-trend',
    label: 'Kickout Outcomes',
    description: 'Kickout win rate and contest type across each match',
    category: 'Kickouts',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <KickoutTrend data={seasonDashboard.kickout_trends} /> : null,
  },
  {
    id: 'turnover-leaderboard',
    label: 'Turnover Kings',
    description: 'Top ball-winners ranked by interceptions, blocks, and turnovers',
    category: 'Defence',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <TurnoverLeaderboard data={seasonDashboard.turnover_leaderboard} /> : null,
  },
  {
    id: 'season-expected-points',
    label: 'Expected Points — Season',
    description: 'Cumulative chance quality vs actual scoring across the season, plus over/under-performers',
    category: 'Scoring',
    // Only fall through to the generic "loading data..." card while
    // seasonDashboard itself hasn't arrived yet. Once it HAS loaded, always
    // render the chart — even if expected_points_season came back empty —
    // so SeasonExpectedPoints' own "no shot location data yet" message shows
    // instead of a loading spinner that never resolves (which is exactly
    // what happened when the field was present-but-empty or briefly absent:
    // the old `seasonDashboard?.expected_points_season ? ... : null` guard
    // returned null either way, and null always renders as "loading data...").
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <SeasonExpectedPoints data={seasonDashboard.expected_points_season ?? EMPTY_SEASON_XP} /> : null,
  },
  {
    id: 'territory-distribution',
    label: 'Territory Distribution',
    description: 'Time spent in each third of the pitch',
    category: 'Possession',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <TerritoryDistribution data={seasonDashboard.territory_distribution} matchesInView={seasonDashboard.matches_in_view} /> : null,
  },
  {
    id: 'attacking-thirds',
    label: 'Attacking Thirds',
    description: 'Which channel — left, centre or right — attacking-third play flows through',
    category: 'Possession',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <AttackingThirds data={seasonDashboard.attacking_thirds ?? EMPTY_ATTACKING_THIRDS} matchesInView={seasonDashboard.matches_in_view} /> : null,
  },
  {
    id: 'shot-map',
    label: 'Shot Map',
    description: 'Every shot plotted on the pitch by outcome',
    category: 'Scoring',
    render: ({ dashboardData }) =>
      <ShotMapCard shotLocations={dashboardData.shot_locations} matchTrends={dashboardData.match_trends} />,
  },
  {
    id: 'shooting-efficiency',
    label: 'Shooting Efficiency',
    description: 'Conversion rate by pitch zone',
    category: 'Scoring',
    render: ({ dashboardData }) =>
      <ShootingEfficiencyHeatmap shots={dashboardData.shot_locations} />,
  },
  {
    id: 'red-zone-list',
    label: 'Red Zone Players',
    description: 'Players with workload spiking 20%+ above average',
    category: 'GPS',
    requiresGps: true,
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <RedZoneList data={seasonDashboard.red_zone_players} /> : null,
  },
  {
    id: 'workhorse-radar',
    label: 'Workhorse Radar',
    description: 'Physical output radar — last match vs season average',
    category: 'GPS',
    requiresGps: true,
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <WorkhorseRadar data={seasonDashboard.workhorse_radar} /> : null,
  },
  {
    id: 'score-momentum',
    label: 'Score Momentum',
    description: 'Cumulative score difference showing momentum swings and droughts',
    category: 'Scoring',
    colSpan: 2,
    render: ({ seasonDashboard }) =>
      seasonDashboard?.score_timeline ? <ScoreMomentumChart data={seasonDashboard.score_timeline} /> : null,
  },
  {
    id: 'dead-ball-vs-play',
    label: 'Dead Ball vs Play',
    description: 'Breakdown of scores by source — play, frees, 45s, penalties',
    category: 'Scoring',
    render: ({ seasonDashboard }) =>
      seasonDashboard?.dead_ball_breakdown ? <DeadBallBreakdownChart data={seasonDashboard.dead_ball_breakdown} /> : null,
  },
  {
    id: 'defensive-zones',
    label: 'Defensive Action Zones',
    description: 'Pitch map of where blocks, interceptions, and turnovers happen',
    category: 'Defence',
    render: ({ seasonDashboard }) =>
      seasonDashboard?.defensive_action_zones ? <DefensiveActionZones data={seasonDashboard.defensive_action_zones} /> : null,
  },
  {
    id: 'kickout-landing-zones',
    label: 'Kickout Landing Zones',
    description: '9-zone heatmap of kickout landing spots and win/loss rates',
    category: 'Kickouts',
    render: ({ seasonDashboard }) =>
      seasonDashboard?.kickout_landing_zones ? <KickoutLandingZones data={seasonDashboard.kickout_landing_zones} /> : null,
  },
  {
    id: 'kpi-sparkline-grid',
    label: 'KPI Dashboard',
    description: '16 key metrics with sparkline trends — season health at a glance',
    category: 'Overview',
    colSpan: 2,
    render: ({ seasonDashboard }) =>
      seasonDashboard?.kpi_sparkline_grid ? <KPISparklineGrid data={seasonDashboard.kpi_sparkline_grid} /> : null,
  },
  {
    id: 'season-hmld',
    label: 'Season Intensity',
    description: 'Per-match HMLD density, HSR, and sprint distance — team average GPS across the season',
    category: 'GPS',
    requiresGps: true,
    render: ({ seasonDashboard }) =>
      seasonDashboard?.season_hmld && seasonDashboard.season_hmld.per_match.length > 0
        ? <SeasonHMLDChart data={seasonDashboard.season_hmld} />
        : null,
  },
  {
    id: 'transition-speed',
    label: 'Transition Speed',
    description: 'Ball Recovery Time and Turnover-to-Shot Time, toggled — how fast the team wins the ball back and how fast it converts that into a shot',
    category: 'Defence',
    render: ({ seasonDashboard }) =>
      seasonDashboard?.transition_speed && seasonDashboard.transition_speed.per_match.length > 0
        ? <TransitionSpeedChart data={seasonDashboard.transition_speed} />
        : null,
  },
]

// Build a pinned AI chart entry
export function makePinnedAiEntry(chart: AIChartSpec): ChartRegistryEntry {
  return {
    id: `ai-${chart.id}`,
    label: chart.title,
    render: ({ onUnpin }) => (
      <DynamicChart
        chart={chart}
        onUnpin={onUnpin ? () => onUnpin(chart.id) : undefined}
        isPinned={true}
        canPin={false}
      />
    ),
  }
}

export function getChartRegistry(): Map<string, ChartRegistryEntry> {
  const map = new Map<string, ChartRegistryEntry>()
  CANONICAL_CHARTS.forEach(c => map.set(c.id, c))
  return map
}
