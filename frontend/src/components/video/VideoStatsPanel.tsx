/**
 * VideoStatsPanel — live-recording's "Match Statistics" table, rebuilt for
 * Video Tagging.
 *
 * matchStatsPanel (MatchRecording.tsx) isn't reusable as-is — it reads a
 * `matchStats` object from a match_id-keyed backend endpoint that computes
 * from the committed `match_events` table, which is empty for a video
 * session until an explicit "Save to Match" sync. This component reproduces
 * the same two-column design, sourced instead from the session's own
 * in-memory tagged events (via the videoEventChartAdapter conversion) —
 * except Possession/Poss. Count, which genuinely IS live already: ball
 * drags write straight into the same possession_events table live
 * recording reads, so that one row is fetched the same way
 * PossessionTerritoryChart does.
 *
 * Row set is smaller than live recording's — only what's cleanly derivable
 * from tagged video events is shown (no Goal Chances/Ball Recovery/Fouls,
 * which need backend fields or foul-tracking video tagging doesn't capture
 * the same way live recording does).
 */

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { api } from '../../services/api'
import type { ChartEvent } from '../../utils/videoEventChartAdapter'

interface VideoStatsPanelProps {
  matchId: string
  chartEvents: ChartEvent[]
  clubName: string
  opponentName: string
  hasEvents: boolean
  onOpenExtraStats: () => void
}

const SHOT_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved',
  'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss',
])
const SCORE_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five',
])
const WIDE_TYPES = new Set(['wide', 'wide_free'])

function count(events: ChartEvent[], team: 'own' | 'opponent', predicate: (e: ChartEvent) => boolean): number {
  return events.filter(e => e.team === team && predicate(e)).length
}

