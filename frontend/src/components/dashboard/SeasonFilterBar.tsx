import { useEffect, useRef, useState } from 'react'
import { Filter, Loader2, ChevronDown, X } from 'lucide-react'
import { MATCH_STAGE_OPTIONS } from '@/services/api'

const LAST_N_OPTIONS = [3, 5, 10]

interface SeasonFilterBarProps {
  availableCompetitions: string[]
  availableStages: string[]
  competition: string
  stage: string
  lastN: number | null
  matchesInView: number
  loading: boolean
  onChange: (next: { competition: string; stage: string; lastN: number | null }) => void
}

/**
 * Compact filter trigger + popover for the season dashboard. Three plain
 * always-visible <select>s ate a full row of width on every screen size
 * for a feature most visits leave untouched — this collapses to one small
 * button (with an active-filter badge) that opens a panel on demand,
 * closing on an outside click or Escape.
 */
export default function SeasonFilterBar({
  availableCompetitions,
  availableStages,
  competition,
  stage,
  lastN,
  matchesInView,
  loading,
  onChange,
}: SeasonFilterBarProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const activeCount = [competition, stage, lastN].filter(Boolean).length

  useEffect(() => {
    if (!open) return
    const handlePointer = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointer)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handlePointer)
      document.removeEventListener('keydown', handleKey)
    }
  }, [open])

  const clearAll = () => onChange({ competition: '', stage: '', lastN: null })

  return (
    <div className="relative inline-block" ref={panelRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          activeCount > 0
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
            : 'border-white/10 bg-white/5 text-white/60 hover:text-white hover:bg-white/10'
        }`}
      >
        <Filter size={14} />
        Filter
        {activeCount > 0 && (
          <span className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-[10px] font-bold text-[#0a1a10]">
            {activeCount}
          </span>
        )}
        {loading && <Loader2 size={13} className="animate-spin text-white/40" />}
        <ChevronDown size={13} className={`text-white/40 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-2 z-30 w-72 bg-slate-900/98 backdrop-blur-xl border border-white/15 rounded-2xl shadow-2xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-bold text-white">Filter Season</span>
            <button onClick={() => setOpen(false)} className="p-1 rounded-lg hover:bg-white/10 transition-colors">
              <X size={14} className="text-white/50" />
            </button>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/40 mb-1.5">Competition</label>
            <select
              value={competition}
              onChange={(e) => onChange({ competition: e.target.value, stage, lastN })}
              className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="" className="bg-slate-900">All Competitions</option>
              {availableCompetitions.map(c => (
                <option key={c} value={c} className="bg-slate-900">{c}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/40 mb-1.5">Stage</label>
            <select
              value={stage}
              onChange={(e) => onChange({ competition, stage: e.target.value, lastN })}
              className="w-full bg-white/10 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
            >
              <option value="" className="bg-slate-900">All Stages</option>
              {(availableStages.length > 0 ? availableStages : MATCH_STAGE_OPTIONS).map(s => (
                <option key={s} value={s} className="bg-slate-900">{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-white/40 mb-1.5">Last N Matches</label>
            <div className="flex gap-1.5">
              {[null, ...LAST_N_OPTIONS].map(n => (
                <button
                  key={n ?? 'all'}
                  onClick={() => onChange({ competition, stage, lastN: n })}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    lastN === n
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {n === null ? 'All' : n}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between pt-1 border-t border-white/10">
            <span className="text-xs text-white/40">
              {matchesInView} match{matchesInView === 1 ? '' : 'es'}
            </span>
            <div className="flex items-center gap-3">
              {activeCount > 0 && (
                <button onClick={clearAll} className="text-xs text-white/50 hover:text-white underline">
                  Clear filters
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors min-h-[40px]"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
