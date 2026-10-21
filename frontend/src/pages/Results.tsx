/**
 * Results Page
 * Shows list of completed matches with search, filters, and lazy loading
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Trophy, Calendar, MapPin, ChevronRight, RefreshCw,
  Activity, Video, ClipboardList, Search, X, ChevronDown,
  Filter, MoreHorizontal, Trash2, Loader2,
} from 'lucide-react'
import { useMatches } from '../hooks/useMatches'
import { useClubName } from '../contexts/ClubContext'
import { useAuth } from '../contexts/AuthContext'
import LoadingSkeleton from '../components/LoadingSkeleton'
import { api } from '../services/api'
import type { Match } from '../types'

const PAGE_SIZE = 12

// Format GAA score as "G-PP" (e.g., "1-08")
function formatGAAScore(goals: number, points: number): string {
  return `${goals}-${String(points).padStart(2, '0')}`
}

// Calculate total score
function totalScore(goals: number, points: number): number {
  return goals * 3 + points
}

// Get result type
function getResultType(match: Match): 'W' | 'L' | 'D' {
  const teamTotal = totalScore(match.team_goals, match.team_points)
  const oppTotal = totalScore(match.opponent_goals, match.opponent_points)
  if (teamTotal > oppTotal) return 'W'
  if (teamTotal < oppTotal) return 'L'
  return 'D'
}

// Get result badge styling
function getResultBadge(result: 'W' | 'L' | 'D') {
  switch (result) {
    case 'W': return { label: 'W', class: 'bg-emerald-500/20 text-emerald-400' }
    case 'L': return { label: 'L', class: 'bg-red-500/20 text-red-400' }
    case 'D': return { label: 'D', class: 'bg-amber-500/20 text-amber-400' }
  }
}

function DataBadge({ icon: Icon, label, color }: { icon: typeof Activity; label: string; color: string }) {
  const [showTooltip, setShowTooltip] = useState(false)

  return (
    <span
      className="relative"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setShowTooltip((v) => !v)
      }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <Icon size={14} className={color} />
      {showTooltip && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-[10px] rounded bg-black/90 text-white whitespace-nowrap z-10">
          {label}
        </span>
      )}
    </span>
  )
}

/** Permanent delete, guarded: the button stays disabled until "delete match" is typed. */
function DeleteMatchModal({ match, onClose, onDeleted }: { match: Match; onClose: () => void; onDeleted: () => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = typed.trim().toLowerCase() === 'delete match'

  const confirm = async () => {
    if (!ok || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.matches.delete(match.id)
      onDeleted()
    } catch (e: any) {
      setError(e?.message || 'Could not delete the match. Please try again.')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md glass-card p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 rounded-full bg-red-500/20"><Trash2 size={18} className="text-red-400" /></div>
          <h2 className="text-lg font-bold text-white">Delete this match?</h2>
        </div>
        <p className="text-sm text-white/70 mb-1">
          <span className="font-semibold text-white">vs {match.opponent}</span> · {new Date(match.match_date).toLocaleDateString()}
        </p>
        <p className="text-sm text-white/60 mb-4">
          This permanently deletes the match and everything attached to it: events, possession, lineup, GPS and video
          tagging. It cannot be undone.
        </p>
        <label className="block text-xs font-semibold text-white/70 mb-1.5">
          Type <span className="font-mono text-red-300">delete match</span> to confirm
        </label>
        <input
          autoFocus
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') confirm() }}
          placeholder="delete match"
          className="w-full bg-white/10 border border-white/20 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500/60"
        />
        {error && <p className="text-xs text-red-300 mt-2">{error}</p>}
        <div className="flex gap-3 mt-5">
          <button
            onClick={onClose}
            disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-xl bg-white/10 text-white/80 hover:text-white text-sm font-semibold transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={confirm}
            disabled={!ok || busy}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy && <Loader2 size={14} className="animate-spin" />}
            Delete match
          </button>
        </div>
      </div>
    </div>
  )
}

type ResultFilter = 'all' | 'W' | 'L' | 'D'
type VenueFilter = 'all' | 'home' | 'away' | 'neutral'

export default function Results() {
  const { data: matches, isLoading, error, refetch } = useMatches()
  const clubName = useClubName()
  const navigate = useNavigate()
  const { canEdit } = useAuth()
  const queryClient = useQueryClient()
  const [menuFor, setMenuFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Match | null>(null)

  // Same "next match → prep" quick-access shown on the Dashboard — added here
  // too since Matches (this page) is where a coach naturally lands after
  // reviewing results and looking to plan ahead for the next fixture.
  const [nextMatch, setNextMatch] = useState<Match | null>(null)
  const [liveMatch, setLiveMatch] = useState<Match | null>(null)
  useEffect(() => {
    api.matches.getInProgress().then(setLiveMatch).catch(() => {})
    api.matches.getNextScheduled().then(setNextMatch).catch(() => {})
  }, [])

  const [search, setSearch] = useState('')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [venueFilter, setVenueFilter] = useState<VenueFilter>('all')
  const [competitionFilter, setCompetitionFilter] = useState<string>('all')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [showFilters, setShowFilters] = useState(false)

  // All completed matches sorted by date desc
  const completedMatches = useMemo(() => {
    const completed = matches?.filter((m) => m.status === 'completed') || []
    return completed.sort(
      (a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
    )
  }, [matches])

  // Unique competitions for filter dropdown
  const competitions = useMemo(() => {
    const comps = new Set<string>()
    completedMatches.forEach((m) => {
      if (m.competition) comps.add(m.competition)
    })
    return Array.from(comps).sort()
  }, [completedMatches])

  // Apply search + filters
  const filteredMatches = useMemo(() => {
    let result = completedMatches

    // Search by opponent name
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      result = result.filter((m) => m.opponent.toLowerCase().includes(q))
    }

    // Result filter
    if (resultFilter !== 'all') {
      result = result.filter((m) => getResultType(m) === resultFilter)
    }

    // Venue filter
    if (venueFilter !== 'all') {
      result = result.filter((m) => m.venue === venueFilter)
    }

    // Competition filter
    if (competitionFilter !== 'all') {
      result = result.filter((m) => m.competition === competitionFilter)
    }

    return result
  }, [completedMatches, search, resultFilter, venueFilter, competitionFilter])

  // Lazy-loaded slice
  const visibleMatches = filteredMatches.slice(0, visibleCount)
  const hasMore = visibleCount < filteredMatches.length

  const loadMore = useCallback(() => {
    setVisibleCount((prev) => prev + PAGE_SIZE)
  }, [])

  // Reset visible count when filters change
  const activeFilterCount = [
    resultFilter !== 'all',
    venueFilter !== 'all',
    competitionFilter !== 'all',
  ].filter(Boolean).length

  const clearFilters = () => {
    setSearch('')
    setResultFilter('all')
    setVenueFilter('all')
    setCompetitionFilter('all')
    setVisibleCount(PAGE_SIZE)
  }

  if (isLoading) {
    return <LoadingSkeleton variant="list" />
  }

  if (error) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">Failed to load results</p>
        <button onClick={() => refetch()} className="btn-glass">
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
            <Trophy size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Match Results</h1>
            <p className="text-white/60 text-sm">
              {completedMatches.length} completed match{completedMatches.length !== 1 ? 'es' : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {liveMatch ? (
            <div
              onClick={() => navigate(`/match/${liveMatch.id}`)}
              className="glass-card-live cursor-pointer"
            >
              <div className="glass-card-live-inner px-4 py-2 flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Live</span>
                </div>
                <span className="text-sm font-bold text-white whitespace-nowrap">vs {liveMatch.opponent}</span>
                <ChevronRight size={16} className="text-white/40" />
              </div>
            </div>
          ) : nextMatch ? (
            <div
              onClick={() => navigate(`/match-prep/${nextMatch.id}`)}
              className="bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 rounded-xl px-4 py-2 cursor-pointer hover:from-emerald-600/30 hover:to-cyan-600/30 border border-emerald-500/30 hover:border-emerald-500/50 transition-all flex items-center gap-2 group"
            >
              <Calendar size={14} className="text-emerald-400 flex-shrink-0" />
              <span className="text-xs text-emerald-400/80 font-semibold uppercase tracking-wide">Next</span>
              <span className="text-sm font-bold text-white whitespace-nowrap">
                {nextMatch.opponent} ({nextMatch.venue === 'home' ? 'H' : nextMatch.venue === 'away' ? 'A' : 'N'})
              </span>
              <ChevronRight size={16} className="text-emerald-400/60 group-hover:text-emerald-400 group-hover:translate-x-0.5 transition-all" />
            </div>
          ) : null}
          <button onClick={() => refetch()} className="btn-glass p-2" title="Refresh">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Search + Filter Bar */}
      {completedMatches.length > 0 && (
        <div className="space-y-3">
          {/* Search Row */}
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisibleCount(PAGE_SIZE) }}
                placeholder="Search opponent..."
                className="w-full pl-9 pr-8 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-all"
              />
              {search && (
                <button
                  onClick={() => { setSearch(''); setVisibleCount(PAGE_SIZE) }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                showFilters || activeFilterCount > 0
                  ? 'bg-orange-600/20 text-orange-400 border border-orange-500/30'
                  : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
              }`}
            >
              <Filter size={14} />
              {activeFilterCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-orange-500 text-black text-[10px] font-bold flex items-center justify-center">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </div>

          {/* Filter Row */}
          {showFilters && (
            <div className="flex flex-wrap gap-2 items-center">
              {/* Result Filter */}
              <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                {(['all', 'W', 'L', 'D'] as const).map((r) => (
                  <button
                    key={r}
                    onClick={() => { setResultFilter(r); setVisibleCount(PAGE_SIZE) }}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      resultFilter === r
                        ? r === 'W' ? 'bg-emerald-500/30 text-emerald-400'
                          : r === 'L' ? 'bg-red-500/30 text-red-400'
                          : r === 'D' ? 'bg-amber-500/30 text-amber-400'
                          : 'bg-white/20 text-white'
                        : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {r === 'all' ? 'All' : r === 'W' ? 'Wins' : r === 'L' ? 'Losses' : 'Draws'}
                  </button>
                ))}
              </div>

              {/* Venue Filter */}
              <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
                {(['all', 'home', 'away'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => { setVenueFilter(v); setVisibleCount(PAGE_SIZE) }}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all ${
                      venueFilter === v ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'
                    }`}
                  >
                    {v === 'all' ? 'All venues' : v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>

              {/* Competition Filter */}
              {competitions.length > 0 && (
                <select
                  value={competitionFilter}
                  onChange={(e) => { setCompetitionFilter(e.target.value); setVisibleCount(PAGE_SIZE) }}
                  className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 text-xs focus:outline-none focus:border-white/30 appearance-none cursor-pointer"
                  style={{ backgroundImage: 'none' }}
                >
                  <option value="all" className="bg-slate-800">All competitions</option>
                  {competitions.map((c) => (
                    <option key={c} value={c} className="bg-slate-800">{c}</option>
                  ))}
                </select>
              )}

              {/* Clear Filters */}
              {activeFilterCount > 0 && (
                <button
                  onClick={clearFilters}
                  className="px-2.5 py-1.5 rounded-lg text-xs text-white/50 hover:text-white/80 transition-all"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

          {/* Results count when filtered */}
          {(search || activeFilterCount > 0) && (
            <p className="text-white/40 text-xs">
              {filteredMatches.length} match{filteredMatches.length !== 1 ? 'es' : ''} found
              {search && <> matching "{search}"</>}
            </p>
          )}
        </div>
      )}

      {/* Match Cards Grid */}
      {completedMatches.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trophy size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Results Yet</h3>
          <p className="text-white/60">
            Complete a match to see results here
          </p>
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <Search size={32} className="mx-auto text-white/20 mb-3" />
          <p className="text-white/60 text-sm">No matches found</p>
          <button onClick={clearFilters} className="mt-3 text-orange-400 text-sm hover:text-orange-300 transition-colors">
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleMatches.map((match) => {
              const result = getResultBadge(getResultType(match))
              const teamTotal = totalScore(match.team_goals, match.team_points)
              const oppTotal = totalScore(match.opponent_goals, match.opponent_points)
              const hasAnyData = match.has_gps || match.has_video || match.has_events

              return (
                <Link
                  key={match.id}
                  to={match.video_tagging_in_progress ? `/results/${match.id}/video` : `/results/${match.id}`}
                  className="glass-card p-5 hover:bg-white/10 transition-all group relative"
                >
                  {/* Result Badge & Opponent */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <span className={`inline-block px-2 py-1 rounded text-xs font-bold mb-2 ${result.class}`}>
                        {result.label}
                      </span>
                      <h3 className="text-lg font-bold text-white">vs {match.opponent}</h3>
                    </div>
                    <div className="flex items-center gap-1">
                      {canEdit && (
                        <div className="relative">
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuFor(menuFor === match.id ? null : match.id) }}
                            className="p-1.5 rounded-lg text-white/40 hover:text-white hover:bg-white/10 transition-colors"
                            aria-label="Match options"
                            title="Options"
                          >
                            <MoreHorizontal size={18} />
                          </button>
                          {menuFor === match.id && (
                            <>
                              <div
                                className="fixed inset-0 z-30"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuFor(null) }}
                              />
                              <div className="absolute right-0 top-full mt-1 z-40 min-w-[150px] rounded-xl bg-slate-900 border border-white/15 shadow-xl py-1">
                                <button
                                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setMenuFor(null); setDeleting(match) }}
                                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-300 hover:bg-red-500/15 transition-colors"
                                >
                                  <Trash2 size={14} /> Delete match
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      )}
                      <ChevronRight
                        size={20}
                        className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all"
                      />
                    </div>
                  </div>

                  {/* Score */}
                  <div className="flex items-center justify-center space-x-4 py-4 mb-4 bg-white/5 rounded-xl">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">
                        {formatGAAScore(match.team_goals, match.team_points)}
                      </div>
                      <div className="text-xs text-white/60">{clubName}</div>
                      <div className="text-xs text-white/40">({teamTotal} pts)</div>
                    </div>
                    <div className="text-white/40">-</div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white/80">
                        {formatGAAScore(match.opponent_goals, match.opponent_points)}
                      </div>
                      <div className="text-xs text-white/60">{match.opponent}</div>
                      <div className="text-xs text-white/40">({oppTotal} pts)</div>
                    </div>
                  </div>

                  {/* Match Info */}
                  <div className="flex items-center justify-between text-sm text-white/50">
                    <div className="flex items-center space-x-1">
                      <Calendar size={14} />
                      <span>{new Date(match.match_date).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center space-x-3">
                      {hasAnyData && (
                        <div className="flex items-center space-x-1.5">
                          {match.has_gps && <DataBadge icon={Activity} label="GPS data" color="text-emerald-400" />}
                          {match.has_video && <DataBadge icon={Video} label="Video analysis" color="text-purple-400" />}
                          {match.has_events && <DataBadge icon={ClipboardList} label="Match events" color="text-blue-400" />}
                        </div>
                      )}
                      <div className="flex items-center space-x-1">
                        <MapPin size={14} />
                        <span className="capitalize">{match.venue}</span>
                      </div>
                    </div>
                  </div>

                  {/* Competition tag */}
                  {match.competition && (
                    <div className="mt-3 pt-3 border-t border-white/5">
                      <span className="text-[10px] text-white/40 bg-white/5 px-2 py-0.5 rounded">
                        {match.competition}{match.stage ? ` · ${match.stage}` : ''}
                      </span>
                    </div>
                  )}
                </Link>
              )
            })}
          </div>

          {deleting && (
            <DeleteMatchModal
              match={deleting}
              onClose={() => setDeleting(null)}
              onDeleted={() => {
                setDeleting(null)
                queryClient.invalidateQueries({ queryKey: ['matches'] })
                queryClient.invalidateQueries({ queryKey: ['fixtures'] })
              }}
            />
          )}

          {/* Load More */}
          {hasMore && (
            <div className="flex justify-center pt-2">
              <button
                onClick={loadMore}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white/70 text-sm font-medium hover:bg-white/10 hover:text-white transition-all"
              >
                <ChevronDown size={16} />
                Show more ({filteredMatches.length - visibleCount} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