export default function VideoStatsPanel({
  matchId,
  chartEvents,
  clubName,
  opponentName,
  hasEvents,
  onOpenExtraStats,
}: VideoStatsPanelProps) {
  // Possession genuinely is live — ball drags on the tracking pitch already
  // write into the same possession_events table live recording reads.
  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => api.possession.getByMatch(matchId),
    enabled: !!matchId,
    refetchInterval: 15000,
  })
  const ownPossession = possessionEvents?.filter(p => p.is_home_team).length ?? 0
  const oppPossession = possessionEvents?.filter(p => !p.is_home_team).length ?? 0
  const possessionTotal = ownPossession + oppPossession
  const ownPossessionPct = possessionTotal > 0 ? Math.round((ownPossession / possessionTotal) * 100) : 0
  const oppPossessionPct = possessionTotal > 0 ? 100 - ownPossessionPct : 0

  const ownShots = count(chartEvents, 'own', e => SHOT_TYPES.has(e.event_type))
  const oppShots = count(chartEvents, 'opponent', e => SHOT_TYPES.has(e.event_type))
  const ownScores = count(chartEvents, 'own', e => SCORE_TYPES.has(e.event_type))
  const oppScores = count(chartEvents, 'opponent', e => SCORE_TYPES.has(e.event_type))
  const ownWides = count(chartEvents, 'own', e => WIDE_TYPES.has(e.event_type))
  const oppWides = count(chartEvents, 'opponent', e => WIDE_TYPES.has(e.event_type))
  const ownAccuracy = ownShots > 0 ? (ownScores / ownShots) * 100 : 0
  const oppAccuracy = oppShots > 0 ? (oppScores / oppShots) * 100 : 0

  const ownTurnoversWon = count(chartEvents, 'own', e => e.event_type === 'turnover_won')
  const oppTurnoversWon = count(chartEvents, 'opponent', e => e.event_type === 'turnover_won')
  const ownUnforcedErrors = count(chartEvents, 'own', e => e.event_type === 'unforced_error')
  const oppUnforcedErrors = count(chartEvents, 'opponent', e => e.event_type === 'unforced_error')

  const ownKickoutEvents = chartEvents.filter(e => e.team === 'own' && e.event_type.startsWith('own_kickout'))
  const ownKickoutWon = ownKickoutEvents.filter(e => e.event_type === 'own_kickout_won' || e.event_type === 'own_kickout_won_break').length
  const oppKickoutEvents = chartEvents.filter(e => e.team === 'opponent' && e.event_type.startsWith('opp_kickout'))
  const oppKickoutRetained = oppKickoutEvents.filter(e => e.event_type === 'opp_kickout_opposition_won' || e.event_type === 'opp_kickout_opposition_won_break').length

  const ownYellow = count(chartEvents, 'own', e => e.event_type === 'yellow_card')
  const oppYellow = count(chartEvents, 'opponent', e => e.event_type === 'yellow_card')
  const ownBlack = count(chartEvents, 'own', e => e.event_type === 'black_card')
  const oppBlack = count(chartEvents, 'opponent', e => e.event_type === 'black_card')
  const ownRed = count(chartEvents, 'own', e => e.event_type === 'red_card')
  const oppRed = count(chartEvents, 'opponent', e => e.event_type === 'red_card')

  const rows: { label: string; left: string | number; right: string | number; leftVal: number; rightVal: number }[] = [
    { label: 'Possession', left: `${ownPossessionPct}%`, right: `${oppPossessionPct}%`, leftVal: ownPossessionPct, rightVal: oppPossessionPct },
    { label: 'Poss. Count', left: ownPossession, right: oppPossession, leftVal: ownPossession, rightVal: oppPossession },
    { label: 'Shots', left: ownShots, right: oppShots, leftVal: ownShots, rightVal: oppShots },
    { label: 'Scores', left: ownScores, right: oppScores, leftVal: ownScores, rightVal: oppScores },
    { label: 'Wides', left: ownWides, right: oppWides, leftVal: oppWides, rightVal: ownWides },
    { label: 'Accuracy', left: `${ownAccuracy.toFixed(1)}%`, right: `${oppAccuracy.toFixed(1)}%`, leftVal: ownAccuracy, rightVal: oppAccuracy },
    { label: 'Turnovers Won', left: ownTurnoversWon, right: oppTurnoversWon, leftVal: ownTurnoversWon, rightVal: oppTurnoversWon },
    { label: 'Unforced Errors', left: ownUnforcedErrors, right: oppUnforcedErrors, leftVal: oppUnforcedErrors, rightVal: ownUnforcedErrors },
    { label: 'Kickouts Won', left: `${ownKickoutWon}/${ownKickoutEvents.length}`, right: `${oppKickoutRetained}/${oppKickoutEvents.length}`, leftVal: ownKickoutWon, rightVal: oppKickoutRetained },
    { label: '🟡 Yellow', left: ownYellow, right: oppYellow, leftVal: oppYellow, rightVal: ownYellow },
    ...(ownBlack + oppBlack > 0 ? [{ label: '⬛ Black', left: ownBlack, right: oppBlack, leftVal: oppBlack, rightVal: ownBlack }] : []),
    ...(ownRed + oppRed > 0 ? [{ label: '🔴 Red', left: ownRed, right: oppRed, leftVal: oppRed, rightVal: ownRed }] : []),
  ]

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center space-x-2 text-white">
          <Activity size={20} className="text-emerald-400" />
          <span>Match Statistics</span>
        </h3>
        {hasEvents && (
          <button
            onClick={onOpenExtraStats}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-colors"
          >
            More Stats
          </button>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.08] overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)' }}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
          <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider">{clubName}</div>
          <div className="min-w-[90px]" />
          <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider">{opponentName}</div>
        </div>

        {rows.map((row, idx) => {
          const leftWins = row.leftVal > row.rightVal
          const rightWins = row.rightVal > row.leftVal
          return (
            <div
              key={row.label}
              className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 transition-colors hover:bg-white/[0.05] ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} ${idx > 0 ? 'border-t border-white/[0.05]' : ''}`}
            >
              <div className={`text-center text-base font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>
                {row.left}
              </div>
              <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[90px]">
                {row.label}
              </div>
              <div className={`text-center text-base font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>
                {row.right}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
