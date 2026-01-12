import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import GAAPitch from '@/components/GAAPitch'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
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

interface Player {
  id: number
  name: string
  jerseyNumber: number
}

interface PendingEvent {
  eventType: EventType
  team: 'dungloe' | 'opponent'
  position: BallPosition
}

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
  const [seconds, setSeconds] = useState(0)
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false)
  const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null)

  // Timer effect
  useEffect(() => {
    if (matchPhase === 'first_half' || matchPhase === 'second_half') {
      const interval = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= 59) {
            setMinute((m) => m + 1)
            return 0
          }
          return prev + 1
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [matchPhase])

  // Mock match data - START AT 0-00
  const match = {
    opponent: 'Glenties',
    score: { dungloe: { goals: 0, points: 0 }, opponent: { goals: 0, points: 0 } },
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

  // Calculate kickout retention %
  const dungloeKickoutRetention = ((stats.kickouts.won / (stats.kickouts.won + stats.kickouts.lost)) * 100).toFixed(1)
  const opponentKickoutRetention = ((stats.kickouts.lost / (stats.kickouts.won + stats.kickouts.lost)) * 100).toFixed(1)

  const handleQuickAction = (eventType: EventType) => {
    console.log('Quick action:', eventType, 'at position:', ballPosition)
    // Open player selection modal
    setPendingEvent({
      eventType: eventType as EventType,
      team: 'dungloe', // TODO: Determine team based on context
      position: ballPosition
    })
    setIsPlayerModalOpen(true)
  }

  const handlePlayerSelected = (player: Player) => {
    if (!pendingEvent) return
    
    console.log('Event recorded:', {
      ...pendingEvent,
      player: player,
      minute: minute,
      second: seconds
    })
    
    // TODO: Call API to record event
    // await recordMatchEvent(matchId, { ...pendingEvent, playerId: player.id })
    
    // Close modal and reset
    setIsPlayerModalOpen(false)
    setPendingEvent(null)
  }

  const startHalf = () => {
    if (matchPhase === 'not_started') {
      setMatchPhase('first_half')
      setMinute(0)
      setSeconds(0)
    } else if (matchPhase === 'half_time') {
      setMatchPhase('second_half')
    }
  }

  const getPhaseButtonText = () => {
    if (matchPhase === 'not_started') return 'Start First Half'
    if (matchPhase === 'half_time') return 'Start Second Half'
    return null
  }

  const formatTime = () => {
    return `${minute}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <div className="min-h-screen pb-8">
      {/* Compact Match Header */}
      <div className="glass-card p-4 mb-6">
        <div className="grid grid-cols-3 gap-4 items-center">
          {/* Left: Match Info & Timer */}
          <div className="space-y-2">
            <h1 className="text-xl font-bold text-white">
              Dungloe vs {match.opponent}
            </h1>
            <p className="text-white/60 text-sm">League Match - {matchPhase === 'not_started' ? 'Ready' : 'Live'}</p>
            {matchPhase !== 'not_started' && (
              <div className="badge badge-success flex items-center space-x-2 inline-flex animate-pulse">
                <Clock size={14} />
                <span className="font-mono">{formatTime()}</span>
              </div>
            )}
          </div>

          {/* Center: Score */}
          <div className="flex items-center justify-center space-x-4 text-center">
            <div>
              <div className="text-4xl font-bold text-white">
                {match.score.dungloe.goals}-{String(match.score.dungloe.points).padStart(2, '0')}
              </div>
              <div className="text-white/60 text-xs mt-1">Dungloe</div>
            </div>
            <div className="text-xl text-white/40">vs</div>
            <div>
              <div className="text-4xl font-bold text-white/80">
                {match.score.opponent.goals}-{String(match.score.opponent.points).padStart(2, '0')}
              </div>
              <div className="text-white/60 text-xs mt-1">{match.opponent}</div>
            </div>
          </div>

          {/* Right: Quick Stats & Actions */}
          <div className="flex flex-col items-end space-y-2">
            <div className="flex items-center space-x-2">
              <div className="text-right">
                <div className="text-xs text-white/60">Possession</div>
                <div className="text-sm font-bold text-indigo-400">{stats.possession.dungloe}%</div>
              </div>
              <div className="text-right">
                <div className="text-xs text-white/60">Accuracy</div>
                <div className="text-sm font-bold text-emerald-400">{stats.accuracy}%</div>
              </div>
            </div>
            <div className="flex items-center space-x-2">
              {getPhaseButtonText() && (
                <button className="btn-primary flex items-center space-x-1 !py-1 !px-3 text-sm" onClick={startHalf}>
                  <Play size={14} />
                  <span>{getPhaseButtonText()}</span>
                </button>
              )}
              <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white font-medium shadow-lg hover:shadow-xl hover:from-orange-700 hover:to-amber-700 transition-all text-sm" onClick={() => navigate('/')}>
                End Match
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Pitch Area */}
        <div className="lg:col-span-2">
          {/* Pitch */}
          <div className="glass-card p-6 relative mb-4">
            <GAAPitch
              ballPosition={ballPosition}
              onBallMove={setBallPosition}
              showZones={true}
            />
            
            {/* Categorized Action Buttons - Overlapping Bottom of Pitch */}
            <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 z-10 w-full max-w-2xl px-4">
              <CategorizedActionButtons onActionSelect={handleQuickAction} />
            </div>
          </div>

          {/* In-Game Analysis Section - Extra spacing added */}
          <div className="glass-card p-6" style={{ marginTop: '4rem' }}>
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
              {/* Table Header - Container-Header Highlight */}
              <div className="grid grid-cols-3 bg-blue-600/30 border border-blue-500/50">
                <div className="py-2 px-3 text-center text-sm font-bold text-white border-r border-blue-500/50">Dungloe</div>
                <div className="py-2 px-3 text-center text-sm font-bold text-white border-r border-blue-500/50">Stat</div>
                <div className="py-2 px-3 text-center text-sm font-bold text-white">{match.opponent}</div>
              </div>

              {/* Possession */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.possession.dungloe}%
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  POSSESSION
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.possession.opponent}%
                </div>
              </div>

              {/* Shots */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.shots.dungloe}
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  SHOTS
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.shots.opponent}
                </div>
              </div>

              {/* Scores */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.scores.dungloe}
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  SCORES
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.scores.opponent}
                </div>
              </div>

              {/* Wides */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.wides.dungloe}
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  WIDES
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.wides.opponent}
                </div>
              </div>

              {/* Accuracy */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.accuracy}%
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  ACCURACY
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {(stats.scores.opponent / stats.shots.opponent * 100).toFixed(1)}%
                </div>
              </div>

              {/* Conversion Rate */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.conversionRate}%
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  CONVERSION
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1)}%
                </div>
              </div>

              {/* Turnovers */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.turnovers.won}
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  TURNOVERS WON
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.turnovers.lost}
                </div>
              </div>

              {/* Kickouts */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {stats.kickouts.won}
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  KICKOUTS WON
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {stats.kickouts.lost}
                </div>
              </div>

              {/* Kickout Retention % */}
              <div className="grid grid-cols-3 border-t border-white/10">
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black border-r border-white/10 flex items-center justify-center">
                  {dungloeKickoutRetention}%
                </div>
                <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                  KICKOUT RETENTION
                </div>
                <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                  {opponentKickoutRetention}%
                </div>
              </div>
            </div>
          </div>

          {/* Recent Events */}
          <div className="glass-card p-6">
            <h3 className="text-lg font-semibold mb-4 text-white">Recent Events</h3>
            <div className="space-y-2 text-sm">
              {[
                { time: "34'", event: 'Point - Barry Curran', type: 'score' },
                { time: "32'", event: 'Turnover Won - Oran Gallagher', type: 'positive' },
                { time: "29'", event: 'Wide - Ryan Grannell', type: 'negative' },
                { time: "27'", event: 'Goal - Shaun McGee', type: 'score' },
                { time: "24'", event: 'Kickout Won - Paddy Bonner', type: 'positive' },
              ].map((event, i) => (
                <div 
                  key={i} 
                  className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${
                    i % 2 === 0 ? 'bg-white/[0.07]' : 'bg-white/[0.03]'
                  } hover:bg-white/10`}
                >
                  <div className="badge badge-info w-12 text-center text-white">{event.time}</div>
                  <div className="flex-1 text-white/90">{event.event}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Player Selection Modal */}
      {pendingEvent && (
        <PlayerSelectionModal
          isOpen={isPlayerModalOpen}
          onClose={() => {
            setIsPlayerModalOpen(false)
            setPendingEvent(null)
          }}
          onSelectPlayer={handlePlayerSelected}
          eventType={pendingEvent.eventType as any}
          team={pendingEvent.team}
        />
      )}
    </div>
  )
}
