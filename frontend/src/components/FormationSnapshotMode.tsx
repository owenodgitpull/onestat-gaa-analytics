/**
 * FormationSnapshotMode — fast tap-to-place formation capture.
 *
 * Flow:
 *  1. Tap pitch → instantly places a "?" marker
 *  2. Keep tapping to drop as many markers as needed (e.g. 6 taps in 3 seconds)
 *  3. Tap any "?" marker on the pitch to select it → player strip highlights
 *  4. Tap a jersey number to assign that player (or leave as "?")
 *  5. Tap Save — unassigned markers are saved with null player_id
 *
 * Minimum 2 markers to save. No inactivity auto-close (was confusing).
 */

import { useState, useEffect, useCallback } from 'react'
import { X, Check, RotateCcw, Trash2 } from 'lucide-react'

interface SnapshotPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
  positionLabel?: string
}

interface PlacedPosition {
  id: string // temp client ID for tracking
  playerId: string | null
  jerseyNumber: number | null
  playerName: string | null
  positionLabel: string | null
  x: number
  y: number
}

interface FormationSnapshotModeProps {
  isOpen: boolean
  onClose: () => void
  onSave: (positions: Array<{ playerId: string; jerseyNumber: number | null; x: number; y: number }>, label: string) => void
  availablePlayers: SnapshotPlayer[]
}

const LABELS = ['Defensive Shape', 'Kickout Setup', 'Attacking Press', 'Custom']

let nextId = 1

