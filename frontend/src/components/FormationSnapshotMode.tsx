/**
 * FormationSnapshotMode — overlay for capturing player positions on the pitch.
 *
 * Tap a position on the pitch, then tap a jersey number to place that player.
 * Auto-closes after 5 seconds of inactivity. Minimum 2 players required to save.
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { X, Check, RotateCcw } from 'lucide-react'

interface SnapshotPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
}

interface PlacedPosition {
  playerId: string
  jerseyNumber: number | null
  x: number
  y: number
}

interface FormationSnapshotModeProps {
  isOpen: boolean
  onClose: () => void
  onSave: (positions: PlacedPosition[], label: string) => void
  availablePlayers: SnapshotPlayer[]
}

const LABELS = ['Defensive Shape', 'Kickout Setup', 'Attacking Press', 'Custom']

export default function FormationSnapshotMode({
  isOpen,
  onClose,
  onSave,
  availablePlayers,
}: FormationSnapshotModeProps) {
  const [positions, setPositions] = useState<PlacedPosition[]>([])
  const [pendingTap, setPendingTap] = useState<{ x: number; y: number } | null>(null)
  const [selectedLabel, setSelectedLabel] = useState('Defensive Shape')
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset inactivity timer on any interaction
  const resetInactivityTimer = useCallback(() => {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    inactivityTimer.current = setTimeout(() => {
      onClose()
    }, 8000) // 8s inactivity auto-close
  }, [onClose])

  useEffect(() => {
    if (isOpen) {
      setPositions([])
      setPendingTap(null)
      setSelectedLabel('Defensive Shape')
      resetInactivityTimer()
    }
    return () => {
      if (inactivityTimer.current) clearTimeout(inactivityTimer.current)
    }
  }, [isOpen, resetInactivityTimer])

  if (!isOpen) return null

  const handlePitchTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingTap({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) })
    resetInactivityTimer()
  }

  const handlePlayerSelect = (player: SnapshotPlayer) => {
    if (!pendingTap) return
    // Remove existing placement for this player
    const filtered = positions.filter(p => p.playerId !== player.playerId)
    setPositions([...filtered, { ...player, ...pendingTap }])
    setPendingTap(null)
    resetInactivityTimer()
  }

  const handleSave = () => {
    if (positions.length < 2) return
    onSave(positions, selectedLabel)
    onClose()
  }

  const placedPlayerIds = new Set(positions.map(p => p.playerId))
  const unplacedPlayers = availablePlayers
    .filter(p => !placedPlayerIds.has(p.playerId))
    .sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99))

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-purple-900/30 border-b border-purple-500/20">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-purple-300">Formation Snapshot</span>
          <span className="text-xs text-white/50">{positions.length} players placed</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setPositions([]); setPendingTap(null); resetInactivityTimer() }}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 hover:bg-white/20"
            title="Reset"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={positions.length < 2}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-1 ${
              positions.length >= 2
                ? 'bg-purple-500 text-white hover:bg-purple-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
            }`}
          >
            <Check size={14} /> Save
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 hover:bg-white/20"
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
            onClick={() => { setSelectedLabel(label); resetInactivityTimer() }}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
              selectedLabel === label
                ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40'
                : 'bg-white/10 text-white/50 border border-white/10 hover:bg-white/20'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pitch area — tap to place */}
      <div
        className="flex-1 relative mx-4 my-3 rounded-xl overflow-hidden bg-green-900/50 border-2 border-purple-500/30 cursor-crosshair"
        onClick={handlePitchTap}
      >
        {/* Pitch background */}
        <img
          src="/pitch-svg.svg"
          className="w-full h-full object-contain opacity-40"
          alt="pitch"
          draggable={false}
        />

        {/* Placed players */}
        {positions.map((pos) => (
          <div
            key={pos.playerId}
            className="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-purple-500 border-2 border-white flex items-center justify-center text-white text-sm font-bold shadow-lg"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
          >
            {pos.jerseyNumber ?? '?'}
          </div>
        ))}

        {/* Pending tap marker */}
        {pendingTap && (
          <div
            className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-3 border-dashed border-yellow-400 animate-pulse"
            style={{ left: `${pendingTap.x}%`, top: `${pendingTap.y}%` }}
          />
        )}

        {/* Instruction overlay */}
        <div className="absolute bottom-3 left-0 right-0 text-center">
          <span className="text-xs text-white/60 bg-black/60 px-3 py-1 rounded-full">
            {pendingTap ? 'Now tap a jersey number below' : 'Tap pitch to place a player'}
          </span>
        </div>
      </div>

      {/* Player selection strip — shown when pending tap */}
      {pendingTap && (
        <div className="flex-shrink-0 px-4 py-2 bg-black/60 border-t border-white/10">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
            {unplacedPlayers.map(player => (
              <button
                key={player.playerId}
                onClick={() => handlePlayerSelect(player)}
                className="flex-shrink-0 w-10 h-10 rounded-full bg-purple-500/30 border-2 border-purple-400/50 text-purple-200 font-bold text-sm hover:bg-purple-500/50 transition-all"
                title={player.playerName}
              >
                {player.jerseyNumber ?? '?'}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
