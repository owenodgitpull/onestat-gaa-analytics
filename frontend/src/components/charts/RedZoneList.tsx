import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import type { RedZonePlayer } from '@/services/api'

interface RedZoneListProps {
  data: RedZonePlayer[]
}

// Shown on both the empty and populated states so it's visible regardless of
// whether anyone's currently flagged — this is match-day GPS only (this
// match's distance/DSL vs the player's own last few matches), a different
// signal from the ACWR-based status on Squad Health (which blends training +
// match load over 7/28 days). The two can disagree without either being
// wrong: a big single-match spike here doesn't necessarily mean overall
// training+match balance is off, and vice versa.
const EXPLAINER =
  'Match-day GPS only — flags a match that spiked well above this player’s own recent match average. ' +
  'This is a different signal from the training+match ACWR status on Squad Health, so the two can disagree without either being wrong.'

export default function RedZoneList({ data }: RedZoneListProps) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <AlertTriangle size={18} className="text-amber-400" />
            Red Zone Players
            <span title={EXPLAINER}><Info size={14} className="text-white/30" /></span>
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
          <span title={EXPLAINER}><Info size={14} className="text-white/30" /></span>
        </h3>
        <span className="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">
          {data.length} flagged
        </span>
      </div>
      <p className="text-white/40 text-xs -mt-2 mb-4">
        Match-day GPS only, vs each player's own recent matches — a different signal from Squad Health's training+match status.
      </p>

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
