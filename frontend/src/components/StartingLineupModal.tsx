import { useState, useEffect } from 'react'
import { X, Users, Copy, Search, Swords, ChevronDown, ChevronUp } from 'lucide-react'
import { Player } from '@/types'
import { useClub } from '@/contexts/ClubContext'
import { api } from '@/services/api'

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
  /** Powers the "Opposition Key Players" reminder link below — omitted
   *  entirely (not just disabled) when there's no match yet to link to. */
  matchId?: string | null
}

export default function StartingLineupModal({
  isOpen,
  onClose,
  onConfirm,
  players,
  lastMatchLineup,
  savedLineup,
  matchId,
}: StartingLineupModalProps) {
  const [lineup, setLineup] = useState<Record<string, LineupEntry>>(savedLineup ?? {})
  const [selectingPosition, setSelectingPosition] = useState<string | null>(null)
  const [selectedPitchPos, setSelectedPitchPos] = useState<string | null>(null)
  const [playerSearchQuery, setPlayerSearchQuery] = useState('')
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  // Opposition Key Players — same one-name-per-line textarea Match Prep's
  // FixturePreview.tsx uses, inline here instead of linking out to it. A
  // link away was overkill for "add a couple of names" and risked losing
  // unsaved lineup picks (this modal's own local state) on navigation.
  const [rosterExpanded, setRosterExpanded] = useState(false)
  const [rosterInput, setRosterInput] = useState('')
  const [rosterSaving, setRosterSaving] = useState(false)
  const [rosterSaved, setRosterSaved] = useState(false)
  const [rosterLoaded, setRosterLoaded] = useState(false)

  const handleToggleRoster = async () => {
    setRosterExpanded(prev => !prev)
    if (!rosterLoaded && matchId) {
      try {
        const result = await api.matchPrep.getOppositionRoster(matchId)
        if (result.players?.length) setRosterInput(result.players.join('\n'))
        setRosterLoaded(true)
      } catch { setRosterLoaded(true) }
    }
  }

  const handleSaveRoster = async () => {
    if (!matchId) return
    const names = rosterInput.split('\n').map(n => n.trim()).filter(Boolean)
    setRosterSaving(true)
    try {
      await api.matchPrep.saveOppositionRoster(matchId, names)
      setRosterSaved(true)
      setTimeout(() => setRosterSaved(false), 3000)
    } catch (err) {
      console.error('Failed to save opposition roster:', err)
    } finally {
      setRosterSaving(false)
    }
  }

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
    if (selectingPosition) return // picker open — ignore pitch taps

    if (selectedPitchPos === positionId) {
      setSelectedPitchPos(null)
      return
    }

    if (selectedPitchPos) {
      // Complete swap/move
      const fromId = selectedPitchPos
      const toId = positionId
      setSelectedPitchPos(null)
      setLineup(prev => {
        const next = { ...prev }
        const fromEntry = prev[fromId]
        const toEntry = prev[toId]
        if (!fromEntry) return prev
        if (toEntry) {
          // Swap — jersey numbers stay with positions
          next[toId] = { playerId: fromEntry.playerId, jerseyNumber: prev[toId]?.jerseyNumber ?? null }
          next[fromId] = { playerId: toEntry.playerId, jerseyNumber: prev[fromId]?.jerseyNumber ?? null }
        } else {
          // Move to empty slot
          next[toId] = { playerId: fromEntry.playerId, jerseyNumber: defaultJerseyFor(toId, prev) }
          delete next[fromId]
        }
        return next
      })
      return
    }

    if (lineup[positionId]) {
      setSelectedPitchPos(positionId)
    } else {
      setSelectingPosition(positionId)
      setPlayerSearchQuery('')
    }
  }

  const handleRemovePlayer = (positionId: string) => {
    setSelectedPitchPos(null)
    const newLineup = { ...lineup }
    delete newLineup[positionId]
    setLineup(newLineup)
  }

  const handleMoveToBench = (positionId: string) => {
    const firstEmpty = SUBSTITUTE_POSITIONS.find(s => !lineup[s.id])
    if (!firstEmpty) return
    const entry = lineup[positionId]
    if (!entry) return
    setSelectedPitchPos(null)
    setLineup(prev => {
      const next = { ...prev }
      delete next[positionId]
      next[firstEmpty.id] = { playerId: entry.playerId, jerseyNumber: null }
      return next
    })
  }

  const handleMoveToStarting = (positionId: string) => {
    const firstEmpty = FORMATION_POSITIONS.find(p => !lineup[p.id])
    if (!firstEmpty) return
    const entry = lineup[positionId]
    if (!entry) return
    setSelectedPitchPos(null)
    setLineup(prev => {
      const next = { ...prev }
      delete next[positionId]
      next[firstEmpty.id] = { playerId: entry.playerId, jerseyNumber: defaultJerseyFor(firstEmpty.id, prev) }
      return next
    })
  }

  const handlePlayerSelect = (playerId: string) => {
    if (selectingPosition) {
      // Filling an empty slot
      setLineup(prev => ({
        ...prev,
        [selectingPosition]: { playerId, jerseyNumber: defaultJerseyFor(selectingPosition, prev) },
      }))
      setSelectingPosition(null)
      return
    }

    if (!selectedPitchPos) return

    // A filled slot is selected — tapping ANY player in the list (starting,
    // on the bench, or not selected at all) brings them into that slot. If
    // they're already placed elsewhere, this is a swap; otherwise it's a
    // straight replace (the outgoing player drops back to the available pool).
    const positionId = selectedPitchPos
    const theirPositionId = Object.entries(lineup).find(([, e]) => e.playerId === playerId)?.[0]

    setLineup(prev => {
      const myEntry = prev[positionId]
      if (!myEntry) return prev
      const next = { ...prev }
      if (theirPositionId) {
        next[theirPositionId] = { playerId: myEntry.playerId, jerseyNumber: prev[theirPositionId]?.jerseyNumber ?? null }
        next[positionId] = { playerId, jerseyNumber: prev[positionId]?.jerseyNumber ?? null }
      } else {
        next[positionId] = { playerId, jerseyNumber: prev[positionId]?.jerseyNumber ?? defaultJerseyFor(positionId, prev) }
      }
      return next
    })
    setSelectedPitchPos(null)
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

  // Players offered when a filled slot is selected — includes players
  // already on the bench or starting elsewhere (tagged with where), since
  // tapping any of them swaps them into the selected slot. Unlike
  // getAvailablePlayers (only for filling an EMPTY slot).
  const getSwapCandidates = () => {
    if (!selectedPitchPos) return []
    const currentPlayerId = lineup[selectedPitchPos]?.playerId
    return players
      .filter(p => p.active && p.id !== currentPlayerId)
      .map(p => {
        const positionId = Object.entries(lineup).find(([, e]) => e.playerId === p.id)?.[0]
        const status = !positionId
          ? null
          : FORMATION_POSITIONS.some(fp => fp.id === positionId) ? 'Starting' : 'Bench'
        return { player: p, status }
      })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => { setSelectedPitchPos(null); if (!selectingPosition) onClose() }} />

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
            {matchId && (
              <button
                onClick={handleToggleRoster}
                className="glass-card-hover px-3 py-1.5 flex items-center space-x-1.5 ml-2"
                title="Add opposition key players for scorer/turnover tagging during the match"
              >
                <Swords size={14} className="text-orange-400" />
                <span className="text-white text-xs font-semibold">Opposition Key Players</span>
                {rosterExpanded ? <ChevronUp size={14} className="text-white/40" /> : <ChevronDown size={14} className="text-white/40" />}
              </button>
            )}
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={22} />
          </button>
        </div>

        {/* Opposition Key Players — inline, collapsed by default */}
        {matchId && rosterExpanded && (
          <div className="mb-3 p-3 rounded-xl bg-white/5 border border-white/10 space-y-2">
            <p className="text-xs text-white/40">
              Enter key opposition players by surname only — one per line (we keep this to the minimum needed to tag them pitchside, not a full name). These appear for quick selection when recording opponent scores or tagging who we forced a turnover from.
            </p>
            <textarea
              value={rosterInput}
              onChange={(e) => setRosterInput(e.target.value)}
              placeholder={"Enter one surname per line, e.g.:\nCox\nMurtagh"}
              rows={4}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/30">
                {rosterInput.split('\n').filter(l => l.trim()).length} players
              </span>
              <button
                onClick={handleSaveRoster}
                disabled={rosterSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                style={{
                  background: rosterSaved ? 'rgba(16,185,129,0.2)' : 'rgba(251,146,60,0.15)',
                  border: rosterSaved ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(251,146,60,0.3)',
                  color: rosterSaved ? '#34d399' : '#fb923c',
                }}
              >
                {rosterSaving ? 'Saving...' : rosterSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        )}

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
                const isSelected = selectedPitchPos === pos.id

                return (
                  <div
                    key={pos.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onClick={(e) => handlePositionClick(e, pos.id)}
                  >
                    {isSelected && (
                      <span className="absolute inset-0 rounded-full ring-4 ring-amber-400 animate-ping" />
                    )}
                    {/* Jersey Icon */}
                    <div
                      className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-[10px] sm:text-xs transition-all ${
                        assignedPlayer
                          ? `ring-2 shadow-lg ${isSelected ? 'scale-125 ring-4' : 'hover:scale-105'}`
                          : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110'
                      }`}
                      style={assignedPlayer ? {
                        backgroundColor: jerseyBg,
                        color: jerseyText,
                        '--tw-ring-color': isSelected ? '#fbbf24' : jerseyText,
                        boxShadow: isSelected ? '0 0 16px rgba(251,191,36,0.5)' : undefined,
                      } as React.CSSProperties : undefined}
                    >
                      {displayLabel}
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        <span className={`text-[9px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 sm:py-1 rounded ${isSelected ? 'bg-amber-500/30 text-amber-200' : 'bg-black/50 text-white'}`}>
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
                const isSelected = selectedPitchPos === pos.id

                return (
                  <div
                    key={pos.id}
                    className="cursor-pointer flex flex-col items-center"
                    onClick={(e) => handlePositionClick(e, pos.id)}
                  >
                    <div className="relative">
                      {isSelected && (
                        <span className="absolute inset-0 rounded-full ring-4 ring-amber-400 animate-ping" />
                      )}
                      {/* Jersey Icon - Smaller for subs */}
                      <div
                        className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-[9px] sm:text-xs transition-all ${
                          assignedPlayer
                            ? `ring-2 shadow-lg ${isSelected ? 'scale-125 ring-4' : 'hover:scale-105'}`
                            : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110'
                        }`}
                        style={assignedPlayer ? {
                          backgroundColor: jerseyBg, color: jerseyText,
                          '--tw-ring-color': isSelected ? '#fbbf24' : jerseyText,
                          boxShadow: isSelected ? '0 0 12px rgba(251,191,36,0.5)' : undefined,
                        } as React.CSSProperties : undefined}
                      >
                        {displayLabel}
                      </div>
                    </div>

                    {/* Player Name */}
                    {assignedPlayer && (
                      <div className="mt-2">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isSelected ? 'bg-amber-500/30 text-amber-200' : 'bg-black/50 text-white'}`}>
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
                          <p className="text-white font-semibold text-sm">{player.name}</p>
                          {player.position && (
                            <p className="text-white/40 text-xs capitalize">{player.position}</p>
                          )}
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
            ) : selectedPitchPos ? (
              <>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-bold text-white">
                    Replace {(() => {
                      const entry = lineup[selectedPitchPos]
                      const p = entry ? getPlayerById(entry.playerId) : null
                      return p ? displaySurname(p.name) : ''
                    })()}
                  </h3>
                  <button
                    onClick={() => setSelectedPitchPos(null)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                  >
                    <X size={16} />
                  </button>
                </div>

                {/* Quick actions for the selected slot */}
                {(() => {
                  const isStarting = FORMATION_POSITIONS.some(p => p.id === selectedPitchPos)
                  const hasBenchSlot = SUBSTITUTE_POSITIONS.some(s => !lineup[s.id])
                  const hasStartSlot = FORMATION_POSITIONS.some(p => !lineup[p.id])
                  return (
                    <div className="flex gap-1.5 mb-3">
                      {isStarting && hasBenchSlot && (
                        <button
                          onClick={() => handleMoveToBench(selectedPitchPos)}
                          className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg bg-purple-500/20 border border-purple-400/30 text-purple-300 hover:bg-purple-500/30 transition-colors"
                        >→ Bench</button>
                      )}
                      {!isStarting && hasStartSlot && (
                        <button
                          onClick={() => handleMoveToStarting(selectedPitchPos)}
                          className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-300 hover:bg-blue-500/30 transition-colors"
                        >← Start</button>
                      )}
                      <button
                        onClick={() => handleRemovePlayer(selectedPitchPos)}
                        className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-lg bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 transition-colors"
                      >Remove</button>
                    </div>
                  )
                })()}

                <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                  {getSwapCandidates().map(({ player, status }) => (
                    <button
                      key={player.id}
                      onClick={() => handlePlayerSelect(player.id)}
                      className="w-full glass-card-hover px-3 py-2 text-left flex items-center justify-between gap-2"
                    >
                      <div>
                        <p className="text-white font-semibold text-sm">{player.name}</p>
                        {player.position && (
                          <p className="text-white/40 text-xs capitalize">{player.position}</p>
                        )}
                      </div>
                      {status && (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                          status === 'Starting' ? 'bg-blue-500/20 text-blue-300' : 'bg-purple-500/20 text-purple-300'
                        }`}>
                          {status}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
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
