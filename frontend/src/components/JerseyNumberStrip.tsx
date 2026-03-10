/**
 * JerseyNumberStrip — persistent horizontal strip of player buttons
 * for quick ball carrier assignment.
 *
 * Shows jersey number when available, otherwise position label (HB, FB, etc.)
 * with player surname underneath.
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
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

export default function JerseyNumberStrip({
  players,
  activeCarrierId,
  currentPossession,
  onCarrierSelect,
  disabled = false,
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

  const isOwn = currentPossession === PossessionTeam.OWN
  const activeColor = isOwn ? 'bg-emerald-500 border-emerald-400' : 'bg-orange-500 border-orange-400'
  const inactiveColor = 'bg-white/10 border-white/20'

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
              rounded-xl border-2 transition-all duration-150
              ${hasJersey ? 'w-[48px] h-[48px]' : 'w-[48px] h-[52px] px-0.5'}
              ${isActive ? `${activeColor} text-white scale-110 shadow-lg shadow-emerald-500/30` : `${inactiveColor} text-white/70`}
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/20 active:scale-90'}
            `}
            title={player.playerName}
          >
            <span className={`font-bold leading-none ${hasJersey ? 'text-base' : 'text-[11px]'}`}>
              {label}
            </span>
            {hasJersey ? (
              <span className="text-[8px] leading-none mt-0.5 text-white/50 truncate max-w-full">
                {surname(player.playerName)}
              </span>
            ) : (
              <span className="text-[8px] leading-none mt-0.5 text-white/50 truncate max-w-full">
                {surname(player.playerName)}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
