/**
 * Player Comparison Page
 * Side-by-side comparison of two players for manager selection decisions
 */

import { useState, useMemo } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ChevronLeft,
  GitCompareArrows,
  ArrowLeftRight,
  Search,
  Users
} from 'lucide-react'
import {
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  Legend,
} from 'recharts'
import { api, ComparisonPlayerStats } from '@/services/api'
import { usePlayers } from '@/hooks/usePlayers'
import LoadingSkeleton from '@/components/LoadingSkeleton'

// H2H stat definitions
const H2H_STATS: { key: keyof ComparisonPlayerStats; label: string; format?: (v: number | null) => string }[] = [
  { key: 'total_score_value', label: 'Total Score' },
  { key: 'accuracy_pct', label: 'Accuracy', format: v => v != null ? `${v}%` : '—' },
  { key: 'matches_played', label: 'Matches' },
  { key: 'blocks', label: 'Blocks' },
  { key: 'turnovers_won', label: 'Turnovers Won' },
  { key: 'avg_distance_km', label: 'Avg Distance', format: v => v != null ? `${v} km` : '—' },
  { key: 'avg_sprints', label: 'Avg Sprints', format: v => v != null ? `${v}` : '—' },
  { key: 'avg_max_speed_kmh', label: 'Top Speed', format: v => v != null ? `${v} km/h` : '—' },
  { key: 'attendance_rate', label: 'Attendance', format: v => v != null ? `${v}%` : '—' },
]

function formatValue(stat: typeof H2H_STATS[number], value: number | null): string {
  if (stat.format) return stat.format(value)
  return value != null ? String(value) : '—'
}

function ComparisonBar({ label, valueA, valueB, formatFn }: {
  label: string
  valueA: number | null
  valueB: number | null
  formatFn: (v: number | null) => string
}) {
  const numA = valueA ?? 0
  const numB = valueB ?? 0
  const max = Math.max(numA, numB, 1)
  const pctA = (numA / max) * 100
  const pctB = (numB / max) * 100

  return (
    <div className="py-3">
      <div className="text-center text-xs font-medium text-white/60 mb-2">{label}</div>
      <div className="flex items-center gap-3">
        {/* Player A value */}
        <div className="w-16 text-right text-sm font-semibold text-white flex-shrink-0">
          {formatFn(valueA)}
        </div>
        {/* Bar A (grows right-to-left) */}
        <div className="flex-1 flex justify-end">
          <div className="h-5 rounded-l-full bg-emerald-500/40 relative" style={{ width: `${pctA}%`, minWidth: numA > 0 ? '4px' : '0' }}>
            {numA >= numB && numA > 0 && (
              <div className="absolute inset-0 rounded-l-full bg-emerald-500/30 animate-pulse" />
            )}
          </div>
        </div>
        {/* Bar B (grows left-to-right) */}
        <div className="flex-1 flex justify-start">
          <div className="h-5 rounded-r-full bg-amber-500/40 relative" style={{ width: `${pctB}%`, minWidth: numB > 0 ? '4px' : '0' }}>
            {numB >= numA && numB > 0 && (
              <div className="absolute inset-0 rounded-r-full bg-amber-500/30 animate-pulse" />
            )}
          </div>
        </div>
        {/* Player B value */}
        <div className="w-16 text-left text-sm font-semibold text-white flex-shrink-0">
          {formatFn(valueB)}
        </div>
      </div>
    </div>
  )
}

