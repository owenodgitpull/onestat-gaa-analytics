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

import { Activity } from 'lucide-react'
import { usePossessionSummary } from '../hooks/useMatchEvents'
import StatsTable from './charts/StatsTable'
import type { MatchStats, PossessionSummary } from '../types'
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

// Event sets — copied from the backend's match_service so the panel counts
// exactly what Live Recording / Match Result count.
const SCORING_TYPES = new Set(['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])
const MISS_TYPES = new Set(['wide', 'wide_free', 'forty_five_missed'])
const OWN_KO_WON = new Set(['own_kickout_won', 'own_kickout_won_break'])
const OWN_KO_LOST = new Set(['own_kickout_opposition_won', 'own_kickout_opposition_won_break', 'own_kickout_sideline'])
const OPP_KO_RETAINED = new Set(['opp_kickout_opposition_won', 'opp_kickout_opposition_won_break'])
const OPP_KO_LOST = new Set(['opp_kickout_won', 'opp_kickout_won_break', 'opp_kickout_sideline'])
const BALL_LOSS = new Set(['turnover_lost', 'unforced_error'])
const BALL_RECOVERY = new Set([
  'turnover_won', 'interception', 'tackle_won',
  'own_kickout_won', 'opp_kickout_won', 'kickout_won', 'own_kickout_won_break', 'opp_kickout_won_break',
  'own_kickout_opposition_won', 'own_kickout_opposition_won_break',
  'opp_kickout_opposition_won', 'opp_kickout_opposition_won_break',
  'goal', 'point', 'point_free', 'two_point', 'two_point_free', 'forty_five', 'penalty_goal',
])
// Same set the backend counts as a goal chance (match_service _GOAL_CHANCE_TYPES):
// goals, penalties, saves and hit-posts — the old local rule omitted saved/hit_post,
// so Goal Chances read lower here than in Live Recording.
const GOAL_CHANCE_TYPES = new Set(['goal', 'penalty_goal', 'penalty_miss', 'saved', 'hit_post'])

/**
 * Compute MatchStats from in-memory events — uses the exact same logic as
 * MatchRecording.tsx's stats computation (lines 1154-1300).
 */
function computeStatsFromEvents(
  events: ChartEvent[],
  possession?: PossessionSummary
): MatchStats {
  // Counting rules are a direct port of the backend's match_service
  // get_match_stats (what Live Recording / Match Result show), so Video
  // Tagging's panel behaves identically. Notably: kickouts are decoded from
  // the event TYPE, not event.team (an opposition-won kickout is tagged to
  // the opposition in video, which the old team-filtered code never counted as
  // OUR lost kickout); a turnover/unforced error LOST by one side is a
  // turnover WON by the other; penalties are goal chances but not shots.
  const mk = () => ({
    goal_chances: 0, total_shots: 0, scores: 0, wides: 0, dropped_short: 0, hit_post: 0,
    turnovers_won: 0, turnovers_lost: 0, unforced_errors: 0,
    kickouts_won: 0, kickouts_lost: 0, fouls: 0, yellow: 0, black: 0, red: 0,
  })
  const T = mk()
  const O = mk()
  for (const e of events) {
    const me = e.team === 'own' ? T : O
    const other = e.team === 'own' ? O : T
    const ty = e.event_type
    if (GOAL_CHANCE_TYPES.has(ty)) me.goal_chances++

    if (SCORING_TYPES.has(ty)) { me.total_shots++; me.scores++ }
    else if (MISS_TYPES.has(ty)) { me.total_shots++; me.wides++ }
    else if (ty === 'short') { me.total_shots++; me.dropped_short++ }
    else if (ty === 'saved') { me.total_shots++ }
    else if (ty === 'hit_post') { me.total_shots++; me.hit_post++ }
    else if (ty === 'turnover_won' || ty === 'interception' || ty === 'tackle_won') me.turnovers_won++
    else if (ty === 'turnover_lost') { me.turnovers_lost++; other.turnovers_won++ }
    else if (ty === 'unforced_error') { me.turnovers_lost++; other.turnovers_won++; me.unforced_errors++ }
    else if (OWN_KO_WON.has(ty)) T.kickouts_won++
    else if (OWN_KO_LOST.has(ty)) T.kickouts_lost++
    else if (OPP_KO_RETAINED.has(ty)) O.kickouts_won++
    else if (OPP_KO_LOST.has(ty)) O.kickouts_lost++
    else if (ty === 'kickout_won' || ty === 'breaking_ball_won') T.kickouts_won++
    else if (ty === 'kickout_lost' || ty === 'breaking_ball_lost') T.kickouts_lost++
    else if (ty === 'foul_committed') me.fouls++
    else if (ty === 'foul_won') other.fouls++
    else if (ty === 'yellow_card') me.yellow++
    else if (ty === 'black_card') me.black++
    else if (ty === 'red_card') me.red++
  }

  const ownShots = T.total_shots, oppShots = O.total_shots
  const ownScores = T.scores, oppScores = O.scores
  const ownWides = T.wides, oppWides = O.wides
  const ownDroppedShort = T.dropped_short, oppDroppedShort = O.dropped_short
  const ownGoalChances = T.goal_chances, oppGoalChances = O.goal_chances
  // Accuracy = scores / (scores + wides): saves and drop-shorts aren't inaccuracy
  const ownAccuracy = ownScores + ownWides > 0 ? (ownScores / (ownScores + ownWides)) * 100 : 0
  const oppAccuracy = oppScores + oppWides > 0 ? (oppScores / (oppScores + oppWides)) * 100 : 0
  // Conversion = scores / total shots
  const ownConversion = ownShots > 0 ? (ownScores / ownShots) * 100 : 0
  const oppConversion = oppShots > 0 ? (oppScores / oppShots) * 100 : 0
  const ownTurnoversWon = T.turnovers_won, oppTurnoversWon = O.turnovers_won
  const ownTurnoversLost = T.turnovers_lost, oppTurnoversLost = O.turnovers_lost
  const ownUnforcedErrors = T.unforced_errors, oppUnforcedErrors = O.unforced_errors
  const ownKickoutWon = T.kickouts_won, ownKickoutLost = T.kickouts_lost
  const oppKickoutWon = O.kickouts_won, oppKickoutLost = O.kickouts_lost
  const ownFouls = T.fouls, oppFouls = O.fouls
  const ownYellow = T.yellow, oppYellow = O.yellow
  const ownBlack = T.black, oppBlack = O.black
  const ownRed = T.red, oppRed = O.red

  // Ball recovery — average minutes to win the ball back after a loss event
  // (same rule as the backend's _calc_recovery: only gaps of 0 < Δ ≤ 10 min).
  const calcRecovery = (team: 'own' | 'opponent'): number | null => {
    const timed = events
      .filter(e => e.minute != null && e.team === team)
      .sort((a, b) => a.minute - b.minute)
    const gaps: number[] = []
    let lossMin: number | null = null
    for (const e of timed) {
      if (BALL_LOSS.has(e.event_type)) lossMin = e.minute
      else if (lossMin !== null && BALL_RECOVERY.has(e.event_type)) {
        const diff = e.minute - lossMin
        if (diff > 0 && diff <= 10) gaps.push(diff)
        lossMin = null
      }
    }
    return gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null
  }
  // Possession from possession_events — same rules as the backend's
  // match_service stats (what Live Recording shows): % by TIME (sum of
  // duration_seconds), falling back to event counts only while no durations
  // exist; "possession count" = spells (consecutive runs of the same team).
  // The API returns `team: 'own' | 'opponent'` — NOT is_home_team (the old
  // code read that nonexistent field, so every event counted as the
  // opposition's and Dungloe showed 0% regardless of what was recorded).
  // The server now does the counting (usePossessionSummary) — same rules, a
  // handful of numbers instead of every row.
  const ownPossessionCount = possession?.own_spells ?? 0
  const oppPossessionCount = possession?.opponent_spells ?? 0
  const ownPossSecs = possession?.own_seconds ?? 0
  const totalPossSecs = ownPossSecs + (possession?.opponent_seconds ?? 0)
  const possEventCount = (possession?.own_count ?? 0) + (possession?.opponent_count ?? 0)
  const teamPossessionPct = totalPossSecs > 0
    ? (ownPossSecs / totalPossSecs) * 100
    : possEventCount > 0 ? ((possession?.own_count ?? 0) / possEventCount) * 100 : 0
  const oppPossessionPct = totalPossSecs > 0 || possEventCount > 0 ? 100 - teamPossessionPct : 0

  // Poss → Shots %
  // A share of possessions can't pass 100%: every shot came from a possession, so count at least one per shot
  const teamPossDenom = Math.max(ownPossessionCount, ownShots)
  const oppPossDenom = Math.max(oppPossessionCount, oppShots)
  const teamPossToShotsPct = teamPossDenom > 0 ? (ownShots / teamPossDenom) * 100 : 0
  const oppPossToShotsPct = oppPossDenom > 0 ? (oppShots / oppPossDenom) * 100 : 0

  return {
    match_id: '', // Not needed for display
    team_possession_percentage: teamPossessionPct,
    opponent_possession_percentage: oppPossessionPct,
    team_possession_count: ownPossessionCount,
    opponent_possession_count: oppPossessionCount,
    team_poss_converted_to_shots_pct: Math.round(teamPossToShotsPct * 10) / 10,
    opponent_poss_converted_to_shots_pct: Math.round(oppPossToShotsPct * 10) / 10,
    team_total_shots: ownShots,
    team_scores: ownScores,
    team_wides: ownWides,
    team_dropped_short: ownDroppedShort,
    team_goal_chances: ownGoalChances,
    team_accuracy: ownAccuracy,
    team_conversion_rate: ownConversion,
    opponent_total_shots: oppShots,
    opponent_scores: oppScores,
    opponent_wides: oppWides,
    opponent_dropped_short: oppDroppedShort,
    opponent_goal_chances: oppGoalChances,
    opponent_accuracy: oppAccuracy,
    opponent_conversion_rate: oppConversion,
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
    team_ball_recovery_avg_min: calcRecovery('own'),
    opponent_ball_recovery_avg_min: calcRecovery('opponent'),
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
  // Possession totals when computing from events (one cheap aggregate, shared
  // with every other panel on the page — not every possession row on a timer)
  const { data: possessionSummary } = usePossessionSummary(matchId, !!events && !matchStats)

  // Use provided matchStats OR compute from events
  const stats: MatchStats | undefined = matchStats
    ? matchStats
    : events
      ? computeStatsFromEvents(events, possessionSummary)
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
