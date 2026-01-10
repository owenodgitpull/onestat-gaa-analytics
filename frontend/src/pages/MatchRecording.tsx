import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import GAAPitch from '@/components/GAAPitch'
import { BallPosition, PossessionTeam, EventType } from '@/types'
import { 
  Target, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle, 
  XCircle,
  User,
  Users,
  Clock,
  Activity
} from 'lucide-react'

export default function MatchRecording() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const [ballPosition, setBallPosition] = useState<BallPosition>({
    x: 50,
    y: 50,
    team: PossessionTeam.DUNGLOE
  })

  // Mock match data
  const match = {
    opponent: 'Glenties',
    score: { dungloe: { goals: 2, points: 8 }, opponent: { goals: 1, points: 12 } },
    minute: 34,
    status: 'in_progress'
  }

  const stats = {
    possession: 58,
    shots: 18,
    scores: 10,
    wides: 5,
    accuracy: 55.6,
    conversionRate: 62.5,
    turnovers: { won: 9, lost: 6 },
    kickouts: { won: 8, lost: 5 }
  }

  const handleQuickAction = (eventType: EventType) => {
    console.log('Quick action:', eventType, 'at position:', ballPosition)
    // TODO: Open player selection modal
    alert(`${eventType} - Player selection modal coming next!`)
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Match Header */}
      <div className="glass-card p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-3xl font-bold text-gradient">
              Dungloe vs {match.opponent}
            </h1>
            <p className="text-white/60 mt-1">League Match - Live</p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="badge badge-success flex items-center space-x-2">
              <Clock size={14} />
              <span>{match.minute}'</span>
            </div>
            <button className="btn-danger" onClick={() => navigate('/')}>
              End Match
            </button>
          </div>
        </div>

        {/* Score */}
        <div className="flex items-center justify-center space-x-8 text-center">
          <div>
            <div className="text-5xl font-bold text-gradient-gold">
              {match.score.dungloe.goals}-{String(match.score.dungloe.points).padStart(2, '0')}
            </div>
            <div className="text-white/60 text-sm mt-2">Dungloe</div>
          </div>
          <div className="text-2xl text-white/40">vs</div>
          <div>
            <div className="text-5xl font-bold text-white/80">
              {match.score.opponent.goals}-{String(match.score.opponent.points).padStart(2, '0')}
            </div>
            <div className="text-white/60 text-sm mt-2">{match.opponent}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Pitch Area */}
        <div className="lg:col-span-2 space-y-4">
          <div className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Pitch</h2>
              <div className="flex items-center space-x-2 text-sm text-white/60">
                <Activity size={16} />
                <span>Tap pitch to move ball</span>
              </div>
            </div>
            <GAAPitch
              ballPosition={ballPosition}
              onBallMove={setBallPosition}
              showZones={true}
            />
          </div>

          {/* Action Buttons */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4">Quick Actions</h3>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <button 
                className="btn-primary flex flex-col items-center space-y-2 py-4"
                onClick={() => handleQuickAction(EventType.GOAL)}
              >
                <Target size={24} />
                <span className="text-sm">Goal</span>
              </button>
              
              <button 
                className="btn-primary flex flex-col items-center space-y-2 py-4"
                onClick={() => handleQuickAction(EventType.POINT)}
              >
                <TrendingUp size={24} />
                <span className="text-sm">Point</span>
              </button>

              <button 
                className="btn-glass flex flex-col items-center space-y-2 py-4"
                onClick={() => handleQuickAction(EventType.WIDE)}
              >
                <XCircle size={24} />
                <span className="text-sm">Wide</span>
              </button>

              <button 
                className="btn-glass flex flex-col items-center space-y-2 py-4"
                onClick={() => handleQuickAction(EventType.TURNOVER_WON)}
              >
                <CheckCircle size={24} />
                <span className="text-sm">T/O Won</span>
              </button>

              <button 
                className="btn-glass flex flex-col items-center space-y-2 py-4"
                onClick={() => handleQuickAction(EventType.TURNOVER_LOST)}
              >
                <AlertCircle size={24} />
                <span className="text-sm">T/O Lost</span>
              </button>
            </div>
          </div>
        </div>

        {/* Live Stats Sidebar */}
        <div className="space-y-4">
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2">
              <Activity size={20} />
              <span>Match Stats</span>
            </h3>

            {/* Possession */}
            <div className="mb-6">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-white/80">Possession</span>
                <span className="text-gradient font-semibold">{stats.possession}%</span>
              </div>
              <div className="h-3 bg-white/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500"
                  style={{ width: `${stats.possession}%` }}
                />
              </div>
            </div>

            {/* Stats Grid */}
            <div className="space-y-3">
              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Shots</div>
                <div className="stat-value text-2xl">{stats.shots}</div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Scores</div>
                <div className="stat-value text-2xl text-emerald-400">{stats.scores}</div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Accuracy</div>
                <div className="stat-value text-2xl">{stats.accuracy}%</div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Conversion Rate</div>
                <div className="stat-value text-2xl text-amber-400">{stats.conversionRate}%</div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Wides</div>
                <div className="stat-value text-2xl text-red-400">{stats.wides}</div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Turnovers</div>
                <div className="flex items-center justify-center space-x-4 mt-2">
                  <div className="text-center">
                    <div className="text-xl font-bold text-emerald-400">{stats.turnovers.won}</div>
                    <div className="text-xs text-white/60">Won</div>
                  </div>
                  <div className="text-white/40">/</div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-red-400">{stats.turnovers.lost}</div>
                    <div className="text-xs text-white/60">Lost</div>
                  </div>
                </div>
              </div>

              <div className="stat-card bg-white/5 !p-4">
                <div className="stat-label">Kickouts</div>
                <div className="flex items-center justify-center space-x-4 mt-2">
                  <div className="text-center">
                    <div className="text-xl font-bold text-emerald-400">{stats.kickouts.won}</div>
                    <div className="text-xs text-white/60">Won</div>
                  </div>
                  <div className="text-white/40">/</div>
                  <div className="text-center">
                    <div className="text-xl font-bold text-red-400">{stats.kickouts.lost}</div>
                    <div className="text-xs text-white/60">Lost</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Events */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Events</h3>
            <div className="space-y-3 text-sm">
              {[
                { time: "34'", event: 'Point - Barry Curran', type: 'score' },
                { time: "32'", event: 'Turnover Won - Oran Gallagher', type: 'positive' },
                { time: "29'", event: 'Wide - Ryan Grannell', type: 'negative' },
                { time: "27'", event: 'Goal - Shaun McGee', type: 'score' },
                { time: "24'", event: 'Kickout Won - Paddy Bonner', type: 'positive' },
              ].map((event, i) => (
                <div key={i} className="flex items-center space-x-3 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors">
                  <div className="badge badge-info w-12 text-center">{event.time}</div>
                  <div className="flex-1 text-white/80">{event.event}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
