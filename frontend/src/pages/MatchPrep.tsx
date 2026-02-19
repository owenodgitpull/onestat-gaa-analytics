import { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Users,
  Copy,
  Save,
  Play,
  ArrowLeft,
  MapPin,
  Calendar,
  X,
  Check,
} from 'lucide-react'
import { api } from '@/services/api'
import type { PlayerWorkload } from '@/services/api'
import type { Match, Player } from '@/types'

// ── Pitch position data (mirrored from StartingLineupModal) ──────────────

interface LineupPosition {
  id: string
  x: number
  y: number
  label: string
}

const FORMATION_POSITIONS: LineupPosition[] = [
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

const SUBSTITUTE_POSITIONS: LineupPosition[] = [
  { id: 'sub-1', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-2', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-3', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-4', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-5', x: 0, y: 0, label: 'SUB' },
]

// ── Helpers ────────────────────────────────────────────────────────────────

const getStatusDot = (status: string) => {
  switch (status) {
    case 'optimal':
      return 'bg-emerald-400'
    case 'undertrained':
      return 'bg-amber-400'
    case 'elevated':
      return 'bg-orange-400'
    case 'high_risk':
      return 'bg-red-400'
    default:
      return 'bg-slate-400'
  }
}

const getStatusLabel = (status: string) => {
  switch (status) {
    case 'optimal':
      return 'Optimal'
    case 'undertrained':
      return 'Undertrained'
    case 'elevated':
      return 'Elevated'
    case 'high_risk':
      return 'High Risk'
    default:
      return 'Unknown'
  }
}

const getAcwrColor = (acwr: number | null) => {
  if (acwr === null) return 'text-slate-400'
  if (acwr < 0.8) return 'text-amber-400'
  if (acwr <= 1.3) return 'text-emerald-400'
  if (acwr <= 1.5) return 'text-orange-400'
  return 'text-red-400'
}

const getJerseyRing = (workload: PlayerWorkload | undefined) => {
  if (!workload) return 'ring-white/30'
  switch (workload.status) {
    case 'optimal':
      return 'ring-emerald-400'
    case 'undertrained':
      return 'ring-amber-400'
    case 'elevated':
      return 'ring-orange-400'
    case 'high_risk':
      return 'ring-red-400'
    default:
      return 'ring-white/30'
  }
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MatchPrep() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()

  const [match, setMatch] = useState<Match | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [workloads, setWorkloads] = useState<PlayerWorkload[]>([])
  const [lineup, setLineup] = useState<Record<string, string>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, string> | null>(null)
  const [selectingPosition, setSelectingPosition] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load all data on mount
  useEffect(() => {
    if (!matchId) return
    const load = async () => {
      setLoading(true)
      try {
        const [matchData, playerData, healthData, existingLineup, lastLineup] = await Promise.all([
          api.matches.getById(matchId),
          api.players.getAll(),
          api.squadHealth.getSummary().catch(() => null),
          api.matchLineups.getLineup(matchId).catch(() => []),
          api.matchLineups.getLastLineup().catch(() => []),
        ])
        setMatch(matchData)
        setPlayers(playerData)
        if (healthData) setWorkloads(healthData.player_workloads)

        // Load existing lineup for this match
        if (existingLineup.length > 0) {
          const lineupObj: Record<string, string> = {}
          existingLineup.forEach(entry => {
            lineupObj[entry.position_id] = entry.player_id
          })
          setLineup(lineupObj)
        }

        // Load last match lineup for quick-reuse
        if (lastLineup.length > 0) {
          const lastObj: Record<string, string> = {}
          lastLineup.forEach(entry => {
            lastObj[entry.position_id] = entry.player_id
          })
          setLastMatchLineup(lastObj)
        }
      } catch (err) {
        console.error('Failed to load match prep data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [matchId])

  // Workload lookup map
  const workloadMap = useMemo(() => {
    const map = new Map<string, PlayerWorkload>()
    workloads.forEach(w => map.set(w.player_id, w))
    return map
  }, [workloads])

  // Player lookup
  const playerMap = useMemo(() => {
    const map = new Map<string, Player>()
    players.forEach(p => map.set(p.id, p))
    return map
  }, [players])

  // Available players (not already selected)
  const selectedIds = useMemo(() => new Set(Object.values(lineup)), [lineup])

  const availablePlayers = useMemo(() => {
    return players
      .filter(p => p.active && !selectedIds.has(p.id))
      .sort((a, b) => {
        // Sort: goalkeepers first, then defenders, midfielders, forwards
        const posOrder: Record<string, number> = { goalkeeper: 0, defender: 1, midfielder: 2, forward: 3 }
        const aOrder = posOrder[a.position] ?? 4
        const bOrder = posOrder[b.position] ?? 4
        if (aOrder !== bOrder) return aOrder - bOrder
        return a.name.localeCompare(b.name)
      })
  }, [players, selectedIds])

  const selectedCount = Object.keys(lineup).length
  const startingCount = FORMATION_POSITIONS.filter(p => lineup[p.id]).length

  const handlePositionClick = (positionId: string) => {
    if (lineup[positionId]) {
      // Remove player
      const newLineup = { ...lineup }
      delete newLineup[positionId]
      setLineup(newLineup)
      setSaved(false)
    } else {
      setSelectingPosition(positionId)
    }
  }

  const handlePlayerSelect = (playerId: string) => {
    if (selectingPosition) {
      setLineup(prev => ({ ...prev, [selectingPosition]: playerId }))
      setSelectingPosition(null)
      setSaved(false)
    }
  }

  const handleUseLastLineup = () => {
    if (lastMatchLineup) {
      setLineup(lastMatchLineup)
      setSaved(false)
    }
  }

  const handleSave = async () => {
    if (!matchId) return
    setSaving(true)
    try {
      const entries = Object.entries(lineup).map(([position_id, player_id]) => ({
        player_id,
        position_id,
        is_substitute: position_id.startsWith('sub-'),
      }))
      await api.matchLineups.saveLineup(matchId, entries)
      setSaved(true)
    } catch (err) {
      console.error('Failed to save lineup:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndStart = async () => {
    if (!matchId) return
    setSaving(true)
    try {
      const entries = Object.entries(lineup).map(([position_id, player_id]) => ({
        player_id,
        position_id,
        is_substitute: position_id.startsWith('sub-'),
      }))
      await api.matchLineups.saveLineup(matchId, entries)
      navigate(`/match/${matchId}`)
    } catch (err) {
      console.error('Failed to save lineup:', err)
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
      </div>
    )
  }

  if (!match) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">Match not found</p>
        <button onClick={() => navigate('/')} className="btn-glass">Back to Dashboard</button>
      </div>
    )
  }

  const venueLabel = match.venue === 'home' ? 'Home' : match.venue === 'away' ? 'Away' : 'Neutral'
  const matchDate = new Date(match.match_date).toLocaleDateString('en-IE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-white">Match Prep</h1>
            <div className="flex items-center gap-3 text-white/60 text-sm mt-0.5">
              <span className="font-semibold text-white">{match.opponent}</span>
              <span className="flex items-center gap-1">
                <MapPin size={12} />
                {venueLabel}
              </span>
              <span className="flex items-center gap-1">
                <Calendar size={12} />
                {matchDate}
              </span>
              {match.competition && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold">
                  {match.competition}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {saved && (
            <span className="flex items-center gap-1 text-emerald-400 text-sm font-semibold">
              <Check size={14} />
              Saved
            </span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || selectedCount === 0}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save size={16} />
            Save Lineup
          </button>
          <button
            onClick={handleSaveAndStart}
            disabled={saving || startingCount < 15}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Play size={16} />
            Save & Start
          </button>
        </div>
      </div>

      {/* Use Last Lineup button */}
      {lastMatchLineup && selectedCount === 0 && (
        <button
          onClick={handleUseLastLineup}
          className="glass-card px-5 py-3 flex items-center gap-2 hover:bg-white/10 transition-all"
        >
          <Copy size={18} className="text-blue-400" />
          <span className="text-white font-semibold">Use Last Lineup</span>
        </button>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Pitch + Subs (2 cols) */}
        <div className="md:col-span-2 flex flex-col gap-4">
          {/* Pitch */}
          <div className="glass-card p-4">
            <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden aspect-[16/10]">
              <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full opacity-40">
                <rect width="2332" height="1446" fill="#2d5016" />
                <image
                  href="/pitch-svg.svg"
                  width="2332"
                  height="1446"
                  preserveAspectRatio="xMidYMid meet"
                />
              </svg>

              {FORMATION_POSITIONS.map(pos => {
                const playerId = lineup[pos.id]
                const player = playerId ? playerMap.get(playerId) : null
                const workload = playerId ? workloadMap.get(playerId) : undefined

                return (
                  <div
                    key={pos.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onClick={() => handlePositionClick(pos.id)}
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm transition-all ring-2 ${
                      player
                        ? `bg-red-600 text-white ${getJerseyRing(workload)} shadow-lg`
                        : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110 ring-white/30'
                    }`}>
                      {player ? (player.jersey_number ?? pos.label) : pos.label}
                    </div>
                    {player && (
                      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        <span className="text-white text-xs font-semibold bg-black/60 px-2 py-0.5 rounded flex items-center gap-1">
                          {workload && (
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${getStatusDot(workload.status)}`} />
                          )}
                          {player.name.split(' ').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Substitutes */}
            <div className="flex justify-center gap-6 mt-4">
              {SUBSTITUTE_POSITIONS.map((pos, index) => {
                const playerId = lineup[pos.id]
                const player = playerId ? playerMap.get(playerId) : null
                const workload = playerId ? workloadMap.get(playerId) : undefined

                return (
                  <div
                    key={pos.id}
                    className="cursor-pointer flex flex-col items-center"
                    onClick={() => handlePositionClick(pos.id)}
                  >
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-xs transition-all ring-2 ${
                      player
                        ? `bg-red-600 text-white ${getJerseyRing(workload)} shadow-lg`
                        : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110 ring-white/30'
                    }`}>
                      {player ? (player.jersey_number ?? `S${index + 1}`) : `S${index + 1}`}
                    </div>
                    {player && (
                      <div className="mt-1.5">
                        <span className="text-white text-[10px] font-semibold bg-black/50 px-1.5 py-0.5 rounded flex items-center gap-1">
                          {workload && (
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${getStatusDot(workload.status)}`} />
                          )}
                          {player.name.split(' ').pop()}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Count indicator */}
            <div className="text-center mt-3 text-sm text-white/50">
              {startingCount}/15 starting + {selectedCount - startingCount}/5 subs
            </div>
          </div>
        </div>

        {/* Player Picker Panel (right column) */}
        <div className="glass-card p-4 max-h-[80vh] overflow-y-auto">
          {selectingPosition ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white">
                  Select for {
                    FORMATION_POSITIONS.find(p => p.id === selectingPosition)?.label ||
                    `Sub ${selectingPosition.replace('sub-', '')}`
                  }
                </h3>
                <button
                  onClick={() => setSelectingPosition(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 transition-all"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="space-y-1.5">
                {availablePlayers.map(player => {
                  const wl = workloadMap.get(player.id)
                  const isUnavailable = player.status === 'injured' || player.status === 'suspended'
                  return (
                    <button
                      key={player.id}
                      onClick={() => !isUnavailable && handlePlayerSelect(player.id)}
                      disabled={isUnavailable}
                      className={`w-full text-left p-3 rounded-xl transition-all ${
                        isUnavailable
                          ? 'opacity-40 cursor-not-allowed bg-white/5'
                          : 'bg-white/5 hover:bg-white/10 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {wl && (
                            <span className={`w-2 h-2 rounded-full ${getStatusDot(wl.status)}`} />
                          )}
                          <span className="text-white font-semibold text-sm">{player.name}</span>
                          {player.jersey_number && (
                            <span className="text-white/30 text-xs">#{player.jersey_number}</span>
                          )}
                        </div>
                        {isUnavailable && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-400 font-semibold">
                            {player.status}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-white/40 text-xs capitalize">{player.position}</span>
                        {wl && (
                          <>
                            <span className={`text-xs font-semibold ${getAcwrColor(wl.acwr)}`}>
                              ACWR: {wl.acwr !== null ? wl.acwr.toFixed(2) : '—'}
                            </span>
                            <span className="text-white/30 text-xs">
                              {getStatusLabel(wl.status)}
                            </span>
                          </>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </>
          ) : (
            <>
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Users size={18} />
                Selected ({selectedCount}/20)
              </h3>

              {/* Starting XV */}
              <div className="mb-4">
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Starting XV</p>
                <div className="space-y-1">
                  {FORMATION_POSITIONS.map(pos => {
                    const player = lineup[pos.id] ? playerMap.get(lineup[pos.id]) : null
                    const wl = lineup[pos.id] ? workloadMap.get(lineup[pos.id]) : undefined
                    return (
                      <div key={pos.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                        <div className="flex items-center gap-2">
                          <span className="text-white/40 text-xs font-mono w-7">{pos.label}</span>
                          {player ? (
                            <div className="flex items-center gap-1.5">
                              {wl && <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(wl.status)}`} />}
                              <span className="text-white text-sm font-semibold">{player.name}</span>
                            </div>
                          ) : (
                            <span className="text-white/20 text-sm italic">Empty</span>
                          )}
                        </div>
                        {player && (
                          <button
                            onClick={() => handlePositionClick(pos.id)}
                            className="text-white/30 hover:text-red-400 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Substitutes */}
              <div>
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Substitutes</p>
                <div className="space-y-1">
                  {SUBSTITUTE_POSITIONS.map((pos, i) => {
                    const player = lineup[pos.id] ? playerMap.get(lineup[pos.id]) : null
                    const wl = lineup[pos.id] ? workloadMap.get(lineup[pos.id]) : undefined
                    return (
                      <div key={pos.id} className="flex items-center justify-between p-2 rounded-lg bg-white/5">
                        <div className="flex items-center gap-2">
                          <span className="text-white/40 text-xs font-mono w-7">S{i + 1}</span>
                          {player ? (
                            <div className="flex items-center gap-1.5">
                              {wl && <span className={`w-1.5 h-1.5 rounded-full ${getStatusDot(wl.status)}`} />}
                              <span className="text-white text-sm font-semibold">{player.name}</span>
                            </div>
                          ) : (
                            <span className="text-white/20 text-sm italic">Empty</span>
                          )}
                        </div>
                        {player && (
                          <button
                            onClick={() => handlePositionClick(pos.id)}
                            className="text-white/30 hover:text-red-400 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Health legend */}
              {workloads.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/10">
                  <p className="text-white/30 text-xs font-semibold uppercase tracking-wider mb-2">Health Key</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { status: 'optimal', label: 'Optimal', dot: 'bg-emerald-400' },
                      { status: 'undertrained', label: 'Undertrained', dot: 'bg-amber-400' },
                      { status: 'elevated', label: 'Elevated', dot: 'bg-orange-400' },
                      { status: 'high_risk', label: 'High Risk', dot: 'bg-red-400' },
                    ].map(item => (
                      <div key={item.status} className="flex items-center gap-1.5 text-xs text-white/50">
                        <span className={`w-2 h-2 rounded-full ${item.dot}`} />
                        {item.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
