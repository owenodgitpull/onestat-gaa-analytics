import { useMemo } from 'react'
import { X, Plus, Check, BarChart3, Shield, Crosshair, Activity, Gauge } from 'lucide-react'
import { CANONICAL_CHARTS } from '@/config/chartRegistry'

interface ChartLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  hiddenCharts: string[]
  chartOrder: string[]
  onShowChart: (chartId: string) => void
  onHideChart: (chartId: string) => void
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  Possession: <Activity size={16} className="text-emerald-400" />,
  Scoring: <Crosshair size={16} className="text-amber-400" />,
  Defence: <Shield size={16} className="text-blue-400" />,
  Kickouts: <BarChart3 size={16} className="text-cyan-400" />,
  GPS: <Gauge size={16} className="text-purple-400" />,
  Overview: <BarChart3 size={16} className="text-white/60" />,
}

const CATEGORY_ORDER = ['Overview', 'Possession', 'Scoring', 'Defence', 'Kickouts', 'GPS']

export default function ChartLibraryModal(props: ChartLibraryModalProps) {
  const { isOpen, onClose, chartOrder, onShowChart, onHideChart } = props
  if (!isOpen) return null

  const visibleSet = useMemo(() => new Set(chartOrder), [chartOrder])
  const totalCharts = CANONICAL_CHARTS.length
  const visibleCount = CANONICAL_CHARTS.filter(c => visibleSet.has(c.id)).length

  // Group charts by category
  const grouped = useMemo(() => {
    const groups: Record<string, typeof CANONICAL_CHARTS> = {}
    for (const chart of CANONICAL_CHARTS) {
      const cat = chart.category || 'Other'
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(chart)
    }
    return groups
  }, [])

  const sortedCategories = CATEGORY_ORDER.filter(c => grouped[c])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">Chart Library</h3>
            <p className="text-sm text-white/50 mt-0.5">
              {visibleCount} of {totalCharts} charts on dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-6">
          {sortedCategories.map(category => (
            <div key={category}>
              {/* Category header */}
              <div className="flex items-center gap-2 mb-3">
                {CATEGORY_ICONS[category]}
                <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{category}</h4>
              </div>

              {/* Charts in this category */}
              <div className="space-y-1.5">
                {grouped[category].map(entry => {
                  const isVisible = visibleSet.has(entry.id)

                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium text-sm">{entry.label}</span>
                          {entry.requiresGps && (
                            <span className="text-[10px] text-purple-400 bg-purple-500/20 px-1.5 py-0.5 rounded-full">GPS</span>
                          )}
                          {entry.colSpan === 2 && (
                            <span className="text-[10px] text-white/30 bg-white/10 px-1.5 py-0.5 rounded-full">Wide</span>
                          )}
                        </div>
                        {entry.description && (
                          <p className="text-xs text-white/40 mt-0.5">{entry.description}</p>
                        )}
                      </div>

                      {isVisible ? (
                        <button
                          onClick={() => onHideChart(entry.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-red-500/20 hover:text-red-400 transition-colors shrink-0"
                        >
                          <Check size={14} />
                          Added
                        </button>
                      ) : (
                        <button
                          onClick={() => onShowChart(entry.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 text-white/70 text-xs font-medium hover:bg-emerald-500/20 hover:text-emerald-400 transition-colors shrink-0"
                        >
                          <Plus size={14} />
                          Add
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
