import { useEffect, useState, useCallback } from 'react'
import {
  TrendingUp,
  Target,
  Activity,
  Calendar,
  Trophy,
  Zap,
  MapPin,
  RefreshCw,
  MessageSquare,
  Bot,
  Crosshair,
  Percent,
  CircleDot,
  Sparkles,
  Heart,
  BarChart3
} from 'lucide-react'
import AIAnalyst from '@/components/AIAnalyst'
import SquadHealthView from '@/components/SquadHealthView'
import DynamicChart from '@/components/DynamicChart'
import { api, DashboardData, AIChartSpec } from '@/services/api'

export default function AnalyticsDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [aiCharts, setAiCharts] = useState<AIChartSpec[]>([])
  const [aiChartsSummary, setAiChartsSummary] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shotFilter, setShotFilter] = useState<'all' | 'dungloe' | 'opponent'>('dungloe')
  const [showAIChat, setShowAIChat] = useState(false)
  const [loadingAICharts, setLoadingAICharts] = useState(false)
  const [replacingChartId, setReplacingChartId] = useState<string | null>(null)
  const [dismissedChartIds, setDismissedChartIds] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<'season' | 'health'>('season')

  const fetchDashboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.analytics.getDashboard()
      setDashboardData(data)
    } catch (err) {
      setError('Failed to load dashboard data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const fetchAICharts = useCallback(async () => {
    setLoadingAICharts(true)
    try {
      const result = await api.ai.getDashboardCharts(dismissedChartIds, 4)
      if (result.success && result.charts) {
        setAiCharts(result.charts)
        setAiChartsSummary(result.summary || '')
      }
    } catch (err) {
      console.error('Failed to load AI charts:', err)
    } finally {
      setLoadingAICharts(false)
    }
  }, [dismissedChartIds])

  const handleDismissChart = async (chartId: string) => {
    setReplacingChartId(chartId)

    // Track dismissed chart ID to avoid regenerating it
    const newDismissedIds = [...dismissedChartIds, chartId]
    setDismissedChartIds(newDismissedIds)

    try {
      // Get a replacement chart
      const result = await api.ai.getReplacementChart(newDismissedIds)

      if (result.success && result.chart) {
        // Replace the dismissed chart with the new one
        setAiCharts(prev => prev.map(c =>
          c.id === chartId ? result.chart! : c
        ))
      } else {
        // If replacement failed, just remove the chart
        setAiCharts(prev => prev.filter(c => c.id !== chartId))
      }
    } catch (err) {
      console.error('Failed to get replacement chart:', err)
      // Remove the chart if replacement failed
      setAiCharts(prev => prev.filter(c => c.id !== chartId))
    } finally {
      setReplacingChartId(null)
    }
  }

  useEffect(() => {
    fetchDashboard()
    fetchAICharts()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  if (error || !dashboardData) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'No data available'}</p>
        <button onClick={fetchDashboard} className="btn-glass">
          Retry
        </button>
      </div>
    )
  }

  const { season_summary, top_scorers, top_turnovers, shot_locations, possession_zones, match_trends } = dashboardData

  // Filter shots for heat map
  const filteredShots = shotFilter === 'all'
    ? shot_locations
    : shot_locations.filter(s => s.team === shotFilter)

  // Calculate shot statistics
  const totalShots = filteredShots.length
  const scoredShots = filteredShots.filter(s => s.is_score)
  const missedShots = filteredShots.filter(s => !s.is_score)
  const goals = filteredShots.filter(s => s.is_score && s.event_type === 'GOAL')
  const points = filteredShots.filter(s => s.is_score && (s.event_type === 'POINT' || s.event_type === '2_POINTER'))

  // Accuracy = scores / total shots
  const accuracy = totalShots > 0 ? Math.round((scoredShots.length / totalShots) * 100) : 0

  // Calculate possession/territory data from zones
  const totalTurnoversWon = possession_zones.reduce((sum, z) => sum + z.turnovers_won, 0)
  const totalTurnoversLost = possession_zones.reduce((sum, z) => sum + z.turnovers_lost, 0)
  const netPossession = totalTurnoversWon - totalTurnoversLost

  // Estimate possession based on scoring and turnovers
  const dungloeScores = season_summary.total_goals_scored + season_summary.total_points_scored
  const oppScores = season_summary.total_goals_conceded + season_summary.total_points_conceded
  const totalScores = dungloeScores + oppScores
  const estimatedPossession = totalScores > 0
    ? Math.round((dungloeScores / totalScores) * 100) + Math.round(netPossession * 2)
    : 50

  // Clamp possession between 20-80 for display
  const possessionPercent = Math.max(20, Math.min(80, estimatedPossession))


  return (
    <div className="space-y-8">
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex bg-white/10 rounded-xl p-1">
          <button
            onClick={() => setViewMode('season')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              viewMode === 'season'
                ? 'bg-indigo-600 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <BarChart3 size={18} />
            Season Stats
          </button>
          <button
            onClick={() => setViewMode('health')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              viewMode === 'health'
                ? 'bg-rose-600 text-white'
                : 'text-white/60 hover:text-white'
            }`}
          >
            <Heart size={18} />
            Squad Health
          </button>
        </div>
        {viewMode === 'season' && (
          <button onClick={fetchDashboard} className="btn-glass flex items-center gap-2">
            <RefreshCw size={16} />
            Refresh
          </button>
        )}
      </div>

      {/* Conditional View */}
      {viewMode === 'health' ? (
        <SquadHealthView />
      ) : (
        <>
      {/* Season Overview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <TrendingUp size={24} className="text-white" />
            <span className="text-white">Season Overview</span>
          </h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Matches Played</div>
            <div className="stat-value">{season_summary.matches_played}</div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Win Rate</div>
            <div className="stat-value text-emerald-400">{season_summary.win_rate}%</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.wins}W - {season_summary.losses}L - {season_summary.draws}D
            </div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Avg Score</div>
            <div className="stat-value text-amber-400">{season_summary.avg_score_per_match}</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.total_goals_scored}G + {season_summary.total_points_scored}P
            </div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Avg Conceded</div>
            <div className="stat-value text-red-400">{season_summary.avg_conceded_per_match}</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.total_goals_conceded}G + {season_summary.total_points_conceded}P
            </div>
          </div>
        </div>
      </div>

      {/* STAPLE CHARTS - Shot Map + Possession (Always Shown) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shot Map with Stats Below */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold flex items-center space-x-2 text-white">
              <MapPin size={20} className="text-white" />
              <span>Shot Map</span>
              <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full ml-2">Staple</span>
            </h3>
            <div className="flex gap-2">
              {(['dungloe', 'opponent', 'all'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setShotFilter(filter)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    shotFilter === filter
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'dungloe' ? 'Dungloe' : 'Opponent'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden" style={{ aspectRatio: '16/10' }}>
            <svg viewBox="0 0 2332 1446" className="w-full h-full">
              <rect width="2332" height="1446" fill="#2d5016" />
              <image
                href="/pitch-svg.svg"
                width="2332"
                height="1446"
                preserveAspectRatio="xMidYMid meet"
              />
              {filteredShots.map((shot, idx) => {
                const x = (shot.x / 100) * 1960 + 183
                const y = (shot.y / 100) * 1167 + 123
                const color = shot.is_score ? '#10b981' : '#ef4444'
                return (
                  <circle
                    key={idx}
                    cx={x}
                    cy={y}
                    r="18"
                    fill={color}
                    stroke="white"
                    strokeWidth="3"
                    opacity="0.85"
                  />
                )
              })}
            </svg>
          </div>

          {/* Shot Statistics */}
          <div className="grid grid-cols-4 gap-3 mt-4">
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-white/60 text-xs mb-1">
                <Crosshair size={12} />
                <span>Total</span>
              </div>
              <div className="text-2xl font-bold text-white">{totalShots}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-white/60 text-xs mb-1">
                <Percent size={12} />
                <span>Accuracy</span>
              </div>
              <div className="text-2xl font-bold text-emerald-400">{accuracy}%</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-white/60 text-xs mb-1">
                <Target size={12} />
                <span>Goals</span>
              </div>
              <div className="text-2xl font-bold text-amber-400">{goals.length}</div>
            </div>
            <div className="bg-white/5 rounded-xl p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-white/60 text-xs mb-1">
                <CircleDot size={12} />
                <span>Points</span>
              </div>
              <div className="text-2xl font-bold text-indigo-400">{points.length}</div>
            </div>
          </div>

          {/* Legend */}
          <div className="flex justify-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              Scored ({scoredShots.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              Missed ({missedShots.length})
            </span>
          </div>
        </div>

        {/* Possession / Territory Chart */}
        <div className="glass-card p-6 flex flex-col">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Activity size={20} className="text-white" />
            <span>Possession & Territory</span>
            <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full ml-2">Staple</span>
          </h3>

          {/* Possession Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="text-indigo-400 font-semibold">Dungloe</span>
              <span className="text-orange-400 font-semibold">Opponents</span>
            </div>
            <div className="relative h-10 rounded-full overflow-hidden bg-orange-500/80">
              <div
                className="absolute left-0 top-0 h-full bg-gradient-to-r from-indigo-600 to-indigo-500 transition-all duration-500"
                style={{ width: `${possessionPercent}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-between px-4">
                <span className="text-white font-bold text-lg">{possessionPercent}%</span>
                <span className="text-white font-bold text-lg">{100 - possessionPercent}%</span>
              </div>
            </div>
          </div>

          {/* Territory Breakdown */}
          <div className="flex-1">
            <div className="text-sm text-white/60 mb-3">Territory Control by Zone</div>
            <div className="grid grid-cols-3 gap-2 h-32">
              <div className="bg-gradient-to-b from-indigo-900/40 to-indigo-800/30 rounded-lg p-3 flex flex-col justify-between border border-indigo-500/20">
                <div className="text-xs text-white/50">Defensive</div>
                <div className="text-center">
                  <div className="text-xs text-emerald-400">Won: {possession_zones.find(z => z.zone.includes('defensive'))?.turnovers_won || 0}</div>
                  <div className="text-xs text-red-400">Lost: {possession_zones.find(z => z.zone.includes('defensive'))?.turnovers_lost || 0}</div>
                </div>
              </div>
              <div className="bg-gradient-to-b from-slate-700/40 to-slate-600/30 rounded-lg p-3 flex flex-col justify-between border border-slate-500/20">
                <div className="text-xs text-white/50">Midfield</div>
                <div className="text-center">
                  <div className="text-xs text-emerald-400">Won: {possession_zones.find(z => z.zone.includes('middle'))?.turnovers_won || 0}</div>
                  <div className="text-xs text-red-400">Lost: {possession_zones.find(z => z.zone.includes('middle'))?.turnovers_lost || 0}</div>
                </div>
              </div>
              <div className="bg-gradient-to-b from-amber-900/40 to-amber-800/30 rounded-lg p-3 flex flex-col justify-between border border-amber-500/20">
                <div className="text-xs text-white/50">Attacking</div>
                <div className="text-center">
                  <div className="text-xs text-emerald-400">Won: {possession_zones.find(z => z.zone.includes('attacking'))?.turnovers_won || 0}</div>
                  <div className="text-xs text-red-400">Lost: {possession_zones.find(z => z.zone.includes('attacking'))?.turnovers_lost || 0}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Net Turnovers Summary */}
          <div className="mt-4 pt-4 border-t border-white/10 flex justify-around">
            <div className="text-center">
              <div className="text-xs text-white/50">Turnovers Won</div>
              <div className="text-xl font-bold text-emerald-400">{totalTurnoversWon}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-white/50">Turnovers Lost</div>
              <div className="text-xl font-bold text-red-400">{totalTurnoversLost}</div>
            </div>
            <div className="text-center">
              <div className="text-xs text-white/50">Net</div>
              <div className={`text-xl font-bold ${netPossession >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {netPossession >= 0 ? '+' : ''}{netPossession}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI-GENERATED DYNAMIC CHARTS */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <span className="text-white">AI-Generated Insights</span>
            <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-0.5 rounded-full">Dynamic</span>
          </h2>
          <button
            onClick={fetchAICharts}
            disabled={loadingAICharts}
            className="btn-glass flex items-center gap-2 text-sm"
          >
            <RefreshCw size={14} className={loadingAICharts ? 'animate-spin' : ''} />
            Regenerate All
          </button>
        </div>

        {aiChartsSummary && (
          <p className="text-white/60 text-sm mb-4 pl-13">{aiChartsSummary}</p>
        )}

        {loadingAICharts && aiCharts.length === 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="glass-card p-6 h-[300px] flex items-center justify-center">
                <div className="flex flex-col items-center gap-3">
                  <RefreshCw size={24} className="animate-spin text-purple-400" />
                  <span className="text-white/50 text-sm">AI generating chart {i}...</span>
                </div>
              </div>
            ))}
          </div>
        ) : aiCharts.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {aiCharts.map(chart => (
              <DynamicChart
                key={chart.id}
                chart={chart}
                onDismiss={handleDismissChart}
                isLoading={replacingChartId === chart.id}
              />
            ))}
          </div>
        ) : (
          <div className="glass-card p-8 text-center">
            <Sparkles size={32} className="text-purple-400 mx-auto mb-3" />
            <p className="text-white/60 mb-4">No AI charts available. Click "Regenerate All" to generate insights.</p>
            <button onClick={fetchAICharts} className="btn-primary">
              Generate Charts
            </button>
          </div>
        )}

        <p className="text-white/40 text-xs mt-3 text-center">
          Hover over any chart and click X to dismiss and generate a new insight
        </p>
      </div>

      {/* Leaderboards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Scorers */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Target size={20} className="text-white" />
            <span>Top Scorers</span>
          </h3>
          {top_scorers.length > 0 ? (
            <div className="space-y-3">
              {top_scorers.slice(0, 5).map((player, i) => (
                <div key={player.player_id} className="flex items-center space-x-3 p-3 rounded-xl bg-white hover:bg-white/90 transition-colors">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white ${
                    i === 0 ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                    i === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                    i === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700' :
                    'bg-gradient-to-br from-indigo-600 to-purple-600'
                  }`}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-slate-900 truncate">{player.player_name}</div>
                    <div className="text-xs text-slate-600">
                      {player.goals}G - {player.points}P - {player.two_pointers}x2PT
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                      {player.total_score}
                    </div>
                    <div className="text-xs text-slate-600">{player.matches_played} games</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-white/40">
              No scoring data yet
            </div>
          )}
        </div>

        {/* Turnover Leaders */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Trophy size={20} className="text-white" />
            <span>Turnover Kings</span>
          </h3>
          {top_turnovers.length > 0 ? (
            <div className="space-y-3">
              {top_turnovers.slice(0, 5).map((player, i) => (
                <div key={player.player_id} className="flex items-center space-x-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                  <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white ${
                    i === 0 ? 'bg-gradient-to-br from-emerald-500 to-teal-600' :
                    'bg-gradient-to-br from-slate-600 to-slate-700'
                  }`}>
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-white truncate block">{player.player_name}</span>
                    <div className="flex gap-3 text-xs mt-1">
                      <span className="text-emerald-400">Won: {player.turnovers_won}</span>
                      <span className="text-red-400">Lost: {player.turnovers_lost}</span>
                    </div>
                  </div>
                  <div className={`text-xl font-bold ${player.net_turnovers >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {player.net_turnovers >= 0 ? '+' : ''}{player.net_turnovers}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-white/40">
              No turnover data yet
            </div>
          )}
        </div>
      </div>

      {/* Recent Matches */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
          <Calendar size={20} className="text-white" />
          <span>Recent Results</span>
        </h3>
        {match_trends.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {match_trends.slice(0, 6).map((match) => (
              <div key={match.match_id} className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-white">{match.opponent}</div>
                  <div className={`px-2 py-1 rounded text-xs font-bold ${
                    match.result === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                    match.result === 'L' ? 'bg-red-500/20 text-red-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {match.result}
                  </div>
                </div>
                <div className="text-lg font-bold text-white">
                  {match.dungloe_score} - {match.opponent_score}
                </div>
                <div className="text-xs text-white/40 mt-1">
                  {new Date(match.match_date).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-white/40">
            No completed matches yet
          </div>
        )}
      </div>

      {/* AI Analyst */}
      <div className="glass-card p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bot size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">AI-Powered Analyst</h2>
              <p className="text-white/60">
                Ask questions about matches, tactics, and player performance
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAIChat(true)}
            className="btn-primary flex items-center gap-2 px-6 py-3"
          >
            <MessageSquare size={20} />
            Chat with AI
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <Zap className="text-amber-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Tactical Analysis</h3>
            <p className="text-sm text-white/60">Get insights on formations, patterns, and strategies</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <Target className="text-emerald-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Performance Review</h3>
            <p className="text-sm text-white/60">Analyze player stats and scoring efficiency</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <TrendingUp className="text-indigo-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Training Insights</h3>
            <p className="text-sm text-white/60">Get recommendations for improvement areas</p>
          </div>
        </div>
      </div>

      {/* AI Chat Modal */}
      <AIAnalyst
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        initialContext="I have access to all Dungloe GAA match data, player statistics, GPS performance benchmarks, and tactical information from the knowledge base."
      />
        </>
      )}
    </div>
  )
}
