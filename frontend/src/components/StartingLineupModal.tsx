import { useState } from 'react'
import { X, Users, Copy } from 'lucide-react'
import { Player } from '@/types'

interface LineupPosition {
  id: string
  x: number // Percentage (0-100)
  y: number // Percentage (0-100)
  label: string
}

// Standard GAA 15-player formation positions (goalkeeper + 6 backs + 2 mids + 6 forwards)
const FORMATION_POSITIONS: LineupPosition[] = [
  // Goalkeeper
  { id: 'gk', x: 7, y: 50, label: 'GK' },
  // Full backs (3) - Corner Backs on wings, Full Back in center
  { id: 'fb-left', x: 20, y: 18, label: 'CB' },
  { id: 'fb-center', x: 20, y: 50, label: 'FB' },
  { id: 'fb-right', x: 20, y: 82, label: 'CB' },
  // Half backs (3) - Half Backs on wings, Center Half Back in center
  { id: 'hb-left', x: 35, y: 18, label: 'HB' },
  { id: 'hb-center', x: 35, y: 50, label: 'CHB' },
  { id: 'hb-right', x: 35, y: 82, label: 'HB' },
  // Midfield (2)
  { id: 'mf-left', x: 50, y: 35, label: 'MF' },
  { id: 'mf-right', x: 50, y: 65, label: 'MF' },
  // Half forwards (3) - Half Forwards on wings, Center Half Forward in center
  { id: 'hf-left', x: 65, y: 18, label: 'HF' },
  { id: 'hf-center', x: 65, y: 50, label: 'CHF' },
  { id: 'hf-right', x: 65, y: 82, label: 'HF' },
  // Full forwards (3) - Corner Forwards on wings, Full Forward in center
  { id: 'ff-left', x: 80, y: 18, label: 'CF' },
  { id: 'ff-center', x: 80, y: 50, label: 'FF' },
  { id: 'ff-right', x: 80, y: 82, label: 'CF' },
]

// Substitute positions (shown below the pitch)
const SUBSTITUTE_POSITIONS: LineupPosition[] = [
  { id: 'sub-1', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-2', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-3', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-4', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-5', x: 0, y: 0, label: 'SUB' },
]

interface StartingLineupModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (lineup: Record<string, string>) => void
  players: Player[]
  lastMatchLineup?: Record<string, string>
}

