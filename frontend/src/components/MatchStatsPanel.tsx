/**
 * MatchStatsPanel — unified "Match Statistics" panel for all three contexts:
 * Live Recording, Video Tagging, and Match Result.
 *
 * Takes EITHER:
 * - `matchStats` (MatchStats from backend API) — MatchResult and MatchRecording
 *   when the match is completed and stats are committed to the DB
 * - `events` (ChartEvent[] for in-memory computation) — VideoTagging and
 *   MatchRecording's live stats before they're committed
 *
 * Uses the exact same calculations as MatchRecording.tsx for consistency.
 * Renders via the existing StatsTable component.
 */

import { useQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import { api } from '../services/api'
import StatsTable from './charts/StatsTable'
import type { MatchStats } from '../types'
import type { ChartEvent } from '../utils/videoEventChartAdapter'

interface MatchStatsPanelProps {
  // Backend stats (MatchResult, completed MatchRecording)
  matchStats?: MatchStats | null

  // In-memory events (VideoTagging, live MatchRecording)
  events?: ChartEvent[]
  matchId?: string  // For fetching live possession count

  // Display
  clubName: string
  opponentName: string
  hasEvents: boolean
  onOpenExtraStats?: () => void
}

const SHOT_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'hit_post',
  'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss',
])
const SCORE_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five',
])
const WIDE_TYPES = new Set(['wide', 'wide_free'])
const DROPPED_SHORT_TYPES = new Set(['short'])

function count(events: ChartEvent[], team: 'own' | 'opponent', predicate: (e: ChartEvent) => boolean): number {
  return events.filter(e => e.team === team && predicate(e)).length
}

/**
 * Compute MatchStats from in-memory events — uses the exact same logic as
 * MatchRecording.tsx's stats computation (lines 1154-1300).
 */
