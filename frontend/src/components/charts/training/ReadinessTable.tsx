import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReadinessPlayer } from '@/services/api'

interface Props {
  data: ReadinessPlayer[]
}

const STATUS_CONFIG = {
  optimal: { emoji: '\u2705', label: 'Optimal', color: 'text-emerald-400', bg: 'bg-emerald-500/20', bar: 'bg-emerald-500' },
  fatigued: { emoji: '\u26a0\ufe0f', label: 'Fatigued', color: 'text-amber-400', bg: 'bg-amber-500/20', bar: 'bg-amber-500' },
  high_risk: { emoji: '\ud83d\udea9', label: 'High Risk', color: 'text-red-400', bg: 'bg-red-500/20', bar: 'bg-red-500' },
}

export default function ReadinessTable({ data }: Props) {
  const [sortAsc, setSortAsc] = useState(false)
  const display = data.length > 15 ? data.slice(0, 15) : data

  const sorted = [...display].sort((a, b) =>
    sortAsc ? a.readiness_score - b.readiness_score : b.readiness_score - a.readiness_score
  )

  if (data.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-4">Readiness & Risk</h3>
        <div className="flex-1 flex items-center justify-center text-white/40">
          No readiness data available
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-white mb-1">Readiness & Risk</h3>
      <p className="text-xs text-white/40 mb-4">DSL consistency + balance + speed attainment</p>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/40 text-xs">
              <th className="text-left pb-2 pr-2">Player</th>
              <th
                className="text-left pb-2 px-2 cursor-pointer select-none"
                onClick={() => setSortAsc(!sortAsc)}
              >
                <span className="inline-flex items-center gap-1">
                  Score
                  {sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </span>
              </th>
              <th className="text-left pb-2 px-2">Status</th>
              <th className="text-left pb-2 pl-2 hidden md:table-cell">Insight</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => {
              const cfg = STATUS_CONFIG[p.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.fatigued
              return (
                <tr key={p.player_id} className="border-t border-white/5 hover:bg-white/5 transition-colors">
                  <td className="py-2 pr-2 text-white font-medium truncate max-w-[120px]">
                    {p.player_name}
                  </td>
                  <td className="py-2 px-2">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${cfg.bar}`}
                          style={{ width: `${Math.min(p.readiness_score, 100)}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono ${cfg.color}`}>
                        {p.readiness_score.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2 px-2">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.color}`}>
                      {cfg.emoji} {cfg.label}
                    </span>
                  </td>
                  <td className="py-2 pl-2 text-white/50 text-xs hidden md:table-cell max-w-[200px] truncate">
                    {p.insight}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
