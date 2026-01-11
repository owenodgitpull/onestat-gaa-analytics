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
  Activity,
  Play,
  Zap
} from 'lucide-react'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

export default function MatchRecording() {
  const { matchId } = useParams()
  const navigate = useNavigate()
  const [ballPosition, setBallPosition] = useState<BallPosition>({
    x: 50,
    y: 50,
    team: PossessionTeam.DUNGLOE
  })
  const [matchPhase, setMatchPhase] = useState<MatchPhase>('not_started')
  const [minute, setMinute] = useState(0)

  // Mock match data
  const match = {
    opponent: 'Glenties',
    score: { dungloe: { goals: 2, points: 8 }, opponent: { goals: 1, points: 12 } },
    minute: minute,
    status: matchPhase
  }

  const stats = {
    possession: { dungloe: 58, opponent: 42 },
    shots: { dungloe: 18, opponent: 14 },
    scores: { dungloe: 10, opponent: 13 },
    wides: { dungloe: 5, opponent: 3 },
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

  const startHalf = () => {
    if (matchPhase === 'not_started') {
      setMatchPhase('first_half')
      // TODO: Start timer
      alert('First half started! Timer will begin counting up to 30 minutes.')
    } else if (matchPhase === 'half_time') {
      setMatchPhase('second_half')
      // TODO: Continue timer
      alert('Second half started! Timer continues.')
    }
  }

  const getPhaseButtonText = () => {
    if (matchPhase === 'not_started') return 'Start First Half'
    if (matchPhase === 'half_time') return 'Start Second Half'
    return null
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
            <p className="text-white/60 mt-1">League Match - {matchPhase === 'not_started' ? 'Ready' : 'Live'}</p>
          </div>
          <div className="flex items-center space-x-4">
            {matchPhase !== 'not_started' && (
              <div className="badge badge-success flex items-center space-x-2">
                <Clock size={14} />
                <span>{match.minute}'</span>
              </div>
            )}
            {getPhaseButtonText() && (
              <button className="btn-primary flex items-center space-x-2" onClick={startHalf}>
                <Play size={18} />
                <span>{getPhaseButtonText()}</span>
              </button>
            )}
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
          {/* Pitch */}
          <div className="glass-card p-6 relative">
            <GAAPitch
              ballPosition={ballPosition}
              onBallMove={setBallPosition}
              showZones={true}
            />
            
            {/* Quick Actions at Bottom */}
            <div className="mt-4 flex justify-center">
              <div className="glass-card p-3 inline-flex space-x-2">
                <button 
                  className="btn-primary !py-2 !px-4 flex items-center space-x-2 text-sm"
                  onClick={() => handleQuickAction(EventType.GOAL)}
                >
                  <Target size={16} />
                  <span>Goal</span>
                </button>
                
                <button 
                  className="btn-primary !py-2 !px-4 flex items-center space-x-2 text-sm"
                  onClick={() => handleQuickAction(EventType.POINT)}
                >
                  <TrendingUp size={16} />
                  <span>Point</span>
                </button>

                <button 
                  className="btn-glass !py-2 !px-4 flex items-center space-x-2 text-sm"
                  onClick={() => handleQuickAction(EventType.WIDE)}
                >
                  <XCircle size={16} />
                  <span>Wide</span>
                </button>

                <button 
                  className="btn-glass !py-2 !px-4 flex items-center space-x-2 text-sm"
                  onClick={() => handleQuickAction(EventType.TURNOVER_WON)}
                >
                  <CheckCircle size={16} />
                  <span>T/O Won</span>
                </button>

                <button 
                  className="btn-glass !py-2 !px-4 flex items-center space-x-2 text-sm"
                  onClick={() => handleQuickAction(EventType.TURNOVER_LOST)}
                >
                  <AlertCircle size={16} />
                  <span>T/O Lost</span>
                </button>
              </div>
            </div>
          </div>

          {/* In-Game Analysis Section */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4 text-white flex items-center space-x-2">
              <Activity size={20} className="text-white" />
              <span>Live Analysis & Insights</span>
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Placeholder for charts */}
              <div className="bg-white/5 rounded-lg p-4 text-center text-white/60">
                <div className="text-sm mb-2">Possession Flow</div>
                <div className="h-24 flex items-center justify-center">
                  <span className="text-xs">Chart: Line graph coming soon</span>
                </div>
              </div>
              
              <div className="bg-white/5 rounded-lg p-4 text-center text-white/60">
                <div className="text-sm mb-2">Shot Accuracy Trend</div>
                <div className="h-24 flex items-center justify-center">
                  <span className="text-xs">Chart: Area chart coming soon</span>
                </div>
              </div>
            </div>
            
            {/* AI Insights Placeholder */}
            <div className="mt-4 p-4 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 rounded-lg border border-indigo-500/30">
              <div className="flex items-start space-x-3">
                <Zap size={20} className="text-amber-400 flex-shrink-0 mt-1" />
                <div>
                  <h4 className="font-semibold text-white mb-1">AI Insight</h4>
                  <p className="text-sm text-white/70">
                    Dungloe's possession in the attacking third is 12% higher than their season average. 
                    Continue applying pressure - conversion rate suggests goals are coming.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Live Stats Sidebar */}
        <div className="space-y-4">
          {/* Match Statistics Table */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white">
              <Activity size={20} className="text-white" />
              <span>Match Statistics</span>
            </h3>

            <div className="overflow-hidden rounded-lg border border-white/10">
              {/* Table Header */}
              <div className="grid grid-cols-3 bg-white/5">
                <div className="p-3 text-center text-sm font-bold text-white border-r border-white/10">Dungloe</div>
                <div className="p-3 text-center text-sm font-bold text-white border-r border-white/10">Stat</div>
                <div className="p-3 text-center text-sm font-bold text-white">{match.opponent}</div>
              </div>

              {/* Possession */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-indigo-600 border-r border-white/10">
                  {stats.possession.dungloe}%
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  POSSESSION
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-red-600">
                  {stats.possession.opponent}%
                </div>
              </div>

              {/* Shots */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900 border-r border-white/10">
                  {stats.shots.dungloe}
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  SHOTS
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900">
                  {stats.shots.opponent}
                </div>
              </div>

              {/* Scores */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-emerald-600 border-r border-white/10">
                  {stats.scores.dungloe}
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  SCORES
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-emerald-600">
                  {stats.scores.opponent}
                </div>
              </div>

              {/* Wides */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-red-600 border-r border-white/10">
                  {stats.wides.dungloe}
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  WIDES
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-red-600">
                  {stats.wides.opponent}
                </div>
              </div>

              {/* Accuracy */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-indigo-600 border-r border-white/10">
                  {stats.accuracy}%
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  ACCURACY
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-indigo-600">
                  {(stats.scores.opponent / stats.shots.opponent * 100).toFixed(1)}%
                </div>
              </div>

              {/* Conversion Rate */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-amber-600 border-r border-white/10">
                  {stats.conversionRate}%
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  CONVERSION
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-amber-600">
                  {((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1)}%
                </div>
              </div>

              {/* Turnovers */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900 border-r border-white/10">
                  {stats.turnovers.won}
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  TURNOVERS WON
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900">
                  {stats.turnovers.lost}
                </div>
              </div>

              {/* Kickouts */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900 border-r border-white/10">
                  {stats.kickouts.won}
                </div>
                <div className="p-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10">
                  KICKOUTS WON
                </div>
                <div className="p-3 text-center bg-white text-lg font-bold text-slate-900">
                  {stats.kickouts.lost}
                </div>
              </div>
            </div>
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