export default function FormationSnapshotMode({
  isOpen,
  onClose,
  onSave,
  availablePlayers,
}: FormationSnapshotModeProps) {
  const [positions, setPositions] = useState<PlacedPosition[]>([])
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [selectedLabel, setSelectedLabel] = useState('Defensive Shape')

  useEffect(() => {
    if (isOpen) {
      setPositions([])
      setSelectedMarkerId(null)
      setSelectedLabel('Defensive Shape')
      nextId = 1
    }
  }, [isOpen])

  const handlePitchTap = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    // Get coordinates from mouse or touch event
    let clientX: number, clientY: number
    if ('touches' in e) {
      // Touch event — use changedTouches for touchend
      const touch = e.changedTouches?.[0] || e.touches[0]
      if (!touch) return
      clientX = touch.clientX
      clientY = touch.clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((clientX - rect.left) / rect.width) * 100
    const y = ((clientY - rect.top) / rect.height) * 100

    const clampedX = Math.max(2, Math.min(98, x))
    const clampedY = Math.max(2, Math.min(98, y))

    const id = `marker-${nextId++}`
    setPositions(prev => [...prev, {
      id,
      playerId: null,
      jerseyNumber: null,
      playerName: null,
      positionLabel: null,
      x: clampedX,
      y: clampedY,
    }])
    // Auto-select the newly placed marker so user can assign immediately
    setSelectedMarkerId(id)
  }, [])

  const handleMarkerTap = useCallback((e: React.MouseEvent, markerId: string) => {
    e.stopPropagation() // Don't place a new marker
    setSelectedMarkerId(prev => prev === markerId ? null : markerId)
  }, [])

  const handlePlayerAssign = useCallback((player: SnapshotPlayer) => {
    if (!selectedMarkerId) return
    setPositions(prev => prev.map(p => {
      if (p.id !== selectedMarkerId) {
        // If this player was already assigned elsewhere, unassign them
        if (p.playerId === player.playerId) {
          return { ...p, playerId: null, jerseyNumber: null, playerName: null, positionLabel: null }
        }
        return p
      }
      return { ...p, playerId: player.playerId, jerseyNumber: player.jerseyNumber, playerName: player.playerName, positionLabel: player.positionLabel ?? null }
    }))
    setSelectedMarkerId(null)
  }, [selectedMarkerId])

  const handleDeleteMarker = useCallback(() => {
    if (!selectedMarkerId) return
    setPositions(prev => prev.filter(p => p.id !== selectedMarkerId))
    setSelectedMarkerId(null)
  }, [selectedMarkerId])

  const handleSave = () => {
    if (positions.length < 2) return
    // Map to the shape onSave expects — unassigned get empty playerId
    onSave(
      positions.map(p => ({
        playerId: p.playerId || `unassigned-${p.id}`,
        jerseyNumber: p.jerseyNumber,
        x: p.x,
        y: p.y,
      })),
      selectedLabel
    )
    onClose()
  }

  if (!isOpen) return null

  const assignedPlayerIds = new Set(positions.filter(p => p.playerId).map(p => p.playerId))
  const unassignedPlayers = availablePlayers
    .filter(p => !assignedPlayerIds.has(p.playerId))
    .sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99))

  const selectedMarker = positions.find(p => p.id === selectedMarkerId)

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-purple-900/30 border-b border-purple-500/20">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-purple-300">Formation Snapshot</span>
          <span className="text-xs text-white/50">{positions.length} placed</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setPositions([]); setSelectedMarkerId(null) }}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 active:bg-white/20 touch-manipulation"
            title="Reset all"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={positions.length < 2}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 touch-manipulation ${
              positions.length >= 2
                ? 'bg-purple-500 text-white active:bg-purple-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
          >
            <Check size={14} /> Save
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 active:bg-white/20 touch-manipulation"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Label picker */}
      <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-black/40">
        {LABELS.map(label => (
          <button
            key={label}
            onClick={() => setSelectedLabel(label)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all touch-manipulation ${
              selectedLabel === label
                ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40'
                : 'bg-white/10 text-white/50 border border-white/10'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pitch area — tap to place markers */}
      <div
        className="flex-1 relative mx-3 my-2 rounded-xl overflow-hidden bg-green-900/50 border-2 border-purple-500/30"
        onClick={handlePitchTap}
        onTouchEnd={(e) => {
          e.preventDefault()
          handlePitchTap(e)
        }}
        style={{ touchAction: 'none' }}
      >
        {/* Pitch background */}
        <img
          src="/pitch-svg.svg"
          className="w-full h-full object-contain opacity-40"
          alt="pitch"
          draggable={false}
        />

        {/* Placed markers */}
        {positions.map((pos) => {
          const isSelected = pos.id === selectedMarkerId
          const isAssigned = pos.playerId !== null
          return (
            <div
              key={pos.id}
              className={`absolute rounded-full flex items-center justify-center font-bold shadow-lg transition-all touch-manipulation ${
                isSelected
                  ? 'w-12 h-12 -ml-6 -mt-6 ring-2 ring-yellow-400 ring-offset-1 ring-offset-transparent z-10'
                  : 'w-10 h-10 -ml-5 -mt-5'
              } ${
                isAssigned
                  ? 'bg-purple-500 border-2 border-white text-white text-sm'
                  : 'bg-white/20 border-2 border-dashed border-white/60 text-white/80 text-lg'
              }`}
              style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              onClick={(e) => handleMarkerTap(e, pos.id)}
              onTouchEnd={(e) => {
                e.stopPropagation()
                e.preventDefault()
                setSelectedMarkerId(prev => prev === pos.id ? null : pos.id)
              }}
            >
              {isAssigned ? (pos.jerseyNumber ?? pos.positionLabel ?? '?') : '?'}
            </div>
          )
        })}

        {/* Instruction */}
        <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
          <span className="text-xs text-white/60 bg-black/60 px-3 py-1 rounded-full">
            {positions.length === 0
              ? 'Tap pitch to place players'
              : selectedMarkerId
                ? 'Assign a jersey below, or tap another spot'
                : 'Keep tapping to add more, or tap a marker to assign'}
          </span>
        </div>
      </div>

      {/* Player assignment strip — always visible */}
      <div className="flex-shrink-0 px-3 py-2 bg-black/60 border-t border-white/10">
        {selectedMarkerId && selectedMarker ? (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-white/50">
                {selectedMarker.playerName
                  ? `Selected: ${selectedMarker.playerName}`
                  : 'Tap a player to assign'}
              </span>
              <button
                onClick={handleDeleteMarker}
                className="flex-shrink-0 px-2 py-1 rounded-lg bg-red-500/20 text-red-400 active:bg-red-500/40 touch-manipulation text-xs flex items-center gap-1"
              >
                <Trash2 size={12} /> Remove
              </button>
            </div>
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              {unassignedPlayers.map(player => (
                <button
                  key={player.playerId}
                  onClick={() => handlePlayerAssign(player)}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/40 active:bg-purple-500/40 transition-all touch-manipulation"
                >
                  <span className="w-7 h-7 rounded-full bg-purple-500/40 border border-purple-300/50 flex items-center justify-center text-purple-200 font-bold text-xs">
                    {player.jerseyNumber ?? '#'}
                  </span>
                  <span className="text-xs text-white/80 font-medium whitespace-nowrap max-w-[80px] truncate">
                    {player.playerName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-center py-1.5">
            <span className="text-xs text-white/40">
              {positions.length === 0
                ? 'Tap the pitch to start placing players'
                : positions.some(p => !p.playerId)
                  ? `${positions.filter(p => !p.playerId).length} unassigned — tap a marker to assign`
                  : `${positions.length} players placed — tap Save or add more`}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
