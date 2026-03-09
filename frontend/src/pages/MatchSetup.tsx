import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Play,
  Upload,
  ArrowLeft,
  MapPin,
  Calendar,
  Users,
  Check,
  Minus,
  Plus,
  Loader2,
} from 'lucide-react'
import { useMatch } from '../hooks/useMatches'
import { usePlayers } from '../hooks/usePlayers'
import { useClub } from '../contexts/ClubContext'
import { api } from '../services/api'
import StartingLineupModal, { type LineupEntry } from '../components/StartingLineupModal'

type Mode = 'choose' | 'post-match'

export default function MatchSetup() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const { data: match, isLoading: matchLoading } = useMatch(matchId ?? null)
  const { data: players = [] } = usePlayers()
  const { club } = useClub()

  const [mode, setMode] = useState<Mode>('choose')

  // Score state
  const [teamGoals, setTeamGoals] = useState(0)
  const [teamTwoPointers, setTeamTwoPointers] = useState(0)
  const [teamPoints, setTeamPoints] = useState(0)
  const [oppGoals, setOppGoals] = useState(0)
  const [oppTwoPointers, setOppTwoPointers] = useState(0)
  const [oppPoints, setOppPoints] = useState(0)

  // Strip colours
  const [teamColour, setTeamColour] = useState('#10B981')
  const [oppColour, setOppColour] = useState('#FFFFFF')

  // Lineup
  const [showLineupModal, setShowLineupModal] = useState(false)
  const [lineup, setLineup] = useState<Record<string, LineupEntry> | null>(null)
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, LineupEntry> | undefined>(undefined)

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Default team colour from club
  useEffect(() => {
    if (club?.primary_colour) {
      setTeamColour(club.primary_colour)
    }
  }, [club])

  // Load existing lineup for this match (from match prep) + last match lineup for reuse
  useEffect(() => {
    if (matchId) {
      api.matchLineups.getLineup(matchId)
        .then(entries => {
          if (entries.length > 0) {
            const obj: Record<string, LineupEntry> = {}
            entries.forEach(e => {
              obj[e.position_id] = {
                playerId: e.player_id,
                jerseyNumber: e.match_jersey_number ?? e.player_jersey_number,
              }
            })
            setLineup(obj)
          }
        })
        .catch(() => {})
    }
    api.matchLineups.getLastLineup()
      .then(entries => {
        if (entries.length > 0) {
          const obj: Record<string, LineupEntry> = {}
          entries.forEach(e => {
            obj[e.position_id] = {
              playerId: e.player_id,
              jerseyNumber: e.match_jersey_number ?? e.player_jersey_number,
            }
          })
          setLastMatchLineup(obj)
        }
      })
      .catch(() => {})
  }, [matchId])

  // Auto-redirect based on match status
  useEffect(() => {
    if (!match || !matchId) return
    if (match.status === 'completed') {
      navigate(`/results/${matchId}`, { replace: true })
    } else if (match.status === 'in_progress') {
      navigate(`/match/${matchId}`, { replace: true })
    }
  }, [match, matchId, navigate])

  const handleCompleteMatch = async () => {
    if (!matchId) return
    setSubmitting(true)
    setError(null)
    try {
      // 1. Save strip colours
      await api.matches.update(matchId, {
        team_strip_colour: teamColour,
        opponent_strip_colour: oppColour,
      } as any)

      // 2. Save score (aggregate two-pointers into points: each 2-ptr = 2 points)
      await api.matches.updateScore(matchId, {
        team_goals: teamGoals,
        team_points: teamTwoPointers * 2 + teamPoints,
        opponent_goals: oppGoals,
        opponent_points: oppTwoPointers * 2 + oppPoints,
      })

      // 3. Save lineup (if set)
      if (lineup && Object.keys(lineup).length > 0) {
        const entries = Object.entries(lineup).map(([position_id, entry]) => ({
          player_id: entry.playerId,
          position_id,
          is_substitute: position_id.startsWith('sub-'),
          jersey_number: entry.jerseyNumber,
        }))
        await api.matchLineups.saveLineup(matchId, entries)
      }

      // 4. Complete match (triggers AI analysis in background)
      await api.matches.complete(matchId)

      // 5. Navigate to results
      navigate(`/results/${matchId}`)
    } catch (err: any) {
      console.error('Failed to complete match:', err)
      setError(err.message || 'Failed to complete match')
    } finally {
      setSubmitting(false)
    }
  }

  if (matchLoading) {
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
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  })
  const clubName = club?.short_name || club?.name || 'Team'
  const lineupCount = lineup ? Object.keys(lineup).length : 0

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="w-10 h-10 rounded-xl flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-all"
        >
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-white">Match Setup</h1>
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
          </div>
        </div>
      </div>

      {/* Mode: Choose */}
      {mode === 'choose' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Record Live */}
          <button
            onClick={() => navigate(`/match/${matchId}`)}
            className="glass-card p-8 text-center hover:bg-white/10 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/20 flex items-center justify-center mx-auto mb-4 group-hover:bg-emerald-500/30 transition-colors">
              <Play size={32} className="text-emerald-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Record Live</h3>
            <p className="text-white/50 text-sm">
              Track events in real-time during the match
            </p>
          </button>

          {/* Post-Match Entry */}
          <button
            onClick={() => setMode('post-match')}
            className="glass-card p-8 text-center hover:bg-white/10 transition-all group cursor-pointer"
          >
            <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mx-auto mb-4 group-hover:bg-purple-500/30 transition-colors">
              <Upload size={32} className="text-purple-400" />
            </div>
            <h3 className="text-xl font-bold text-white mb-2">Post-Match Entry</h3>
            <p className="text-white/50 text-sm">
              Enter the score &amp; lineup, then upload video and GPS
            </p>
          </button>
        </div>
      )}

      {/* Mode: Post-Match Form */}
      {mode === 'post-match' && (
        <div className="space-y-6">
          {/* Back to choose */}
          <button
            onClick={() => setMode('choose')}
            className="flex items-center gap-1 text-white/50 hover:text-white text-sm transition-colors"
          >
            <ArrowLeft size={14} />
            Back to options
          </button>

          {/* Final Score */}
          <div className="glass-card p-4 sm:p-6 space-y-3">
            <h3 className="text-lg font-bold text-white">Final Score</h3>

            {/* Team */}
            <div className="rounded-xl bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-white font-semibold text-sm">{clubName}</p>
                <p className="text-emerald-400 text-sm font-bold tabular-nums">
                  {teamGoals}-{teamTwoPointers * 2 + teamPoints}
                  <span className="text-white/30 font-normal ml-1.5">
                    ({teamGoals * 3 + teamTwoPointers * 2 + teamPoints})
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-evenly">
                <ScoreInput label="Goals" value={teamGoals} onChange={setTeamGoals} />
                <ScoreInput label="2-Ptrs" value={teamTwoPointers} onChange={setTeamTwoPointers} accent="text-orange-400" />
                <ScoreInput label="Points" value={teamPoints} onChange={setTeamPoints} />
              </div>
            </div>

            {/* Opponent */}
            <div className="rounded-xl bg-white/5 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-white font-semibold text-sm">{match.opponent}</p>
                <p className="text-red-400 text-sm font-bold tabular-nums">
                  {oppGoals}-{oppTwoPointers * 2 + oppPoints}
                  <span className="text-white/30 font-normal ml-1.5">
                    ({oppGoals * 3 + oppTwoPointers * 2 + oppPoints})
                  </span>
                </p>
              </div>
              <div className="flex items-center justify-evenly">
                <ScoreInput label="Goals" value={oppGoals} onChange={setOppGoals} />
                <ScoreInput label="2-Ptrs" value={oppTwoPointers} onChange={setOppTwoPointers} accent="text-orange-400" />
                <ScoreInput label="Points" value={oppPoints} onChange={setOppPoints} />
              </div>
            </div>
          </div>

          {/* Strip Colours */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-bold text-white mb-4">Strip Colours</h3>
            <div className="flex items-center gap-8 justify-center">
              <ColourPicker label={clubName} colour={teamColour} borderColour={club?.secondary_colour} onChange={setTeamColour} />
              <span className="text-white/20 text-sm">vs</span>
              <ColourPicker label={match.opponent} colour={oppColour} onChange={setOppColour} />
            </div>
          </div>

          {/* Lineup */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Lineup</h3>
                <p className="text-white/40 text-sm mt-0.5">
                  {lineupCount > 0 ? `${lineupCount} players selected` : 'Optional — helps AI analysis'}
                </p>
              </div>
              <button
                onClick={() => setShowLineupModal(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition-all"
              >
                <Users size={16} />
                {lineupCount > 0 ? 'Edit Lineup' : 'Select Lineup'}
              </button>
            </div>
            {lineupCount > 0 && (
              <div className="mt-3 flex items-center gap-2 text-emerald-400 text-sm">
                <Check size={14} />
                <span>{lineupCount} players set</span>
              </div>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Complete Match Button */}
          <button
            onClick={handleCompleteMatch}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold text-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'var(--gradient-primary)',
              color: '#0a1a10',
              boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3)',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={20} className="animate-spin" />
                Saving...
              </>
            ) : (
              <>
                Next
                <ArrowLeft size={18} className="rotate-180" />
              </>
            )}
          </button>
        </div>
      )}

      {/* Lineup Modal (reused) */}
      <StartingLineupModal
        isOpen={showLineupModal}
        onClose={() => setShowLineupModal(false)}
        onConfirm={(selectedLineup) => {
          setLineup(selectedLineup)
          setShowLineupModal(false)
        }}
        players={players}
        lastMatchLineup={lastMatchLineup}
      />
    </div>
  )
}

