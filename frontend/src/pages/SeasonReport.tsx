import { useEffect, useState } from 'react'
import { FileText, TrendingUp, BarChart3, Trophy, Target, Shield } from 'lucide-react'
import { useClubName } from '@/contexts/ClubContext'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import { KPI_REGISTRY } from '@/config/kpiRegistry'
import { CANONICAL_CHARTS, type ChartRenderProps } from '@/config/chartRegistry'
import { api, DashboardData, SeasonDashboardData, KPICardItem } from '@/services/api'

// Build explanations lookup from registry
const KPI_EXPLANATIONS: Record<string, { what: string; formula: string }> = {}
for (const entry of KPI_REGISTRY) {
  Object.assign(KPI_EXPLANATIONS, entry.explanations)
}

// Group KPI entries by theme
function groupByTheme() {
  const groups: Record<string, typeof KPI_REGISTRY> = {}
  for (const entry of KPI_REGISTRY) {
    if (!groups[entry.theme]) groups[entry.theme] = []
    groups[entry.theme].push(entry)
  }
  return groups
}

const THEME_ICONS: Record<string, React.ReactNode> = {
  'Scoring Output': <Target size={16} className="text-amber-400" />,
  'Defence': <Shield size={16} className="text-blue-400" />,
  'Restarts': <Trophy size={16} className="text-emerald-400" />,
  'Transition & Efficiency': <TrendingUp size={16} className="text-purple-400" />,
  'Defensive System': <Shield size={16} className="text-red-400" />,
  'Defensive Solidity': <Shield size={16} className="text-orange-400" />,
  'Territory': <BarChart3 size={16} className="text-cyan-400" />,
  'Scoring Quality': <Target size={16} className="text-yellow-400" />,
  'Goal Threat': <Target size={16} className="text-rose-400" />,
  'Restart Attack': <Trophy size={16} className="text-teal-400" />,
  'Discipline': <Shield size={16} className="text-pink-400" />,
}

function formatKPIValue(card: KPICardItem): string {
  if (card.format === 'percent') return `${card.value}%`
  if (card.format === 'signed_int') return card.value > 0 ? `+${card.value}` : `${card.value}`
  return `${card.value}`
}

