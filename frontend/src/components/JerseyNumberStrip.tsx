/**
 * JerseyNumberStrip — persistent horizontal strip of player buttons
 * for quick ball carrier assignment.
 *
 * Shows jersey number with player surname underneath.
 * All buttons use team primary colour with secondary (trim) border.
 * Active carrier gets full opacity + glow; others are slightly dimmed.
 *
 * Players are ordered by positional line (defence → attack in 1st half,
 * reversed in 2nd half). Recent carriers appear as quick-pick shortcuts.
 */

import { useMemo } from 'react'
import { PossessionTeam } from '@/types'

export interface JerseyPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
  isOnField: boolean
  positionLabel?: string
  positionId?: string
}

interface JerseyNumberStripProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  currentPossession: PossessionTeam
  onCarrierSelect: (playerId: string, jerseyNumber: number | null) => void
  disabled?: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  currentHalf?: 1 | 2
  attackingRight?: boolean
  recentCarrierIds?: string[]
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

/** Map position_id prefixes to positional line order (defence → attack) */
export const POSITION_LINE_ORDER: Record<string, number> = {
  'gk': 0,
  'fb': 1,
  'hb': 2,
  'mf': 3,
  'hf': 4,
  'ff': 5,
}

/** Map position_id to short line label for group dividers */
const LINE_LABELS: Record<number, string> = {
  0: 'GK',
  1: 'FB',
  2: 'HB',
  3: 'MF',
  4: 'HF',
  5: 'FF',
}

export function getPositionLine(positionId?: string): number {
  if (!positionId) return 3 // default to midfield
  const prefix = positionId.split('-')[0]
  return POSITION_LINE_ORDER[prefix] ?? 3
}

export default function JerseyNumberStrip({
  players,
  activeCarrierId,
  onCarrierSelect,
  disabled = false,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  currentHalf = 1,
  attackingRight = true,
  recentCarrierIds = [],
}: JerseyNumberStripProps) {
  // Sort by positional line, direction-aware based on half
  const sortedPlayers = useMemo(() => {
    const onField = players.filter(p => p.isOnField)

    return [...onField].sort((a, b) => {
      const lineA = getPositionLine(a.positionId)
      const lineB = getPositionLine(b.positionId)

      // Mirror pitch: defence first when attacking right (GK on left), reversed when attacking left
      const defenceFirst = attackingRight
      const lineCompare = defenceFirst ? lineA - lineB : lineB - lineA

      if (lineCompare !== 0) return lineCompare

      // Within same line, sort by jersey number
      if (a.jerseyNumber != null && b.jerseyNumber != null) return a.jerseyNumber - b.jerseyNumber
      if (a.jerseyNumber != null) return -1
      if (b.jerseyNumber != null) return 1
      return a.playerName.localeCompare(b.playerName)
    })
  }, [players, attackingRight])

  // Recent carriers (last 3 unique, excluding current active carrier)
  const recentPlayers = useMemo(() => {
    if (recentCarrierIds.length === 0) return []
    const seen = new Set<string>()
    const result: JerseyPlayer[] = []
    for (const id of recentCarrierIds) {
      if (id === activeCarrierId) continue
      if (seen.has(id)) continue
      seen.add(id)
      const p = sortedPlayers.find(sp => sp.playerId === id)
      if (p) result.push(p)
      if (result.length >= 3) break
    }
    return result
  }, [recentCarrierIds, activeCarrierId, sortedPlayers])

  if (sortedPlayers.length === 0) return null

  // Group players by positional line for subtle separators
  let lastLine = -1

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-hide"
      style={{ justifyContent: 'safe center' }}
    >
      {/* `safe center` (not plain `center`) — a row centered while it fits
          scrolls normally, but a PLAIN centered flex row that later overflows
          (a full 15-a-side lineup on a narrower screen) clips its start
          behind the left edge until the user scrolls left first to reveal
          it — "safe" falls back to start-alignment in that case instead. */}
      <span className="text-[10px] text-white/50 font-semibold uppercase tracking-wider whitespace-nowrap mr-1 flex-shrink-0">
        Carrier
      </span>

      {/* Recent carriers quick picks */}
      {recentPlayers.length > 0 && (
        <>
          {recentPlayers.map((player) => {
            const hasJersey = player.jerseyNumber != null
            const label = hasJersey ? String(player.jerseyNumber) : (player.positionLabel || '?')
            return (
              <button
                key={`recent-${player.playerId}`}
                onClick={() => !disabled && onCarrierSelect(player.playerId, player.jerseyNumber)}
                disabled={disabled}
                className={`
                  flex-shrink-0 flex flex-col items-center justify-center
                  rounded-full transition-all duration-150
                  w-[44px] h-[44px]
                  ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer hover:scale-105 active:scale-90'}
                `}
                style={{
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  border: `2px solid ${teamPrimaryColor}80`,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
                  color: '#FFFFFF',
                  opacity: 0.85,
                }}
                title={`${player.playerName} (recent)`}
              >
                <span className={`font-bold leading-none ${hasJersey ? 'text-sm' : 'text-[10px]'}`}>
                  {label}
                </span>
                <span className="text-[7px] leading-none mt-0.5 truncate max-w-full text-white/70">
                  {surname(player.playerName)}
                </span>
              </button>
            )
          })}
          {/* Divider between recent and positional list */}
          <div className="w-px h-8 bg-white/15 flex-shrink-0 mx-0.5" />
        </>
      )}

      {/* Positional player list */}
      {sortedPlayers.map((player) => {
        const isActive = player.playerId === activeCarrierId
        const hasJersey = player.jerseyNumber != null
        const label = hasJersey ? String(player.jerseyNumber) : (player.positionLabel || '?')
        const line = getPositionLine(player.positionId)

        // Insert subtle line separator between positional groups
        const showSeparator = lastLine !== -1 && line !== lastLine
        lastLine = line

        return (
          <div key={player.playerId} className="flex items-center gap-1.5 flex-shrink-0">
            {showSeparator && (
              <div className="flex flex-col items-center flex-shrink-0 mx-0.5">
                <div className="w-px h-3 bg-white/10" />
                <span className="text-[7px] text-white/25 font-medium leading-none my-0.5">
                  {LINE_LABELS[currentHalf === 1 ? line : line] || ''}
                </span>
                <div className="w-px h-3 bg-white/10" />
              </div>
            )}
            <button
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
          </div>
        )
      })}
    </div>
  )
}
