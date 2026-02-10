/**
 * Player View Page
 * Shows comprehensive player profile with stats, attendance, and performance data
 */

import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  User,
  Trophy,
  Target,
  Calendar,
  Activity,
  TrendingUp,
  ChevronLeft,
  RefreshCw,
  Dumbbell,
  Zap,
  Heart,
  AlertTriangle,
  CheckCircle,
  ArrowUp,
  ArrowDown,
  Minus,
  Brain
} from 'lucide-react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  Legend
} from 'recharts'

import { api } from '../services/api'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8001/api/v1'

// Types
interface Player {
  id: string
  name: string
  jersey_number: number | null
  position: string
  date_of_birth: string | null
  status: string
  active: boolean
}

interface PlayerMatchStats {
  match_id: string
  opponent: string
  match_date: string
  goals: number
  points: number
  two_pointers: number
  total_score: number
  turnovers_won: number
  turnovers_lost: number
}

interface PlayerAttendanceStats {
  total_sessions: number
  present_count: number
  absent_count: number
  late_count: number
  excused_count: number
  attendance_rate: number
}

interface GPSDataPoint {
  session_date: string
  total_distance_m: number | null
  max_speed_ms: number | null
  sprint_count: number | null
  dynamic_stress_load: number | null
}

// API functions
const fetchPlayer = async (id: string): Promise<Player> => {
  const res = await fetch(`${API_BASE}/players/${id}`)
  if (!res.ok) throw new Error('Failed to fetch player')
  return res.json()
}

const fetchPlayerMatchStats = async (id: string): Promise<PlayerMatchStats[]> => {
  const res = await fetch(`${API_BASE}/analytics/player/${id}/matches`)
  if (!res.ok) return [] // Return empty if endpoint doesn't exist yet
  return res.json()
}

const fetchPlayerAttendance = async (id: string): Promise<PlayerAttendanceStats | null> => {
  const res = await fetch(`${API_BASE}/attendance/overview`)
  if (!res.ok) return null
  const data = await res.json()
  const playerSummary = data.player_summaries?.find((p: any) => p.player_id === id)
  return playerSummary || null
}

const fetchPlayerGPSData = async (id: string): Promise<GPSDataPoint[]> => {
  const res = await fetch(`${API_BASE}/training/gps/player/${id}?limit=20`)
  if (!res.ok) return []
  return res.json()
}

// Stat Card component
function StatCard({ label, value, subtext, icon: Icon, color = 'indigo' }: {
  label: string
  value: string | number
  subtext?: string
  icon: any
  color?: string
}) {
  const colorClasses: Record<string, string> = {
    indigo: 'from-indigo-600 to-purple-600',
    emerald: 'from-emerald-600 to-teal-600',
    amber: 'from-amber-600 to-orange-600',
    red: 'from-red-600 to-pink-600'
  }

  return (
    <div className="stat-card">
      <div className="flex items-center justify-between mb-2">
        <span className="text-white/70 text-sm font-medium">{label}</span>
        <div className={`w-8 h-8 rounded-lg bg-gradient-to-br ${colorClasses[color]} flex items-center justify-center`}>
          <Icon size={16} className="text-white" />
        </div>
      </div>
      <div className="stat-value">{value}</div>
      {subtext && <div className="text-xs text-white/50 mt-1">{subtext}</div>}
    </div>
  )
}