function computeStatsFromEvents(
  events: ChartEvent[],
  possessionEvents?: unknown[]
): MatchStats {
  const ownShots = count(events, 'own', e => SHOT_TYPES.has(e.event_type))
  const oppShots = count(events, 'opponent', e => SHOT_TYPES.has(e.event_type))
  const ownScores = count(events, 'own', e => SCORE_TYPES.has(e.event_type))
  const oppScores = count(events, 'opponent', e => SCORE_TYPES.has(e.event_type))
  const ownWides = count(events, 'own', e => WIDE_TYPES.has(e.event_type))
  const oppWides = count(events, 'opponent', e => WIDE_TYPES.has(e.event_type))
  const ownDroppedShort = count(events, 'own', e => DROPPED_SHORT_TYPES.has(e.event_type))
  const oppDroppedShort = count(events, 'opponent', e => DROPPED_SHORT_TYPES.has(e.event_type))

  const ownAccuracy = ownShots > 0 ? (ownScores / ownShots) * 100 : 0
  const oppAccuracy = oppShots > 0 ? (oppScores / oppShots) * 100 : 0

  const ownTurnoversWon = count(events, 'own', e => e.event_type === 'turnover_won' || e.event_type === 'tackle_won')
  const ownTurnoversLost = count(events, 'own', e => e.event_type === 'turnover_lost')
  const oppTurnoversWon = count(events, 'opponent', e => e.event_type === 'turnover_won' || e.event_type === 'tackle_won')
  const oppTurnoversLost = count(events, 'opponent', e => e.event_type === 'turnover_lost')

  const ownUnforcedErrors = count(events, 'own', e => e.event_type === 'unforced_error')
  const oppUnforcedErrors = count(events, 'opponent', e => e.event_type === 'unforced_error')

  // Kickouts - own kickout events
  const ownKickoutEvents = events.filter(e => e.team === 'own' && e.event_type.startsWith('own_kickout'))
  const ownKickoutWon = ownKickoutEvents.filter(e =>
    e.event_type === 'own_kickout_won' || e.event_type === 'own_kickout_won_break'
  ).length
  const ownKickoutLost = ownKickoutEvents.filter(e =>
    e.event_type === 'own_kickout_opposition_won' ||
    e.event_type === 'own_kickout_opposition_won_break' ||
    e.event_type === 'own_kickout_sideline'
  ).length

  // Kickouts - opponent kickout events (we're contesting their kickouts)
  const oppKickoutEvents = events.filter(e => e.team === 'opponent' && e.event_type.startsWith('opp_kickout'))
  const oppKickoutWon = oppKickoutEvents.filter(e =>
    e.event_type === 'opp_kickout_opposition_won' || e.event_type === 'opp_kickout_opposition_won_break'
  ).length
  const oppKickoutLost = oppKickoutEvents.filter(e =>
    e.event_type === 'opp_kickout_won' ||
    e.event_type === 'opp_kickout_won_break' ||
    e.event_type === 'opp_kickout_sideline'
  ).length

  const ownFouls = count(events, 'own', e => e.event_type === 'foul_committed')
  const oppFouls = count(events, 'opponent', e => e.event_type === 'foul_committed')

  const ownYellow = count(events, 'own', e => e.event_type === 'yellow_card')
  const oppYellow = count(events, 'opponent', e => e.event_type === 'yellow_card')
  const ownBlack = count(events, 'own', e => e.event_type === 'black_card')
  const oppBlack = count(events, 'opponent', e => e.event_type === 'black_card')
  const ownRed = count(events, 'own', e => e.event_type === 'red_card')
  const oppRed = count(events, 'opponent', e => e.event_type === 'red_card')

  // Goal chances - shots from inside D zone (approximate based on existing logic)
  const ownGoalChances = count(events, 'own', e =>
    (e.event_type === 'goal' || e.event_type === 'penalty_goal' || e.event_type === 'penalty_miss')
  )
  const oppGoalChances = count(events, 'opponent', e =>
    (e.event_type === 'goal' || e.event_type === 'penalty_goal' || e.event_type === 'penalty_miss')
  )

  // Possession from possession_events — same rules as the backend's
  // match_service stats (what Live Recording shows): % by TIME (sum of
  // duration_seconds), falling back to event counts only while no durations
  // exist; "possession count" = spells (consecutive runs of the same team).
  // The API returns `team: 'own' | 'opponent'` — NOT is_home_team (the old
  // code read that nonexistent field, so every event counted as the
  // opposition's and Dungloe showed 0% regardless of what was recorded).
  const isOwnPoss = (p: any) => (p.team != null ? p.team === 'own' : !!p.is_home_team)
  const possList = (possessionEvents ?? []) as any[]
  const sortedPoss = [...possList].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')))
  let ownPossessionCount = 0
  let oppPossessionCount = 0
  let prevPoss: 'own' | 'opponent' | null = null
  for (const p of sortedPoss) {
    const curr = isOwnPoss(p) ? 'own' : 'opponent'
    if (curr !== prevPoss) {
      if (curr === 'own') ownPossessionCount++
      else oppPossessionCount++
      prevPoss = curr
    }
  }
  const ownPossSecs = possList.filter(isOwnPoss).reduce((s, p) => s + (p.duration_seconds ?? 0), 0)
  const totalPossSecs = possList.reduce((s, p) => s + (p.duration_seconds ?? 0), 0)
  const teamPossessionPct = totalPossSecs > 0
    ? (ownPossSecs / totalPossSecs) * 100
    : possList.length > 0 ? (possList.filter(isOwnPoss).length / possList.length) * 100 : 0
  const oppPossessionPct = totalPossSecs > 0 || possList.length > 0 ? 100 - teamPossessionPct : 0

  // Poss → Shots %
  const teamPossToShotsPct = ownPossessionCount > 0 ? (ownShots / ownPossessionCount) * 100 : 0
  const oppPossToShotsPct = oppPossessionCount > 0 ? (oppShots / oppPossessionCount) * 100 : 0

  return {
    match_id: '', // Not needed for display
    team_possession_percentage: teamPossessionPct,
    opponent_possession_percentage: oppPossessionPct,
    team_possession_count: ownPossessionCount,
    opponent_possession_count: oppPossessionCount,
    team_poss_converted_to_shots_pct: Math.round(teamPossToShotsPct),
    opponent_poss_converted_to_shots_pct: Math.round(oppPossToShotsPct),
    team_total_shots: ownShots,
    team_scores: ownScores,
    team_wides: ownWides,
    team_dropped_short: ownDroppedShort,
    team_goal_chances: ownGoalChances,
    team_accuracy: ownAccuracy,
    team_conversion_rate: ownAccuracy, // Same as accuracy for now
    opponent_total_shots: oppShots,
    opponent_scores: oppScores,
    opponent_wides: oppWides,
    opponent_dropped_short: oppDroppedShort,
    opponent_goal_chances: oppGoalChances,
    opponent_accuracy: oppAccuracy,
    opponent_conversion_rate: oppAccuracy,
    team_turnovers_won: ownTurnoversWon,
    team_turnovers_lost: ownTurnoversLost,
    team_unforced_errors: ownUnforcedErrors,
    opponent_turnovers_won: oppTurnoversWon,
    opponent_turnovers_lost: oppTurnoversLost,
    opponent_unforced_errors: oppUnforcedErrors,
    team_kickouts_won: ownKickoutWon,
    team_kickouts_lost: ownKickoutLost,
    opponent_kickouts_won: oppKickoutWon,
    opponent_kickouts_lost: oppKickoutLost,
    team_fouls: ownFouls,
    opponent_fouls: oppFouls,
    team_yellow_cards: ownYellow,
    team_black_cards: ownBlack,
    team_red_cards: ownRed,
    opponent_yellow_cards: oppYellow,
    opponent_black_cards: oppBlack,
    opponent_red_cards: oppRed,
    team_ball_recovery_avg_min: null, // Requires backend calculation
    opponent_ball_recovery_avg_min: null,
  }
}

export default function MatchStatsPanel({
  matchStats,
  events,
  matchId,
  clubName,
  opponentName,
  hasEvents,
  onOpenExtraStats,
}: MatchStatsPanelProps) {
  // Fetch live possession count if computing from events
  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => api.possession.getByMatch(matchId!),
    enabled: !!matchId && !!events && !matchStats,
    refetchInterval: 15000,
  })

  // Use provided matchStats OR compute from events
  const stats: MatchStats | undefined = matchStats
    ? matchStats
    : events
      ? computeStatsFromEvents(events, possessionEvents)
      : undefined

  if (!stats) {
    return (
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center space-x-2 text-white">
            <Activity size={20} className="text-emerald-400" />
            <span>Match Statistics</span>
          </h3>
        </div>
        <div className="text-center text-white/40 py-8">Loading stats...</div>
      </div>
    )
  }

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center space-x-2 text-white">
          <Activity size={20} className="text-emerald-400" />
          <span>Match Statistics</span>
        </h3>
        {hasEvents && onOpenExtraStats && (
          <button
            onClick={onOpenExtraStats}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-colors"
          >
            More Stats
          </button>
        )}
      </div>

      <StatsTable stats={stats} opponent={opponentName} teamName={clubName} />
    </div>
  )
}