function PlayerPicker({ excludeId, onSelect }: {
  excludeId?: string
  onSelect: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const { data: players } = usePlayers()

  const filtered = useMemo(() => {
    if (!players) return []
    return players
      .filter(p => p.id !== excludeId)
      .filter(p =>
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.jersey_number?.toString() || '').includes(search)
      )
  }, [players, excludeId, search])

  return (
    <div className="glass-card p-5">
      <h3 className="text-lg font-semibold text-white mb-3">Select a player</h3>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
        <input
          type="text"
          placeholder="Search by name or number..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm"
        />
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {filtered.map(p => (
          <button
            key={p.id}
            onClick={() => onSelect(p.id)}
            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-white/10 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
              {p.jersey_number || p.name.charAt(0)}
            </div>
            <div>
              <div className="font-medium text-white text-sm">{p.name}</div>
              <div className="text-xs text-white/50 capitalize">{(p.position || '').replace(/_/g, ' ')}</div>
            </div>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-white/40 text-center py-4">No players found</p>
        )}
      </div>
    </div>
  )
}

export default function PlayerComparison() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const playerAId = searchParams.get('a') || ''
  const playerBId = searchParams.get('b') || ''

  const hasBothPlayers = !!playerAId && !!playerBId

  const { data: comparison, isLoading } = useQuery({
    queryKey: ['player-comparison', playerAId, playerBId],
    queryFn: () => api.players.comparePlayers(playerAId, playerBId),
    enabled: hasBothPlayers,
  })

  const handleSelectB = (id: string) => {
    setSearchParams({ a: playerAId, b: id })
  }

  const handleSelectA = (id: string) => {
    if (playerBId) {
      setSearchParams({ a: id, b: playerBId })
    } else {
      setSearchParams({ a: id })
    }
  }

  const handleSwap = () => {
    if (playerAId && playerBId) {
      setSearchParams({ a: playerBId, b: playerAId })
    }
  }

  // Radar chart data
  const radarData = useMemo(() => {
    if (!comparison) return []
    const a = comparison.player_a
    const b = comparison.player_b

    // Normalise each axis to 0-100 relative scale
    const norm = (valA: number | null, valB: number | null) => {
      const nA = valA ?? 0
      const nB = valB ?? 0
      const max = Math.max(nA, nB, 1)
      return { a: Math.round((nA / max) * 100), b: Math.round((nB / max) * 100) }
    }

    const scoring = norm(a.total_score_value, b.total_score_value)
    const accuracy = norm(a.accuracy_pct, b.accuracy_pct)
    const defence = norm((a.blocks || 0) + (a.interceptions || 0), (b.blocks || 0) + (b.interceptions || 0))
    const workRate = norm(a.turnovers_won, b.turnovers_won)
    const fitness = norm(a.avg_distance_km, b.avg_distance_km)
    const discipline = norm(a.attendance_rate, b.attendance_rate)

    return [
      { axis: 'Scoring', A: scoring.a, B: scoring.b },
      { axis: 'Accuracy', A: accuracy.a, B: accuracy.b },
      { axis: 'Defence', A: defence.a, B: defence.b },
      { axis: 'Work Rate', A: workRate.a, B: workRate.b },
      { axis: 'Fitness', A: fitness.a, B: fitness.b },
      { axis: 'Discipline', A: discipline.a, B: discipline.b },
    ]
  }, [comparison])

  if (hasBothPlayers && isLoading) {
    return <LoadingSkeleton />
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/players')}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex items-center gap-3">
          <GitCompareArrows size={24} className="text-amber-400" />
          <h1 className="text-2xl font-bold text-white">Player Comparison</h1>
        </div>
      </div>

      {/* Player Cards */}
      {comparison ? (
        <>
          {/* Two player headers */}
          <div className="grid grid-cols-2 gap-4">
            <PlayerCard stats={comparison.player_a} color="emerald" />
            <PlayerCard stats={comparison.player_b} color="amber" />
          </div>

          {/* Swap button */}
          <div className="flex justify-center">
            <button
              onClick={handleSwap}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all border border-white/10"
            >
              <ArrowLeftRight size={16} />
              Swap
            </button>
          </div>

          {/* H2H Comparison Bars */}
          <div className="glass-card p-5">
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="text-sm font-semibold text-emerald-400 text-center">{comparison.player_a.player_name}</div>
              <div className="text-sm font-semibold text-amber-400 text-center">{comparison.player_b.player_name}</div>
            </div>
            <div className="divide-y divide-white/10">
              {H2H_STATS.map(stat => (
                <ComparisonBar
                  key={stat.key}
                  label={stat.label}
                  valueA={comparison.player_a[stat.key] as number | null}
                  valueB={comparison.player_b[stat.key] as number | null}
                  formatFn={v => formatValue(stat, v)}
                />
              ))}
            </div>
          </div>

          {/* Radar Chart */}
          <div className="glass-card p-5">
            <h3 className="text-lg font-semibold text-white mb-4 text-center">Player Profile</h3>
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.15)" />
                  <PolarAngleAxis
                    dataKey="axis"
                    tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 12 }}
                  />
                  <Radar
                    name={comparison.player_a.player_name}
                    dataKey="A"
                    stroke="#34d399"
                    fill="#34d399"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                  <Radar
                    name={comparison.player_b.player_name}
                    dataKey="B"
                    stroke="#fbbf24"
                    fill="#fbbf24"
                    fillOpacity={0.2}
                    strokeWidth={2}
                  />
                  <Legend
                    wrapperStyle={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Pre-selected player A */}
          {playerAId && !playerBId && (
            <div className="space-y-4">
              <PreselectedPlayerCard playerId={playerAId} color="emerald" />
              <div className="flex items-center gap-3 text-white/50">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-sm">vs</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>
              <PlayerPicker excludeId={playerAId} onSelect={handleSelectB} />
            </div>
          )}

          {/* No players selected */}
          {!playerAId && (
            <div className="space-y-4">
              <div className="glass-card p-8 text-center">
                <Users size={40} className="mx-auto text-white/20 mb-3" />
                <p className="text-white/60 mb-4">Select two players from the squad to compare</p>
              </div>
              <PlayerPicker onSelect={handleSelectA} />
            </div>
          )}
        </>
      )}
    </div>
  )
}

function PlayerCard({ stats, color }: { stats: ComparisonPlayerStats; color: 'emerald' | 'amber' }) {
  const gradients = {
    emerald: 'from-emerald-600 to-cyan-600',
    amber: 'from-amber-500 to-orange-500',
  }

  return (
    <Link
      to={`/players/${stats.player_id}`}
      className="glass-card p-4 hover:bg-white/10 transition-colors"
    >
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradients[color]} flex items-center justify-center text-lg font-bold text-white`}>
          {stats.player_name.charAt(0)}
        </div>
        <div>
          <div className="font-semibold text-white">{stats.player_name}</div>
          <div className="text-xs text-white/50">{stats.matches_played} matches</div>
        </div>
      </div>
    </Link>
  )
}

function PreselectedPlayerCard({ playerId, color }: { playerId: string; color: 'emerald' | 'amber' }) {
  const { data: players } = usePlayers()
  const player = players?.find(p => p.id === playerId)

  const gradients = {
    emerald: 'from-emerald-600 to-cyan-600',
    amber: 'from-amber-500 to-orange-500',
  }

  if (!player) return null

  return (
    <div className="glass-card p-4">
      <div className="flex items-center gap-3">
        <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${gradients[color]} flex items-center justify-center text-lg font-bold text-white`}>
          {player.jersey_number || player.name.charAt(0)}
        </div>
        <div>
          <div className="font-semibold text-white">{player.name}</div>
          <div className="text-xs text-white/50 capitalize">{(player.position || '').replace(/_/g, ' ')}</div>
        </div>
      </div>
    </div>
  )
}
