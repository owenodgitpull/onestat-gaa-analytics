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
import { LayoutGrid, Library } from 'lucide-react'
import SortableChartCard from './SortableChartCard'
import ChartLibraryModal from './ChartLibraryModal'
import { CANONICAL_CHARTS, makePinnedAiEntry, type ChartRenderProps, type ChartRegistryEntry } from '@/config/chartRegistry'
import type { AIChartSpec } from '@/services/api'

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

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor)
  )

  // Build chart registry map (canonical + pinned AI)
  const registryMap = new Map<string, ChartRegistryEntry>()
  CANONICAL_CHARTS.forEach(c => registryMap.set(c.id, c))
  pinnedAiCharts.forEach(c => registryMap.set(`ai-${c.id}`, makePinnedAiEntry(c)))

  // Filter chart order to only renderable charts
  const visibleCharts = chartOrder.filter(id => {
    const entry = registryMap.get(id)
    if (!entry) return false
    // GPS charts only show if GPS data exists
    if (entry.requiresGps && !hasGpsData) return false
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
                  {rendered ?? (
                    <div className="glass-card p-6 flex items-center justify-center min-h-[200px]">
                      <p className="text-white/40 text-sm">
                        {entry.label} — loading data...
                      </p>
                    </div>
                  )}
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
