import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type { Player } from '../types'

interface PitchPlayerSelectorProps {
  isOpen: boolean
  onClose: () => void
  onSelectPlayer: (player: Player) => void
  eventType: string
  team: 'own' | 'opponent'
  players: Player[]
  /** Lineup entries with position information for on-pitch placement */
  matchLineup: Array<{
    player_id: string
    position_id?: string
    match_jersey_number?: number | null
    player_jersey_number?: number | null
    is_on_field?: boolean
  }>
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  attackingRight?: boolean
  readOnly?: boolean  // View-only mode — shows lineup without player selection
}

// Standard GAA formation: 1-3-3-2-3-3 (15 players)
const FORMATION_POSITIONS = [
  { id: 'gk', x: 7, y: 50, label: 'GK' },
  { id: 'fb-left', x: 20, y: 18, label: 'CB' },
  { id: 'fb-center', x: 20, y: 50, label: 'FB' },
  { id: 'fb-right', x: 20, y: 82, label: 'CB' },
  { id: 'hb-left', x: 35, y: 18, label: 'HB' },
  { id: 'hb-center', x: 35, y: 50, label: 'CHB' },
  { id: 'hb-right', x: 35, y: 82, label: 'HB' },
  { id: 'mf-left', x: 50, y: 35, label: 'MF' },
  { id: 'mf-right', x: 50, y: 65, label: 'MF' },
  { id: 'hf-left', x: 65, y: 18, label: 'HF' },
  { id: 'hf-center', x: 65, y: 50, label: 'CHF' },
  { id: 'hf-right', x: 65, y: 82, label: 'HF' },
  { id: 'ff-left', x: 80, y: 18, label: 'CF' },
  { id: 'ff-center', x: 80, y: 50, label: 'FF' },
  { id: 'ff-right', x: 80, y: 82, label: 'CF' },
]

const EVENT_LABELS: Record<string, { title: string; color: string }> = {
  goal: { title: 'Who Scored?', color: 'text-emerald-400' },
  point: { title: 'Who Scored?', color: 'text-blue-400' },
  assist: { title: 'Who Assisted?', color: 'text-cyan-400' },
  turnover: { title: 'Who Won?', color: 'text-amber-400' },
  kickout: { title: 'Who Won?', color: 'text-emerald-400' },
  wide: { title: 'Who Took?', color: 'text-red-400' },
  saved: { title: 'Who Shot (Saved)?', color: 'text-blue-400' },
  turnover_won: { title: 'Who Won Turnover?', color: 'text-emerald-400' },
  turnover_lost: { title: 'Who Lost Possession?', color: 'text-red-400' },
  our_unforced_error: { title: 'Who Made Error?', color: 'text-red-400' },
  opp_unforced_error: { title: 'Who Made Error?', color: 'text-red-400' },
  foul_committed: { title: 'Who Fouled?', color: 'text-red-400' },
  own_kickout_won: { title: 'Who Won Our Kickout?', color: 'text-emerald-400' },
  opp_kickout_won: { title: 'Who Won Opp Kickout?', color: 'text-emerald-400' },
  own_kickout_won_break: { title: 'Who Won Break?', color: 'text-emerald-400' },
  opp_kickout_won_break: { title: 'Who Won Break?', color: 'text-emerald-400' },
  yellow_card: { title: 'Yellow Card — Who?', color: 'text-yellow-400' },
  black_card: { title: 'Black Card — Who?', color: 'text-slate-300' },
  red_card: { title: 'Red Card — Who?', color: 'text-red-500' },
  point_free: { title: 'Who Took Free?', color: 'text-blue-400' },
  two_point_free: { title: 'Who Took Free?', color: 'text-blue-400' },
  wide_free: { title: 'Who Took Free?', color: 'text-red-400' },
  forty_five: { title: 'Who Took 45?', color: 'text-blue-400' },
  forty_five_missed: { title: 'Who Took 45?', color: 'text-red-400' },
  penalty_goal: { title: 'Who Took Penalty?', color: 'text-emerald-400' },
  penalty_miss: { title: 'Who Took Penalty?', color: 'text-red-400' },
  block: { title: 'Who Blocked?', color: 'text-cyan-400' },
  interception: { title: 'Who Intercepted?', color: 'text-cyan-400' },
}

