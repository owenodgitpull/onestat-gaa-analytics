import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, MapPin, Trophy, User, Swords, ClipboardList, ClipboardCheck, Pencil, Users, ChevronDown, ChevronUp, Flag, GraduationCap } from 'lucide-react'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import EditFixtureModal from '../components/EditFixtureModal'
import { hasPendingTutorial } from '../components/MatchRecordingTutorial'
import type { Match, FormResult } from '../types'

function FormBadge({ result }: { result: 'W' | 'L' | 'D' }) {
  const colors = {
    W: 'bg-emerald-500 text-white',
    L: 'bg-red-500 text-white',
    D: 'bg-amber-500 text-white',
  }
  return (
    <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 ${colors[result]}`}>
      {result}
    </span>
  )
}

function FormRow({ results }: { results: FormResult[] }) {
  if (results.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-white/30 text-sm">No recent results</p>
      </div>
    )
  }

  // Badge sits in the same row as the match it belongs to (left-most, before
  // the date) — a separate badge row above the list left it ambiguous which
  // badge lined up with which row, especially once row counts didn't match
  // (e.g. only 2 results loaded so far vs 5 badges).
  return (
    <div className="space-y-1.5">
      {results.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded bg-white/[0.03]">
          <FormBadge result={r.result} />
          <span className="text-white/40 flex-shrink-0">{format(new Date(r.date), 'd MMM')}</span>
          <span className="text-white/70 truncate mx-2 flex-1 text-center">{r.opponent_faced}</span>
          <span className="text-white/60 font-mono flex-shrink-0">{r.score_for} - {r.score_against}</span>
        </div>
      ))}
    </div>
  )
}

export default function FixturePreview() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [editingFixture, setEditingFixture] = useState<Match | null>(null)
  const [rosterExpanded, setRosterExpanded] = useState(false)
  const [rosterInput, setRosterInput] = useState('')
  const [rosterSaving, setRosterSaving] = useState(false)
  const [rosterSaved, setRosterSaved] = useState(false)
  const [rosterLoaded, setRosterLoaded] = useState(false)

  // AI opponent form state
  type FormState = 'idle' | 'loading' | 'loaded' | 'dismissed'
  const [aiFormState, setAiFormState] = useState<FormState>('idle')
  const [aiFormResults, setAiFormResults] = useState<FormResult[]>([])
  const formInitRef = useRef<string | null>(null)

  const handleEditFixture = async (id: string, data: any) => {
    await api.matches.update(id, data)
    queryClient.invalidateQueries({ queryKey: ['fixture-preview', matchId] })
    queryClient.invalidateQueries({ queryKey: ['fixtures'] })
  }

  const handleDeleteFixture = async (id: string) => {
    await api.matches.delete(id)
    queryClient.invalidateQueries({ queryKey: ['fixtures'] })
    navigate('/fixtures')
  }

  const { data, isLoading, error } = useQuery({
    queryKey: ['fixture-preview', matchId],
    queryFn: () => api.fixtures.getPreview(matchId!),
    enabled: !!matchId,
  })

  useEffect(() => {
    if (!data || formInitRef.current === data.match.id) return
    formInitRef.current = data.match.id
    const { ai_opponent_form, club_county } = data as any
    if (ai_opponent_form?.dismissed) {
      setAiFormState('dismissed')
    } else if (ai_opponent_form?.results?.length) {
      setAiFormResults(ai_opponent_form.results)
      setAiFormState('loaded')
    } else if (club_county) {
      setAiFormState('loading')
      api.fixtures.fetchOpponentForm(data.match.id)
        .then(res => {
          setAiFormResults((res as any).results || [])
          setAiFormState('loaded')
        })
        .catch(() => setAiFormState('idle'))
    }
    // else no county set — stay idle
  }, [data])

  const handleDismissForm = async () => {
    try { await api.fixtures.dismissOpponentForm(matchId!) } catch {}
    setAiFormState('dismissed')
  }

  const handleRetryForm = async () => {
    setAiFormState('loading')
    try {
      const res = await api.fixtures.fetchOpponentForm(matchId!, true)
      setAiFormResults((res as any).results || [])
      setAiFormState('loaded')
    } catch {
      setAiFormState('idle')
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="glass-card p-8 text-center mx-auto max-w-md mt-12">
        <p className="text-red-400 text-lg font-semibold mb-2">Failed to load fixture</p>
        <p className="text-white/40 text-sm mb-4">The fixture preview could not be loaded. It may have been deleted or the data is unavailable.</p>
        <button onClick={() => navigate('/fixtures')} className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-cyan-400 text-sm font-medium transition-colors">
          Back to Fixtures
        </button>
      </div>
    )
  }

  const { match, our_form, last_meeting, has_events } = data

  // If match is already completed, redirect to the result page
  if (match.status === 'completed') {
    navigate(`/results/${match.id}`, { replace: true })
    return null
  }

  const matchDate = new Date(match.match_date)
  const isPastScheduled = match.status === 'scheduled' && matchDate < new Date()
  const tutorialPending = hasPendingTutorial()

  const venueBadge = (venue: string) => {
    const v = venue?.toLowerCase()
    if (v === 'home') return <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">HOME</span>
    if (v === 'away') return <span className="px-2 py-0.5 text-xs font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30">AWAY</span>
    return <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">NEUTRAL</span>
  }

  return (
    <div className="space-y-6">
      {/* Tutorial pending banner */}
      {tutorialPending && canEdit && (
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-purple-500/10 border border-purple-500/30">
          <div className="flex items-center gap-2.5">
            <GraduationCap size={16} className="text-purple-400 flex-shrink-0" />
            <span className="text-sm text-purple-300 font-medium">Tutorial mode ready</span>
            <span className="text-xs text-white/40 hidden sm:inline">— this match will be used for the interactive walkthrough</span>
          </div>
          <button
            onClick={() => navigate(`/match/${match.id}/setup`)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-purple-500/30 border border-purple-400/40 text-purple-200 text-xs font-semibold hover:bg-purple-500/50 transition-colors"
          >
            Start Tutorial
          </button>
        </div>
      )}

      {/* Back + Header */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => navigate('/fixtures')}
            className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
            Back to Fixtures
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRosterExpanded(true)
                if (!rosterLoaded && matchId) {
                  api.matchPrep.getOppositionRoster(matchId)
                    .then(r => { if (r.players?.length) setRosterInput(r.players.join('\n')); setRosterLoaded(true) })
                    .catch(() => setRosterLoaded(true))
                }
                setTimeout(() => document.getElementById('opposition-roster')?.scrollIntoView({ behavior: 'smooth' }), 100)
              }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium text-orange-300 hover:text-orange-200 transition-all bg-orange-500/10 border border-orange-500/20 hover:bg-orange-500/15"
            >
              <Users size={14} />
              Opposition Players
            </button>
            {match.status === 'scheduled' && canEdit && (
              <button
                onClick={() => navigate(`/match-prep/${match.id}`)}
                className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium text-cyan-300 hover:text-cyan-200 transition-all bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/15"
              >
                <ClipboardCheck size={14} />
                Match Prep
              </button>
            )}
            {isPastScheduled && canEdit && (
              <button
                onClick={() => navigate(`/match/${match.id}/setup`)}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: 'linear-gradient(135deg, rgba(0,230,118,0.2), rgba(0,176,255,0.15))',
                  border: '1px solid rgba(0,176,255,0.3)',
                  boxShadow: '0 4px 16px rgba(0,230,118,0.1)',
                }}
              >
                <ClipboardList size={16} />
                {has_events ? 'View Match Data' : 'Log Match Events'}
              </button>
            )}
          </div>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{match.opponent}</h1>
              <p className="text-white/50 text-sm mt-1">
                {format(matchDate, 'EEEE d MMMM yyyy')} at {format(matchDate, 'HH:mm')}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {venueBadge(match.venue)}
              {match.status === 'scheduled' && (
                <button
                  onClick={() => setEditingFixture(match as unknown as Match)}
                  className="p-2 rounded-lg bg-white/5 hover:bg-white/15 text-white/40 hover:text-white transition-all"
                  title="Edit fixture"
                >
                  <Pencil size={15} />
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-white/50">
            {match.competition && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Trophy size={12} />
                {match.competition}{match.stage ? ` · ${match.stage}` : ''}
              </div>
            )}
            {match.referee && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.06] border border-white/10">
                <User size={12} />
                {match.referee}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Form Comparison */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <h3 className="text-sm font-semibold text-white">Our Form</h3>
          </div>
          <FormRow results={our_form} />
        </div>

        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-2 h-2 rounded-full bg-red-400" />
            <h3 className="text-sm font-semibold text-white">Opponent Form</h3>
            {aiFormState === 'loading' && (
              <div className="ml-auto w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
            )}
          </div>

          {aiFormState === 'loading' && (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm">Searching for recent results...</p>
            </div>
          )}

          {aiFormState === 'loaded' && aiFormResults.length > 0 && (
            <>
              <FormRow results={aiFormResults} />
              <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
                <p className="text-xs text-white/25">AI-powered · web search</p>
                <button
                  onClick={handleDismissForm}
                  className="flex items-center gap-1 text-xs text-white/30 hover:text-red-400 transition-colors"
                >
                  <Flag size={11} />
                  Data incorrect?
                </button>
              </div>
            </>
          )}

          {aiFormState === 'loaded' && aiFormResults.length === 0 && (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm mb-2">No results found online</p>
              <button
                onClick={handleRetryForm}
                className="text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors underline"
              >
                Retry search
              </button>
            </div>
          )}

          {aiFormState === 'dismissed' && (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm">Results hidden</p>
              <p className="text-white/20 text-xs mt-1 mb-3">Thanks for the feedback</p>
              <button
                onClick={handleRetryForm}
                className="text-xs text-cyan-400/60 hover:text-cyan-400 transition-colors underline"
              >
                Try fresh search
              </button>
            </div>
          )}

          {aiFormState === 'idle' && !(data as any)?.club_county && (
            <div className="text-center py-6">
              <p className="text-white/40 text-sm mb-2">County not configured</p>
              <p className="text-white/25 text-xs mb-3">Set your county in Club Settings to pull opponent results automatically</p>
              <button
                onClick={() => navigate('/settings')}
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors underline"
              >
                Go to Settings
              </button>
            </div>
          )}

          {aiFormState === 'idle' && (data as any)?.club_county && (
            <div className="text-center py-6">
              <p className="text-white/30 text-sm">No results found</p>
            </div>
          )}
        </div>
      </div>

      {/* Last Meeting */}
      <div className="glass-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Swords size={16} className="text-cyan-400" />
          <h3 className="text-sm font-semibold text-white">Last Meeting</h3>
        </div>

        {last_meeting ? (
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-xs text-white/40 mb-1">Dungloe</p>
              <p className="text-2xl font-bold text-white font-mono">{last_meeting.our_score}</p>
            </div>
            <div className="px-4">
              <FormBadge result={last_meeting.result} />
              <p className="text-[10px] text-white/30 text-center mt-1">
                {format(new Date(last_meeting.date), 'd MMM yy')}
              </p>
            </div>
            <div className="text-center flex-1">
              <p className="text-xs text-white/40 mb-1">{match.opponent}</p>
              <p className="text-2xl font-bold text-white font-mono">{last_meeting.their_score}</p>
            </div>
          </div>
        ) : (
          <div className="text-center py-4">
            <p className="text-white/30 text-sm">No previous meetings found</p>
            <p className="text-white/20 text-xs mt-1">Sync fixtures to populate opponent data</p>
          </div>
        )}

        {last_meeting?.venue && (
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-4 text-xs text-white/40">
            <div className="flex items-center gap-1">
              <MapPin size={12} />
              {last_meeting.venue}
            </div>
            {last_meeting.competition && (
              <div className="flex items-center gap-1">
                <Trophy size={12} />
                {last_meeting.competition}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Match Details Card */}
      <div className="glass-card p-5">
        <h3 className="text-sm font-semibold text-white mb-3">Match Details</h3>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-white/40 text-xs mb-0.5">Date & Time</p>
            <p className="text-white/80">{format(matchDate, 'EEE d MMM yyyy, HH:mm')}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs mb-0.5">Venue</p>
            <p className="text-white/80 capitalize">{match.venue}</p>
          </div>
          {match.competition && (
            <div>
              <p className="text-white/40 text-xs mb-0.5">Competition</p>
              <p className="text-white/80">{match.competition}{match.stage ? ` · ${match.stage}` : ''}</p>
            </div>
          )}
          {match.referee && (
            <div>
              <p className="text-white/40 text-xs mb-0.5">Referee</p>
              <p className="text-white/80">{match.referee}</p>
            </div>
          )}
        </div>
      </div>

      {/* Opposition Key Players */}
      <div id="opposition-roster" className="glass-card overflow-hidden">
        <button
          onClick={async () => {
            setRosterExpanded(prev => !prev)
            if (!rosterLoaded && matchId) {
              try {
                const result = await api.matchPrep.getOppositionRoster(matchId)
                if (result.players?.length) setRosterInput(result.players.join('\n'))
                setRosterLoaded(true)
              } catch { setRosterLoaded(true) }
            }
          }}
          className="flex items-center justify-between w-full px-4 py-3 hover:bg-white/5 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users size={16} className="text-orange-400" />
            <span className="text-sm font-bold text-white">Opposition Key Players</span>
          </div>
          {rosterExpanded ? <ChevronUp size={16} className="text-white/40" /> : <ChevronDown size={16} className="text-white/40" />}
        </button>
        {rosterExpanded && (
          <div className="px-4 pb-4 space-y-3">
            <p className="text-xs text-white/40">
              Enter key opposition players by surname only — one per line (we keep this to the minimum needed to tag them pitchside, not a full name). These will appear for quick selection when recording opponent scores or tagging who we forced a turnover from.
            </p>
            <textarea
              value={rosterInput}
              onChange={(e) => setRosterInput(e.target.value)}
              placeholder={"Enter one surname per line, e.g.:\nCox\nMurtagh"}
              rows={5}
              className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-orange-500/40 resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-white/30">
                {rosterInput.split('\n').filter(l => l.trim()).length} players
              </span>
              <button
                onClick={async () => {
                  const names = rosterInput.split('\n').map(n => n.trim()).filter(Boolean)
                  setRosterSaving(true)
                  try {
                    await api.matchPrep.saveOppositionRoster(matchId!, names)
                    setRosterSaved(true)
                    setTimeout(() => setRosterSaved(false), 3000)
                  } catch (err) {
                    console.error('Failed to save roster:', err)
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
                {rosterSaving ? 'Saving...' : rosterSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </div>

      <EditFixtureModal
        fixture={editingFixture}
        onClose={() => setEditingFixture(null)}
        onSave={handleEditFixture}
        onDelete={handleDeleteFixture}
      />
    </div>
  )
}
