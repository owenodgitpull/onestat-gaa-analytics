/**
 * Players List Page
 * Shows all players with search, filter, and quick stats
 */

import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  Users,
  Search,
  ChevronRight,
  RefreshCw,
  Trophy,
  Target,
  Filter
} from 'lucide-react'
import { api, TopScorer } from '@/services/api'
import { usePlayers } from '@/hooks/usePlayers'

// Position categories for filtering
const positionCategories = [
  { id: 'all', label: 'All Positions' },
  { id: 'goalkeeper', label: 'Goalkeepers' },
  { id: 'defender', label: 'Defenders' },
  { id: 'midfielder', label: 'Midfielders' },
  { id: 'forward', label: 'Forwards' }
]

const positionMapping: Record<string, string> = {
  goalkeeper: 'goalkeeper',
  right_corner_back: 'defender',
  full_back: 'defender',
  left_corner_back: 'defender',
  right_half_back: 'defender',
  centre_half_back: 'defender',
  left_half_back: 'defender',
  midfield: 'midfielder',
  right_half_forward: 'forward',
  centre_half_forward: 'forward',
  left_half_forward: 'forward',
  right_corner_forward: 'forward',
  full_forward: 'forward',
  left_corner_forward: 'forward'
}

export default function Players() {
  const [searchQuery, setSearchQuery] = useState('')
  const [positionFilter, setPositionFilter] = useState('all')

  const { data: players, isLoading } = usePlayers()

  const { data: topScorers } = useQuery({
    queryKey: ['top-scorers'],
    queryFn: () => api.analytics.getTopScorers(50)
  })

  // Create a map of player scores for quick lookup
  const playerScores = useMemo(() => {
    const map = new Map<string, TopScorer>()
    topScorers?.forEach(scorer => {
      map.set(scorer.player_id, scorer)
    })
    return map
  }, [topScorers])

  // Filter players
  const filteredPlayers = useMemo(() => {
    if (!players) return []

    return players.filter(player => {
      // Search filter
      const matchesSearch = player.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (player.jersey_number?.toString() || '').includes(searchQuery)

      // Position filter
      const playerCategory = positionMapping[player.position] || 'other'
      const matchesPosition = positionFilter === 'all' || playerCategory === positionFilter

      return matchesSearch && matchesPosition
    })
  }, [players, searchQuery, positionFilter])

  // Sort by total score descending
  const sortedPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      const scoreA = playerScores.get(a.id)?.total_score || 0
      const scoreB = playerScores.get(b.id)?.total_score || 0
      return scoreB - scoreA
    })
  }, [filteredPlayers, playerScores])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
            <Users size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Players</h1>
            <p className="text-white/60 text-sm">
              {players?.length || 0} player{players?.length !== 1 ? 's' : ''} in squad
            </p>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
          <input
            type="text"
            placeholder="Search by name or number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-12 pr-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={20} className="text-white/40" />
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {positionCategories.map(cat => (
              <option key={cat.id} value={cat.id} className="bg-slate-800 text-white">{cat.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Top Scorers Banner */}
      {topScorers && topScorers.length > 0 && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Trophy size={18} className="text-amber-400" />
            <span className="text-sm font-semibold text-white">Top Scorers</span>
          </div>
          <div className="flex gap-4 overflow-x-auto pb-2">
            {topScorers.slice(0, 5).map((scorer, i) => (
              <Link
                key={scorer.player_id}
                to={`/players/${scorer.player_id}`}
                className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors min-w-[180px]"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                  i === 0 ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                  i === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                  i === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700' :
                  'bg-slate-600'
                }`}>
                  {i + 1}
                </div>
                <div>
                  <div className="font-medium text-white text-sm">{scorer.player_name}</div>
                  <div className="text-xs text-white/60">
                    {scorer.goals}G {scorer.points}P = {scorer.total_score}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Players List */}
      <div className="space-y-3">
        {sortedPlayers.map(player => {
          const stats = playerScores.get(player.id)

          return (
            <Link
              key={player.id}
              to={`/players/${player.id}`}
              className="glass-card p-4 hover:bg-white/10 transition-all cursor-pointer group block"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-lg font-bold text-white">
                    {player.jersey_number || player.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{player.name}</h3>
                    <p className="text-sm text-white/60 capitalize">
                      {(player.position || 'unknown').replace(/_/g, ' ')}
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-6">
                  {stats && (
                    <div className="hidden sm:flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Target size={14} className="text-emerald-400" />
                        <span className="text-white">{stats.goals}G</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Target size={14} className="text-indigo-400" />
                        <span className="text-white">{stats.points}P</span>
                      </div>
                      <div className="text-lg font-bold text-white">
                        {stats.total_score}
                      </div>
                    </div>
                  )}
                  <div className={`px-2 py-1 rounded text-xs font-medium ${
                    player.active
                      ? 'bg-emerald-500/20 text-emerald-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}>
                    {player.active ? 'Active' : 'Inactive'}
                  </div>
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white transition-colors" />
                </div>
              </div>
            </Link>
          )
        })}

        {sortedPlayers.length === 0 && (
          <div className="glass-card p-12 text-center">
            <Users size={48} className="mx-auto text-white/20 mb-4" />
            <h3 className="text-xl font-semibold text-white mb-2">No Players Found</h3>
            <p className="text-white/60">
              {searchQuery || positionFilter !== 'all'
                ? 'Try adjusting your search or filters'
                : 'No players in the squad yet'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
