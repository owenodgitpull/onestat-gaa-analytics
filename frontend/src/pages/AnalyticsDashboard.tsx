import { Link } from 'react-router-dom'
import { 
  TrendingUp, 
  Users, 
  Target, 
  Activity,
  Calendar,
  Trophy,
  Zap,
  ArrowRight
} from 'lucide-react'

export default function AnalyticsDashboard() {
  // Mock data
  const seasonStats = {
    matches: 8,
    wins: 5,
    losses: 2,
    draws: 1,
    goalsScored: 18,
    pointsScored: 87,
    avgScore: 13.1,
    winRate: 62.5
  }

  const topScorers = [
    { name: 'Barry Curran', goals: 4, points: 12, total: 24 },
    { name: 'Shaun McGee', goals: 3, points: 15, total: 24 },
    { name: 'Oran Gallagher', goals: 2, points: 18, total: 24 },
  ]

  const recentMatches = [
    { opponent: 'Glenties', result: 'W', score: '2-15 to 1-12', date: 'Jan 8' },
    { opponent: 'Kilcar', result: 'L', score: '1-09 to 3-11', date: 'Jan 1' },
    { opponent: 'Naomh Conaill', result: 'W', score: '3-14 to 2-10', date: 'Dec 28' },
  ]

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="glass-card p-8 text-center">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 mb-6">
          <Trophy size={40} className="text-white" />
        </div>
        <h1 className="text-5xl font-bold text-gradient mb-4">
          Season 2026
        </h1>
        <p className="text-xl text-white/60 mb-6">
          Senior Men's Team Analytics
        </p>
        <Link to="/match/new" className="btn-primary inline-flex items-center space-x-2">
          <Activity size={20} />
          <span>Start Live Match</span>
          <ArrowRight size={20} />
        </Link>
      </div>

      {/* Season Overview */}
      <div>
        <h2 className="text-2xl font-bold mb-4 flex items-center space-x-2">
          <TrendingUp size={24} />
          <span>Season Overview</span>
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="stat-card">
            <div className="stat-label">Matches Played</div>
            <div className="stat-value">{seasonStats.matches}</div>
          </div>
          
          <div className="stat-card">
            <div className="stat-label">Win Rate</div>
            <div className="stat-value text-emerald-400">{seasonStats.winRate}%</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Goals Scored</div>
            <div className="stat-value text-amber-400">{seasonStats.goalsScored}</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Avg Score</div>
            <div className="stat-value">{seasonStats.avgScore}</div>
          </div>
        </div>
      </div>

      {/* Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Top Scorers */}
        <div className="lg:col-span-2 glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2">
            <Target size={20} />
            <span>Top Scorers</span>
          </h3>
          <div className="space-y-4">
            {topScorers.map((player, i) => (
              <div key={i} className="flex items-center space-x-4 p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <div className="flex-shrink-0 w-12 h-12 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-xl font-bold">
                  #{i + 1}
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-white">{player.name}</div>
                  <div className="text-sm text-white/60">
                    {player.goals} goals, {player.points} points
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl font-bold text-gradient">{player.total}</div>
                  <div className="text-xs text-white/60">total pts</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Matches */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold mb-4 flex items-center space-x-2">
            <Calendar size={20} />
            <span>Recent</span>
          </h3>
          <div className="space-y-3">
            {recentMatches.map((match, i) => (
              <div key={i} className="p-4 rounded-xl bg-white/5 hover:bg-white/10 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{match.opponent}</div>
                  <div className={`badge ${
                    match.result === 'W' ? 'badge-success' : 
                    match.result === 'L' ? 'badge-danger' : 
                    'badge-warning'
                  }`}>
                    {match.result}
                  </div>
                </div>
                <div className="text-sm text-white/60">{match.score}</div>
                <div className="text-xs text-white/40 mt-1">{match.date}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Coming Soon Features */}
      <div className="glass-card p-8 text-center">
        <Zap size={48} className="mx-auto mb-4 text-amber-400" />
        <h2 className="text-2xl font-bold mb-3">Advanced Analytics Coming Soon</h2>
        <p className="text-white/60 mb-4">
          Performance trends • Heat maps • AI insights • Injury predictions
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <span className="badge badge-info">Recharts Integration</span>
          <span className="badge badge-info">Claude AI Analysis</span>
          <span className="badge badge-info">Multi-Match Trends</span>
          <span className="badge badge-info">Player Comparisons</span>
        </div>
      </div>

      {/* Quick Stats */}
      <div>
        <h2 className="text-2xl font-bold mb-4 flex items-center space-x-2">
          <Users size={24} />
          <span>Squad Stats</span>
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="glass-card p-6">
            <div className="text-white/60 text-sm mb-2">Active Players</div>
            <div className="text-4xl font-bold text-gradient">30</div>
          </div>
          
          <div className="glass-card p-6">
            <div className="text-white/60 text-sm mb-2">Avg Age</div>
            <div className="text-4xl font-bold text-white">24.5</div>
          </div>

          <div className="glass-card p-6">
            <div className="text-white/60 text-sm mb-2">Training Sessions</div>
            <div className="text-4xl font-bold text-amber-400">42</div>
          </div>

          <div className="glass-card p-6">
            <div className="text-white/60 text-sm mb-2">Avg Attendance</div>
            <div className="text-4xl font-bold text-emerald-400">87%</div>
          </div>
        </div>
      </div>
    </div>
  )
}
