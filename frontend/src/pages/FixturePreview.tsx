import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { ArrowLeft, MapPin, Trophy, User, Swords, ClipboardList } from 'lucide-react'
import { api } from '../services/api'
import type { FormResult } from '../types'

function FormBadge({ result }: { result: 'W' | 'L' | 'D' }) {
  const colors = {
    W: 'bg-emerald-500 text-white',
    L: 'bg-red-500 text-white',
    D: 'bg-amber-500 text-white',
  }
  return (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${colors[result]}`}>
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

  return (
    <div>
      {/* Form badges */}
      <div className="flex items-center gap-2 mb-3 justify-center">
        {results.map((r, i) => (
          <FormBadge key={i} result={r.result} />
        ))}
      </div>
      {/* Detail list */}
      <div className="space-y-1.5">
        {results.map((r, i) => (
          <div key={i} className="flex items-center justify-between text-xs px-2 py-1.5 rounded bg-white/[0.03]">
            <span className="text-white/40">{format(new Date(r.date), 'd MMM')}</span>
            <span className="text-white/70 truncate mx-2 flex-1 text-center">{r.opponent_faced}</span>
            <span className="text-white/60 font-mono">{r.score_for} - {r.score_against}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function FixturePreview() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()

  const { data, isLoading, error } = useQuery({
    queryKey: ['fixture-preview', matchId],
    queryFn: () => api.fixtures.getPreview(matchId!),
    enabled: !!matchId,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="text-center py-20">
        <p className="text-red-400">Failed to load fixture preview</p>
        <button onClick={() => navigate('/fixtures')} className="text-cyan-400 text-sm mt-2 hover:underline">
          Back to Fixtures
        </button>
      </div>
    )
  }

  const { match, our_form, opponent_form, last_meeting } = data
  const matchDate = new Date(match.match_date)
  const isPastScheduled = match.status === 'scheduled' && matchDate < new Date()

  const venueBadge = (venue: string) => {
    const v = venue?.toLowerCase()
    if (v === 'home') return <span className="px-2 py-0.5 text-xs font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">HOME</span>
    if (v === 'away') return <span className="px-2 py-0.5 text-xs font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30">AWAY</span>
    return <span className="px-2 py-0.5 text-xs font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">NEUTRAL</span>
  }

  return (
    <div className="space-y-6">
      {/* Back + Header */}
      <div>
        <button
          onClick={() => navigate('/fixtures')}
          className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white transition-colors mb-4"
        >
          <ArrowLeft size={16} />
          Back to Fixtures
        </button>

        <div className="glass-card p-6">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h1 className="text-2xl font-bold text-white">{match.opponent}</h1>
              <p className="text-white/50 text-sm mt-1">
                {format(matchDate, 'EEEE d MMMM yyyy')} at {format(matchDate, 'HH:mm')}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {venueBadge(match.venue)}
              {isPastScheduled && (
                <button
                  onClick={() => navigate(`/match/${match.id}/setup`)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                >
                  <ClipboardList size={13} />
                  Log Events
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-3 text-xs text-white/50">
            {match.competition && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Trophy size={12} />
                {match.competition}
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
          </div>
          <FormRow results={opponent_form} />
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
              <p className="text-white/80">{match.competition}</p>
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
    </div>
  )
}
