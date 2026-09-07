import type { JerseyPlayer } from '@/components/JerseyNumberStrip'

/** Approximate formation-slot positions, in the same 0-100 pitch-% space as
 * pitch_x/pitch_y (0 = own goal line, 100 = opponent goal line) before the
 * attacking-direction flip below. Shared between BallCarrierPicker (the
 * radial near the ball) and PitchReceiverDots (the faint markers spread
 * across the pitch) so both always agree on who "the 5 likely receivers"
 * are — they're two views onto the exact same ranking. */
export const FORMATION_XY: Record<string, { x: number; y: number }> = {
  'gk': { x: 7, y: 50 },
  'fb-left': { x: 20, y: 18 }, 'fb-center': { x: 20, y: 50 }, 'fb-right': { x: 20, y: 82 },
  'hb-left': { x: 35, y: 18 }, 'hb-center': { x: 35, y: 50 }, 'hb-right': { x: 35, y: 82 },
  'mf-left': { x: 50, y: 35 }, 'mf-right': { x: 50, y: 65 },
  'hf-left': { x: 65, y: 18 }, 'hf-center': { x: 65, y: 50 }, 'hf-right': { x: 65, y: 82 },
  'ff-left': { x: 80, y: 18 }, 'ff-center': { x: 80, y: 50 }, 'ff-right': { x: 80, y: 82 },
}

export interface RankedReceiver {
  player: JerseyPlayer
  /** Player's formation slot in actual pitch-% space (post attacking-direction flip) */
  x: number
  y: number
  dist: number
}

export interface RankLikelyReceiversOptions {
  /** The player currently holding the ball — excluded from the returned
   * ranking entirely. You can't receive a pass from yourself, so without
   * this a carrier could show up as their own suggested receiver. */
  activeCarrierId?: string | null
  /** Players who were on the ball recently (most-recent-first is fine, order
   * doesn't matter here). Recent on-ball involvement is a better real-position
   * signal than a static formation slot, so these players get an effective
   * distance discount before sorting — they outrank an equally-or-slightly
   * closer player with no recent involvement. */
  recentCarrierIds?: string[]
  /** When true, skips ranking entirely and returns an empty list. Used for
   * events (e.g. kickouts/breaks) where proximity to the ball's marker
   * position isn't a meaningful predictor of who wins it — a midfielder can
   * spring from distance to win a break, so biasing toward "nearby" here
   * would be actively misleading rather than merely imprecise. */
  excludeRanking?: boolean
}

/** Multiplies effective distance for players with recent on-ball involvement,
 * making them rank higher than their static formation slot alone would. */
const RECENCY_DISTANCE_DISCOUNT = 0.7

/** Wing positions that characteristically make forward/support runs off the
 * ball in Gaelic football — a wing-back breaking upfield or a wing-forward
 * peeling off their marker. Excludes the central slots (full-back, centre-back,
 * centre half-forward, full-forward) which tend to hold their line, and
 * midfield, which is already covered by pure ball-proximity. Used only by
 * rankAlternativeReceivers below — the main proximity ranking deliberately
 * stays position-agnostic. */
const RUNNER_POSITIONS = new Set(['hb-left', 'hb-right', 'hf-left', 'hf-right'])

/** Multiplies effective distance for players in a RUNNER_POSITIONS slot,
 * making them rank higher in the *alternative* list than raw ball-distance
 * alone would — they're a plausible next pass even when they're not the
 * nearest player on the pitch right now. */
const RUNNER_DISTANCE_DISCOUNT = 0.8

/**
 * Ranks on-field players by proximity of their formation slot to the ball's
 * current pitch-% position — nearest first. Ranking is by distance to the
 * BALL, not pitch center, so it genuinely re-ranks as the ball moves (the
 * whole point of a "likely receiver" picker).
 */
export function rankLikelyReceivers(
  players: JerseyPlayer[],
  attackingRight: boolean,
  ballPctX: number,
  ballPctY: number,
  options?: RankLikelyReceiversOptions
): RankedReceiver[] {
  const { activeCarrierId = null, recentCarrierIds = [], excludeRanking = false } = options || {}
  if (excludeRanking) return []

  const recentSet = new Set(recentCarrierIds)

  return players
    .filter(p => p.isOnField)
    .filter(p => p.playerId !== activeCarrierId)
    .map(p => {
      const slot = FORMATION_XY[p.positionId || ''] || { x: 50, y: 50 }
      const x = attackingRight ? slot.x : 100 - slot.x
      const y = slot.y
      const rawDist = Math.hypot(x - ballPctX, y - ballPctY)
      // "dist" is the effective (post-discount) distance used for sorting —
      // no other consumer reads it as a literal on-pitch distance today.
      const dist = recentSet.has(p.playerId) ? rawDist * RECENCY_DISTANCE_DISCOUNT : rawDist
      return { player: p, x, y, dist }
    })
    .sort((a, b) => a.dist - b.dist)
}

export interface RankAlternativeReceiversOptions {
  activeCarrierId?: string | null
  recentCarrierIds?: string[]
  /** Player IDs to leave out entirely — in practice, whoever
   * rankLikelyReceivers already surfaced (the pitch dots that are lit up).
   * The whole point of this ranking is to offer something *other* than
   * that set, so showing the same names again would defeat it. */
  excludeIds?: string[]
}

/**
 * Ranks on-field players for the radial carrier picker specifically — a
 * complementary list to rankLikelyReceivers's nearest-to-ball set, not a
 * second copy of it. The pitch dots already surface "who's closest right
 * now"; this surfaces "who else is a good next option": players who touched
 * the ball recently (their real position may have drifted from their static
 * formation slot) and players in a wing-back/wing-forward slot, who
 * characteristically make the forward or overlapping run that the nearest-5
 * static ranking can't see coming. Still weighted by ball distance underneath
 * those bonuses, so it never surfaces someone at the opposite end of the pitch.
 */
export function rankAlternativeReceivers(
  players: JerseyPlayer[],
  attackingRight: boolean,
  ballPctX: number,
  ballPctY: number,
  options?: RankAlternativeReceiversOptions
): RankedReceiver[] {
  const { activeCarrierId = null, recentCarrierIds = [], excludeIds = [] } = options || {}
  const recentSet = new Set(recentCarrierIds)
  const excludeSet = new Set(excludeIds)

  return players
    .filter(p => p.isOnField)
    .filter(p => p.playerId !== activeCarrierId)
    .filter(p => !excludeSet.has(p.playerId))
    .map(p => {
      const slot = FORMATION_XY[p.positionId || ''] || { x: 50, y: 50 }
      const x = attackingRight ? slot.x : 100 - slot.x
      const y = slot.y
      const rawDist = Math.hypot(x - ballPctX, y - ballPctY)
      let dist = rawDist
      if (recentSet.has(p.playerId)) dist *= RECENCY_DISTANCE_DISCOUNT
      if (RUNNER_POSITIONS.has(p.positionId || '')) dist *= RUNNER_DISTANCE_DISCOUNT
      return { player: p, x, y, dist }
    })
    .sort((a, b) => a.dist - b.dist)
}
