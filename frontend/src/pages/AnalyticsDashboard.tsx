import { useEffect, useState, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
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

  Calendar,
  RefreshCw,
  Heart,
  BarChart3,
  Info,
  X,
  LayoutGrid,
  ChevronRight,
  Sparkles,
} from 'lucide-react'
import KPILibraryModal from '@/components/dashboard/KPILibraryModal'
import { KPI_REGISTRY, DEFAULT_VISIBLE_KPIS } from '@/config/kpiRegistry'
import SquadHealthView from '@/components/SquadHealthView'
import LoadingSkeleton from '@/components/LoadingSkeleton'
import InsightAlertsPanel from '@/components/InsightAlertsPanel'
import AiInsightsSection from '@/components/charts/AiInsightsSection'
import MyChartsSection from '@/components/dashboard/MyChartsSection'
import SortableSection from '@/components/dashboard/SortableSection'
import { useDashboardLayout } from '@/hooks/useDashboardLayout'
import type { ChartRenderProps } from '@/config/chartRegistry'
import { api, DashboardData, SeasonDashboardData, AIChartSpec, OutlierSuggestion, KPICardItem } from '@/services/api'
import type { Match } from '@/types'
import { useTour } from '@/hooks/useTour'
import { dashboardSteps } from '@/config/tourSteps'

// Build explanations lookup from registry
const KPI_EXPLANATIONS: Record<string, { what: string; formula: string }> = {}
for (const entry of KPI_REGISTRY) {
  Object.assign(KPI_EXPLANATIONS, entry.explanations)
}

