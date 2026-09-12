/**
 * TrackingStatsPanel — glanceable "stats so far" while tracking.
 *
 * Aggregates directly from the already-loaded VideoEvent array (no backend
 * call) so a coach can pause mid-match and sanity-check what's been tagged
 * before continuing — mirrors live recording's matchStatsPanel, simplified.
 */

import { Fragment } from 'react'
import { X } from 'lucide-react'
import type { VideoEvent } from '../../services/videoApi'

interface TrackingStatsPanelProps {
  events: VideoEvent[]
  homeTeamName: string
  opponentName: string
  onClose: () => void
}

function countFor(events: VideoEvent[], team: 'team_a' | 'team_b', predicate: (e: VideoEvent) => boolean): number {
  return events.filter(e => e.team === team && predicate(e)).length
}

const ROWS: { label: string; test: (e: VideoEvent) => boolean }[] = [
  { label: 'Goals', test: e => e.event_type === 'GOAL_SCORED' },
  { label: 'Points', test: e => e.event_type === 'POINT_SCORED' },
  { label: 'Wides', test: e => e.event_type === 'WIDE' },
  { label: 'Frees / 45s', test: e => ['FREE_KICK', 'FORTY_FIVE', 'PENALTY'].includes(e.event_type) },
  { label: 'Turnovers', test: e => e.event_type.includes('TURNOVER') },
  { label: 'Kickouts', test: e => e.event_type.includes('KICKOUT') },
  { label: 'Cards', test: e => e.event_type.includes('CARD') },
]

export default function TrackingStatsPanel({ events, homeTeamName, opponentName, onClose }: TrackingStatsPanelProps) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative bg-slate-900 border border-white/10 rounded-xl p-4 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-semibold text-white">Stats So Far</span>
          <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-1.5 text-sm">
          <span className="text-white/30 text-xs uppercase tracking-wide" />
          <span className="text-emerald-400 text-xs font-semibold text-center truncate max-w-[80px]">{homeTeamName}</span>
          <span className="text-orange-400 text-xs font-semibold text-center truncate max-w-[80px]">{opponentName}</span>
          {ROWS.map(row => (
            <Fragment key={row.label}>
              <span className="text-white/60">{row.label}</span>
              <span className="text-white font-mono text-center tabular-nums">
                {countFor(events, 'team_a', row.test)}
              </span>
              <span className="text-white font-mono text-center tabular-nums">
                {countFor(events, 'team_b', row.test)}
              </span>
            </Fragment>
          ))}
        </div>
        <p className="text-[11px] text-white/30 mt-3">{events.length} events tagged so far.</p>
      </div>
    </div>
  )
}
