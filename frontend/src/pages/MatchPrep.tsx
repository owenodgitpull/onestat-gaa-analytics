import { useEffect, useState, useMemo, useRef } from 'react'
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
  FileText,
  Plus,
  Pencil,
  ChevronDown,
  ChevronUp,
  Moon,
} from 'lucide-react'
import { api } from '@/services/api'
import type { PlayerWorkload, SetPieceRoutine, ManMarkingAssignment, SleepFlag } from '@/services/api'
import type { Match, Player } from '@/types'
import { useClub } from '@/contexts/ClubContext'
import OppositionBriefing from '@/components/OppositionBriefing'
import ManMarkingPanel from '@/components/ManMarkingPanel'
import SetPieceEditor from '@/components/SetPieceEditor'
import { PushToPlayersModal } from '@/components/playbook'
import ConfirmationModal from '@/components/ConfirmationModal'

// ── Pitch position data (mirrored from StartingLineupModal) ──────────────

interface LineupPosition {
  id: string
  x: number
  y: number
  label: string
}

const CAPTAIN_RE = /\s*\((?:c|vc)\)\s*$/i

function displaySurname(name: string) {
  const clean = name.replace(CAPTAIN_RE, '').trim()
  const isCaptain = /\(c\)/i.test(name)
  const surname = clean.split(' ').pop() || clean
  return isCaptain ? `${surname} ©` : surname
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
  { id: 'sub-6', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-7', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-8', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-9', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-10', x: 0, y: 0, label: 'SUB' },
  { id: 'sub-11', x: 0, y: 0, label: 'SUB' },
]

const POSITION_DEFAULT_JERSEY: Record<string, number> = {
  'gk':        1,
  'fb-left':   4,
  'fb-center': 3,
  'fb-right':  2,
  'hb-left':   7,
  'hb-center': 6,
  'hb-right':  5,
  'mf-left':   8,
  'mf-right':  9,
  'hf-left':   12,
  'hf-center': 11,
  'hf-right':  10,
  'ff-left':   15,
  'ff-center': 14,
  'ff-right':  13,
}

function defaultJerseyFor(positionId: string, currentLineup: Record<string, { jerseyNumber: number | null }>): number | null {
  const posDefault = POSITION_DEFAULT_JERSEY[positionId]
  if (posDefault == null) return null
  const taken = Object.values(currentLineup).some(e => e.jerseyNumber === posDefault)
  return taken ? null : posDefault
}

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


// ── Component ──────────────────────────────────────────────────────────────

