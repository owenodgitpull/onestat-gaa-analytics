/**
 * Man of the Match calculation utility
 */

import type { Player } from '../types'

interface MatchEventForMOTM {
  player_id?: string | number | null
  event_type: string
  team?: string
}

export interface PlayerScore {
  playerId: string
  playerName: string
  score: number
  breakdown: {
    goals: number
    points: number
    twoPointers: number
    turnoversWon: number
    turnoversLost: number
    kickoutsWon: number
  }
}

/**
 * Calculate Man of the Match based on positive contributions
 * Scoring weights:
 * - Goal: 10 points
 * - 2-Pointer: 5 points
 * - Point: 3 points
 * - Turnover Won: 2 points
 * - Kickout Won: 2 points
 * - Turnover Lost: -1 point
 */
export function calculateManOfMatch(
  events: MatchEventForMOTM[],
  players: Player[]
): PlayerScore | null {
  if (!events || events.length === 0) return null

  const playerScores: Record<string, PlayerScore> = {}

  // Only count Dungloe events with a player
  const dungloeEvents = events.filter(
    (e) => e.team === 'dungloe' && e.player_id
  )

  for (const event of dungloeEvents) {
    const pid = String(event.player_id)
    if (!playerScores[pid]) {
      const player = players.find((p) => p.id === pid)
      playerScores[pid] = {
        playerId: pid,
        playerName: player?.name || 'Unknown Player',
        score: 0,
        breakdown: {
          goals: 0,
          points: 0,
          twoPointers: 0,
          turnoversWon: 0,
          turnoversLost: 0,
          kickoutsWon: 0,
        },
      }
    }

    // Scoring weights
    switch (event.event_type) {
      case 'goal':
        playerScores[pid].score += 10
        playerScores[pid].breakdown.goals++
        break
      case 'point':
      case 'point_free':
        playerScores[pid].score += 3
        playerScores[pid].breakdown.points++
        break
      case 'two_point':
      case 'two_point_free':
        playerScores[pid].score += 5
        playerScores[pid].breakdown.twoPointers++
        break
      case 'turnover_won':
        playerScores[pid].score += 2
        playerScores[pid].breakdown.turnoversWon++
        break
      case 'turnover_lost':
      case 'our_unforced_error':
        playerScores[pid].score -= 1
        playerScores[pid].breakdown.turnoversLost++
        break
      // Kickout wins
      case 'own_kickout_dungloe_won':
      case 'own_kickout_dungloe_won_break':
      case 'opp_kickout_dungloe_won':
      case 'opp_kickout_dungloe_won_break':
        playerScores[pid].score += 2
        playerScores[pid].breakdown.kickoutsWon++
        break
    }
  }

  // Find highest scorer
  const sorted = Object.values(playerScores).sort((a, b) => b.score - a.score)
  return sorted[0] || null
}
