/**
 * JerseyNumberStrip — persistent horizontal strip of jersey number buttons
 * below the pitch for quick ball carrier assignment.
 *
 * Uses matchLineup data to show players currently on the field.
 * Active carrier is highlighted with team color.
 */

import { useMemo } from 'react'
import { PossessionTeam } from '@/types'

interface JerseyPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
  isOnField: boolean
}

interface JerseyNumberStripProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  currentPossession: PossessionTeam
  onCarrierSelect: (playerId: string, jerseyNumber: number | null) => void
  disabled?: boolean
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
  const activeTextColor = 'text-white'
  const inactiveColor = 'bg-white/10 border-white/20'
  const inactiveTextColor = 'text-white/70'

  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hide">
      <span className="text-[9px] text-white/40 font-medium uppercase tracking-wider whitespace-nowrap mr-1">
        Carrier
      </span>
      {sortedPlayers.map((player) => {
        const isActive = player.playerId === activeCarrierId
        return (
          <button
            key={player.playerId}
            onClick={() => !disabled && onCarrierSelect(player.playerId, player.jerseyNumber)}
            disabled={disabled}
            className={`
              flex-shrink-0 w-[42px] h-[42px] rounded-full flex items-center justify-center
              font-bold text-sm border-2 transition-all duration-150
              ${isActive ? `${activeColor} ${activeTextColor} scale-110 shadow-lg` : `${inactiveColor} ${inactiveTextColor}`}
              ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:bg-white/20 active:scale-95'}
            `}
            title={player.playerName}
          >
            {player.jerseyNumber ?? '?'}
          </button>
        )
      })}
    </div>
  )
}