export default function PitchPlayerSelector({
  isOpen,
  onClose,
  onSelectPlayer,
  eventType,
  players,
  matchLineup,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  attackingRight = true,
  readOnly = false,
}: PitchPlayerSelectorProps) {
  const [animateIn, setAnimateIn] = useState(false)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  const [animateOut, setAnimateOut] = useState(false)

  // Map players to formation positions using position_id from lineup
  const playerPositions = useMemo(() => {
    // Build lookup: position_id → lineup entry (on-field only)
    const onField = matchLineup.filter(e => e.is_on_field !== false)
    const byPosition = new Map(onField.map(e => [e.position_id, e]))
    // Also build an ordered fallback for lineups without position_id
    const unmatched: typeof onField = []

    const result: Array<{
      id: string; x: number; y: number; label: string; player: Player; jerseyNumber: number | null
    }> = []

    for (const pos of FORMATION_POSITIONS) {
      const entry = byPosition.get(pos.id)
      if (entry) {
        const player = players.find(p => p.id === entry.player_id)
        if (player) {
          result.push({
            ...pos,
            player,
            jerseyNumber: (entry as any).match_jersey_number ?? (entry as any).player_jersey_number ?? player.jersey_number,
          })
          continue
        }
      }
      unmatched.push(undefined as any) // placeholder
    }

    // Fallback: if position_id matching found nothing, map by index order
    if (result.length === 0 && onField.length > 0) {
      for (let i = 0; i < Math.min(onField.length, FORMATION_POSITIONS.length); i++) {
        const entry = onField[i]
        const pos = FORMATION_POSITIONS[i]
        const player = players.find(p => p.id === entry.player_id)
        if (player) {
          result.push({
            ...pos,
            player,
            jerseyNumber: (entry as any).match_jersey_number ?? (entry as any).player_jersey_number ?? player.jersey_number,
          })
        }
      }
    }

    return result
  }, [matchLineup, players])

  // Animate in when opening
  useEffect(() => {
    if (isOpen) {
      setAnimateIn(false)
      setSelectedPlayerId(null)
      setAnimateOut(false)
      // Stagger the entrance
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setAnimateIn(true)
        })
      })
    }
  }, [isOpen])

  if (!isOpen) return null

  const eventInfo = EVENT_LABELS[eventType] || { title: 'Select Player', color: 'text-white' }

  const handleSelect = (player: Player) => {
    setSelectedPlayerId(player.id)
    setAnimateOut(true)
    // Fire callback immediately — parent will close/unmount us
    onSelectPlayer(player)
  }

  const surname = (name: string) => {
    const parts = name.trim().split(' ')
    return parts[parts.length - 1] || name
  }

  const content = (
    <div className="fixed inset-0 z-[110] flex flex-col">
      {/* Semi-transparent backdrop */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm transition-opacity duration-300"
        style={{ opacity: animateIn && !animateOut ? 1 : 0 }}
        onClick={onClose}
      />

      {/* Header prompt */}
      <div
        className="relative z-10 text-center pt-3 pb-2 transition-all duration-300"
        style={{
          opacity: animateIn && !animateOut ? 1 : 0,
          transform: animateIn && !animateOut ? 'translateY(0)' : 'translateY(-20px)',
        }}
      >
        {readOnly ? (
          <>
            <h2 className="text-lg font-bold text-white">Current Lineup</h2>
            <p className="text-white/50 text-xs mt-0.5">{playerPositions.length} players on field</p>
          </>
        ) : (
          <>
            <h2 className={`text-lg font-bold ${eventInfo.color}`}>{eventInfo.title}</h2>
            <p className="text-white/50 text-xs mt-0.5">Tap a player on the pitch</p>
          </>
        )}
      </div>

      {/* Pitch with players */}
      <div className="relative flex-1 mx-2 mb-2">
        {/* Pitch background */}
        <div className="absolute inset-0 rounded-xl overflow-hidden">
          <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full opacity-30">
            <rect width="2332" height="1446" fill="#2d5016" />
            <image
              href="/pitch-svg.svg"
              width="2332"
              height="1446"
              preserveAspectRatio="xMidYMid meet"
            />
          </svg>
        </div>

        {/* Player circles */}
        {playerPositions.map((item, index) => {
          const isSelected = selectedPlayerId === item.player.id
          const delay = index * 30 // Stagger entrance by 30ms each

          return (
            <button
              key={item.player.id}
              className="absolute transform -translate-x-1/2 -translate-y-1/2 flex flex-col items-center focus:outline-none"
              style={{
                left: `${attackingRight ? item.x : 100 - item.x}%`,
                top: `${item.y}%`,
                opacity: animateOut ? (isSelected ? 1 : 0) : (animateIn ? 1 : 0),
                transform: `translate(-50%, -50%) scale(${
                  animateOut
                    ? (isSelected ? 1.3 : 0.5)
                    : (animateIn ? 1 : 0.3)
                })`,
                transition: `all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) ${animateOut ? 0 : delay}ms`,
              }}
              onClick={() => readOnly ? onClose() : handleSelect(item.player)}
            >
              {/* Jersey circle */}
              <div
                className={`w-14 h-14 rounded-full flex flex-col items-center justify-center shadow-lg ring-2 transition-transform active:scale-90 ${
                  isSelected ? 'scale-110' : 'hover:ring-4 hover:scale-105'
                }`}
                style={{
                  backgroundColor: teamPrimaryColor,
                  color: teamSecondaryColor,
                  '--tw-ring-color': teamSecondaryColor,
                  boxShadow: isSelected
                    ? `0 0 20px ${teamPrimaryColor}80`
                    : `0 4px 12px rgba(0,0,0,0.4)`,
                } as React.CSSProperties}
              >
                {item.jerseyNumber != null ? (
                  <span className="font-bold text-lg">{item.jerseyNumber}</span>
                ) : (
                  <span className="font-bold text-xs leading-tight">{item.label}</span>
                )}
              </div>

              {/* Player name */}
              <span
                className="mt-1 text-xs font-semibold text-white bg-black/70 px-2 py-0.5 rounded whitespace-nowrap max-w-[80px] truncate"
              >
                {surname(item.player.name)}
              </span>
            </button>
          )
        })}
      </div>

      {/* Skip button */}
      <div
        className="relative z-10 pb-3 px-4 transition-all duration-300"
        style={{
          opacity: animateIn && !animateOut ? 1 : 0,
          transform: animateIn && !animateOut ? 'translateY(0)' : 'translateY(20px)',
        }}
      >
        <button
          onClick={onClose}
          className="w-full py-3 rounded-xl bg-white/10 border border-white/20 text-white/70 text-sm font-medium hover:bg-white/15 transition-colors"
        >
          {readOnly ? 'Close' : 'Skip Player — Event will still be logged'}
        </button>
      </div>
    </div>
  )

  return createPortal(content, document.body)
}