// ── Score Input ──────────────────────────────────────────────────────────────

function ScoreInput({
  label,
  value,
  onChange,
  accent,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  accent?: string
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <span className={`text-[10px] sm:text-xs uppercase tracking-wider ${accent || 'text-white/40'}`}>{label}</span>
      <div className="flex items-center">
        <button
          onClick={() => onChange(Math.max(0, value - 1))}
          className="w-8 h-9 rounded-l-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all active:bg-white/25"
        >
          <Minus size={14} />
        </button>
        <span className="w-8 h-9 flex items-center justify-center text-xl font-bold text-white tabular-nums bg-white/5">{value}</span>
        <button
          onClick={() => onChange(value + 1)}
          className="w-8 h-9 rounded-r-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/70 hover:text-white transition-all active:bg-white/25"
        >
          <Plus size={14} />
        </button>
      </div>
    </div>
  )
}

// ── Colour Picker ────────────────────────────────────────────────────────────

function ColourPicker({
  label,
  colour,
  borderColour,
  onChange,
}: {
  label: string
  colour: string
  borderColour?: string | null
  onChange: (c: string) => void
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-white/60 text-sm font-semibold truncate max-w-[100px]">{label}</span>
      <label className="relative cursor-pointer group">
        <div
          className="w-12 h-12 rounded-full border-[3px] group-hover:brightness-110 transition-all shadow-lg"
          style={{ backgroundColor: colour, borderColor: borderColour || 'rgba(255,255,255,0.25)' }}
        />
        <input
          type="color"
          value={colour}
          onChange={e => onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
        />
      </label>
      <span className="text-white/30 text-xs font-mono">{colour}</span>
    </div>
  )
}
