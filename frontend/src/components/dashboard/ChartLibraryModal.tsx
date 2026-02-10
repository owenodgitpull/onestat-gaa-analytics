import { X, Plus } from 'lucide-react'
import { CANONICAL_CHARTS } from '@/config/chartRegistry'

interface ChartLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  hiddenCharts: string[]
  onShowChart: (chartId: string) => void
}

export default function ChartLibraryModal({
  isOpen,
  onClose,
  hiddenCharts,
  onShowChart,
}: ChartLibraryModalProps) {
  if (!isOpen) return null

  const hiddenEntries = CANONICAL_CHARTS.filter(c => hiddenCharts.includes(c.id))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h3 className="text-lg font-bold text-white">Chart Library</h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-5">
          {hiddenEntries.length === 0 ? (
            <p className="text-white/50 text-center py-8">
              All charts are visible on your dashboard.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-white/50 mb-3">
                These charts are hidden from your dashboard. Click to re-add them.
              </p>
              {hiddenEntries.map(entry => (
                <button
                  key={entry.id}
                  onClick={() => {
                    onShowChart(entry.id)
                    if (hiddenEntries.length === 1) onClose()
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors text-left group"
                >
                  <div className="flex-1">
                    <span className="text-white font-medium">{entry.label}</span>
                    {entry.requiresGps && (
                      <span className="ml-2 text-xs text-white/30">GPS</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-emerald-400 text-sm font-medium opacity-60 group-hover:opacity-100 transition-opacity">
                    <Plus size={16} />
                    Add
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
