import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { LayoutGrid, Library, Crosshair, Shield, BarChart3, Gauge, Eye } from 'lucide-react'
import ChartZoomModal from '@/components/ChartZoomModal'
import SortableChartCard from './SortableChartCard'
import ChartLibraryModal from './ChartLibraryModal'
import { CANONICAL_CHARTS, makePinnedAiEntry, type ChartRenderProps, type ChartRegistryEntry } from '@/config/chartRegistry'
import type { AIChartSpec } from '@/services/api'

// GAA-tactical filter groups over the registry's raw `category` strings
// (Possession/Scoring/Defence/Kickouts/GPS/Overview) — maps, doesn't rename,
// so ChartLibraryModal's own grouping stays untouched. Kickouts kept its
// own filter rather than folding into Defence/Attack — restarts are their
// own tactical battle, matches how much this matters to elite analysts.
// `null` means "no filter" (today's behaviour, stays the default).
type ChartFilterKey = 'all' | 'attack' | 'defence' | 'kickouts' | 'physical' | 'overview'

const CHART_FILTERS: { key: ChartFilterKey; label: string; icon: React.ReactNode; categories: string[] | null }[] = [
  { key: 'all', label: 'All', icon: <LayoutGrid size={13} />, categories: null },
  { key: 'attack', label: 'Attack', icon: <Crosshair size={13} />, categories: ['Scoring', 'Possession'] },
  { key: 'defence', label: 'Defence', icon: <Shield size={13} />, categories: ['Defence'] },
  { key: 'kickouts', label: 'Kickouts', icon: <BarChart3 size={13} />, categories: ['Kickouts'] },
  { key: 'physical', label: 'Physical', icon: <Gauge size={13} />, categories: ['GPS'] },
  { key: 'overview', label: 'Overview', icon: <Eye size={13} />, categories: ['Overview'] },
]

interface MyChartsSectionProps {
  chartOrder: string[]
  hiddenCharts: string[]
  pinnedAiCharts: AIChartSpec[]
  hasGpsData: boolean
  renderProps: ChartRenderProps
  onReorderCharts: (newOrder: string[]) => void
  onHideChart: (chartId: string) => void
  onShowChart: (chartId: string) => void
  onUnpinChart: (chartId: string) => void
}

export default function MyChartsSection({
  chartOrder,
  hiddenCharts,
  pinnedAiCharts,
  hasGpsData,
  renderProps,
  onReorderCharts,
  onHideChart,
  onShowChart,
  onUnpinChart,
}: MyChartsSectionProps) {
  const [showLibrary, setShowLibrary] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<ChartFilterKey>('all')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  // Build chart registry map (canonical + pinned AI)
  const registryMap = new Map<string, ChartRegistryEntry>()
  CANONICAL_CHARTS.forEach(c => registryMap.set(c.id, c))
  pinnedAiCharts.forEach(c => registryMap.set(`ai-${c.id}`, makePinnedAiEntry(c)))

  const activeFilterCategories = CHART_FILTERS.find(f => f.key === activeFilter)?.categories ?? null

  // Filter chart order to only renderable charts
  const visibleCharts = chartOrder.filter(id => {
    const entry = registryMap.get(id)
    if (!entry) return false
    // GPS charts only show if GPS data exists
    if (entry.requiresGps && !hasGpsData) return false
    // Category filter — AI-pinned charts carry no category (their content
    // varies too freely to force into one tactical bucket), so they only
    // ever show under "All", not any specific filter.
    if (activeFilterCategories && !activeFilterCategories.includes(entry.category || '')) return false
    return true
  })

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = chartOrder.indexOf(active.id as string)
    const newIndex = chartOrder.indexOf(over.id as string)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = [...chartOrder]
    newOrder.splice(oldIndex, 1)
    newOrder.splice(newIndex, 0, active.id as string)
    onReorderCharts(newOrder)
  }

  const activeEntry = activeId ? registryMap.get(activeId) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
            <LayoutGrid size={20} className="text-white" />
          </div>
          <span className="text-white">Core Stats</span>
        </h2>
        <button
          data-tour="chart-library-btn"
          onClick={() => setShowLibrary(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 hover:text-white text-xs font-medium transition-colors"
        >
          <Library size={14} />
          Chart Library
          {hiddenCharts.length > 0 && (
            <span className="ml-1 px-1.5 py-0.5 text-xs rounded-full bg-white/20">{hiddenCharts.length}</span>
          )}
        </button>
      </div>

      {/* Category filters — only show a chart's tactical group at a time.
          "All" (default) is today's behaviour, unfiltered. */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {CHART_FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setActiveFilter(f.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              activeFilter === f.key
                ? 'bg-emerald-500/20 border border-emerald-400/40 text-emerald-300'
                : 'bg-white/5 border border-white/10 text-white/50 hover:text-white/80 hover:bg-white/10'
            }`}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
      </div>

      {visibleCharts.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-white/40 text-sm">
            No {activeFilter === 'all' ? '' : `${CHART_FILTERS.find(f => f.key === activeFilter)?.label.toLowerCase()} `}charts on your dashboard yet.
          </p>
          <button
            onClick={() => setShowLibrary(true)}
            className="mt-3 text-emerald-400 hover:text-emerald-300 text-xs font-medium"
          >
            Add one from the Chart Library
          </button>
        </div>
      ) : (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={visibleCharts} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
            {visibleCharts.map((chartId, idx) => {
              const entry = registryMap.get(chartId)!
              const isAiPinned = chartId.startsWith('ai-')
              const aiChartId = isAiPinned ? chartId.replace('ai-', '') : undefined
              const rendered = entry.render({ ...renderProps, onUnpin: onUnpinChart })

              return (
                <SortableChartCard
                  key={chartId}
                  id={chartId}
                  colSpan={entry.colSpan}
                  isAiPinned={isAiPinned}
                  isFirst={idx === 0}
                  onHide={!isAiPinned ? () => onHideChart(chartId) : undefined}
                  onUnpin={isAiPinned && aiChartId ? () => onUnpinChart(aiChartId) : undefined}
                >
                  <ChartZoomModal title={entry.label}>
                    {rendered ?? (
                      <div className="glass-card p-6 flex items-center justify-center min-h-[200px]">
                        <p className="text-white/40 text-sm">
                          {entry.label} — loading data...
                        </p>
                      </div>
                    )}
                  </ChartZoomModal>
                </SortableChartCard>
              )
            })}
          </div>
        </SortableContext>

        <DragOverlay>
          {activeEntry && (
            <div className="opacity-80 rotate-2 scale-105">
              {activeEntry.render({ ...renderProps, onUnpin: onUnpinChart })}
            </div>
          )}
        </DragOverlay>
      </DndContext>
      )}

      <ChartLibraryModal
        isOpen={showLibrary}
        onClose={() => setShowLibrary(false)}
        hiddenCharts={hiddenCharts}
        chartOrder={chartOrder}
        onShowChart={onShowChart}
        onHideChart={onHideChart}
      />
    </div>
  )
}
