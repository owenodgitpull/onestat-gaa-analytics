/**
 * "Which opposition player?" — the SAME pitch picker used for our own players (PitchPlayerSelector), fed the
 * opposition lineup in the opposition's colours. Inter-county only: callers render it only when the match has an
 * opposition lineup (useOppositionSquad().enabled). Skipping (closing) must always be allowed — the event is already
 * logged; this only attaches the player to it.
 */
import { useMemo } from 'react'
import PitchPlayerSelector from './PitchPlayerSelector'
import type { OppositionSquad } from '@/hooks/useOppositionSquad'
import type { Player } from '../types'

interface Props {
  squad: OppositionSquad
  /** Key into the picker's title table, e.g. 'foul_committed' → "Who Fouled?" */
  eventType: string
  /** Direction OUR team attacks this half; the opposition's pitch is the mirror image. */
  ourAttackingRight: boolean
  ballPosition?: { x: number; y: number } | null
  onSelect: (oppositionPlayerId: string, name: string) => void
  onClose: () => void
}

export default function OppositionPlayerSelector({ squad, eventType, ourAttackingRight, ballPosition, onSelect, onClose }: Props) {
  const { players, lineup } = useMemo(() => {
    const players = squad.players.map(p => ({
      id: p.playerId, name: p.playerName, jersey_number: p.jerseyNumber, position: null,
    })) as unknown as Player[]
    const lineup = squad.players.map(p => ({
      player_id: p.playerId,
      position_id: p.isOnField ? p.positionId : undefined,
      match_jersey_number: p.jerseyNumber,
      player_jersey_number: p.jerseyNumber,
      is_on_field: p.isOnField,
    }))
    return { players, lineup }
  }, [squad.players])

  if (!squad.enabled || !players.length) return null
  return (
    <PitchPlayerSelector
      isOpen
      onClose={onClose}
      onSelectPlayer={p => onSelect(String(p.id), p.name)}
      eventType={eventType}
      team="opponent"
      players={players}
      matchLineup={lineup}
      teamPrimaryColor={squad.primary}
      teamSecondaryColor={squad.secondary}
      attackingRight={!ourAttackingRight}
      ballPosition={ballPosition}
    />
  )
}
