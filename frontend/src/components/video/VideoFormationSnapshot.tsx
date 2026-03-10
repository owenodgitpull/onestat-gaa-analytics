/**
 * VideoFormationSnapshot — Formation snapshot overlay for video tagging.
 *
 * Shows a full-screen pitch where the user can place both own and opposition
 * players by tapping a position, then selecting from a player strip.
 * Own team uses the match lineup; opposition players are labelled by jersey number.
 *
 * No inactivity timeout (unlike live mode) since video review is deliberate.
 */

import { useState, useMemo } from 'react'
import { X, Check, RotateCcw, Users } from 'lucide-react'

interface OwnPlayer {
  playerId: string
  jerseyNumber: number | null
  playerName: string
}

interface PlacedPosition {
  playerId?: string | null
  jerseyNumber: number | null
  playerName?: string | null
  team: 'own' | 'opponent'
  x: number
  y: number
}

interface VideoFormationSnapshotProps {
  isOpen: boolean
  onClose: () => void
  onSave: (positions: PlacedPosition[], label: string) => void
  ownPlayers: OwnPlayer[]
  opponentName: string
}

const LABELS = ['Defensive Shape', 'Kickout Setup', 'Attacking Press', 'Counter Attack', 'Custom']
const OPP_JERSEYS = Array.from({ length: 15 }, (_, i) => i + 1)