export default function StartingLineupModal({
  isOpen,
  onClose,
  onConfirm,
  players,
  lastMatchLineup
}: StartingLineupModalProps) {
  const [lineup, setLineup] = useState<Record<string, string>>({})
  const [selectingPosition, setSelectingPosition] = useState<string | null>(null)

  if (!isOpen) return null

  const handlePositionClick = (e: React.MouseEvent, positionId: string) => {
    e.stopPropagation()

    // If position already has a player, remove them
    if (lineup[positionId]) {
      const newLineup = { ...lineup }
      delete newLineup[positionId]
      setLineup(newLineup)
    } else {
      // Otherwise, open player selection
      setSelectingPosition(positionId)
    }
  }

  const handleRemovePlayer = (positionId: string) => {
    const newLineup = { ...lineup }
    delete newLineup[positionId]
    setLineup(newLineup)
  }

  const handlePlayerSelect = (playerId: string) => {
    if (selectingPosition) {
      setLineup(prev => ({ ...prev, [selectingPosition]: playerId }))
      setSelectingPosition(null)
    }
  }

  const handleUseLastLineup = () => {
    if (lastMatchLineup) {
      setLineup(lastMatchLineup)
    }
  }

  const getPlayerById = (playerId: string) => {
    return players.find(p => p.id === playerId)
  }

  const getAvailablePlayers = () => {
    const selectedIds = Object.values(lineup)
    return players.filter(p => p.active && !selectedIds.includes(p.id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !selectingPosition && onClose()} />

      {/* Modal */}
      <div className="relative w-full max-w-6xl glass-card p-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 rounded-full bg-indigo-500/20">
              <Users className="text-indigo-400" size={28} />
            </div>
            <h2 className="text-2xl font-bold text-white">Select Starting Lineup</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Use Last Match Lineup Button */}
        {lastMatchLineup && (
          <button
            onClick={handleUseLastLineup}
            className="mb-4 glass-card-hover px-6 py-3 flex items-center space-x-2"
          >
            <Copy size={20} className="text-blue-400" />
            <span className="text-white font-semibold">Use Last Match Lineup</span>
          </button>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Pitch View with Substitutes */}
          <div className="flex flex-col gap-3">
            {/* Pitch */}
            <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden aspect-[16/10]">
              {/* Actual GAA Pitch SVG */}
              <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full opacity-40">
                <rect width="2332" height="1446" fill="#2d5016" />
                <image
                  href="/pitch-svg.svg"
                  width="2332"
                  height="1446"
                  preserveAspectRatio="xMidYMid meet"
                />
              </svg>

              {/* Jersey Icons */}
              {FORMATION_POSITIONS.map((pos) => {
                const assignedPlayer = lineup[pos.id] ? getPlayerById(lineup[pos.id]) : null

                return (
                  <div
                    key={pos.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                    style={{
                      left: `${pos.x}%`,
                      top: `${pos.y}%`,
                    }}
                    onClick={(e) => handlePositionClick(e, pos.id)}
                  >
                    {/* Jersey Icon */}
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm transition-all ${
                      assignedPlayer
                        ? 'bg-indigo-600 text-white ring-2 ring-white'
                        : 'bg-red-600/80 text-white/90 hover:bg-red-500 hover:scale-110'
                    }`}>
                      {assignedPlayer?.jersey_number || pos.label}
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        <span className="text-white text-xs font-semibold bg-black/50 px-2 py-1 rounded">
                          {assignedPlayer.name.split(' ').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Substitutes - Below the pitch */}
            <div className="flex justify-center gap-6 px-4">
              {SUBSTITUTE_POSITIONS.map((pos, index) => {
                const assignedPlayer = lineup[pos.id] ? getPlayerById(lineup[pos.id]) : null

                return (
                  <div
                    key={pos.id}
                    className="cursor-pointer flex flex-col items-center"
                    onClick={(e) => handlePositionClick(e, pos.id)}
                  >
                    {/* Jersey Icon - Smaller for subs */}
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs transition-all ${
                      assignedPlayer
                        ? 'bg-indigo-600 text-white ring-2 ring-white'
                        : 'bg-red-600/80 text-white/90 hover:bg-red-500 hover:scale-110'
                    }`}>
                      {assignedPlayer?.jersey_number || `S${index + 1}`}
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="mt-2">
                        <span className="text-white text-[10px] font-semibold bg-black/50 px-1.5 py-0.5 rounded">
                          {assignedPlayer.name.split(' ').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Player Selection Panel */}
          <div>
            {selectingPosition ? (
              <>
                <h3 className="text-xl font-bold text-white mb-4">
                  Select Player for {FORMATION_POSITIONS.find(p => p.id === selectingPosition)?.label}
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {getAvailablePlayers().length > 0 ? (
                    getAvailablePlayers().map((player) => (
                      <button
                        key={player.id}
                        onClick={() => handlePlayerSelect(player.id)}
                        className="w-full glass-card-hover p-4 text-left flex items-center space-x-3"
                      >
                        {player.jersey_number && (
                          <div className="w-10 h-10 rounded-full bg-indigo-600 flex items-center justify-center text-white font-bold">
                            {player.jersey_number}
                          </div>
                        )}
                        <div className="flex-1">
                          <p className="text-white font-semibold">{player.name}</p>
                          {player.position && (
                            <p className="text-white/60 text-sm capitalize">{player.position.replace(/_/g, ' ')}</p>
                          )}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="glass-card p-6 text-center">
                      <p className="text-white/60">No players available</p>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => setSelectingPosition(null)}
                  className="mt-4 w-full btn-glass"
                >
                  Cancel
                </button>
              </>
            ) : (
              <>
                <h3 className="text-xl font-bold text-white mb-4">
                  Selected Players ({Object.keys(lineup).length}/20)
                </h3>
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {/* Starting lineup */}
                  <div className="mb-3">
                    <p className="text-white/50 text-sm font-semibold mb-2">Starting XV</p>
                    {FORMATION_POSITIONS.map((pos) => {
                      const player = lineup[pos.id] ? getPlayerById(lineup[pos.id]) : null
                      return (
                        <div key={pos.id} className="glass-card p-3 flex items-center justify-between mb-1">
                          <span className="text-white/70 font-medium">{pos.label}</span>
                          {player ? (
                            <div className="flex items-center gap-2">
                              <span className="text-white font-semibold">{player.name}</span>
                              <button
                                onClick={() => handleRemovePlayer(pos.id)}
                                className="text-white/60 hover:text-red-400 transition-colors"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-white/40 italic">Not selected</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Substitutes */}
                  <div>
                    <p className="text-white/50 text-sm font-semibold mb-2">Substitutes</p>
                    {SUBSTITUTE_POSITIONS.map((pos, index) => {
                      const player = lineup[pos.id] ? getPlayerById(lineup[pos.id]) : null
                      return (
                        <div key={pos.id} className="glass-card p-3 flex items-center justify-between mb-1">
                          <span className="text-white/70 font-medium">Sub {index + 1}</span>
                          {player ? (
                            <div className="flex items-center gap-2">
                              <span className="text-white font-semibold">{player.name}</span>
                              <button
                                onClick={() => handleRemovePlayer(pos.id)}
                                className="text-white/60 hover:text-red-400 transition-colors"
                              >
                                <X size={16} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-white/40 italic">Not selected</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        {!selectingPosition && (
          <div className="flex space-x-4 mt-6">
            <button onClick={onClose} className="flex-1 btn-glass">
              Cancel
            </button>
            <button
              onClick={() => onConfirm(lineup)}
              disabled={Object.keys(lineup).length === 0}
              className="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-700 hover:to-indigo-800 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Lineup ({Object.keys(lineup).length}/20)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
