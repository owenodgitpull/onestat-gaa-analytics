import { useMemo } from 'react'
import { X, Plus, Check, Crosshair, Shield, Activity, Gauge, Target, AlertTriangle } from 'lucide-react'
import { KPI_REGISTRY, type KPIRegistryEntry } from '@/config/kpiRegistry'

interface KPILibraryModalProps {
  isOpen: boolean
  onClose: () => void
  visibleKpis: string[]
  onToggleKpi: (kpiId: string) => void
}

const THEME_ICONS: Record<string, React.ReactNode> = {
  'Scoring Output': <Crosshair size={16} className="text-amber-400" />,
  'Shooting': <Target size={16} className="text-orange-400" />,
  'Defence': <Shield size={16} className="text-blue-400" />,
  'Discipline': <AlertTriangle size={16} className="text-red-400" />,
  'Restarts': <Activity size={16} className="text-cyan-400" />,
  'Transition & Efficiency': <Gauge size={16} className="text-emerald-400" />,
  'Tempo': <Activity size={16} className="text-purple-400" />,
  'Defensive System': <Shield size={16} className="text-indigo-400" />,
  'Defensive Solidity': <Shield size={16} className="text-sky-400" />,
  'Territory': <Target size={16} className="text-teal-400" />,
  'Scoring Quality': <Crosshair size={16} className="text-yellow-400" />,
  'Goal Threat': <Crosshair size={16} className="text-rose-400" />,
  'Restart Attack': <Activity size={16} className="text-lime-400" />,
}

const THEME_ORDER = [
  'Scoring Output', 'Shooting', 'Transition & Efficiency', 'Tempo',
  'Defence', 'Defensive System', 'Defensive Solidity', 'Territory',
  'Scoring Quality', 'Goal Threat', 'Restarts', 'Restart Attack', 'Discipline',
]

export default function KPILibraryModal({ isOpen, onClose, visibleKpis, onToggleKpi }: KPILibraryModalProps) {
  if (!isOpen) return null

  const visibleSet = useMemo(() => new Set(visibleKpis), [visibleKpis])
  const totalKpis = KPI_REGISTRY.length
  const visibleCount = KPI_REGISTRY.filter(k => visibleSet.has(k.id)).length

  const grouped = useMemo(() => {
    const groups: Record<string, KPIRegistryEntry[]> = {}
    for (const kpi of KPI_REGISTRY) {
      const theme = kpi.theme
      if (!groups[theme]) groups[theme] = []
      groups[theme].push(kpi)
    }
    return groups
  }, [])

  const sortedThemes = THEME_ORDER.filter(t => grouped[t])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-900 border border-white/10 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div>
            <h3 className="text-lg font-bold text-white">KPI Library</h3>
            <p className="text-sm text-white/50 mt-0.5">
              {visibleCount} of {totalKpis} KPIs on dashboard
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-6">
          {sortedThemes.map(theme => (
            <div key={theme}>
              <div className="flex items-center gap-2 mb-3">
                {THEME_ICONS[theme] || <Gauge size={16} className="text-white/40" />}
                <h4 className="text-sm font-semibold text-white/70 uppercase tracking-wider">{theme}</h4>
              </div>

              <div className="space-y-1.5">
                {grouped[theme].map(entry => {
                  const isVisible = visibleSet.has(entry.id)
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/8 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-white font-medium text-sm">{entry.frontLabel}</span>
                          {entry.flipLabel && (
                            <span className="text-[10px] text-white/30 bg-white/10 px-1.5 py-0.5 rounded-full">Flip</span>
                          )}
                        </div>
                        {entry.flipLabel && (
                          <p className="text-xs text-white/40 mt-0.5">Flip: {entry.flipLabel}</p>
                        )}
                      </div>

                      {isVisible ? (
                        <button
                          onClick={() => onToggleKpi(entry.id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-medium hover:bg-red-500/20 hover:text-red-400 transition-colors shrink-0"
                        >
                          <Check size={14} />
                          Added
                        </button>
                      ) : (
                        <button
                          onClick={() => onToggleKpi(entry.id)}
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
