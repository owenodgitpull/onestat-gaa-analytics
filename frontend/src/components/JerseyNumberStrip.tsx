/**
 * JerseyNumberStrip — persistent horizontal strip of player buttons
 * for quick ball carrier assignment.
 *
 * Shows jersey number with player surname underneath.
 * All buttons use team primary colour with secondary (trim) border.
 * Active carrier gets full opacity + glow; others are slightly dimmed.
 */

import { useMemo } from 'react'
import { PossessionTeam } from '@/types'

interface JerseyPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
  isOnField: boolean
  positionLabel?: string
}

interface JerseyNumberStripProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  currentPossession: PossessionTeam
  onCarrierSelect: (playerId: string, jerseyNumber: number | null) => void
  disabled?: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

export default function JerseyNumberStrip({
  players,
  activeCarrierId,
  onCarrierSelect,
  disabled = false,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
}: JerseyNumberStripProps) {
  // Sort by jersey number, then by name for those without numbers
  const sortedPlayers = useMemo(() => {
    return [...players]
      .filter(p => p.isOnField)
      .sort((a, b) => {
        if (a.jerseyNumber != null && b.jerseyNumber != null) return a.jerseyNumber - b.jerseyNumber
        if (a.jerseyNumber != null) return -1
        if (b.jerseyNumber != null) return 1
        return a.playerName.localeCompare(b.playerName)
      })
  }, [players])

  if (sortedPlayers.length === 0) return null

  return (
    <div className="flex items-center justify-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hide">
      <span className="text-[10px] text-white/50 font-semibold uppercase tracking-wider whitespace-nowrap mr-1 flex-shrink-0">
        Carrier
      </span>
      {sortedPlayers.map((player) => {
        const isActive = player.playerId === activeCarrierId
        const hasJersey = player.jerseyNumber != null
        const label = hasJersey ? String(player.jerseyNumber) : (player.positionLabel || '?')

        return (
          <button
            key={player.playerId}
            onClick={() => !disabled && onCarrierSelect(player.playerId, player.jerseyNumber)}
            disabled={disabled}
            className={`
              flex-shrink-0 flex flex-col items-center justify-center
              rounded-full transition-all duration-150
              w-[48px] h-[48px]
              ${isActive ? 'scale-110' : ''}
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-90'}
            `}
            style={{
              backgroundColor: teamPrimaryColor,
              border: `3px solid ${teamSecondaryColor}`,
              boxShadow: isActive
                ? `0 0 16px ${teamPrimaryColor}80, 0 0 4px ${teamSecondaryColor}60`
                : `0 2px 6px rgba(0,0,0,0.3)`,
              color: '#FFFFFF',
              opacity: isActive ? 1 : 0.65,
            }}
            title={player.playerName}
          >
            <span className={`font-bold leading-none ${hasJersey ? 'text-base' : 'text-[11px]'}`}>
              {label}
            </span>
            <span className="text-[7px] leading-none mt-0.5 truncate max-w-full text-white/80">
              {surname(player.playerName)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