export default function VideoFormationSnapshot({
  isOpen,
  onClose,
  onSave,
  ownPlayers,
  opponentName,
}: VideoFormationSnapshotProps) {
  const [positions, setPositions] = useState<PlacedPosition[]>([])
  const [pendingTap, setPendingTap] = useState<{ x: number; y: number } | null>(null)
  const [selectedLabel, setSelectedLabel] = useState('Defensive Shape')
  const [activeTeam, setActiveTeam] = useState<'own' | 'opponent'>('own')

  // Sort own players by jersey number
  const sortedOwnPlayers = useMemo(
    () => [...ownPlayers].sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99)),
    [ownPlayers],
  )

  if (!isOpen) return null

  const handlePitchTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    setPendingTap({ x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) })
  }

  const handleOwnPlayerSelect = (player: OwnPlayer) => {
    if (!pendingTap) return
    const filtered = positions.filter(
      (p) => !(p.team === 'own' && p.playerId === player.playerId),
    )
    setPositions([
      ...filtered,
      {
        playerId: player.playerId,
        jerseyNumber: player.jerseyNumber,
        playerName: player.playerName,
        team: 'own',
        ...pendingTap,
      },
    ])
    setPendingTap(null)
  }

  const handleOppPlayerSelect = (jerseyNumber: number) => {
    if (!pendingTap) return
    // Remove existing placement for this opponent jersey
    const filtered = positions.filter(
      (p) => !(p.team === 'opponent' && p.jerseyNumber === jerseyNumber),
    )
    setPositions([
      ...filtered,
      {
        playerId: null,
        jerseyNumber,
        playerName: `${opponentName} #${jerseyNumber}`,
        team: 'opponent',
        ...pendingTap,
      },
    ])
    setPendingTap(null)
  }

  const handleRemovePlayer = (index: number) => {
    setPositions((prev) => prev.filter((_, i) => i !== index))
  }

  const handleSave = () => {
    if (positions.length < 2) return
    onSave(positions, selectedLabel)
    // Reset state
    setPositions([])
    setPendingTap(null)
    setSelectedLabel('Defensive Shape')
    onClose()
  }

  const handleReset = () => {
    setPositions([])
    setPendingTap(null)
  }

  const ownPositions = positions.filter((p) => p.team === 'own')
  const oppPositions = positions.filter((p) => p.team === 'opponent')

  // Players not yet placed
  const placedOwnIds = new Set(ownPositions.map((p) => p.playerId))
  const unplacedOwn = sortedOwnPlayers.filter((p) => !placedOwnIds.has(p.playerId))
  const placedOppJerseys = new Set(oppPositions.map((p) => p.jerseyNumber))
  const unplacedOpp = OPP_JERSEYS.filter((j) => !placedOppJerseys.has(j))

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-black/85 backdrop-blur-sm">
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 bg-purple-900/30 border-b border-purple-500/20">
        <div className="flex items-center gap-3">
          <Users size={16} className="text-purple-300" />
          <span className="text-sm font-semibold text-purple-300">Formation Snapshot</span>
          <span className="text-xs text-white/50">
            {ownPositions.length} own + {oppPositions.length} opp
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleReset}
            className="p-1.5 rounded-lg bg-white/10 text-white/60 hover:bg-white/20"
            title="Reset all"
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
      <div className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 bg-black/40 overflow-x-auto">
        {LABELS.map((label) => (
          <button
            key={label}
            onClick={() => setSelectedLabel(label)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 ${
              selectedLabel === label
                ? 'bg-purple-500/30 text-purple-300 border border-purple-400/40'
                : 'bg-white/10 text-white/50 border border-white/10 hover:bg-white/20'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pitch area */}
      <div
        className="flex-1 relative mx-4 my-3 rounded-xl overflow-hidden bg-green-900/50 border-2 border-purple-500/30 cursor-crosshair"
        onClick={handlePitchTap}
      >
        <img
          src="/pitch-svg.svg"
          className="w-full h-full object-contain opacity-40"
          alt="pitch"
          draggable={false}
        />

        {/* Placed own players — green */}
        {ownPositions.map((pos) => (
          <div
            key={`own-${pos.playerId}`}
            className="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-emerald-600 border-2 border-white flex items-center justify-center text-white text-sm font-bold shadow-lg cursor-pointer hover:scale-110 transition-transform"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={(e) => {
              e.stopPropagation()
              handleRemovePlayer(positions.indexOf(pos))
            }}
            title={`${pos.playerName} — tap to remove`}
          >
            {pos.jerseyNumber ?? '?'}
          </div>
        ))}

        {/* Placed opponent players — orange */}
        {oppPositions.map((pos) => (
          <div
            key={`opp-${pos.jerseyNumber}`}
            className="absolute w-10 h-10 -ml-5 -mt-5 rounded-full bg-orange-600 border-2 border-white/80 flex items-center justify-center text-white text-sm font-bold shadow-lg cursor-pointer hover:scale-110 transition-transform"
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            onClick={(e) => {
              e.stopPropagation()
              handleRemovePlayer(positions.indexOf(pos))
            }}
            title={`${pos.playerName} — tap to remove`}
          >
            {pos.jerseyNumber}
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
            {pendingTap
              ? `Select ${activeTeam === 'own' ? 'your' : 'opponent'} player below`
              : 'Tap pitch to place a player'}
          </span>
        </div>
      </div>

      {/* Team toggle + Player strip */}
      <div className="flex-shrink-0 bg-black/60 border-t border-white/10">
        {/* Team toggle */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5">
          <button
            onClick={() => setActiveTeam('own')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTeam === 'own'
                ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400/40'
                : 'bg-white/10 text-white/50 border border-white/10 hover:bg-white/20'
            }`}
          >
            Your Team ({ownPositions.length}/15)
          </button>
          <button
            onClick={() => setActiveTeam('opponent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTeam === 'opponent'
                ? 'bg-orange-500/30 text-orange-300 border border-orange-400/40'
                : 'bg-white/10 text-white/50 border border-white/10 hover:bg-white/20'
            }`}
          >
            {opponentName} ({oppPositions.length}/15)
          </button>
        </div>

        {/* Player strip — shows when pending tap active */}
        {pendingTap && (
          <div className="px-4 py-2">
            <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-1">
              {activeTeam === 'own'
                ? unplacedOwn.map((player) => (
                    <button
                      key={player.playerId}
                      onClick={() => handleOwnPlayerSelect(player)}
                      className="flex-shrink-0 w-10 h-10 rounded-full bg-emerald-500/30 border-2 border-emerald-400/50 text-emerald-200 font-bold text-sm hover:bg-emerald-500/50 transition-all"
                      title={player.playerName}
                    >
                      {player.jerseyNumber ?? '?'}
                    </button>
                  ))
                : unplacedOpp.map((jersey) => (
                    <button
                      key={jersey}
                      onClick={() => handleOppPlayerSelect(jersey)}
                      className="flex-shrink-0 w-10 h-10 rounded-full bg-orange-500/30 border-2 border-orange-400/50 text-orange-200 font-bold text-sm hover:bg-orange-500/50 transition-all"
                      title={`${opponentName} #${jersey}`}
                    >
                      {jersey}
                    </button>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
