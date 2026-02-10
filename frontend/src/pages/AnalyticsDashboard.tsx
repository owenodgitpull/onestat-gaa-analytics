import { useEffect, useState, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import {
  TrendingUp,
  Target,
  Calendar,
  Zap,
  RefreshCw,
  MessageSquare,
  Bot,
  Heart,
  BarChart3,
  Info,
  RotateCcw,
} from 'lucide-react'
import AIAnalyst from '@/components/AIAnalyst'
import SquadHealthView from '@/components/SquadHealthView'
import AiInsightsSection from '@/components/charts/AiInsightsSection'
import MyChartsSection from '@/components/dashboard/MyChartsSection'
import SortableSection from '@/components/dashboard/SortableSection'
import { useDashboardLayout } from '@/hooks/useDashboardLayout'
import type { ChartRenderProps } from '@/config/chartRegistry'
import { api, DashboardData, SeasonDashboardData, AIChartSpec, OutlierSuggestion, KPICardItem } from '@/services/api'

// KPI card explanations for info tooltips — plain-English GAA context
const KPI_EXPLANATIONS: Record<string, string> = {
  productivity: "How efficiently we turn possessions into scores — higher means we make the most of every attack",
  turnover_diff: "Turnovers won minus lost — positive means we're winning more ball than giving it away",
  kickout_retention: "How often we retain our own goalkeeper's kickouts — crucial for building attacks from restarts",
  shot_efficiency: "Percentage of shots that result in scores — shows how clinical we are in front of the posts",
  fouls_per_game: "Average fouls committed per match — fewer means less frees conceded to opposition",
  avg_scored: "Average total points scored per match (goals×3 + points)",
  avg_conceded: "Average total points conceded per match — lower means a tighter defence",
}

// Card pairings: [front, back] for flip cards, [single] for standalone
const KPI_PAIRINGS: string[][] = [
  ['productivity', 'shot_efficiency'],
  ['turnover_diff', 'fouls_per_game'],
  ['kickout_retention', 'avg_conceded'],
  ['avg_scored'],
]

export default function AnalyticsDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [seasonDashboard, setSeasonDashboard] = useState<SeasonDashboardData | null>(null)
  const [aiCharts, setAiCharts] = useState<AIChartSpec[]>([])
  const [aiChartsSummary, setAiChartsSummary] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAIChat, setShowAIChat] = useState(false)
  const [loadingAICharts, setLoadingAICharts] = useState(false)
  const [replacingChartId, setReplacingChartId] = useState<string | null>(null)
  const [dismissedChartIds, setDismissedChartIds] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<OutlierSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [viewMode, setViewMode] = useState<'season' | 'health'>('season')
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set())
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)

  const {
    layout,
    pinChart,
    unpinChart,
    isPinned,
    canPin,
    hideChart,
    showChart,
    reorderCharts,
    reorderSections,
    resetLayout,
  } = useDashboardLayout()

  // Section-level DnD sensors (same config: pointer distance 8, touch delay 200ms)
  const sectionSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  const fetchDashboard = async () => {
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

  const fetchSuggestions = useCallback(async () => {
    setLoadingSuggestions(true)
    try {
      const result = await api.ai.getOutlierSuggestions()
      if (result.success && result.suggestions) {
        setSuggestions(result.suggestions)
      }
    } catch (err) {
      console.error('Failed to load outlier suggestions:', err)
    } finally {
      setLoadingSuggestions(false)
    }
  }, [])

  const handlePinChart = useCallback((chart: AIChartSpec) => {
    pinChart(chart)
    // Remove from dynamic AI charts so it only appears in My Charts
    setAiCharts(prev => prev.filter(c => c.id !== chart.id))
  }, [pinChart])

  const handleUnpinChart = useCallback(async (chartId: string) => {
    unpinChart(chartId)
    // Fetch replacement for AI section if under 4
    if (aiCharts.length < 4) {
      try {
        const result = await api.ai.getReplacementChart(dismissedChartIds)
        if (result.success && result.chart) {
          setAiCharts(prev => [...prev, result.chart!])
        }
      } catch (err) {
        console.error('Failed to fetch replacement chart after unpin:', err)
      }
    }
  }, [unpinChart, aiCharts.length, dismissedChartIds])

  const handleDismissChart = async (chartId: string) => {
    setReplacingChartId(chartId)
    const newDismissedIds = [...dismissedChartIds, chartId]
    setDismissedChartIds(newDismissedIds)

    try {
      const result = await api.ai.getReplacementChart(newDismissedIds)
      if (result.success && result.chart) {
        setAiCharts(prev => prev.map(c => c.id === chartId ? result.chart! : c))
      } else {
        setAiCharts(prev => prev.filter(c => c.id !== chartId))
      }
    } catch (err) {
      console.error('Failed to get replacement chart:', err)
      setAiCharts(prev => prev.filter(c => c.id !== chartId))
    } finally {
      setReplacingChartId(null)
    }
  }

  useEffect(() => {
    fetchDashboard()
    fetchAICharts()
    fetchSuggestions()
  }, [])

  // Section-level drag handlers
  const handleSectionDragStart = (event: DragStartEvent) => {
    setActiveSectionId(event.active.id as string)
  }

  const handleSectionDragEnd = (event: DragEndEvent) => {
    setActiveSectionId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = layout.sectionOrder.indexOf(active.id as string)
    const newIndex = layout.sectionOrder.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = [...layout.sectionOrder]
    newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, active.id as string)
    reorderSections(newOrder)
  }

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

  const { season_summary, top_scorers, match_trends } = dashboardData

  // Check if GPS data exists in season dashboard
  const hasGpsData = !!(seasonDashboard && (
    seasonDashboard.red_zone_players.length > 0 ||
    seasonDashboard.workhorse_radar.metrics.length > 0
  ))

  // Chart render props shared with MyChartsSection
  const chartRenderProps: ChartRenderProps = {
    seasonDashboard,
    dashboardData,
  }

  const pinnedChartIds = layout.pinnedAiCharts.map(c => c.id)

  // Section renderers
  const renderSection = (sectionId: string) => {
    switch (sectionId) {
      case 'my-charts':
        return (
          <MyChartsSection
            chartOrder={layout.chartOrder}
            hiddenCharts={layout.hiddenCharts}
            pinnedAiCharts={layout.pinnedAiCharts}
            hasGpsData={hasGpsData}
            renderProps={chartRenderProps}
            onReorderCharts={reorderCharts}
            onHideChart={hideChart}
            onShowChart={showChart}
            onUnpinChart={handleUnpinChart}
          />
        )
      case 'ai-insights':
        return (
          <AiInsightsSection
            aiCharts={aiCharts}
            pinnedChartIds={pinnedChartIds}
            loadingAICharts={loadingAICharts}
            replacingChartId={replacingChartId}
            canPin={canPin}
            onDismissChart={handleDismissChart}
            onPinChart={handlePinChart}
            onRegenerateAll={fetchAICharts}
            isPinned={isPinned}
            aiChartsSummary={aiChartsSummary}
            suggestions={suggestions}
            loadingSuggestions={loadingSuggestions}
          />
        )
      case 'top-scorers':
        return (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
              <Target size={20} className="text-white" />
              <span>Top Scorers</span>
            </h3>
            {top_scorers.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {top_scorers.slice(0, 6).map((player, i) => (
                  <div key={player.player_id} className="flex items-center space-x-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white ${
                      i === 0 ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                      i === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                      i === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700' :
                      'bg-gradient-to-br from-indigo-600 to-purple-600'
                    }`}>
                      #{i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-white truncate">{player.player_name}</div>
                      <div className="text-xs text-white/60">
                        {player.goals}G - {player.points}P - {player.two_pointers}x2PT
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                        {player.total_score}
                      </div>
                      <div className="text-xs text-white/60">{player.matches_played} games</div>
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
        )
      case 'recent-results':
        return (
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
        )
      case 'ai-analyst':
        return (
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
        )
      default:
        return null
    }
  }

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
          <div className="flex items-center gap-2">
            <button
              onClick={resetLayout}
              className="btn-glass flex items-center gap-2 text-xs text-white/50 hover:text-white/80"
              title="Reset dashboard layout to defaults"
            >
              <RotateCcw size={14} />
              Reset Layout
            </button>
            <button onClick={fetchDashboard} className="btn-glass flex items-center gap-2">
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* Conditional View */}
      {viewMode === 'health' ? (
        <SquadHealthView />
      ) : (
        <>
      {/* 1. Season Overview — KPI Cards (always at top, not draggable) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <TrendingUp size={24} className="text-white" />
            <span className="text-white">Season Overview</span>
          </h2>
        </div>
        {seasonDashboard?.kpi_cards ? (
          <>
            <p className="text-sm text-white/50 mb-4">
              {seasonDashboard.kpi_cards.metadata.matches_played} Matches | {seasonDashboard.kpi_cards.metadata.win_rate}% Win Rate ({seasonDashboard.kpi_cards.metadata.wins}W-{seasonDashboard.kpi_cards.metadata.losses}L-{seasonDashboard.kpi_cards.metadata.draws}D)
            </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {KPI_PAIRINGS.map((pairing, pairIdx) => {
                const cards = seasonDashboard.kpi_cards!.cards
                const frontCard = cards.find(c => c.key === pairing[0])
                const backCard = pairing.length > 1 ? cards.find(c => c.key === pairing[1]) : null
                const isFlipped = flippedCards.has(pairIdx)
                const isPair = !!backCard

                if (!frontCard) return null

                const renderFace = (card: KPICardItem, isFront: boolean) => {
                  const colorMap: Record<string, string> = {
                    green: 'text-emerald-400',
                    amber: 'text-amber-400',
                    red: 'text-red-400',
                  }
                  const valueColor = colorMap[card.color] || 'text-white'
                  let displayValue: string
                  if (card.format === 'percent') {
                    displayValue = `${card.value}%`
                  } else if (card.format === 'signed_int') {
                    displayValue = card.value > 0 ? `+${card.value}` : `${card.value}`
                  } else {
                    displayValue = `${card.value}`
                  }

                  return (
                    <div
                      className="glass-card p-5 absolute inset-0 flex flex-col justify-center"
                      style={{
                        backfaceVisibility: 'hidden',
                        ...(isFront ? {} : { transform: 'rotateY(180deg)' }),
                      }}
                    >
                      <button
                        className="absolute top-2.5 right-2.5 w-5 h-5 rounded-full bg-white/10 hover:bg-white/25 flex items-center justify-center transition-colors z-10"
                        onClick={(e) => {
                          e.stopPropagation()
                          setActiveTooltip(prev => prev === card.key ? null : card.key)
                        }}
                        onMouseEnter={() => setActiveTooltip(card.key)}
                        onMouseLeave={() => setActiveTooltip(null)}
                      >
                        <Info size={11} className="text-white/50" />
                      </button>
                      {activeTooltip === card.key && (
                        <div className="absolute top-9 right-2 bg-slate-900/95 border border-white/20 rounded-lg p-2.5 text-xs text-white/80 leading-relaxed z-20 w-48 shadow-xl backdrop-blur-sm">
                          {card.insight || KPI_EXPLANATIONS[card.key]}
                        </div>
                      )}

                      <div className="text-white/60 text-xs font-semibold uppercase tracking-wide mb-1.5 pr-6">{card.label}</div>
                      <div className={`text-3xl font-bold ${valueColor}`}>{displayValue}</div>

                      {isPair && (
                        <div className="absolute bottom-2 right-3 text-[9px] text-white/20 flex items-center gap-0.5">
                          <RefreshCw size={8} />
                          Flip
                        </div>
                      )}
                    </div>
                  )
                }

                return (
                  <div
                    key={pairIdx}
                    className={isPair ? 'cursor-pointer' : ''}
                    style={{ perspective: '1000px', height: '120px' }}
                    onClick={() => {
                      if (isPair) {
                        setFlippedCards(prev => {
                          const next = new Set(prev)
                          if (next.has(pairIdx)) next.delete(pairIdx)
                          else next.add(pairIdx)
                          return next
                        })
                        setActiveTooltip(null)
                      }
                    }}
                  >
                    <div
                      style={{
                        transition: 'transform 0.6s ease-in-out',
                        transformStyle: 'preserve-3d',
                        transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                        position: 'relative',
                        width: '100%',
                        height: '100%',
                      }}
                    >
                      {renderFace(frontCard, true)}
                      {backCard && renderFace(backCard, false)}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="stat-card">
                <div className="text-white/70 text-sm font-semibold mb-2">Matches Played</div>
                <div className="stat-value">{season_summary.matches_played}</div>
              </div>
              <div className="stat-card">
                <div className="text-white/70 text-sm font-semibold mb-2">Win Rate</div>
                <div className="stat-value text-emerald-400">{season_summary.win_rate}%</div>
                <div className="text-xs text-white/50 mt-1">
                  {season_summary.wins}W - {season_summary.losses}L - {season_summary.draws}D
                </div>
              </div>
              <div className="stat-card">
                <div className="text-white/70 text-sm font-semibold mb-2">Avg Score</div>
                <div className="stat-value text-amber-400">{season_summary.avg_score_per_match}</div>
              </div>
              <div className="stat-card">
                <div className="text-white/70 text-sm font-semibold mb-2">Avg Conceded</div>
                <div className="stat-value text-red-400">{season_summary.avg_conceded_per_match}</div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 2. Draggable sections */}
      <DndContext
        sensors={sectionSensors}
        collisionDetection={closestCenter}
        onDragStart={handleSectionDragStart}
        onDragEnd={handleSectionDragEnd}
      >
        <SortableContext items={layout.sectionOrder} strategy={verticalListSortingStrategy}>
          <div className="space-y-8 pl-8">
            {layout.sectionOrder.map(sectionId => (
              <SortableSection key={sectionId} id={sectionId}>
                {renderSection(sectionId)}
              </SortableSection>
            ))}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeSectionId && (
            <div className="opacity-60 rounded-2xl ring-2 ring-indigo-500/50 bg-slate-900/80 p-4">
              <div className="text-white/80 font-semibold text-sm capitalize">
                {activeSectionId.replace(/-/g, ' ')}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

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
