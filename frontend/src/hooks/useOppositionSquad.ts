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

type LineupRow = NonNullable<Match['opposition_lineup']>[number]

export interface PickerOption { id: string; name: string; jerseyNumber: number | null }

/** Optimistic lineup after an opposition substitution: the player coming on takes the outgoing player's slot (mirrors
 *  the server swap in opposition_service, so the circles update instantly and the next refetch agrees). */
export function swapOppositionLineup(rows: LineupRow[] | null | undefined, offId: string, onId: string) {
  if (!rows) return rows
  const off = rows.find(r => r.opposition_player_id === offId)
  const on = rows.find(r => r.opposition_player_id === onId)
  if (!off || !on) return rows
  const place = (r: LineupRow, position_id: string): LineupRow => {
    const bench = position_id.startsWith('sub')
    return { ...r, position_id, is_substitute: bench, is_on_field: !bench }
  }
  return rows.map(r => (r === off ? place(r, on.position_id) : r === on ? place(r, off.position_id) : r))
}

/** The substitution pickers' options: who is on the pitch (can come off) and who is on the bench (can come on). */
export function oppositionPickerOptions(squad: OppositionSquad): { onField: PickerOption[]; bench: PickerOption[] } {
  const opt = (p: JerseyPlayer): PickerOption => ({ id: p.playerId, name: p.playerName, jerseyNumber: p.jerseyNumber })
  return { onField: squad.players.filter(p => p.isOnField).map(opt), bench: squad.players.filter(p => !p.isOnField).map(opt) }
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
