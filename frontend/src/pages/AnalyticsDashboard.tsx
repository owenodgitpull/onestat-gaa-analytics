import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  TrendingUp,
  Users,
  Target,
  Activity,
  Calendar,
  Trophy,
  Zap,
  ArrowRight,
  MapPin,
  RefreshCw,
  MessageSquare,
  Bot
} from 'lucide-react'
import AIAnalyst from '@/components/AIAnalyst'
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  Cell,
  Legend,
  PieChart,
  Pie
} from 'recharts'
import { api, DashboardData, ShotLocation } from '@/services/api'

export default function AnalyticsDashboard() {
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [shotFilter, setShotFilter] = useState<'all' | 'dungloe' | 'opponent'>('dungloe')
  const [showAIChat, setShowAIChat] = useState(false)

  const fetchDashboard = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.analytics.getDashboard()
      setDashboardData(data)
    } catch (err) {
      setError('Failed to load dashboard data')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDashboard()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw className="animate-spin text-indigo-400" size={48} />
      </div>
    )
  }

  if (error || !dashboardData) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-red-400 mb-4">{error || 'No data available'}</p>
        <button onClick={fetchDashboard} className="btn-glass">
          Retry
        </button>
      </div>
    )
  }

  const { season_summary, top_scorers, top_turnovers, shot_locations, possession_zones, match_trends } = dashboardData

  // Filter shots for heat map
  const filteredShots = shotFilter === 'all'
    ? shot_locations
    : shot_locations.filter(s => s.team === shotFilter)

  // Prepare shot data for scatter chart
  const scoredShots = filteredShots.filter(s => s.is_score)
  const missedShots = filteredShots.filter(s => !s.is_score)

  // Match trends for line chart (reverse to show chronologically)
  const trendData = [...match_trends].reverse().map((m, i) => ({
    name: m.opponent.substring(0, 8),
    dungloe: m.dungloe_score,
    opponent: m.opponent_score,
    result: m.result
  }))

  // Turnover zones data
  const zoneData = possession_zones
    .filter(z => z.turnovers_lost > 0 || z.turnovers_won > 0)
    .sort((a, b) => b.turnovers_lost - a.turnovers_lost)
    .slice(0, 8)

  return (
    <div className="space-y-8">
      {/* Season Overview */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold flex items-center space-x-2">
            <TrendingUp size={24} className="text-white" />
            <span className="text-white">Season Overview</span>
          </h2>
          <button onClick={fetchDashboard} className="btn-glass flex items-center gap-2">
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Matches Played</div>
            <div className="stat-value">{season_summary.matches_played}</div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Win Rate</div>
            <div className="stat-value text-emerald-400">{season_summary.win_rate}%</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.wins}W - {season_summary.losses}L - {season_summary.draws}D
            </div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Avg Score</div>
            <div className="stat-value text-amber-400">{season_summary.avg_score_per_match}</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.total_goals_scored}G + {season_summary.total_points_scored}P
            </div>
          </div>

          <div className="stat-card">
            <div className="text-slate-900 text-sm font-semibold mb-2">Avg Conceded</div>
            <div className="stat-value text-red-400">{season_summary.avg_conceded_per_match}</div>
            <div className="text-xs text-slate-600 mt-1">
              {season_summary.total_goals_conceded}G + {season_summary.total_points_conceded}P
            </div>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Shot Heat Map */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold flex items-center space-x-2 text-white">
              <MapPin size={20} className="text-white" />
              <span>Shot Map</span>
            </h3>
            <div className="flex gap-2">
              {(['dungloe', 'opponent', 'all'] as const).map(filter => (
                <button
                  key={filter}
                  onClick={() => setShotFilter(filter)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                    shotFilter === filter
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white/10 text-white/60 hover:bg-white/20'
                  }`}
                >
                  {filter === 'all' ? 'All' : filter === 'dungloe' ? 'Dungloe' : 'Opponent'}
                </button>
              ))}
            </div>
          </div>

          <div className="relative bg-green-900/40 rounded-xl overflow-hidden" style={{ aspectRatio: '16/10' }}>
            {/* Pitch background SVG */}
            <svg viewBox="0 0 100 62.5" className="absolute inset-0 w-full h-full opacity-30">
              <rect width="100" height="62.5" fill="#2d5016" />
              {/* Center line */}
              <line x1="50" y1="0" x2="50" y2="62.5" stroke="white" strokeWidth="0.3" />
              {/* Goals */}
              <rect x="0" y="23" width="2" height="16.5" fill="none" stroke="white" strokeWidth="0.3" />
              <rect x="98" y="23" width="2" height="16.5" fill="none" stroke="white" strokeWidth="0.3" />
              {/* 45m arcs (simplified) */}
              <line x1="22" y1="0" x2="22" y2="62.5" stroke="white" strokeWidth="0.2" strokeDasharray="2,2" />
              <line x1="78" y1="0" x2="78" y2="62.5" stroke="white" strokeWidth="0.2" strokeDasharray="2,2" />
            </svg>

            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
                <XAxis type="number" dataKey="x" domain={[0, 100]} hide />
                <YAxis type="number" dataKey="y" domain={[0, 100]} hide />
                <Tooltip
                  content={({ payload }) => {
                    if (payload && payload.length) {
                      const data = payload[0].payload as ShotLocation
                      return (
                        <div className="bg-slate-900 text-white text-xs p-2 rounded shadow">
                          <p>{data.event_type.replace(/_/g, ' ')}</p>
                          <p className={data.is_score ? 'text-emerald-400' : 'text-red-400'}>
                            {data.is_score ? 'Scored' : 'Missed'}
                          </p>
                        </div>
                      )
                    }
                    return null
                  }}
                />
                <Scatter name="Scored" data={scoredShots} fill="#10b981" />
                <Scatter name="Missed" data={missedShots} fill="#ef4444" />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="flex justify-center gap-4 mt-3 text-xs">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
              Scored ({scoredShots.length})
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-full bg-red-500"></span>
              Missed ({missedShots.length})
            </span>
          </div>
        </div>

        {/* Match Trends */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Activity size={20} className="text-white" />
            <span>Score Trends</span>
          </h3>
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
                <YAxis stroke="#9ca3af" fontSize={12} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="dungloe"
                  stroke="#6366f1"
                  strokeWidth={3}
                  dot={{ fill: '#6366f1', strokeWidth: 2 }}
                  name="Dungloe"
                />
                <Line
                  type="monotone"
                  dataKey="opponent"
                  stroke="#ef4444"
                  strokeWidth={3}
                  dot={{ fill: '#ef4444', strokeWidth: 2 }}
                  name="Opponent"
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-white/40">
              No completed matches yet
            </div>
          )}
        </div>
      </div>

      {/* Second Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Scorers */}
        <div className="lg:col-span-2 glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Target size={20} className="text-white" />
            <span>Top Scorers</span>
          </h3>
          {top_scorers.length > 0 ? (
            <div className="space-y-3">
              {top_scorers.slice(0, 5).map((player, i) => (
                <div key={player.player_id} className="flex items-center space-x-4 p-4 rounded-xl bg-white hover:bg-white/90 transition-colors">
                  <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold text-white ${
                    i === 0 ? 'bg-gradient-to-br from-yellow-500 to-amber-600' :
                    i === 1 ? 'bg-gradient-to-br from-slate-400 to-slate-500' :
                    i === 2 ? 'bg-gradient-to-br from-orange-600 to-orange-700' :
                    'bg-gradient-to-br from-indigo-600 to-purple-600'
                  }`}>
                    #{i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-semibold text-slate-900">{player.player_name}</div>
                    <div className="text-sm text-slate-600">
                      {player.goals}G • {player.points}P • {player.two_pointers}×2PT
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold bg-gradient-to-r from-indigo-600 to-purple-600 bg-clip-text text-transparent">
                      {player.total_score}
                    </div>
                    <div className="text-xs text-slate-600">{player.matches_played} matches</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-white/40">
              No scoring data yet
            </div>
          )}
        </div>

        {/* Turnover Leaders */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <Trophy size={20} className="text-white" />
            <span>Turnover Kings</span>
          </h3>
          {top_turnovers.length > 0 ? (
            <div className="space-y-3">
              {top_turnovers.slice(0, 5).map((player, i) => (
                <div key={player.player_id} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-white text-sm">{player.player_name}</span>
                    <span className={`text-sm font-bold ${player.net_turnovers >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {player.net_turnovers >= 0 ? '+' : ''}{player.net_turnovers}
                    </span>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <span className="text-emerald-400">Won: {player.turnovers_won}</span>
                    <span className="text-red-400">Lost: {player.turnovers_lost}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-48 flex items-center justify-center text-white/40">
              No turnover data yet
            </div>
          )}
        </div>
      </div>

      {/* Possession Lost Zones */}
      {zoneData.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
            <MapPin size={20} className="text-white" />
            <span>Possession Lost by Zone</span>
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={zoneData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis type="number" stroke="#9ca3af" fontSize={12} />
              <YAxis
                type="category"
                dataKey="zone"
                stroke="#9ca3af"
                fontSize={10}
                width={100}
                tickFormatter={(v) => v.replace(/_/g, ' ').replace(/defensive/g, 'def').replace(/attacking/g, 'att')}
              />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px' }}
                labelStyle={{ color: '#fff' }}
              />
              <Legend />
              <Bar dataKey="turnovers_lost" fill="#ef4444" name="Lost" />
              <Bar dataKey="turnovers_won" fill="#10b981" name="Won" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Matches */}
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold mb-4 flex items-center space-x-2 text-white">
          <Calendar size={20} className="text-white" />
          <span>Recent Results</span>
        </h3>
        {match_trends.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {match_trends.slice(0, 6).map((match) => (
              <div key={match.match_id} className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-white">{match.opponent}</div>
                  <div className={`px-2 py-1 rounded text-xs font-bold ${
                    match.result === 'W' ? 'bg-emerald-500/20 text-emerald-400' :
                    match.result === 'L' ? 'bg-red-500/20 text-red-400' :
                    'bg-amber-500/20 text-amber-400'
                  }`}>
                    {match.result}
                  </div>
                </div>
                <div className="text-lg font-bold text-white">
                  {match.dungloe_score} - {match.opponent_score}
                </div>
                <div className="text-xs text-white/40 mt-1">
                  {new Date(match.match_date).toLocaleDateString()}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-white/40">
            No completed matches yet
          </div>
        )}
      </div>

      {/* AI Insights */}
      <div className="glass-card p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center">
              <Bot size={32} className="text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">AI-Powered Analyst</h2>
              <p className="text-white/60">
                Ask questions about matches, tactics, and player performance
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowAIChat(true)}
            className="btn-primary flex items-center gap-2 px-6 py-3"
          >
            <MessageSquare size={20} />
            Chat with AI
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <Zap className="text-amber-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Tactical Analysis</h3>
            <p className="text-sm text-white/60">Get insights on formations, patterns, and strategies</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <Target className="text-emerald-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Performance Review</h3>
            <p className="text-sm text-white/60">Analyze player stats and scoring efficiency</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
               onClick={() => setShowAIChat(true)}>
            <TrendingUp className="text-indigo-400 mb-2" size={24} />
            <h3 className="font-semibold text-white mb-1">Training Insights</h3>
            <p className="text-sm text-white/60">Get recommendations for improvement areas</p>
          </div>
        </div>

        <div className="flex flex-wrap justify-center gap-2 mt-6">
          <span className="badge badge-info">Claude AI Integration</span>
          <span className="badge badge-info">GAA Tactics Knowledge</span>
          <span className="badge badge-info">Real-time Analysis</span>
        </div>
      </div>

      {/* AI Chat Modal */}
      <AIAnalyst
        isOpen={showAIChat}
        onClose={() => setShowAIChat(false)}
        initialContext="I have access to all Dungloe GAA match data, player statistics, and tactical information."
      />
    </div>
  )
}
