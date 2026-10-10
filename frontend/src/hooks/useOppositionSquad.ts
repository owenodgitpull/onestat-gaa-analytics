/**
 * The opposition's on-pitch squad for the recorders (inter-county only).
 *
 * Turns the match's opposition lineup into the same `JerseyPlayer` shape our own players use, so the existing carrier
 * radial, pitch receiver dots and fullscreen strip render opposition circles with no new components. Empty (and
 * `enabled: false`) for clubs and for matches with no lineup entered — recording then behaves exactly as before.
 */
import { useMemo } from 'react'
import type { JerseyPlayer } from '@/components/JerseyNumberStrip'
import { FORMATION_POSITIONS } from '@/components/StartingLineupModal'
import type { Match, Club } from '@/types'

const LABEL_BY_POSITION = Object.fromEntries(FORMATION_POSITIONS.map(p => [p.id, p.label]))

export const OPPOSITION_DEFAULT_PRIMARY = '#F97316'
export const OPPOSITION_DEFAULT_SECONDARY = '#FFFFFF'

export interface OppositionSquad {
  enabled: boolean
  players: JerseyPlayer[]
  primary: string
  secondary: string
}

const NONE: OppositionSquad = { enabled: false, players: [], primary: OPPOSITION_DEFAULT_PRIMARY, secondary: OPPOSITION_DEFAULT_SECONDARY }

export function useOppositionSquad(match: Match | null | undefined, club: Club | null | undefined): OppositionSquad {
  const featureOn = !!club?.features?.opposition_lineup
  const lineup = match?.opposition_lineup
  const primary = match?.opponent_strip_colour || OPPOSITION_DEFAULT_PRIMARY
  const secondary = match?.opponent_strip_secondary_colour || OPPOSITION_DEFAULT_SECONDARY

  return useMemo(() => {
    if (!featureOn || !lineup?.length) return NONE
    const players: JerseyPlayer[] = lineup.map(r => ({
      playerId: r.opposition_player_id,
      jerseyNumber: r.jersey_number,
      playerName: r.surname,
      isOnField: r.is_on_field,
      positionLabel: LABEL_BY_POSITION[r.position_id] ?? 'SUB',
      positionId: r.position_id,
    }))
    return { enabled: true, players, primary, secondary }
  }, [featureOn, lineup, primary, secondary])
}
