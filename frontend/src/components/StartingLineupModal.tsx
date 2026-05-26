import { useState, useEffect } from 'react'
import { X, Users, Copy, Search } from 'lucide-react'
import { Player } from '@/types'
import { useClub } from '@/contexts/ClubContext'

interface LineupPosition {
  id: string
  x: number // Percentage (0-100)
  y: number // Percentage (0-100)
  label: string
}

// Standard GAA 15-player formation positions (goalkeeper + 6 backs + 2 mids + 6 forwards)
const CAPTAIN_RE = /\s*\((?:c|vc)\)\s*$/i

function displaySurname(name: string) {
  const clean = name.replace(CAPTAIN_RE, '').trim()
  const isCaptain = /\(c\)/i.test(name)
  const surname = clean.split(' ').pop() || clean
  return isCaptain ? `${surname} ©` : surname
}

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

// Default GAA jersey numbers by position (standard Irish football numbering)
const POSITION_DEFAULT_JERSEY: Record<string, number> = {
  'gk':        1,
  'fb-left':   4,  // Left Corner Back
  'fb-center': 3,  // Full Back
  'fb-right':  2,  // Right Corner Back
  'hb-left':   7,  // Left Half Back
  'hb-center': 6,  // Centre Half Back
  'hb-right':  5,  // Right Half Back
  'mf-left':   8,  // Midfield
  'mf-right':  9,  // Midfield
  'hf-left':   12, // Left Half Forward
  'hf-center': 11, // Centre Half Forward
  'hf-right':  10, // Right Half Forward
  'ff-left':   15, // Left Corner Forward
  'ff-center': 14, // Full Forward
  'ff-right':  13, // Right Corner Forward
}

// Substitute positions (shown below the pitch)
const SUBSTITUTE_POSITIONS: LineupPosition[] = [
  { id: 'sub-1', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-2', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-3', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-4', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-5', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-6', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-7', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-8', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-9', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-10', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-11', x: 0, y: 0, label: 'SUB' },
]

export interface LineupEntry {
  playerId: string
  jerseyNumber: number | null
}

interface StartingLineupModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (lineup: Record<string, LineupEntry>) => void
  players: Player[]
  lastMatchLineup?: Record<string, LineupEntry>
  savedLineup?: Record<string, LineupEntry>
}