export default function MatchPrep() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  const [match, setMatch] = useState<Match | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [workloads, setWorkloads] = useState<PlayerWorkload[]>([])
  const [sleepFlagMap, setSleepFlagMap] = useState<Map<string, SleepFlag>>(new Map())
  const [lineup, setLineup] = useState<Record<string, { playerId: string; jerseyNumber: number | null }>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, { playerId: string; jerseyNumber: number | null }> | null>(null)
  const [selectingPosition, setSelectingPosition] = useState<string | null>(null)
  const [selectedPitchPos, setSelectedPitchPos] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  // Opposition roster state
  const [oppositionRoster, setOppositionRoster] = useState<string[]>([])
  const [oppositionInput, setOppositionInput] = useState('')
  const [rosterSaving, setRosterSaving] = useState(false)
  const [rosterSaved, setRosterSaved] = useState(false)

  // Tactical notes state
  const [tacticalNotes, setTacticalNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(true)
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Man marking state
  const [markingAssignments, setMarkingAssignments] = useState<ManMarkingAssignment[]>([])

  // Set-piece routines state
  const [setPieces, setSetPieces] = useState<SetPieceRoutine[]>([])
  const [editingSetPiece, setEditingSetPiece] = useState<SetPieceRoutine | null>(null)
  const [showSetPieceEditor, setShowSetPieceEditor] = useState(false)
  const [newSetPieceName, setNewSetPieceName] = useState('')
  const [newSetPieceCategory, setNewSetPieceCategory] = useState<'attacking' | 'defensive' | 'kickout'>('attacking')

  // Delete confirmation state
  const [deletingSetPieceId, setDeletingSetPieceId] = useState<string | null>(null)
  // Push to players state
  const [pushingRoutine, setPushingRoutine] = useState<SetPieceRoutine | null>(null)
  // Voiceover state
  const [voiceoverUrl, setVoiceoverUrl] = useState<string | null>(null)

  // Section collapse state
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    tactical: true,
    briefing: false,
    marking: false,
    setpieces: false,
  })

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Load all data on mount
  useEffect(() => {
    if (!matchId) return
    const load = async () => {
      setLoading(true)
      try {
        const [matchData, playerData, healthData, existingLineup, lastLineup, notesData, markingsData, setPiecesData, rosterData, sleepFlagsData] = await Promise.all([
          api.matches.getById(matchId),
          api.players.getAll(),
          api.squadHealth.getSummary().catch(() => null),
          api.matchLineups.getLineup(matchId).catch(() => []),
          api.matchLineups.getLastLineup().catch(() => []),
          api.matchPrep.getTacticalNotes(matchId).catch(() => ({ tactical_notes: '' })),
          api.matchPrep.listMarkings(matchId).catch(() => []),
          api.matchPrep.listSetPieces().catch(() => []),
          api.matchPrep.getOppositionRoster(matchId).catch(() => ({ players: [] })),
          api.matchPrep.getSleepFlags().catch(() => ({ flags: [] })),
        ])
        setMatch(matchData)
        setPlayers(playerData)
        if (healthData) setWorkloads(healthData.player_workloads)
        if (sleepFlagsData.flags.length > 0) {
          const flagMap = new Map<string, SleepFlag>()
          sleepFlagsData.flags.forEach(f => flagMap.set(f.player_id, f))
          setSleepFlagMap(flagMap)
        }

        // Load existing lineup for this match
        if (existingLineup.length > 0) {
          const lineupObj: Record<string, { playerId: string; jerseyNumber: number | null }> = {}
          existingLineup.forEach(entry => {
            lineupObj[entry.position_id] = {
              playerId: entry.player_id,
              jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number,
            }
          })
          setLineup(lineupObj)
        }

        // Load last match lineup for quick-reuse
        if (lastLineup.length > 0) {
          const lastObj: Record<string, { playerId: string; jerseyNumber: number | null }> = {}
          lastLineup.forEach(entry => {
            lastObj[entry.position_id] = {
              playerId: entry.player_id,
              jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number,
            }
          })
          setLastMatchLineup(lastObj)
        }

        // Load match prep data
        setTacticalNotes(notesData.tactical_notes || '')
        setMarkingAssignments(markingsData)
        setSetPieces(setPiecesData)
        if (rosterData.players?.length) {
          setOppositionRoster(rosterData.players)
          setOppositionInput(rosterData.players.join('\n'))
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
  const selectedIds = useMemo(() => new Set(Object.values(lineup).map(e => e.playerId)), [lineup])

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
  const startingCount = FORMATION_POSITIONS.filter(p => !!lineup[p.id]).length

  const handlePositionClick = (positionId: string) => {
    if (selectingPosition) return // picker open — ignore pitch taps

    if (selectedPitchPos === positionId) {
      setSelectedPitchPos(null)
      return
    }

    if (selectedPitchPos) {
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
          next[toId] = { playerId: fromEntry.playerId, jerseyNumber: defaultJerseyFor(toId, prev) }
          delete next[fromId]
        }
        return next
      })
      setSaved(false)
      return
    }

    if (lineup[positionId]) {
      setSelectedPitchPos(positionId)
    } else {
      setSelectingPosition(positionId)
    }
  }

  const handleDirectRemove = (positionId: string) => {
    setSelectedPitchPos(null)
    const newLineup = { ...lineup }
    delete newLineup[positionId]
    setLineup(newLineup)
    setSaved(false)
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
    setSaved(false)
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
    setSaved(false)
  }

  const handlePlayerSelect = (playerId: string) => {
    if (selectingPosition) {
      setLineup(prev => ({
        ...prev,
        [selectingPosition]: {
          playerId,
          jerseyNumber: defaultJerseyFor(selectingPosition, prev),
        },
      }))
      setSelectingPosition(null)
      setSaved(false)
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
    setSaved(false)
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
      const entries = Object.entries(lineup).map(([position_id, entry]) => ({
        player_id: entry.playerId,
        position_id,
        is_substitute: position_id.startsWith('sub-'),
        jersey_number: entry.jerseyNumber,
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
      const entries = Object.entries(lineup).map(([position_id, entry]) => ({
        player_id: entry.playerId,
        position_id,
        is_substitute: position_id.startsWith('sub-'),
        jersey_number: entry.jerseyNumber,
      }))
      await api.matchLineups.saveLineup(matchId, entries)
      navigate(`/match/${matchId}/setup`)
    } catch (err) {
      console.error('Failed to save lineup:', err)
      setSaving(false)
    }
  }

  // Auto-save tactical notes (debounced)
  const handleTacticalNotesChange = (value: string) => {
    setTacticalNotes(value)
    setNotesSaved(false)
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current)
    notesTimerRef.current = setTimeout(async () => {
      if (matchId) {
        try {
          await api.matchPrep.saveTacticalNotes(matchId, value)
          setNotesSaved(true)
        } catch (err) {
          console.error('Failed to save tactical notes:', err)
        }
      }
    }, 1000)
  }

  // Man marking handlers
  const handleAddMarking = async (playerId: string, opponentName: string, notes?: string) => {
    if (!matchId) return
    try {
      const assignment = await api.matchPrep.createMarking(matchId, {
        player_id: playerId,
        opponent_player_name: opponentName,
        notes,
      })
      setMarkingAssignments(prev => [...prev, assignment])
    } catch (err) {
      console.error('Failed to add marking:', err)
    }
  }

  const handleDeleteMarking = async (assignmentId: string) => {
    try {
      await api.matchPrep.deleteMarking(assignmentId)
      setMarkingAssignments(prev => prev.filter(a => a.id !== assignmentId))
    } catch (err) {
      console.error('Failed to delete marking:', err)
    }
  }

  // Set-piece handlers
  const handleSaveSetPiece = async (elements: Array<Record<string, unknown>>) => {
    try {
      if (editingSetPiece) {
        const updated = await api.matchPrep.updateSetPiece(editingSetPiece.id, { elements })
        setSetPieces(prev => prev.map(sp => sp.id === updated.id ? updated : sp))
      } else {
        const created = await api.matchPrep.createSetPiece({
          name: newSetPieceName || 'Untitled Routine',
          category: newSetPieceCategory,
          elements,
        })
        setSetPieces(prev => [created, ...prev])
      }
      setShowSetPieceEditor(false)
      setEditingSetPiece(null)
      setNewSetPieceName('')
    } catch (err) {
      console.error('Failed to save set piece:', err)
    }
  }

  // Fetch voiceover URL when opening editor for existing routine
  const openSetPieceEditor = async (routine: SetPieceRoutine | null) => {
    setEditingSetPiece(routine)
    setVoiceoverUrl(null)
    setShowSetPieceEditor(true)
    if (routine?.id && routine.has_voiceover) {
      try {
        const { voiceover_url } = await api.matchPrep.getVoiceoverUrl(routine.id)
        setVoiceoverUrl(voiceover_url)
      } catch { /* ignore */ }
    }
  }

  const handleSaveVoiceover = async (blob: Blob) => {
    const routineId = editingSetPiece?.id
    if (!routineId) return
    // Get presigned upload URL
    const { upload_url, key } = await api.matchPrep.getVoiceoverUploadUrl(routineId)
    // Upload directly to R2
    await fetch(upload_url, { method: 'PUT', body: blob, headers: { 'Content-Type': 'audio/webm' } })
    // Confirm upload
    await api.matchPrep.confirmVoiceoverUpload(routineId, key)
    // Fetch new download URL
    const { voiceover_url } = await api.matchPrep.getVoiceoverUrl(routineId)
    setVoiceoverUrl(voiceover_url)
    // Update local state
    setSetPieces(prev => prev.map(sp => sp.id === routineId ? { ...sp, has_voiceover: true } : sp))
  }

  const handleDeleteSetPiece = async (id: string) => {
    try {
      await api.matchPrep.deleteSetPiece(id)
      setSetPieces(prev => prev.filter(sp => sp.id !== id))
    } catch (err) {
      console.error('Failed to delete set piece:', err)
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
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate('/')}
              className="w-10 h-10 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all flex-shrink-0"
            >
              <ArrowLeft size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="text-xl md:text-2xl font-bold text-white">Match Prep</h1>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-white/60 text-sm mt-0.5">
                <span className="font-semibold text-white">{match.opponent}</span>
                <span className="flex items-center gap-1">
                  <MapPin size={12} className="flex-shrink-0" />
                  {venueLabel}
                </span>
                <span className="flex items-center gap-1 whitespace-nowrap">
                  <Calendar size={12} className="flex-shrink-0" />
                  {matchDate}
                </span>
                {match.competition && (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold whitespace-nowrap text-center">
                    {match.competition}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {saved && (
              <span className="flex items-center gap-1 text-emerald-400 text-sm font-semibold">
                <Check size={14} />
                Saved
              </span>
            )}
            <button
              onClick={handleSave}
              disabled={saving || selectedCount === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Save size={14} />
              Save
            </button>
            <button
              onClick={handleSaveAndStart}
              disabled={saving || startingCount < 15}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-white text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              <Play size={14} />
              Save & Start
            </button>
          </div>
        </div>
      </div>

      {/* Use Last Lineup button */}
      {lastMatchLineup && (
        <button
          onClick={handleUseLastLineup}
          className="glass-card px-5 py-3 flex items-center gap-2 hover:bg-white/10 transition-all"
        >
          <Copy size={18} className="text-blue-400" />
          <span className="text-white font-semibold">{selectedCount === 0 ? 'Use Last Lineup' : 'Replace with Last Lineup'}</span>
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
                const entry = lineup[pos.id]
                const player = entry ? playerMap.get(entry.playerId) : null
                const workload = entry ? workloadMap.get(entry.playerId) : undefined
                const sleepFlag = entry ? sleepFlagMap.get(entry.playerId) : undefined
                const displayLabel = entry?.jerseyNumber != null ? `${entry.jerseyNumber}` : pos.label
                const isSelected = selectedPitchPos === pos.id

                return (
                  <div
                    key={pos.id}
                    className="absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer group"
                    style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
                    onClick={() => handlePositionClick(pos.id)}
                  >
                    <div
                      className={`w-8 h-8 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-[10px] sm:text-sm transition-all ring-2 ${
                        player
                          ? `shadow-lg ${isSelected ? 'scale-125' : 'hover:scale-105'}`
                          : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110 ring-white/30'
                      }`}
                      style={player ? {
                        backgroundColor: jerseyBg, color: jerseyText,
                        '--tw-ring-color': isSelected ? '#fbbf24' : jerseyText,
                        '--tw-ring-width': isSelected ? '4px' : '2px',
                        boxShadow: isSelected ? '0 0 18px rgba(251,191,36,0.55)' : undefined,
                      } as React.CSSProperties : undefined}
                    >
                      {player ? displayLabel : pos.label}
                    </div>
                    {player && (
                      <div className="absolute top-full mt-1 left-1/2 transform -translate-x-1/2 whitespace-nowrap">
                        <span className={`text-[9px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded flex items-center gap-1 ${isSelected ? 'bg-amber-500/30 text-amber-200' : 'bg-black/60 text-white'}`}>
                          {workload && (
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${getStatusDot(workload.status)}`} />
                          )}
                          {displaySurname(player.name)}
                          {sleepFlag && (
                            <Moon size={8} className={sleepFlag.severity === 'high' ? 'text-red-400' : 'text-amber-400'} />
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}

              {/* Action strip — when a position is selected */}
              {selectedPitchPos && !selectingPosition && (() => {
                const entry = lineup[selectedPitchPos]
                const player = entry ? playerMap.get(entry.playerId) : null
                if (!player) return null
                const isStarting = FORMATION_POSITIONS.some(p => p.id === selectedPitchPos)
                const hasBenchSlot = SUBSTITUTE_POSITIONS.some(s => !lineup[s.id])
                const hasStartSlot = FORMATION_POSITIONS.some(p => !lineup[p.id])
                return (
                  <div className="absolute inset-x-2 bottom-2 z-10">
                    <div className="flex items-center justify-between gap-1.5 rounded-xl px-3 py-2"
                      style={{
                        background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))',
                        border: '1px solid rgba(245,158,11,0.40)',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                      }}
                    >
                      <span className="text-amber-200 text-xs font-bold truncate flex-1 mr-1">
                        {displaySurname(player.name)}
                      </span>
                      <div className="flex gap-1.5 flex-shrink-0">
                        {isStarting && hasBenchSlot && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveToBench(selectedPitchPos) }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-purple-500/20 border border-purple-400/30 text-purple-300 hover:bg-purple-500/30 transition-colors"
                          >→ Bench</button>
                        )}
                        {!isStarting && hasStartSlot && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleMoveToStarting(selectedPitchPos) }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-300 hover:bg-blue-500/30 transition-colors"
                          >← Start</button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDirectRemove(selectedPitchPos) }}
                          className="text-[10px] px-2 py-1 rounded-lg bg-red-500/20 border border-red-400/30 text-red-300 hover:bg-red-500/30 transition-colors"
                        >Remove</button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setSelectedPitchPos(null) }}
                          className="text-[10px] px-2 py-1 rounded-lg bg-white/5 border border-white/10 text-white/40 hover:bg-white/10 transition-colors"
                        >✕</button>
                      </div>
                    </div>
                    <p className="text-center text-[9px] text-white/30 mt-0.5">or tap another position to swap</p>
                  </div>
                )
              })()}
            </div>

            {/* Substitutes */}
            <div className="flex flex-wrap justify-center gap-3 md:gap-4 mt-4 px-2">
              {SUBSTITUTE_POSITIONS.map((pos, index) => {
                const entry = lineup[pos.id]
                const player = entry ? playerMap.get(entry.playerId) : null
                const workload = entry ? workloadMap.get(entry.playerId) : undefined
                const sleepFlag = entry ? sleepFlagMap.get(entry.playerId) : undefined
                const isSelected = selectedPitchPos === pos.id

                return (
                  <div
                    key={pos.id}
                    className="cursor-pointer flex flex-col items-center"
                    onClick={() => handlePositionClick(pos.id)}
                  >
                    <div
                      className={`w-7 h-7 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-[9px] sm:text-xs transition-all ring-2 ${
                        player
                          ? `shadow-lg ${isSelected ? 'scale-125' : 'hover:scale-105'}`
                          : 'bg-slate-600/80 text-white/90 hover:bg-slate-500 hover:scale-110 ring-white/30'
                      }`}
                      style={player ? {
                        backgroundColor: jerseyBg, color: jerseyText,
                        '--tw-ring-color': isSelected ? '#fbbf24' : jerseyText,
                        boxShadow: isSelected ? '0 0 14px rgba(251,191,36,0.5)' : undefined,
                      } as React.CSSProperties : undefined}
                    >
                      {player ? (entry?.jerseyNumber ?? `S${index + 1}`) : `S${index + 1}`}
                    </div>
                    {player && (
                      <div className="mt-1.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-1 ${isSelected ? 'bg-amber-500/30 text-amber-200' : 'bg-black/50 text-white'}`}>
                          {workload && (
                            <span className={`w-1.5 h-1.5 rounded-full inline-block ${getStatusDot(workload.status)}`} />
                          )}
                          {displaySurname(player.name)}
                          {sleepFlag && (
                            <Moon size={8} className={sleepFlag.severity === 'high' ? 'text-red-400' : 'text-amber-400'} />
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Count indicator */}
            <div className="text-center mt-3 text-sm text-white/50">
              {startingCount}/15 starting + {selectedCount - startingCount}/11 subs
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
                  const sf = sleepFlagMap.get(player.id)
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
                          {sf && (
                            <span className={`flex items-center gap-0.5 text-[10px] font-semibold ${sf.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`}>
                              <Moon size={10} />
                              {sf.avg_last_2_nights}h
                            </span>
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
                        {sf && (
                          <span className={`text-xs ${sf.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`}>
                            Poor sleep ({sf.nights_below_6h} night{sf.nights_below_6h !== 1 ? 's' : ''} &lt;6h)
                          </span>
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
                Selected ({selectedCount}/26)
              </h3>

              {/* Starting XV */}
              <div className="mb-4">
                <p className="text-white/40 text-xs font-semibold uppercase tracking-wider mb-2">Starting XV</p>
                <div className="space-y-1">
                  {FORMATION_POSITIONS.map(pos => {
                    const entry = lineup[pos.id]
                    const player = entry ? playerMap.get(entry.playerId) : null
                    const wl = entry ? workloadMap.get(entry.playerId) : undefined
                    const sf = entry ? sleepFlagMap.get(entry.playerId) : undefined
                    return (
                      <div key={pos.id} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/5">
                        <span className="text-white/40 text-xs font-mono w-7 flex-shrink-0">{pos.label}</span>
                        {player ? (
                          <>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={2}
                              value={entry?.jerseyNumber ?? ''}
                              onChange={(e) => handleJerseyChange(pos.id, e.target.value.replace(/\D/g, ''))}
                              onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                              onFocus={(e) => e.target.select()}
                              className="w-10 h-7 bg-white/10 border border-white/20 rounded text-center text-white text-xs font-bold focus:ring-1 focus:ring-emerald-400 focus:outline-none flex-shrink-0"
                              placeholder="#"
                            />
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              {wl && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDot(wl.status)}`} />}
                              <span className="text-white text-xs font-semibold truncate">{player.name}</span>
                              {sf && <Moon size={10} className={`flex-shrink-0 ${sf.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`} />}
                            </div>
                            <button
                              onClick={() => handleDirectRemove(pos.id)}
                              className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <span className="text-white/20 text-xs italic">Empty</span>
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
                    const entry = lineup[pos.id]
                    const player = entry ? playerMap.get(entry.playerId) : null
                    const wl = entry ? workloadMap.get(entry.playerId) : undefined
                    const sf = entry ? sleepFlagMap.get(entry.playerId) : undefined
                    return (
                      <div key={pos.id} className="flex items-center gap-1.5 p-1.5 rounded-lg bg-white/5">
                        <span className="text-white/40 text-xs font-mono w-7 flex-shrink-0">S{i + 1}</span>
                        {player ? (
                          <>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              maxLength={2}
                              value={entry?.jerseyNumber ?? ''}
                              onChange={(e) => handleJerseyChange(pos.id, e.target.value.replace(/\D/g, ''))}
                              onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select() }}
                              onFocus={(e) => e.target.select()}
                              className="w-10 h-7 bg-white/10 border border-white/20 rounded text-center text-white text-xs font-bold focus:ring-1 focus:ring-emerald-400 focus:outline-none flex-shrink-0"
                              placeholder="#"
                            />
                            <div className="flex items-center gap-1.5 flex-1 min-w-0">
                              {wl && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${getStatusDot(wl.status)}`} />}
                              <span className="text-white text-xs font-semibold truncate">{player.name}</span>
                              {sf && <Moon size={10} className={`flex-shrink-0 ${sf.severity === 'high' ? 'text-red-400' : 'text-amber-400'}`} />}
                            </div>
                            <button
                              onClick={() => handleDirectRemove(pos.id)}
                              className="text-white/30 hover:text-red-400 transition-colors flex-shrink-0"
                            >
                              <X size={13} />
                            </button>
                          </>
                        ) : (
                          <span className="text-white/20 text-xs italic">Empty</span>
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
                    <div className="flex items-center gap-1.5 text-xs text-amber-400/70">
                      <Moon size={10} />
                      Poor sleep (&lt;6h)
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Match Prep Sections ────────────────────────────────── */}

      {/* Tactical Notes */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('tactical')}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText size={16} className="text-cyan-400" />
            <span className="text-sm font-bold text-white">Tactical Notes</span>
            {!notesSaved && <span className="text-amber-400 text-[10px]">unsaved</span>}
            {notesSaved && tacticalNotes && <Check size={12} className="text-emerald-400" />}
          </div>
          {expandedSections.tactical ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {expandedSections.tactical && (
          <div className="px-4 pb-4">
            <textarea
              value={tacticalNotes}
              onChange={e => handleTacticalNotesChange(e.target.value)}
              placeholder="Pre-match tactical plan... e.g. 'Press high for first 15 minutes then drop', 'Target their full-back on the turn', 'Use two-pointer from the 45 on the left'..."
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-cyan-500/30 min-h-[120px] resize-y"
              maxLength={5000}
            />
            <p className="text-white/20 text-[10px] mt-1">
              These notes are surfaced to the Live Match Agent during the game for tactical context.
            </p>
          </div>
        )}
      </div>

      {/* AI Opposition Briefing */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('briefing')}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-purple-400 text-sm">AI</span>
            <span className="text-sm font-bold text-white">Opposition Briefing</span>
          </div>
          {expandedSections.briefing ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {expandedSections.briefing && (
          <div className="px-4 pb-4">
            <OppositionBriefing matchId={matchId!} opponent={match.opponent} />
          </div>
        )}
      </div>

      {/* Opposition Roster */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('opposition')}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="text-orange-400" />
            <span className="text-sm font-bold text-white">Opposition Players</span>
            {oppositionRoster.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300">{oppositionRoster.length}</span>
            )}
          </div>
          {expandedSections.opposition ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {expandedSections.opposition && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-xs text-white/40">
              Only opposition <strong className="text-white/60">scores</strong> are tracked during match recording. Enter key players likely to score — you can quickly attribute their goals and points during the match.
            </p>
            <textarea
              value={oppositionInput}
              onChange={(e) => setOppositionInput(e.target.value)}
              placeholder={"Enter one player per line, e.g.:\nConor Cox\nDiarmuid Murtagh\nEgan Smith"}
              rows={6}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/30">
                {oppositionInput.split('\n').filter(l => l.trim()).length} players entered
              </span>
              <button
                onClick={async () => {
                  const names = oppositionInput.split('\n').map(n => n.trim()).filter(Boolean)
                  setRosterSaving(true)
                  try {
                    const result = await api.matchPrep.saveOppositionRoster(matchId!, names)
                    setOppositionRoster(result.players)
                    setRosterSaved(true)
                    setTimeout(() => setRosterSaved(false), 3000)
                  } catch (err) {
                    console.error('Failed to save opposition roster:', err)
                  } finally {
                    setRosterSaving(false)
                  }
                }}
                disabled={rosterSaving}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all disabled:opacity-50"
                style={{
                  background: rosterSaved ? 'rgba(16,185,129,0.2)' : 'rgba(251,146,60,0.15)',
                  border: rosterSaved ? '1px solid rgba(16,185,129,0.4)' : '1px solid rgba(251,146,60,0.3)',
                  color: rosterSaved ? '#34d399' : '#fb923c',
                }}
              >
                {rosterSaving ? 'Saving...' : rosterSaved ? 'Saved' : 'Save Roster'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Man Marking Assignments */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('marking')}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-orange-400 text-sm font-bold">#</span>
            <span className="text-sm font-bold text-white">Man Marking</span>
            {markingAssignments.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-orange-500/20 text-orange-300 text-[10px] font-bold">
                {markingAssignments.length}
              </span>
            )}
          </div>
          {expandedSections.marking ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {expandedSections.marking && (
          <div className="px-4 pb-4">
            <ManMarkingPanel
              matchId={matchId!}
              assignments={markingAssignments}
              players={players}
              onAdd={handleAddMarking}
              onDelete={handleDeleteMarking}
            />
          </div>
        )}
      </div>

      {/* Tactical Routines */}
      <div className="glass-card overflow-hidden">
        <button
          onClick={() => toggleSection('setpieces')}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Pencil size={14} className="text-amber-400" />
            <span className="text-sm font-bold text-white">Tactical Routines</span>
            {setPieces.length > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold">
                {setPieces.length}
              </span>
            )}
          </div>
          {expandedSections.setpieces ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {expandedSections.setpieces && (
          <div className="px-4 pb-4">
            {/* Create new */}
            <div className="flex items-center gap-2 mb-3">
              <input
                type="text"
                value={newSetPieceName}
                onChange={e => setNewSetPieceName(e.target.value)}
                placeholder="Routine name..."
                className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-white/25"
                maxLength={200}
              />
              <select
                value={newSetPieceCategory}
                onChange={e => setNewSetPieceCategory(e.target.value as 'attacking' | 'defensive' | 'kickout')}
                className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-sm text-white [&>option]:bg-slate-800 [&>option]:text-white"
              >
                <option value="attacking">Attacking</option>
                <option value="defensive">Defensive</option>
                <option value="kickout">Kickout</option>
              </select>
              <button
                onClick={() => openSetPieceEditor(null)}
                disabled={!newSetPieceName.trim()}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold disabled:opacity-40"
              >
                <Plus size={14} /> Draw
              </button>
            </div>

            {/* Existing routines */}
            {setPieces.length === 0 ? (
              <p className="text-white/30 text-xs py-2">No set-piece routines yet. Create one above to draw plays on the pitch.</p>
            ) : (
              <div className="space-y-2">
                {setPieces.map(sp => {
                  const catColor = sp.category === 'attacking' ? 'text-emerald-300 bg-emerald-500/20' :
                    sp.category === 'defensive' ? 'text-blue-300 bg-blue-500/20' : 'text-purple-300 bg-purple-500/20'
                  return (
                    <div key={sp.id} className="flex items-center justify-between p-3 rounded-xl bg-white/5">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${catColor}`}>
                          {sp.category.toUpperCase()}
                        </span>
                        <span className="text-white text-sm font-semibold">{sp.name}</span>
                        <span className="text-white/20 text-xs">{sp.elements.length} elements</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => openSetPieceEditor(sp)}
                          className="p-1.5 rounded-lg text-white/30 hover:text-white"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setDeletingSetPieceId(sp.id)}
                          className="p-1.5 rounded-lg text-white/30 hover:text-red-400"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Tactical Routine Editor Modal */}
      {showSetPieceEditor && (
        <SetPieceEditor
          initialElements={editingSetPiece?.elements || []}
          routineName={editingSetPiece?.name || newSetPieceName || 'Tactical Routine'}
          routineId={editingSetPiece?.id}
          onSave={handleSaveSetPiece}
          onClose={() => {
            setShowSetPieceEditor(false)
            setEditingSetPiece(null)
          }}
          availablePlayers={players.filter(p => p.active).map(p => ({
            playerId: p.id,
            playerName: p.name,
            jerseyNumber: p.jersey_number ?? null,
          }))}
          teamPrimaryColor={jerseyBg}
          teamSecondaryColor={jerseyText}
          onPushToPlayers={editingSetPiece ? () => {
            setPushingRoutine(editingSetPiece)
          } : undefined}
          voiceoverUrl={voiceoverUrl}
          onSaveVoiceover={editingSetPiece?.id ? handleSaveVoiceover : undefined}
        />
      )}

      {/* Delete set piece confirmation */}
      <ConfirmationModal
        isOpen={!!deletingSetPieceId}
        onClose={() => setDeletingSetPieceId(null)}
        onConfirm={() => {
          if (deletingSetPieceId) handleDeleteSetPiece(deletingSetPieceId)
          setDeletingSetPieceId(null)
        }}
        title="Delete Routine"
        message="Are you sure you want to delete this play routine? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />

      {/* Push to Players Modal */}
      {pushingRoutine && (
        <PushToPlayersModal
          routineId={pushingRoutine.id}
          routineName={pushingRoutine.name}
          players={players}
          onPush={async (routineId, playerIds, message) => {
            await api.playbook.pushToPlayers(routineId, playerIds, message)
          }}
          onClose={() => setPushingRoutine(null)}
        />
      )}
    </div>
  )
}
