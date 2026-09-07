/**
 * CarrierSideColumn — vertical, 2-wide column of jersey-number carrier
 * buttons for fullscreen pitch mode. Two instances flank the pitch (left:
 * GK/FB/HB, right: HF/FF, MF split one-each — see FullscreenPitchMode.tsx),
 * filling the gutter space that's empty there today instead of a horizontal
 * strip between the pitch and the action buttons.
 *
 * Visual style is lifted directly from JerseyNumberStrip's positional
 * buttons (same size, colours, active/inactive treatment) so it reads as
 * "the same carrier picker, laid out differently" rather than a new control.
 */

import type { JerseyPlayer } from './JerseyNumberStrip'

interface CarrierSideColumnProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  onCarrierSelect: (playerId: string, jerseyNumber: number | null) => void
  disabled?: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

export default function CarrierSideColumn({
  players,
  activeCarrierId,
  onCarrierSelect,
  disabled = false,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
}: CarrierSideColumnProps) {
  if (players.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-1.5 flex-shrink-0">
      {players.map((player) => {
        const isActive = player.playerId === activeCarrierId
        const hasJersey = player.jerseyNumber != null
        const label = hasJersey ? String(player.jerseyNumber) : (player.positionLabel || '?')

        return (
          <button
            key={player.playerId}
            onClick={() => !disabled && onCarrierSelect(player.playerId, player.jerseyNumber)}
            disabled={disabled}
            className={`
              flex flex-col items-center justify-center
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