export default function StartingLineupModal({
  isOpen,
  onClose,
  onConfirm,
  players,
  lastMatchLineup,
  savedLineup
}: StartingLineupModalProps) {
  const [lineup, setLineup] = useState<Record<string, LineupEntry>>(savedLineup ?? {})
  const [selectingPosition, setSelectingPosition] = useState<string | null>(null)
  const [playerSearchQuery, setPlayerSearchQuery] = useState('')
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  // Sync saved lineup when it loads (e.g. from API after mount)
  useEffect(() => {
    if (savedLineup && Object.keys(savedLineup).length > 0 && Object.keys(lineup).length === 0) {
      setLineup(savedLineup)
    }
  }, [savedLineup])

  if (!isOpen) return null

  // Returns the GAA position default number if it isn't already taken, otherwise null
  const defaultJerseyFor = (positionId: string, currentLineup: Record<string, LineupEntry>): number | null => {
    const posDefault = POSITION_DEFAULT_JERSEY[positionId]
    if (posDefault == null) return null
    const taken = Object.values(currentLineup).some(e => e.jerseyNumber === posDefault)
    return taken ? null : posDefault
  }

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
      setPlayerSearchQuery('')
    }
  }

  const handleRemovePlayer = (positionId: string) => {
    const newLineup = { ...lineup }
    delete newLineup[positionId]
    setLineup(newLineup)
  }

  const handlePlayerSelect = (playerId: string) => {
    if (selectingPosition) {
      setLineup(prev => ({
        ...prev,
        [selectingPosition]: { playerId, jerseyNumber: defaultJerseyFor(selectingPosition, prev) },
      }))
      setSelectingPosition(null)
    }
  }

  const handleJerseyChange = (positionId: string, value: string) => {
    const num = value === '' ? null : parseInt(value, 10)
    setLineup(prev => ({
      ...prev,
      [positionId]: {
        ...prev[positionId],
        jerseyNumber: num !== null && !isNaN(num) ? num : null,
      },
    }))
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
    const selectedIds = Object.values(lineup).map(e => e.playerId)
    return players.filter(p => p.active && !selectedIds.includes(p.id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => !selectingPosition && onClose()} />

      {/* Modal */}
      <div className="relative w-full max-w-6xl glass-card p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-full bg-emerald-500/20">
              <Users className="text-emerald-400" size={20} />
            </div>
            <h2 className="text-xl font-bold text-white">Select Starting Lineup</h2>
            {lastMatchLineup && (
              <button
                onClick={handleUseLastLineup}
                className="glass-card-hover px-3 py-1.5 flex items-center space-x-1.5 ml-3"
              >
                <Copy size={14} className="text-blue-400" />
                <span className="text-white text-xs font-semibold">Use Last Match</span>
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Pitch View with Substitutes */}
          <div className="md:col-span-2 flex flex-col gap-2">
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
                const entry = lineup[pos.id]
                const assignedPlayer = entry ? getPlayerById(entry.playerId) : null
                const displayLabel = entry?.jerseyNumber != null ? `${entry.jerseyNumber}` : pos.label

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
                    <div
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-[10px] sm:text-xs transition-all ${
                        assignedPlayer
                          ? 'ring-2 shadow-lg'
                          : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110'
                      }`}
                      style={assignedPlayer ? { backgroundColor: jerseyBg, color: jerseyText, '--tw-ring-color': jerseyText } as React.CSSProperties : undefined}
                    >
                      {displayLabel}
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        <span className="text-white text-[9px] sm:text-xs font-semibold bg-black/50 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded">
                          {displaySurname(assignedPlayer.name)}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Substitutes - Below the pitch */}
            <div className="flex justify-center flex-wrap gap-x-3 gap-y-2 px-2">
              {SUBSTITUTE_POSITIONS.map((pos, index) => {
                const entry = lineup[pos.id]
                const assignedPlayer = entry ? getPlayerById(entry.playerId) : null
                const displayLabel = entry?.jerseyNumber != null ? `${entry.jerseyNumber}` : `S${index + 1}`

                return (
                  <div
                    key={pos.id}
                    className="cursor-pointer flex flex-col items-center"
                    onClick={(e) => handlePositionClick(e, pos.id)}
                  >
                    {/* Jersey Icon - Smaller for subs */}
                    <div
                      className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-[9px] sm:text-xs transition-all ${
                        assignedPlayer
                          ? 'ring-2 shadow-lg'
                          : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110'
                      }`}
                      style={assignedPlayer ? { backgroundColor: jerseyBg, color: jerseyText, '--tw-ring-color': jerseyText } as React.CSSProperties : undefined}
                    >
                      {displayLabel}
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="mt-2">
                        <span className="text-white text-[10px] font-semibold bg-black/50 px-1.5 py-0.5 rounded">
                          {displaySurname(assignedPlayer.name)}
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
                  Select Player for {FORMATION_POSITIONS.find(p => p.id === selectingPosition)?.label
                    || SUBSTITUTE_POSITIONS.find(p => p.id === selectingPosition)?.label
                    || selectingPosition}
                </h3>
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={16} />
                  <input
                    type="text"
                    value={playerSearchQuery}
                    onChange={(e) => setPlayerSearchQuery(e.target.value)}
                    placeholder="Search by name or number..."
                    className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    autoFocus
                  />
                </div>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {(() => {
                    const available = getAvailablePlayers().filter(p => {
                      if (!playerSearchQuery) return true
                      const q = playerSearchQuery.toLowerCase()
                      return p.name.toLowerCase().includes(q) || (p.jersey_number?.toString() || '').includes(q)
                    })
                    return available.length > 0 ? (
                      available.map((player) => (
                        <button
                          key={player.id}
                          onClick={() => handlePlayerSelect(player.id)}
                          className="w-full glass-card-hover px-3 py-2 text-left"
                        >
                          <p className="text-white font-semibold text-sm">
                            {player.jersey_number != null && (
                              <span className="text-emerald-400 mr-2">#{player.jersey_number}</span>
                            )}
                            {player.name}
                          </p>
                        </button>
                      ))
                    ) : (
                      <div className="glass-card p-6 text-center">
                        <p className="text-white/60">{playerSearchQuery ? 'No matching players' : 'No players available'}</p>
                      </div>
                    )
                  })()}
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
                  Selected Players ({Object.keys(lineup).length}/26)
                </h3>
                <div className="space-y-1 max-h-[60vh] overflow-y-auto">
                  {/* Starting lineup */}
                  <div className="mb-2">
                    <p className="text-white/50 text-xs font-semibold mb-1">Starting XV</p>
                    {FORMATION_POSITIONS.map((pos) => {
                      const entry = lineup[pos.id]
                      const player = entry ? getPlayerById(entry.playerId) : null
                      return (
                        <div key={pos.id} className="glass-card px-2 py-1 flex items-center gap-1.5 mb-0.5">
                          <span className="text-white/50 text-[10px] font-semibold w-7 flex-shrink-0">{pos.label}</span>
                          {player ? (
                            <>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                value={entry.jerseyNumber ?? ''}
                                onChange={(e) => handleJerseyChange(pos.id, e.target.value.replace(/\D/g, ''))}
                                onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                                onFocus={(e) => e.target.select()}
                                className="w-10 h-7 bg-white/10 border border-white/20 rounded text-center text-white text-xs font-bold focus:ring-1 focus:ring-emerald-400 focus:outline-none"
                                placeholder="#"
                              />
                              <span className="text-white text-xs font-medium truncate flex-1">{player.name}</span>
                              <button
                                onClick={() => handleRemovePlayer(pos.id)}
                                className="text-white/40 hover:text-red-400 transition-colors flex-shrink-0"
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <span className="text-white/30 italic text-[10px]">—</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                  {/* Substitutes */}
                  <div>
                    <p className="text-white/50 text-xs font-semibold mb-1">Substitutes</p>
                    {SUBSTITUTE_POSITIONS.map((pos, index) => {
                      const entry = lineup[pos.id]
                      const player = entry ? getPlayerById(entry.playerId) : null
                      return (
                        <div key={pos.id} className="glass-card px-2 py-1 flex items-center gap-1.5 mb-0.5">
                          <span className="text-white/50 text-[10px] font-semibold w-7 flex-shrink-0">S{index + 1}</span>
                          {player ? (
                            <>
                              <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                maxLength={2}
                                value={entry.jerseyNumber ?? ''}
                                onChange={(e) => handleJerseyChange(pos.id, e.target.value.replace(/\D/g, ''))}
                                onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                                onFocus={(e) => e.target.select()}
                                className="w-10 h-7 bg-white/10 border border-white/20 rounded text-center text-white text-xs font-bold focus:ring-1 focus:ring-emerald-400 focus:outline-none"
                                placeholder="#"
                              />
                              <span className="text-white text-xs font-medium truncate flex-1">{player.name}</span>
                              <button
                                onClick={() => handleRemovePlayer(pos.id)}
                                className="text-white/40 hover:text-red-400 transition-colors flex-shrink-0"
                              >
                                <X size={12} />
                              </button>
                            </>
                          ) : (
                            <span className="text-white/30 italic text-[10px]">—</span>
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
              className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Confirm Lineup ({Object.keys(lineup).length}/26)
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
