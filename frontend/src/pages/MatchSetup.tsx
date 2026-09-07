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
  Smartphone,
} from 'lucide-react'
import { useMatch } from '../hooks/useMatches'
import { usePlayers } from '../hooks/usePlayers'
import { useClub } from '../contexts/ClubContext'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import StartingLineupModal, { type LineupEntry } from '../components/StartingLineupModal'
import WeatherPickerPopover, { getWeatherIcon, getWeatherLabel } from '../components/WeatherPickerPopover'
import { consumePendingTutorial } from '../components/MatchRecordingTutorial'
import SimpleScoringConfirmModal from '../components/SimpleScoringConfirmModal'

type Mode = 'choose' | 'post-match'

export default function MatchSetup() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const { data: match, isLoading: matchLoading } = useMatch(matchId ?? null)
  const { data: players = [] } = usePlayers()
  const { club } = useClub()
  const { user } = useAuth()

  const [mode, setMode] = useState<Mode>('choose')

  // Score state
  const [teamGoals, setTeamGoals] = useState(0)
  const [teamTwoPointers, setTeamTwoPointers] = useState(0)
  const [teamPoints, setTeamPoints] = useState(0)
  const [oppGoals, setOppGoals] = useState(0)
  const [oppTwoPointers, setOppTwoPointers] = useState(0)
  const [oppPoints, setOppPoints] = useState(0)

  // Strip colours — secondary (trim/hoop) is optional, many jerseys are one solid colour
  const [teamColour, setTeamColour] = useState('#10B981')
  const [teamTrimColour, setTeamTrimColour] = useState<string | null>(null)
  const [oppColour, setOppColour] = useState('#FFFFFF')
  const [oppTrimColour, setOppTrimColour] = useState<string | null>(null)

  // Lineup
  const [showLineupModal, setShowLineupModal] = useState(false)
  const [lineup, setLineup] = useState<Record<string, LineupEntry> | null>(null)
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, LineupEntry> | undefined>(undefined)

  // Weather
  const [weatherConditions, setWeatherConditions] = useState<string[]>([])
  const [temperature, setTemperature] = useState<number | null>(null)
  const [matchNotes, setMatchNotes] = useState<string | null>(null)
  const [showWeatherPicker, setShowWeatherPicker] = useState(false)

  // Submission
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Simple Scoring (tap-only, no tablet needed)
  const [showSimpleScoringConfirm, setShowSimpleScoringConfirm] = useState(false)

  // Default team colours from club
  useEffect(() => {
    if (club?.primary_colour) {
      setTeamColour(club.primary_colour)
    }
    if (club?.secondary_colour) {
      setTeamTrimColour(club.secondary_colour)
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
      // 1. Save strip colours + weather
      await api.matches.update(matchId, {
        team_strip_colour: teamColour,
        team_strip_secondary_colour: teamTrimColour,
        opponent_strip_colour: oppColour,
        opponent_strip_secondary_colour: oppTrimColour,
        weather_conditions: weatherConditions,
        temperature_celsius: temperature,
        notes: matchNotes,
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

  const handleUseSimpleScoring = async () => {
    if (!matchId) return
    try {
      await api.matches.update(matchId, { precise_tracking_enabled: false })
    } catch (err) {
      console.error('Failed to enable Simple Scoring:', err)
    }
    // Simple Scoring gets no tutorial for now — same navigate pattern as
    // "Record Live", just without the ?tutorial=1 query param.
    consumePendingTutorial()
    navigate(`/match/${matchId}`)
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
          {user?.trial_expired ? (
            <div className="glass-card p-8 text-center border border-amber-500/30 bg-amber-500/5">
              <div className="w-16 h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto mb-4">
                <Play size={32} className="text-amber-500/40" />
              </div>
              <h3 className="text-xl font-bold text-white/60 mb-2">Record Live</h3>
              <p className="text-amber-400/80 text-sm mb-4">Your free trial has ended.</p>
              <a
                href="mailto:owen@onestat.ai?subject=onestat.ai subscription"
                className="inline-block px-4 py-2 rounded-lg bg-amber-500 text-black text-sm font-bold hover:bg-amber-400 transition-colors"
              >
                Upgrade to continue recording
              </a>
            </div>
          ) : (
            <button
              onClick={() => {
                const withTutorial = consumePendingTutorial()
                navigate(withTutorial ? `/match/${matchId}?tutorial=1` : `/match/${matchId}`)
              }}
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
          )}

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

      {mode === 'choose' && !user?.trial_expired && (
        <div className="flex justify-center">
          <button
            onClick={() => setShowSimpleScoringConfirm(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/5 border border-white/10 text-white/50 hover:bg-white/10 hover:text-white/80 active:scale-95 text-xs font-medium transition-all"
          >
            <Smartphone size={13} />
            Recording without a tablet? Use simple scoring instead
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
              <ColourPicker
                label={clubName}
                colour={teamColour}
                onChange={setTeamColour}
                trimColour={teamTrimColour}
                onTrimChange={setTeamTrimColour}
              />
              <span className="text-white/20 text-sm">vs</span>
              <ColourPicker
                label={match.opponent}
                colour={oppColour}
                onChange={setOppColour}
                trimColour={oppTrimColour}
                onTrimChange={setOppTrimColour}
              />
            </div>
          </div>

          {/* Weather */}
          <div className="glass-card p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Weather</h3>
                <p className="text-white/40 text-sm mt-0.5">
                  {weatherConditions.length > 0 ? (
                    <span className="flex items-center gap-2 flex-wrap">
                      {weatherConditions.map(c => {
                        const Icon = getWeatherIcon(c)
                        return (
                          <span key={c} className="flex items-center gap-1">
                            <Icon size={14} /> {getWeatherLabel(c)}
                          </span>
                        )
                      })}
                      {temperature != null && <span>· {temperature}°C</span>}
                    </span>
                  ) : 'Optional — tap to set conditions'}
                </p>
                {matchNotes && (
                  <p className="text-white/30 text-xs mt-1 italic">"{matchNotes}"</p>
                )}
              </div>
              <button
                onClick={() => setShowWeatherPicker(true)}
                className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-sm transition-all"
              >
                {weatherConditions.length > 0 ? 'Change' : 'Set Weather'}
              </button>
            </div>
          </div>
          <WeatherPickerPopover
            isOpen={showWeatherPicker}
            onClose={() => setShowWeatherPicker(false)}
            onSave={(conditions, temp, notes) => {
              setWeatherConditions(conditions)
              setTemperature(temp)
              setMatchNotes(notes)
              setShowWeatherPicker(false)
            }}
            currentConditions={weatherConditions}
            currentTemperature={temperature}
            currentNotes={matchNotes}
          />

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

      {/* Simple Scoring confirmation */}
      <SimpleScoringConfirmModal
        isOpen={showSimpleScoringConfirm}
        onClose={() => setShowSimpleScoringConfirm(false)}
        onConfirm={handleUseSimpleScoring}
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
  onChange,
  trimColour,
  onTrimChange,
}: {
  label: string
  colour: string
  onChange: (c: string) => void
  /** Trim/hoop colour — optional, many jerseys are one solid colour so this can be unset. */
  trimColour?: string | null
  onTrimChange?: (c: string | null) => void
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-white/60 text-sm font-semibold truncate max-w-[100px]">{label}</span>
      <div className="flex items-end gap-3">
        {/* Primary colour */}
        <div className="flex flex-col items-center gap-1">
          <label className="relative cursor-pointer group">
            <div
              className="w-12 h-12 rounded-full border-[3px] group-hover:brightness-110 transition-all shadow-lg"
              style={{ backgroundColor: colour, borderColor: 'rgba(255,255,255,0.25)' }}
            />
            <input
              type="color"
              value={colour}
              onChange={e => onChange(e.target.value)}
              className="absolute inset-0 opacity-0 cursor-pointer"
            />
          </label>
          <span className="text-white/30 text-[10px] font-mono">{colour}</span>
        </div>

        {/* Trim colour — optional, shown as a small "+" until set */}
        {onTrimChange && (
          <div className="flex flex-col items-center gap-1">
            {trimColour ? (
              <label className="relative cursor-pointer group">
                <div
                  className="w-8 h-8 rounded-full border-2 group-hover:brightness-110 transition-all shadow-lg"
                  style={{ backgroundColor: trimColour, borderColor: 'rgba(255,255,255,0.25)' }}
                />
                <input
                  type="color"
                  value={trimColour}
                  onChange={e => onTrimChange(e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <button
                  type="button"
                  onClick={(e) => { e.preventDefault(); onTrimChange(null) }}
                  title="Remove trim colour"
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-800 border border-white/20 text-white/50 hover:text-white hover:bg-slate-700 flex items-center justify-center text-[9px] leading-none"
                >
                  ×
                </button>
              </label>
            ) : (
              <button
                type="button"
                onClick={() => onTrimChange('#FFFFFF')}
                title="Add a trim/hoop colour"
                className="w-8 h-8 rounded-full border-2 border-dashed border-white/25 hover:border-white/50 text-white/30 hover:text-white/60 flex items-center justify-center text-sm transition-colors"
              >
                +
              </button>
            )}
            <span className="text-white/20 text-[10px]">Trim</span>
          </div>
        )}
      </div>
    </div>
  )
}
