/**
 * "Which opposition player?" as the SAME over-the-pitch picker used for our own players (PitchPlayerSelector), fed the
 * opposition lineup in the opposition's colours. Used for opposition scorers (inter-county only: callers render it only
 * when the match has an opposition lineup). The event is already logged with the ball carrier as its default scorer, so
 * closing it keeps that default; picking a player replaces it. The tracked carrier is highlighted as the suggestion.
 */
import { useMemo } from 'react'
import PitchPlayerSelector from './PitchPlayerSelector'
import type { OppositionSquad } from '@/hooks/useOppositionSquad'
import type { Player } from '../types'

interface Props {
  squad: OppositionSquad
  /** Key into the picker's title table, e.g. 'point' -> "Who Scored?" */
  eventType: string
  /** Direction OUR team attacks this half; the opposition's pitch is the mirror image. */
  ourAttackingRight: boolean
  ballPosition?: { x: number; y: number } | null
  suggestedPlayerId?: string | null
  onSelect: (oppositionPlayerId: string, name: string) => void
  onClose: () => void
}

export default function OppositionPlayerSelector({
  squad, eventType, ourAttackingRight, ballPosition, suggestedPlayerId, onSelect, onClose,
}: Props) {
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
      suggestedPlayerId={suggestedPlayerId ?? null}
    />
  )
}
