import PossessionFunnel from '@/components/charts/PossessionFunnel'
import KickoutTrend from '@/components/charts/KickoutTrend'
import TurnoverLeaderboard from '@/components/charts/TurnoverLeaderboard'
import TerritoryDistribution from '@/components/charts/TerritoryDistribution'
import ShotMapCard from '@/components/charts/ShotMapCard'
import ShootingEfficiencyHeatmap from '@/components/charts/ShootingEfficiencyHeatmap'
import RedZoneList from '@/components/charts/RedZoneList'
import WorkhorseRadar from '@/components/charts/WorkhorseRadar'
import DynamicChart from '@/components/DynamicChart'
import type { SeasonDashboardData, DashboardData, AIChartSpec } from '@/services/api'

export interface ChartRegistryEntry {
  id: string
  label: string
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
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <PossessionFunnel data={seasonDashboard.possession_funnel} /> : null,
  },
  {
    id: 'kickout-trend',
    label: 'Kickout Outcomes',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <KickoutTrend data={seasonDashboard.kickout_trends} /> : null,
  },
  {
    id: 'turnover-leaderboard',
    label: 'Turnover Kings',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <TurnoverLeaderboard data={seasonDashboard.turnover_leaderboard} /> : null,
  },
  {
    id: 'territory-distribution',
    label: 'Territory Distribution',
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <TerritoryDistribution data={seasonDashboard.territory_distribution} /> : null,
  },
  {
    id: 'shot-map',
    label: 'Shot Map',
    render: ({ dashboardData }) =>
      <ShotMapCard shotLocations={dashboardData.shot_locations} matchTrends={dashboardData.match_trends} />,
  },
  {
    id: 'shooting-efficiency',
    label: 'Shooting Efficiency',
    render: ({ dashboardData }) =>
      <ShootingEfficiencyHeatmap shots={dashboardData.shot_locations} />,
  },
  {
    id: 'red-zone-list',
    label: 'Red Zone Players',
    requiresGps: true,
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <RedZoneList data={seasonDashboard.red_zone_players} /> : null,
  },
  {
    id: 'workhorse-radar',
    label: 'Workhorse Radar',
    requiresGps: true,
    render: ({ seasonDashboard }) =>
      seasonDashboard ? <WorkhorseRadar data={seasonDashboard.workhorse_radar} /> : null,
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