function getValueColor(color: string): string {
  const map: Record<string, string> = {
    green: 'text-emerald-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }
  return map[color] || 'text-white'
}

export default function SeasonReport() {
  const clubName = useClubName()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [seasonDashboard, setSeasonDashboard] = useState<SeasonDashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchData() {
      setLoading(true)
      setError(null)
      try {
        const [data, seasonData] = await Promise.all([
          api.analytics.getDashboard(),
          api.analytics.getSeasonDashboard().catch(() => null),
        ])
        setDashboardData(data)
        setSeasonDashboard(seasonData)
      } catch (err) {
        setError('Failed to load season report data')
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  if (loading) return <LoadingSkeleton />

  if (error || !dashboardData) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'No data available'}</p>
      </div>
    )
  }

  const { season_summary } = dashboardData
  const kpiCards = seasonDashboard?.kpi_cards?.cards || []
  const metadata = seasonDashboard?.kpi_cards?.metadata
  const themeGroups = groupByTheme()

  const chartRenderProps: ChartRenderProps = {
    seasonDashboard,
    dashboardData,
  }

  return (
    <div className="space-y-8 max-w-5xl mx-auto pb-16">
      {/* 1. Header */}
      <div className="glass-card p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/30 to-blue-500/30 flex items-center justify-center">
              <FileText size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Season Report</h1>
              <p className="text-sm text-white/50">
                {clubName}
                {metadata && (
                  <> &middot; {metadata.matches_played} matches played</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white text-sm font-medium transition-colors print:hidden"
          >
            Print / Export
          </button>
        </div>
      </div>

      {/* 2. AI Executive Summary */}
      {season_summary && (
        <div className="glass-card p-6">
          <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-400" />
            Executive Summary
          </h2>
          <p className="text-white/70 leading-relaxed">
            {clubName} have played {season_summary.matches_played} matches this season with a{' '}
            {season_summary.win_rate}% win rate ({season_summary.wins}W-{season_summary.losses}L-{season_summary.draws}D).
            Averaging {season_summary.avg_score_per_match} points scored and {season_summary.avg_conceded_per_match} conceded per game,
            with {season_summary.total_goals_scored} goals scored and {season_summary.total_goals_conceded} conceded across the season.
          </p>
        </div>
      )}

      {/* 3. Season Overview Stats */}
      <div>
        <h2 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
          <Trophy size={18} className="text-amber-400" />
          Season Overview
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="glass-card p-4 text-center">
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">Played</div>
            <div className="text-2xl font-bold text-white">{season_summary.matches_played}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">Won</div>
            <div className="text-2xl font-bold text-emerald-400">{season_summary.wins}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">Lost</div>
            <div className="text-2xl font-bold text-red-400">{season_summary.losses}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">Drawn</div>
            <div className="text-2xl font-bold text-white/60">{season_summary.draws}</div>
          </div>
          <div className="glass-card p-4 text-center">
            <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">Win Rate</div>
            <div className="text-2xl font-bold text-emerald-400">{season_summary.win_rate}%</div>
          </div>
        </div>
      </div>

      {/* 4. KPI Section — grouped by theme, front + flip side by side */}
      {kpiCards.length > 0 && (
        <div>
          <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <TrendingUp size={18} className="text-emerald-400" />
            Key Performance Indicators
          </h2>

          {Object.entries(themeGroups).map(([theme, entries], groupIdx) => {
            // Only show themes that have cards in the data
            const entriesWithCards = entries.filter(e =>
              kpiCards.some(c => c.key === e.frontKey)
            )
            if (entriesWithCards.length === 0) return null

            return (
              <div key={theme} className={groupIdx > 0 ? 'mt-6' : ''}>
                {/* Theme header with divider */}
                {groupIdx > 0 && (
                  <div className="border-t border-white/10 mb-4" />
                )}
                <div className="flex items-center gap-2 mb-3">
                  {THEME_ICONS[theme] || <TrendingUp size={16} className="text-white/40" />}
                  <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">{theme}</h3>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {entriesWithCards.map(entry => {
                    const frontCard = kpiCards.find(c => c.key === entry.frontKey)
                    const flipCard = entry.flipKey ? kpiCards.find(c => c.key === entry.flipKey) : null

                    return (
                      <div key={entry.id} className="glass-card p-4">
                        <div className={flipCard ? 'grid grid-cols-2 gap-4' : ''}>
                          {/* Front card */}
                          {frontCard && (
                            <div>
                              <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">
                                {frontCard.label}
                              </div>
                              <div className={`text-2xl font-bold ${getValueColor(frontCard.color)}`}>
                                {formatKPIValue(frontCard)}
                              </div>
                              {frontCard.insight && (
                                <div className="text-xs text-white/40 mt-1.5 leading-relaxed line-clamp-2">
                                  {frontCard.insight}
                                </div>
                              )}
                            </div>
                          )}

                          {/* Flip card (shown side by side) */}
                          {flipCard && (
                            <div className="border-l border-white/10 pl-4">
                              <div className="text-white/50 text-xs font-semibold uppercase tracking-wide mb-1">
                                {flipCard.label}
                              </div>
                              <div className={`text-2xl font-bold ${getValueColor(flipCard.color)}`}>
                                {formatKPIValue(flipCard)}
                              </div>
                              {flipCard.insight && (
                                <div className="text-xs text-white/40 mt-1.5 leading-relaxed line-clamp-2">
                                  {flipCard.insight}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 5. Charts Section — all charts, single column */}
      <div>
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <BarChart3 size={18} className="text-blue-400" />
          Season Charts
        </h2>

        <div className="space-y-6">
          {CANONICAL_CHARTS.map(chart => {
            // Skip GPS charts if no GPS data
            if (chart.requiresGps && seasonDashboard &&
              seasonDashboard.red_zone_players.length === 0 &&
              seasonDashboard.workhorse_radar.metrics.length === 0) {
              return null
            }

            const rendered = chart.render(chartRenderProps)
            if (!rendered) return null

            return (
              <div key={chart.id} className="glass-card p-5">
                <div className="mb-3">
                  <h3 className="text-base font-bold text-white">{chart.label}</h3>
                  {chart.description && (
                    <p className="text-xs text-white/40 mt-0.5">{chart.description}</p>
                  )}
                </div>
                {rendered}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
