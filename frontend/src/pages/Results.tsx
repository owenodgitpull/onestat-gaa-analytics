/**
 * Results Page
 * Shows list of completed matches with glassmorphism styling
 */

import { Link } from 'react-router-dom'
import { Trophy, Calendar, MapPin, ChevronRight, RefreshCw } from 'lucide-react'
import { useMatches } from '../hooks/useMatches'
import LoadingSkeleton from '../components/LoadingSkeleton'
import type { Match } from '../types'

// Format GAA score as "G-PP" (e.g., "1-08")
function formatGAAScore(goals: number, points: number): string {
  return `${goals}-${String(points).padStart(2, '0')}`
}

// Calculate total score
function totalScore(goals: number, points: number): number {
  return goals * 3 + points
}

// Get result badge
function getResult(match: Match): { label: string; class: string } {
  const teamTotal = totalScore(match.team_goals, match.team_points)
  const oppTotal = totalScore(match.opponent_goals, match.opponent_points)

  if (teamTotal > oppTotal) {
    return { label: 'W', class: 'bg-emerald-500/20 text-emerald-400' }
  } else if (teamTotal < oppTotal) {
    return { label: 'L', class: 'bg-red-500/20 text-red-400' }
  }
  return { label: 'D', class: 'bg-amber-500/20 text-amber-400' }
}

export default function Results() {
  const { data: matches, isLoading, error, refetch } = useMatches()

  // Filter to completed matches only
  const completedMatches = matches?.filter((m) => m.status === 'completed') || []

  // Sort by date descending (most recent first)
  const sortedMatches = [...completedMatches].sort(
    (a, b) => new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
  )

  if (isLoading) {
    return <LoadingSkeleton />
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
    <div className="space-y-6">
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
        <button onClick={() => refetch()} className="btn-glass p-2" title="Refresh">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Match Cards Grid */}
      {sortedMatches.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <Trophy size={48} className="mx-auto text-white/20 mb-4" />
          <h3 className="text-xl font-semibold text-white mb-2">No Results Yet</h3>
          <p className="text-white/60">
            Complete a match to see results here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedMatches.map((match) => {
            const result = getResult(match)
            const teamTotal = totalScore(match.team_goals, match.team_points)
            const oppTotal = totalScore(match.opponent_goals, match.opponent_points)

            return (
              <Link
                key={match.id}
                to={`/results/${match.id}`}
                className="glass-card p-5 hover:bg-white/10 transition-all group"
              >
                {/* Result Badge & Opponent */}
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <span className={`inline-block px-2 py-1 rounded text-xs font-bold mb-2 ${result.class}`}>
                      {result.label}
                    </span>
                    <h3 className="text-lg font-bold text-white">vs {match.opponent}</h3>
                  </div>
                  <ChevronRight
                    size={20}
                    className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all"
                  />
                </div>

                {/* Score */}
                <div className="flex items-center justify-center space-x-4 py-4 mb-4 bg-white/5 rounded-xl">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-white">
                      {formatGAAScore(match.team_goals, match.team_points)}
                    </div>
                    <div className="text-xs text-white/60">Us</div>
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
                  <div className="flex items-center space-x-1">
                    <MapPin size={14} />
                    <span className="capitalize">{match.venue}</span>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