// Fitness Metric Card with benchmarks and comparisons
function FitnessMetricCard({
  label,
  value,
  unit,
  benchmark,
  lowerIsBetter = false,
  comparison
}: {
  label: string
  value?: number | null
  unit: string
  benchmark?: { good: number; excellent: number }
  lowerIsBetter?: boolean
  comparison?: { previous: number | null; current: number | null; change_pct: number | null }
}) {
  const getStatusColor = () => {
    if (!value || !benchmark) return 'text-white'

    if (lowerIsBetter) {
      if (value <= benchmark.excellent) return 'text-emerald-400'
      if (value <= benchmark.good) return 'text-amber-400'
      return 'text-red-400'
    } else {
      if (value >= benchmark.excellent) return 'text-emerald-400'
      if (value >= benchmark.good) return 'text-amber-400'
      return 'text-red-400'
    }
  }

  const getChangeIndicator = () => {
    if (!comparison || comparison.change_pct === null) return null

    const isImprovement = lowerIsBetter
      ? comparison.change_pct < 0
      : comparison.change_pct > 0

    return (
      <div className={`flex items-center gap-1 text-xs ${isImprovement ? 'text-emerald-400' : 'text-red-400'}`}>
        {comparison.change_pct > 0 ? (
          <ArrowUp size={12} />
        ) : comparison.change_pct < 0 ? (
          <ArrowDown size={12} />
        ) : (
          <Minus size={12} />
        )}
        <span>{Math.abs(comparison.change_pct).toFixed(1)}%</span>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-xl bg-white/5">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-white/80">{label}</div>
        {getChangeIndicator()}
      </div>
      <div className={`text-lg font-bold ${getStatusColor()}`}>
        {value !== undefined && value !== null ? `${value}${unit}` : '-'}
      </div>
      {benchmark && (
        <div className="text-xs text-white/50 mt-1">
          {lowerIsBetter
            ? `<${benchmark.excellent}${unit} excellent`
            : `>${benchmark.excellent}${unit} excellent`}
        </div>
      )}
    </div>
  )
}

export default function PlayerView() {
  const { playerId } = useParams<{ playerId: string }>()
  const [activeTab, setActiveTab] = useState<'overview' | 'matches' | 'training' | 'fitness' | 'attendance'>('overview')

  const { data: player, isLoading: loadingPlayer } = useQuery({
    queryKey: ['player', playerId],
    queryFn: () => fetchPlayer(playerId!),
    enabled: !!playerId
  })

  const { data: matchStats } = useQuery({
    queryKey: ['player-matches', playerId],
    queryFn: () => fetchPlayerMatchStats(playerId!),
    enabled: !!playerId
  })

  const { data: attendanceStats } = useQuery({
    queryKey: ['player-attendance', playerId],
    queryFn: () => fetchPlayerAttendance(playerId!),
    enabled: !!playerId
  })

  const { data: gpsData } = useQuery({
    queryKey: ['player-gps', playerId],
    queryFn: () => fetchPlayerGPSData(playerId!),
    enabled: !!playerId
  })

  // Fitness test queries
  const { data: latestFitnessTest } = useQuery({
    queryKey: ['player-fitness-latest', playerId],
    queryFn: () => api.fitnessTests.getPlayerLatest(playerId!),
    enabled: !!playerId
  })

  const { data: fitnessHistory } = useQuery({
    queryKey: ['player-fitness-history', playerId],
    queryFn: () => api.fitnessTests.getPlayerHistory(playerId!),
    enabled: !!playerId
  })

  const { data: fitnessComparison } = useQuery({
    queryKey: ['player-fitness-comparison', playerId],
    queryFn: () => api.fitnessTests.getPlayerComparison(playerId!),
    enabled: !!playerId
  })

  // Match GPS history
  const { data: matchGpsHistory } = useQuery({
    queryKey: ['player-match-gps', playerId],
    queryFn: () => api.matchGps.getPlayerMatchHistory(playerId!, 10),
    enabled: !!playerId
  })

  if (loadingPlayer) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  if (!player) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-white/60">Player not found</p>
        <Link to="/players" className="btn-primary mt-4 inline-block">
          Back to Players
        </Link>
      </div>
    )
  }

  // Calculate totals from match stats
  const totalGoals = matchStats?.reduce((sum, m) => sum + m.goals, 0) || 0
  const totalPoints = matchStats?.reduce((sum, m) => sum + m.points, 0) || 0
  const totalScore = matchStats?.reduce((sum, m) => sum + m.total_score, 0) || 0
  const matchesPlayed = matchStats?.length || 0

  // Prepare chart data for scoring trend
  const scoringTrendData = matchStats?.slice().reverse().map(m => ({
    name: m.opponent.substring(0, 8),
    goals: m.goals,
    points: m.points,
    total: m.total_score
  })) || []

  // Prepare GPS trend data
  const gpsTrendData = gpsData?.slice().reverse().map((g, i) => ({
    session: `S${i + 1}`,
    distance: g.total_distance_m ? Math.round(g.total_distance_m / 1000 * 10) / 10 : 0,
    maxSpeed: g.max_speed_ms || 0,
    sprints: g.sprint_count || 0
  })) || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/players" className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors">
          <ChevronLeft size={24} />
        </Link>
        <div className="flex items-center gap-4 flex-1">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-3xl font-bold text-white">
            {player.jersey_number || player.name.charAt(0)}
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">{player.name}</h1>
            <div className="flex items-center gap-3 text-white/60">
              <span className="capitalize">{(player.position || 'unknown').replace(/_/g, ' ')}</span>
              {player.jersey_number && <span>#{player.jersey_number}</span>}
              <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                player.active ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
              }`}>
                {player.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: 'overview', label: 'Overview', icon: User },
          { id: 'matches', label: 'Matches', icon: Trophy },
          { id: 'training', label: 'Performance', icon: Dumbbell },
          { id: 'fitness', label: 'Fitness', icon: Heart },
          { id: 'attendance', label: 'Attendance', icon: Calendar }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all ${
              activeTab === tab.id
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            <tab.icon size={18} />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total Score"
              value={totalScore}
              subtext={`${totalGoals}G + ${totalPoints}P`}
              icon={Target}
              color="emerald"
            />
            <StatCard
              label="Matches Played"
              value={matchesPlayed}
              icon={Trophy}
              color="indigo"
            />
            <StatCard
              label="Avg per Match"
              value={matchesPlayed > 0 ? (totalScore / matchesPlayed).toFixed(1) : '0'}
              icon={TrendingUp}
              color="amber"
            />
            <StatCard
              label="Attendance Rate"
              value={`${attendanceStats?.attendance_rate || 0}%`}
              subtext={`${attendanceStats?.present_count || 0}/${attendanceStats?.total_sessions || 0} sessions`}
              icon={Calendar}
              color="indigo"
            />
          </div>

          {/* Scoring Trend Chart */}
          {scoringTrendData.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Activity size={20} />
                Scoring Trend
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scoringTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Bar dataKey="goals" fill="#10b981" name="Goals" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="points" fill="#6366f1" name="Points" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* GPS Performance */}
          {gpsTrendData.length > 0 && (
            <div className="glass-card p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Zap size={20} />
                Training Performance
              </h3>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={gpsTrendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="session" stroke="#9ca3af" fontSize={12} />
                    <YAxis stroke="#9ca3af" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="distance" stroke="#6366f1" name="Distance (km)" strokeWidth={2} />
                    <Line type="monotone" dataKey="sprints" stroke="#10b981" name="Sprints" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Matches Tab */}
      {activeTab === 'matches' && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Match History</h3>
          {matchStats && matchStats.length > 0 ? (
            <div className="space-y-3">
              {matchStats.map(match => (
                <div key={match.match_id} className="flex items-center justify-between p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                  <div>
                    <div className="font-semibold text-white">{match.opponent}</div>
                    <div className="text-sm text-white/60">
                      {new Date(match.match_date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <div className="text-lg font-bold text-white">
                        {match.goals}-{match.points}
                        {match.two_pointers > 0 && ` (+${match.two_pointers}×2pt)`}
                      </div>
                      <div className="text-xs text-white/40">
                        {match.total_score} total
                      </div>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-emerald-400">+{match.turnovers_won} TO won</div>
                      <div className="text-red-400">-{match.turnovers_lost} TO lost</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-white/40 py-8">
              No match data recorded yet
            </div>
          )}
        </div>
      )}

      {/* Training/Performance Tab */}
      {activeTab === 'training' && (
        <div className="space-y-6">
          {/* Training GPS Data */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Activity size={20} />
              Training GPS History
            </h3>
            {gpsData && gpsData.length > 0 ? (
              <div className="space-y-3">
                {gpsData.map((data, i) => (
                  <div key={i} className="p-4 rounded-xl bg-white/5">
                    <div className="text-sm text-white/60 mb-2">{new Date(data.session_date).toLocaleDateString()}</div>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-white/50">Distance</div>
                        <div className="text-lg font-bold text-white">
                          {data.total_distance_m ? `${(data.total_distance_m / 1000).toFixed(1)}km` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">Max Speed</div>
                        <div className="text-lg font-bold text-white">
                          {data.max_speed_ms ? `${data.max_speed_ms.toFixed(1)} m/s` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">Sprints</div>
                        <div className="text-lg font-bold text-white">
                          {data.sprint_count ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">Load</div>
                        <div className="text-lg font-bold text-white">
                          {data.dynamic_stress_load ? data.dynamic_stress_load.toFixed(0) : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-8">
                No training GPS data recorded yet
              </div>
            )}
          </div>

          {/* Match GPS Data */}
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Trophy size={20} />
              Match GPS History
            </h3>
            {matchGpsHistory && matchGpsHistory.length > 0 ? (
              <div className="space-y-3">
                {matchGpsHistory.map((data, i) => (
                  <div key={i} className="p-4 rounded-xl bg-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm text-white/60">{new Date(data.created_at).toLocaleDateString()}</span>
                      {data.playing_minutes && (
                        <span className="text-xs px-2 py-1 rounded bg-indigo-500/20 text-indigo-400">
                          {data.playing_minutes} mins played
                        </span>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-4">
                      <div>
                        <div className="text-xs text-white/50">Distance</div>
                        <div className="text-lg font-bold text-white">
                          {data.total_distance_m ? `${(data.total_distance_m / 1000).toFixed(1)}km` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">Max Speed</div>
                        <div className="text-lg font-bold text-white">
                          {data.max_speed_ms ? `${data.max_speed_ms.toFixed(1)} m/s` : '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">Sprints</div>
                        <div className="text-lg font-bold text-white">
                          {data.sprint_count ?? '-'}
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-white/50">HSR</div>
                        <div className="text-lg font-bold text-white">
                          {data.high_speed_running_m ? `${(data.high_speed_running_m / 1000).toFixed(2)}km` : '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-white/40 py-8">
                No match GPS data recorded yet
              </div>
            )}
          </div>
        </div>
      )}

      {/* Fitness Tab */}
      {activeTab === 'fitness' && (
        <div className="space-y-6">
          {/* Latest Test Results */}
          {latestFitnessTest ? (
            <>
              <div className="glass-card p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Heart size={20} />
                    Latest Fitness Test
                  </h3>
                  <span className="text-sm text-white/60">
                    {new Date(latestFitnessTest.test_date).toLocaleDateString()}
                  </span>
                </div>

                {/* Test Metrics Grid */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Power Metrics */}
                  <FitnessMetricCard
                    label="CMJ"
                    value={latestFitnessTest.cmj_cm}
                    unit="cm"
                    benchmark={{ good: 35, excellent: 45 }}
                    comparison={fitnessComparison?.changes?.cmj_cm}
                  />
                  <FitnessMetricCard
                    label="Squat Jump"
                    value={latestFitnessTest.squat_jump_cm}
                    unit="cm"
                    comparison={fitnessComparison?.changes?.squat_jump_cm}
                  />
                  <FitnessMetricCard
                    label="EUR"
                    value={latestFitnessTest.eur_calculated}
                    unit=""
                    benchmark={{ good: 1.0, excellent: 1.15 }}
                    comparison={fitnessComparison?.changes?.eur_calculated}
                  />

                  {/* Speed/Conditioning */}
                  <FitnessMetricCard
                    label="0-10m Sprint"
                    value={latestFitnessTest.sprint_0_10m_sec}
                    unit="s"
                    benchmark={{ good: 1.85, excellent: 1.7 }}
                    lowerIsBetter
                    comparison={fitnessComparison?.changes?.sprint_0_10m_sec}
                  />
                  <FitnessMetricCard
                    label="Bronco Test"
                    value={latestFitnessTest.bronco_test_min}
                    unit="min"
                    benchmark={{ good: 5.5, excellent: 4.5 }}
                    lowerIsBetter
                    comparison={fitnessComparison?.changes?.bronco_test_min}
                  />

                  {/* Strength */}
                  <FitnessMetricCard
                    label="Press-ups (60s)"
                    value={latestFitnessTest.press_ups_60s}
                    unit=""
                    benchmark={{ good: 30, excellent: 40 }}
                    comparison={fitnessComparison?.changes?.press_ups_60s}
                  />
                  <FitnessMetricCard
                    label="Pull-ups (60s)"
                    value={latestFitnessTest.pull_ups_60s}
                    unit=""
                    benchmark={{ good: 10, excellent: 15 }}
                    comparison={fitnessComparison?.changes?.pull_ups_60s}
                  />

                  {/* Body Composition */}
                  <FitnessMetricCard
                    label="Weight"
                    value={latestFitnessTest.weight_kg}
                    unit="kg"
                    comparison={fitnessComparison?.changes?.weight_kg}
                  />
                </div>

                {/* Mobility */}
                <div className="mt-6">
                  <h4 className="text-sm font-semibold text-white/70 mb-3">Mobility Assessment</h4>
                  <div className="grid grid-cols-3 gap-4">
                    <FitnessMetricCard
                      label="KTW Right"
                      value={latestFitnessTest.ktw_right_cm}
                      unit="cm"
                      benchmark={{ good: 10, excellent: 12 }}
                    />
                    <FitnessMetricCard
                      label="KTW Left"
                      value={latestFitnessTest.ktw_left_cm}
                      unit="cm"
                      benchmark={{ good: 10, excellent: 12 }}
                    />
                    <div className="p-4 rounded-xl bg-white/5">
                      <div className="text-xs text-white/50 mb-1">Overhead Squat</div>
                      <div className="text-lg font-bold text-white">
                        {latestFitnessTest.overhead_squat_score !== undefined
                          ? ['Poor', 'Fair', 'Good', 'Excellent'][latestFitnessTest.overhead_squat_score] || latestFitnessTest.overhead_squat_score
                          : '-'}
                      </div>
                    </div>
                  </div>

                  {/* Ankle Imbalance Warning */}
                  {latestFitnessTest.ktw_right_cm && latestFitnessTest.ktw_left_cm &&
                    Math.abs(latestFitnessTest.ktw_right_cm - latestFitnessTest.ktw_left_cm) > 2 && (
                    <div className="mt-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                      <AlertTriangle size={16} className="text-amber-400" />
                      <span className="text-sm text-amber-400">
                        Ankle mobility imbalance detected ({Math.abs(latestFitnessTest.ktw_right_cm - latestFitnessTest.ktw_left_cm).toFixed(1)}cm difference)
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* AI Analysis */}
              {latestFitnessTest.ai_analysis && (
                <div className="glass-card p-6">
                  <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                    <Brain size={20} />
                    AI Analysis
                  </h3>

                  {/* Injury Risk Score */}
                  {latestFitnessTest.ai_analysis.injury_risk_score !== undefined && (
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-white/60">Injury Risk Score</span>
                        <span className={`font-bold ${
                          latestFitnessTest.ai_analysis.injury_risk_score <= 3 ? 'text-emerald-400' :
                          latestFitnessTest.ai_analysis.injury_risk_score <= 6 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {latestFitnessTest.ai_analysis.injury_risk_score}/10
                        </span>
                      </div>
                      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            latestFitnessTest.ai_analysis.injury_risk_score <= 3 ? 'bg-emerald-500' :
                            latestFitnessTest.ai_analysis.injury_risk_score <= 6 ? 'bg-amber-500' : 'bg-red-500'
                          }`}
                          style={{ width: `${latestFitnessTest.ai_analysis.injury_risk_score * 10}%` }}
                        />
                      </div>
                    </div>
                  )}

                  <div className="grid md:grid-cols-2 gap-6">
                    {/* Strengths */}
                    {latestFitnessTest.ai_analysis.strengths && latestFitnessTest.ai_analysis.strengths.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                          <CheckCircle size={14} />
                          Strengths
                        </h4>
                        <ul className="space-y-1">
                          {latestFitnessTest.ai_analysis.strengths.map((s, i) => (
                            <li key={i} className="text-sm text-white/80">{s}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Weaknesses */}
                    {latestFitnessTest.ai_analysis.weaknesses && latestFitnessTest.ai_analysis.weaknesses.length > 0 && (
                      <div>
                        <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2">
                          <AlertTriangle size={14} />
                          Areas to Improve
                        </h4>
                        <ul className="space-y-1">
                          {latestFitnessTest.ai_analysis.weaknesses.map((w, i) => (
                            <li key={i} className="text-sm text-white/80">{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Recommendations */}
                  {latestFitnessTest.ai_analysis.recommendations && latestFitnessTest.ai_analysis.recommendations.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-indigo-400 mb-2">Training Recommendations</h4>
                      <ul className="space-y-2">
                        {latestFitnessTest.ai_analysis.recommendations.map((r, i) => (
                          <li key={i} className="text-sm text-white/80 flex items-start gap-2">
                            <span className="text-indigo-400 mt-0.5">•</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Position Fit */}
                  {latestFitnessTest.ai_analysis.position_fit && latestFitnessTest.ai_analysis.position_fit.length > 0 && (
                    <div className="mt-6">
                      <h4 className="text-sm font-semibold text-white/60 mb-2">Position Suitability</h4>
                      <div className="flex flex-wrap gap-2">
                        {latestFitnessTest.ai_analysis.position_fit.map((p, i) => (
                          <span key={i} className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-sm">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Test History */}
              {fitnessHistory && fitnessHistory.length > 1 && (
                <div className="glass-card p-6">
                  <h3 className="text-xl font-bold text-white mb-4">Test History</h3>
                  <div className="space-y-3">
                    {fitnessHistory.map((test, i) => (
                      <div key={test.id} className={`p-4 rounded-xl ${i === 0 ? 'bg-indigo-500/10 border border-indigo-500/30' : 'bg-white/5'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-white">
                            {new Date(test.test_date).toLocaleDateString()}
                            {i === 0 && <span className="ml-2 text-xs text-indigo-400">(Latest)</span>}
                          </span>
                          <div className="flex items-center gap-4 text-sm">
                            {test.cmj_cm && (
                              <span className="text-white/60">CMJ: <span className="text-white">{test.cmj_cm}cm</span></span>
                            )}
                            {test.bronco_test_min && (
                              <span className="text-white/60">Bronco: <span className="text-white">{test.bronco_test_min}min</span></span>
                            )}
                            {test.injury_risk_score && (
                              <span className={`px-2 py-0.5 rounded text-xs ${
                                test.injury_risk_score <= 3 ? 'bg-emerald-500/20 text-emerald-400' :
                                test.injury_risk_score <= 6 ? 'bg-amber-500/20 text-amber-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                Risk: {test.injury_risk_score}/10
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="glass-card p-8 text-center">
              <Heart size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/60">No fitness test data recorded yet</p>
              <p className="text-sm text-white/40 mt-2">
                Fitness tests can be added through the team management section
              </p>
            </div>
          )}
        </div>
      )}

      {/* Attendance Tab */}
      {activeTab === 'attendance' && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Attendance Summary</h3>
          {attendanceStats ? (
            <div className="space-y-6">
              {/* Attendance Rate Visualization */}
              <div className="flex items-center gap-4">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#374151"
                      strokeWidth="12"
                    />
                    <circle
                      cx="50"
                      cy="50"
                      r="40"
                      fill="none"
                      stroke="#10b981"
                      strokeWidth="12"
                      strokeDasharray={`${attendanceStats.attendance_rate * 2.51} 251`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold text-white">{attendanceStats.attendance_rate}%</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
                    <span className="text-white/60">Present: {attendanceStats.present_count}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-amber-500"></span>
                    <span className="text-white/60">Late: {attendanceStats.late_count}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-red-500"></span>
                    <span className="text-white/60">Absent: {attendanceStats.absent_count}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                    <span className="text-white/60">Excused: {attendanceStats.excused_count}</span>
                  </div>
                </div>
              </div>

              <div className="text-sm text-white/40">
                Total sessions in period: {attendanceStats.total_sessions}
              </div>
            </div>
          ) : (
            <div className="text-center text-white/40 py-8">
              No attendance data available
            </div>
          )}
        </div>
      )}
    </div>
  )
}