const KPI_STORAGE_KEY = 'gaa-visible-kpis'
function loadVisibleKpis(): string[] {
  try {
    const stored = localStorage.getItem(KPI_STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE_KPIS
}

export default function AnalyticsDashboard() {
  const navigate = useNavigate()
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [seasonDashboard, setSeasonDashboard] = useState<SeasonDashboardData | null>(null)
  const [aiCharts, setAiCharts] = useState<AIChartSpec[]>([])
  const [aiChartsSummary, setAiChartsSummary] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [loadingAICharts, setLoadingAICharts] = useState(false)
  const [replacingChartId, setReplacingChartId] = useState<string | null>(null)
  const [dismissedChartIds, setDismissedChartIds] = useState<string[]>([])
  const [suggestions, setSuggestions] = useState<OutlierSuggestion[]>([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [viewMode, setViewMode] = useState<'season' | 'health' | 'ai'>('season')
  const [flippedCards, setFlippedCards] = useState<Set<number>>(new Set())
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null)
  const [visibleKpis, setVisibleKpis] = useState<string[]>(loadVisibleKpis)
  const [kpiLibraryOpen, setKpiLibraryOpen] = useState(false)
  const { startTour: startDashboardTour } = useTour('dashboard', dashboardSteps)
  const tourTriggered = useRef(false)
  const autoRotatePaused = useRef(false)
  const autoRotateTimer = useRef<ReturnType<typeof setTimeout>>()

  const toggleKpi = useCallback((kpiId: string) => {
    setVisibleKpis(prev => {
      const next = prev.includes(kpiId) ? prev.filter(k => k !== kpiId) : [...prev, kpiId]
      localStorage.setItem(KPI_STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  // Build pairings from registry filtered by visible KPIs
  const kpiPairings = visibleKpis
    .map(id => KPI_REGISTRY.find(r => r.id === id))
    .filter(Boolean) as typeof KPI_REGISTRY
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null)
  const [nextMatch, setNextMatch] = useState<Match | null>(null)
  const [liveMatch, setLiveMatch] = useState<Match | null>(null)

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

  // Load static dashboard data + next/live match immediately
  useEffect(() => {
    fetchDashboard()
    api.matches.getInProgress().then(m => setLiveMatch(m))
    api.matches.getNextScheduled().then(m => setNextMatch(m))
  }, [])

  // Trigger tour on first visit after data loads
  useEffect(() => {
    if (!loading && dashboardData && !tourTriggered.current) {
      tourTriggered.current = true
      startDashboardTour()
    }
  }, [loading, dashboardData, startDashboardTour])

  // Auto-rotate KPI cards: flip one flippable card every 4s, pause on touch/click
  const kpiPairingsRef = useRef(kpiPairings)
  kpiPairingsRef.current = kpiPairings

  useEffect(() => {
    if (!seasonDashboard?.kpi_cards || viewMode !== 'season') return

    let idx = 0

    const scheduleNext = () => {
      autoRotateTimer.current = setTimeout(() => {
        if (autoRotatePaused.current) {
          scheduleNext()
          return
        }
        const flippable = kpiPairingsRef.current
          .map((entry, i) => entry.flipKey ? i : -1)
          .filter(i => i !== -1)
        if (flippable.length === 0) { scheduleNext(); return }

        const pairIdx = flippable[idx % flippable.length]
        setFlippedCards(prev => {
          const next = new Set(prev)
          if (next.has(pairIdx)) next.delete(pairIdx)
          else next.add(pairIdx)
          return next
        })
        idx++
        scheduleNext()
      }, 4000)
    }

    autoRotateTimer.current = setTimeout(scheduleNext, 3000)

    return () => {
      if (autoRotateTimer.current) clearTimeout(autoRotateTimer.current)
    }
  }, [seasonDashboard?.kpi_cards, viewMode])

  // Defer AI calls so static charts render first
  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAICharts()
      fetchSuggestions()
    }, 100)
    return () => clearTimeout(timer)
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
    return <LoadingSkeleton />
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

  const { season_summary } = dashboardData

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
      default:
        return null
    }
  }

  return (
    <div className="space-y-8">
      {/* View Mode Toggle */}
      <div className="flex items-center justify-between">
        <div data-tour="view-mode-toggle" className="flex bg-white/10 rounded-xl p-1">
          <button
            onClick={() => setViewMode('season')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              viewMode === 'season'
                ? 'text-[#0a1a10]'
                : 'text-white/60 hover:text-white'
            }`}
            style={viewMode === 'season' ? { background: 'var(--gradient-primary)' } : {}}
          >
            <BarChart3 size={18} />
            Season Stats
          </button>
          <button
            onClick={() => setViewMode('health')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              viewMode === 'health'
                ? 'text-[#0a1a10]'
                : 'text-white/60 hover:text-white'
            }`}
            style={viewMode === 'health' ? { background: 'var(--gradient-primary)' } : {}}
          >
            <Heart size={18} />
            Squad Health
          </button>
          <button
            onClick={() => setViewMode('ai')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold transition-all ${
              viewMode === 'ai'
                ? 'text-[#0a1a10]'
                : 'text-white/60 hover:text-white'
            }`}
            style={viewMode === 'ai' ? { background: 'var(--gradient-primary)' } : {}}
          >
            <Sparkles size={18} />
            AI Insights
          </button>
        </div>
        <div className="flex items-center gap-2">
          {/* Live Match / Next Match card */}
          {liveMatch ? (
            <div
              onClick={() => navigate(`/match/${liveMatch.id}`)}
              className="glass-card-live cursor-pointer"
            >
              <div className="glass-card-live-inner px-4 py-2 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Live</span>
                </div>
                <span className="text-sm font-bold text-white whitespace-nowrap">
                  vs {liveMatch.opponent}
                </span>
                <span className="text-sm font-semibold text-emerald-300">
                  {liveMatch.team_goals}-{String(liveMatch.team_points).padStart(2, '0')} / {liveMatch.opponent_goals}-{String(liveMatch.opponent_points).padStart(2, '0')}
                </span>
                {liveMatch.current_phase && (
                  <span className="text-xs text-white/50 font-medium">
                    {liveMatch.current_phase === 'first_half' ? '1st Half' : liveMatch.current_phase === 'half_time' ? 'HT' : '2nd Half'}
                  </span>
                )}
                <ChevronRight size={16} className="text-white/40" />
              </div>
            </div>
          ) : nextMatch ? (
            <div
              onClick={() => navigate(`/match-prep/${nextMatch.id}`)}
              className="bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 rounded-xl px-4 py-2 cursor-pointer hover:from-emerald-600/30 hover:to-cyan-600/30 border border-emerald-500/30 hover:border-emerald-500/50 transition-all flex items-center gap-2 group"
            >
              <Calendar size={14} className="text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-emerald-400/80 font-semibold uppercase tracking-wide">Next</span>
              <span className="text-sm font-bold text-white whitespace-nowrap">
                {nextMatch.opponent} ({nextMatch.venue === 'home' ? 'H' : nextMatch.venue === 'away' ? 'A' : 'N'})
              </span>
              <ChevronRight size={16} className="text-emerald-400/60 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all ml-auto" />
            </div>
          ) : (
            <div className="bg-white/10 rounded-xl px-4 py-2 border border-white/10 flex items-center gap-2">
              <Calendar size={14} className="text-white/30 flex-shrink-0" />
              <span className="text-xs text-white/50 font-semibold uppercase tracking-wide">Next Match</span>
              <span className="text-sm text-white/30">No fixture set</span>
            </div>
          )}
          {(viewMode === 'season' || viewMode === 'ai') && (
            <>
              {viewMode === 'season' && (
                <button
                  onClick={resetLayout}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-all"
                  title="Reset layout"
                >
                  <LayoutGrid size={16} />
                </button>
              )}
              <button
                onClick={viewMode === 'ai' ? () => { fetchAICharts(); fetchSuggestions() } : fetchDashboard}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-white/40 hover:text-white/80 hover:bg-white/10 transition-all"
                title="Refresh data"
              >
                <RefreshCw size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Insight Alerts — above all tabs */}
      <InsightAlertsPanel dashboard="season" onAlertClick={() => setViewMode('ai')} />

      {/* Conditional View */}
      {viewMode === 'health' ? (
        <SquadHealthView />
      ) : viewMode === 'ai' ? (
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
      ) : (
        <>
      {/* 1. Season Overview — KPI Cards (always at top, not draggable) */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <TrendingUp size={24} className="text-white" />
            <span className="text-white">Season Overview</span>
          </h2>
          <button
            data-tour="kpi-library-btn"
            onClick={() => setKpiLibraryOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white text-xs font-medium transition-colors"
          >
            <LayoutGrid size={14} />
            KPI Library
          </button>
        </div>
        {seasonDashboard?.kpi_cards ? (
          <>
            <p className="text-sm text-white/50 mb-4">
              {seasonDashboard.kpi_cards.metadata.matches_played} Matches | {seasonDashboard.kpi_cards.metadata.win_rate}% Win Rate ({seasonDashboard.kpi_cards.metadata.wins}W-{seasonDashboard.kpi_cards.metadata.losses}L-{seasonDashboard.kpi_cards.metadata.draws}D)
            </p>
            <div data-tour="kpi-grid" className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiPairings
                .filter(entry => seasonDashboard.kpi_cards!.cards.some(c => c.key === entry.frontKey))
                .map((entry, pairIdx) => {
                const cards = seasonDashboard.kpi_cards!.cards
                const frontCard = cards.find(c => c.key === entry.frontKey)!
                const backCard = entry.flipKey ? cards.find(c => c.key === entry.flipKey) : null
                const isFlipped = flippedCards.has(pairIdx)
                const isPair = !!backCard

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
                      >
                        <Info size={11} className="text-white/50" />
                      </button>
                      {activeTooltip === card.key && createPortal(
                        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setActiveTooltip(null)} />
                          <div className="relative w-full max-w-sm bg-slate-900/95 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
                            {/* Header */}
                            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 bg-gradient-to-r from-orange-600/15 to-amber-600/15">
                              <h3 className="text-sm font-bold text-white">{card.label}</h3>
                              <button onClick={() => setActiveTooltip(null)} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
                                <X size={16} className="text-white/60" />
                              </button>
                            </div>
                            <div className="p-5 space-y-4">
                              {/* What is this metric */}
                              <div>
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">What it measures</div>
                                <div className="text-sm text-white/90 leading-relaxed">{KPI_EXPLANATIONS[card.key]?.what}</div>
                              </div>
                              {/* How it's calculated — only for non-obvious metrics */}
                              {KPI_EXPLANATIONS[card.key]?.formula && (
                                <div>
                                  <div className="text-[10px] font-semibold uppercase tracking-wider text-white/40 mb-1.5">How it's calculated</div>
                                  <div className="text-sm text-white/60 leading-relaxed">{KPI_EXPLANATIONS[card.key]?.formula}</div>
                                </div>
                              )}
                              {/* AI team insight */}
                              <div className="pt-3 border-t border-white/10">
                                <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/60 mb-1.5">AI Insight</div>
                                {card.insight
                                  ? <div className="text-sm text-emerald-300/90 italic leading-relaxed">{card.insight}</div>
                                  : <div className="text-sm text-white/25 italic">Unavailable right now — check back later</div>
                                }
                              </div>
                            </div>
                          </div>
                        </div>,
                        document.body
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
                        // Pause auto-rotate for 15s on manual interaction
                        autoRotatePaused.current = true
                        setTimeout(() => { autoRotatePaused.current = false }, 15000)
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
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
            <div className="opacity-60 rounded-2xl ring-2 ring-emerald-500/50 bg-slate-900/80 p-4">
              <div className="text-white/80 font-semibold text-sm capitalize">
                {activeSectionId.replace(/-/g, ' ')}
              </div>
            </div>
          )}
        </DragOverlay>
      </DndContext>

        </>
      )}

      <KPILibraryModal
        isOpen={kpiLibraryOpen}
        onClose={() => setKpiLibraryOpen(false)}
        visibleKpis={visibleKpis}
        onToggleKpi={toggleKpi}
      />
    </div>
  )
}
