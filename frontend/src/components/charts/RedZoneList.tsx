import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { RedZonePlayer } from '@/services/api'

interface RedZoneListProps {
  data: RedZonePlayer[]
}

export default function RedZoneList({ data }: RedZoneListProps) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-400" />
            Red Zone Players
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-500/20 flex items-center justify-center mb-3">
            <CheckCircle2 size={28} className="text-emerald-400" />
          </div>
          <p className="text-emerald-400 font-semibold text-lg">All Clear</p>
          <p className="text-white/50 text-sm mt-1">
            No players above the 20% stress threshold
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <AlertTriangle size={18} className="text-red-400" />
          Red Zone Players
        </h3>
        <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">
          {data.length} flagged
        </span>
      </div>

      <div className="space-y-3">
        {data.map((player) => (
          <div
            key={player.player_id}
            className="bg-red-500/10 border border-red-500/20 rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold text-white">{player.player_name}</span>
              <span className="text-xs bg-red-500/30 text-red-300 px-2 py-0.5 rounded-full font-semibold">
                +{player.pct_above}% above avg
              </span>
            </div>
            <div className="flex gap-4 text-sm">
              <div>
                <span className="text-white/50">Latest DSL: </span>
                <span className="text-red-400 font-semibold">{player.latest_dsl}</span>
              </div>
              <div>
                <span className="text-white/50">4-wk avg: </span>
                <span className="text-white/70">{player.avg_dsl_4wk}</span>
              </div>
            </div>
            <div className="text-xs text-white/40 mt-1">
              vs {player.last_match_opponent}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
