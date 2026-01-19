import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import GAAPitch from '@/components/GAAPitch'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import { BallPosition, PossessionTeam, EventType, Player } from '@/types'
import { useMatch, useMatchStats, useStartMatch, useCompleteMatch } from '@/hooks/useMatches'
import { useRecordEvent } from '@/hooks/useMatchEvents'
import { useRecordPossession } from '@/hooks/usePossession'
import { usePlayers } from '@/hooks/usePlayers'
import {
  Clock,
  Activity,
  Play,
  Zap,
  AlertCircle
} from 'lucide-react'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

interface PendingEvent {
  eventType: EventType
  team: 'dungloe' | 'opponent'
  position: BallPosition
}

export default function MatchRecording() {
  const { matchId: matchIdParam } = useParams()
  const matchId = matchIdParam || null
  const navigate = useNavigate()

  // Fetch data from backend
  const { data: match, isLoading: matchLoading } = useMatch(matchId)
  const { data: matchStats, isLoading: statsLoading } = useMatchStats(matchId)
  const { data: players = [] } = usePlayers()

  // Mutations
  const startMatch = useStartMatch()
  const completeMatch = useCompleteMatch()
  const recordEvent = useRecordEvent()
  const recordPossession = useRecordPossession()

  // Local state
  const [ballPosition, setBallPosition] = useState<BallPosition>({
    x: 50,
    y: 50,
    team: PossessionTeam.DUNGLOE
  })
  const [matchPhase, setMatchPhase] = useState<MatchPhase>('not_started')
  const [minute, setMinute] = useState(0)
  const [seconds, setSeconds] = useState(0)
  const [currentHalf, setCurrentHalf] = useState<1 | 2>(1)
  const [isPlayerModalOpen, setIsPlayerModalOpen] = useState(false)
  const [isPossessionModalOpen, setIsPossessionModalOpen] = useState(false)
  const [pendingEvent, setPendingEvent] = useState<PendingEvent | null>(null)
  const [activeKickoutTab, setActiveKickoutTab] = useState<string | null>('scoring')
  const [awaitingKickout, setAwaitingKickout] = useState(false) // Lock ball until kickout resolved

  // Query client for manual refetching
  const queryClient = useQueryClient()

  // Sync match status with backend
  useEffect(() => {
    if (match) {
      console.log('Match data loaded:', match) // Debug log
      if (match.status === 'in_progress' && matchPhase === 'not_started') {
        setMatchPhase('first_half')
      } else if (match.status === 'completed' && matchPhase !== 'finished') {
        setMatchPhase('finished')
      }
    }
  }, [match])

  // Timer effect
  useEffect(() => {
    if (matchPhase === 'first_half' || matchPhase === 'second_half') {
      const interval = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= 59) {
            setMinute((m) => {
              // Auto-pause at 30 minutes (half-time)
              if (m >= 29 && matchPhase === 'first_half') {
                setMatchPhase('half_time')
                return m + 1
              }
              // Auto-finish at 60 minutes
              if (m >= 59 && matchPhase === 'second_half') {
                setMatchPhase('finished')
                return m + 1
              }
              return m + 1
            })
            return 0
          }
          return prev + 1
        })
      }, 1000)
      return () => clearInterval(interval)
    }
  }, [matchPhase])

  // Calculate real-time stats from backend - now using MatchStats directly
  // Backend calculates scores as (goals*3 + points), so we need to reverse-engineer for display
  const dungloeGoals = match?.dungloe_goals || 0
  const dungloePoints = match?.dungloe_points || 0
  const opponentGoals = match?.opponent_goals || 0
  const opponentPoints = match?.opponent_points || 0

  // Get other stats directly from matchStats API response
  const dungloeShots = matchStats?.dungloe_total_shots || 0
  const opponentShots = matchStats?.opponent_total_shots || 0
  const dungloeWides = matchStats?.dungloe_wides || 0
  const opponentWides = matchStats?.opponent_wides || 0
  const dungloeScores = matchStats?.dungloe_scores || 0
  const opponentScores = matchStats?.opponent_scores || 0

  // Calculate accuracy
  const dungloeAccuracy = matchStats?.dungloe_accuracy?.toFixed(1) || '0'

  // Calculate possession % from backend stats (time-based, not event count)
  const dungloePossessionPct = matchStats?.dungloe_possession_percentage?.toFixed(0) || '0'
  const opponentPossessionPct = matchStats?.opponent_possession_percentage?.toFixed(0) || '0'

  // Use backend matchStats for all statistics (already calculated correctly)
  const dungloeTurnoversWon = matchStats?.dungloe_turnovers_won || 0
  const dungloeTurnoversLost = matchStats?.dungloe_turnovers_lost || 0
  const dungloeKickoutsWon = matchStats?.dungloe_kickouts_won || 0
  const dungloeKickoutsLost = matchStats?.dungloe_kickouts_lost || 0

  const totalKickouts = dungloeKickoutsWon + dungloeKickoutsLost
  const dungloeKickoutRetention = totalKickouts > 0 ? ((dungloeKickoutsWon / totalKickouts) * 100).toFixed(1) : '0.0'
  const opponentKickoutRetention = totalKickouts > 0 ? ((dungloeKickoutsLost / totalKickouts) * 100).toFixed(1) : '0.0'

  // Recent events - for now show empty array until we add a separate events endpoint
  const recentEvents: any[] = []

  // Match display data
  const matchDisplay = {
    opponent: match?.opponent || 'Loading...',
    score: {
      dungloe: { goals: dungloeGoals, points: dungloePoints },
      opponent: { goals: opponentGoals, points: opponentPoints }
    },
    minute: minute,
    status: matchPhase
  }

  const stats = {
    possession: { dungloe: parseInt(dungloePossessionPct), opponent: parseInt(opponentPossessionPct) },
    shots: { dungloe: dungloeShots, opponent: opponentShots },
    scores: { dungloe: dungloeScores, opponent: opponentScores },
    wides: { dungloe: dungloeWides, opponent: opponentWides },
    accuracy: parseFloat(dungloeAccuracy),
    conversionRate: dungloeShots > 0 ? parseFloat(((dungloeScores / dungloeShots) * 100).toFixed(1)) : 0,
    turnovers: { won: dungloeTurnoversWon, lost: dungloeTurnoversLost },
    kickouts: { won: dungloeKickoutsWon, lost: dungloeKickoutsLost }
  }

  const handleBallMove = async (newPosition: BallPosition) => {
    // Block ball movement if awaiting kickout resolution
    if (awaitingKickout) {
      console.log('Ball movement blocked - awaiting kickout resolution')
      return
    }

    // Only record if match is in progress
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished' || matchPhase === 'half_time') {
      return
    }

    // Update local ball position
    setBallPosition(newPosition)

    // Record possession event to backend
    try {
      await recordPossession.mutateAsync({
        match_id: matchId,
        x_coord: newPosition.x,
        y_coord: newPosition.y,
        team: newPosition.team === PossessionTeam.DUNGLOE ? 'home' : 'away',
        timestamp: new Date(),
        minute: minute,
        half: currentHalf
      })
      console.log('Possession recorded:', newPosition)
    } catch (error) {
      console.error('Failed to record possession:', error)
      // Don't show alert for possession tracking errors (too disruptive)
    }
  }

  // Map frontend event types (from UI buttons) to backend API event types
  const mapEventTypeToBackend = (frontendEventType: string): string => {
    // Remove case sensitivity
    const eventLower = frontendEventType.toLowerCase()

    // Map frontend button types to backend enum values
    const mapping: Record<string, string> = {
      // Scoring (already match backend)
      'goal': 'goal',
      'point': 'point',
      'wide': 'wide',
      'saved': 'saved',

      // Turnovers - Opposition forced
      'turnover_won': 'turnover_won',      // We won via tackle/pressure
      'turnover_lost': 'turnover_lost',    // They won via tackle/pressure

      // Unforced Errors - Own mistakes (distinct from forced turnovers!)
      'our_unforced_error': 'unforced_error',   // Our player's mistake
      'opp_unforced_error': 'unforced_error',   // Their player's mistake

      // Kickouts - Clear mapping: "Dungloe Won" or "Opposition Won"
      'own_kickout_dungloe_won': 'kickout_won',           // Dungloe's kickout, Dungloe won
      'own_kickout_opposition_won': 'kickout_lost',       // Dungloe's kickout, Opposition won (Dungloe lost)
      'opp_kickout_dungloe_won': 'kickout_won',           // Opp's kickout, Dungloe won
      'opp_kickout_opposition_won': 'kickout_won',        // Opp's kickout, Opposition won

      // Breaking balls - same logic
      'own_kickout_dungloe_won_break': 'breaking_ball_won',      // Dungloe won break
      'own_kickout_opposition_won_break': 'breaking_ball_won',   // Opposition won break
      'opp_kickout_dungloe_won_break': 'breaking_ball_won',      // Dungloe won break
      'opp_kickout_opposition_won_break': 'breaking_ball_won',   // Opposition won break
    }

    return mapping[eventLower] || eventLower  // Fallback to original if no mapping
  }

  const handleQuickAction = (eventType: EventType) => {
    console.log('Quick action:', eventType, 'at position:', ballPosition)
    console.log('Ball possession team:', ballPosition.team)

    // NEW PRINCIPLE: Buttons explicitly say "Dungloe Won" or "Opposition Won"
    // "Dungloe Won" → needs Dungloe player selection, is_home_team: true
    // "Opposition Won" → no player needed, is_home_team: false

    const eventStr = String(eventType).toUpperCase()
    const isDungloeWon = eventStr.includes('DUNGLOE_WON')
    const isOppositionWon = eventStr.includes('OPPOSITION_WON')

    // Determine team based on event type
    let isHomeTeam: boolean

    if (isDungloeWon) {
      // ANY "Dungloe Won" event → Dungloe team
      isHomeTeam = true
    } else if (isOppositionWon) {
      // ANY "Opposition Won" event → opponent team
      isHomeTeam = false
    } else if (eventType === EventType.TURNOVER_WON) {
      // Turnover Won → Always Dungloe (we won the ball)
      isHomeTeam = true
    } else if (eventType === EventType.TURNOVER_LOST) {
      // Turnover Lost → Dungloe player lost it (we want to track which Dungloe player made the error)
      isHomeTeam = true
    } else if (eventStr.startsWith('OWN_')) {
      // OWN_ prefix = Dungloe action
      isHomeTeam = true
    } else {
      // No prefix (GOAL, POINT, WIDE) = use POSSESSION
      isHomeTeam = ballPosition.team === PossessionTeam.DUNGLOE
    }

    console.log('Determined isHomeTeam:', isHomeTeam, 'for event:', eventType)

    // Events that don't require player selection
    // Only "Opposition Won" events (we don't track their players)
    const noPlayerNeeded = [
      EventType.OWN_KICKOUT_OPPOSITION_WON,
      EventType.OPP_KICKOUT_OPPOSITION_WON,
      EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
      EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
    ]

    // Opponent scoring - check if opponent has possession
    const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.WIDE]
    const isOpponentScoring = scoringEvents.includes(eventType) && !isHomeTeam

    if (noPlayerNeeded.includes(eventType as EventType) || isOpponentScoring) {
      // Record immediately without player selection
      recordEventWithoutPlayer(eventType, isHomeTeam)
    } else {
      // Open player selection modal for Dungloe players
      // This includes ALL "Dungloe Won" events and Dungloe scoring
      setPendingEvent({
        eventType: eventType as EventType,
        team: isHomeTeam ? 'dungloe' : 'opponent',
        position: ballPosition
      })
      setIsPlayerModalOpen(true)
    }
  }

  const recordEventWithoutPlayer = async (eventType: EventType, isHomeTeam: boolean) => {
    if (!matchId) return

    try {
      const backendEventType = mapEventTypeToBackend(eventType)

      console.log('Recording event without player:', {
        frontendType: eventType,
        backendType: backendEventType,
        isHomeTeam
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: undefined, // No player for contested events
        event_type: backendEventType,
        minute: minute,
        half: currentHalf,
        x_coord: ballPosition.x,
        y_coord: ballPosition.y,
        is_home_team: isHomeTeam,
        notes: undefined
      })

      // Check if this was a scoring event - reset ball and auto-select kickout tab
      const scoringEvents = [EventType.GOAL, EventType.POINT]
      const isScore = scoringEvents.includes(eventType)

      // Check if this was a dead ball event - only WIDE results in kickout
      // SAVED stays in play (keeper can run with it or pass)
      const deadBallEvents = [EventType.WIDE]
      const isDeadBall = deadBallEvents.includes(eventType)

      // Check if this was a kickout/breaking ball event (check the actual eventType enum value)
      const eventTypeStr = String(eventType).toUpperCase()
      const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')

      // Check who won the kickout/break
      const isDungloeWonKickout = eventTypeStr.includes('DUNGLOE_WON')
      const isOppositionWonKickout = eventTypeStr.includes('OPPOSITION_WON')

      if (isScore || isDeadBall) {
        // Reset ball to center midfield after score or dead ball
        const kickoutTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        setBallPosition({
          x: 50,  // Center horizontally
          y: 50,  // Center vertically (midfield)
          team: kickoutTeam  // Other team gets kickout
        })

        // Auto-select appropriate kickout tab
        setActiveKickoutTab(isHomeTeam ? 'opp_kickouts' : 'our_kickouts')

        // Lock ball until kickout is resolved
        setAwaitingKickout(true)

        console.log('Ball reset to center midfield for kickout, tab auto-selected after:', eventType)
      } else {
        // For ALL non-scoring events, return to scoring tab
        setActiveKickoutTab(null)

        if (isKickoutEvent) {
          // After kickout/break event without player, update possession based on who won
          if (isOppositionWonKickout) {
            // Opposition won the kickout/break → Opposition gets possession
            setBallPosition(prev => ({
              ...prev,
              team: PossessionTeam.OPPONENT
            }))

            // Record possession change to backend
            try {
              await recordPossession.mutateAsync({
                match_id: matchId,
                x_coord: ballPosition.x,
                y_coord: ballPosition.y,
                team: 'away',  // Opposition
                timestamp: new Date(),
                minute: minute,
                half: currentHalf
              })
              console.log('Opposition won kickout - possession updated')
            } catch (error) {
              console.error('Failed to record kickout possession:', error)
            }
          }

          // Unlock ball - kickout resolved!
          setAwaitingKickout(false)

          console.log('Kickout event resolved, returning to scoring tab')
        }
      }

      // Force refetch stats immediately after event
      await queryClient.invalidateQueries({ queryKey: ['match', matchId, 'stats'] })

      console.log('Event recorded without player selection')
    } catch (error) {
      console.error('Failed to record event:', error)
      alert('Failed to record event. Please try again.')
    }
  }

  const handlePlayerSelected = async (player: Player) => {
    if (!pendingEvent || !matchId) return

    console.log('Event recorded:', {
      ...pendingEvent,
      player: player,
      minute: minute,
      second: seconds
    })

    // Record event to backend
    try {
      // Map frontend event type to backend API enum
      const backendEventType = mapEventTypeToBackend(pendingEvent.eventType)

      console.log('Recording event with player:', {
        frontendType: pendingEvent.eventType,
        backendType: backendEventType,
        player: player.name,
        team: pendingEvent.team
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: player.id,
        event_type: backendEventType,  // Use mapped backend type
        minute: minute,
        half: currentHalf,
        x_coord: pendingEvent.position.x,
        y_coord: pendingEvent.position.y,
        is_home_team: pendingEvent.team === 'dungloe',
        notes: undefined
      })

      // Check if this was a scoring event (goal or point)
      const scoringEvents = [EventType.GOAL, EventType.POINT]
      const isScore = scoringEvents.includes(pendingEvent.eventType as EventType)

      // Check if this was a dead ball event - only WIDE results in kickout
      // SAVED stays in play (keeper can run with it or pass)
      const deadBallEvents = [EventType.WIDE]
      const isDeadBall = deadBallEvents.includes(pendingEvent.eventType as EventType)

      // Check if this was a kickout/breaking ball event with player selection
      const eventTypeStr = String(pendingEvent.eventType).toUpperCase()
      const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')

      // Check who won the kickout/break
      const isDungloeWonKickout = eventTypeStr.includes('DUNGLOE_WON')
      const isOppositionWonKickout = eventTypeStr.includes('OPPOSITION_WON')

      if (isScore || isDeadBall) {
        // Reset ball to center midfield after score or dead ball
        // After score/wide/short/saved, the defending team takes kickout
        const kickoutTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        setBallPosition({
          x: 50,  // Center horizontally
          y: 50,  // Center vertically (midfield)
          team: kickoutTeam  // Other team gets kickout
        })

        // Auto-select appropriate kickout tab
        setActiveKickoutTab(pendingEvent.team === 'dungloe' ? 'opp_kickouts' : 'our_kickouts')

        // Lock ball until kickout is resolved
        setAwaitingKickout(true)

        console.log('Ball reset to center midfield for kickout, tab auto-selected after:', pendingEvent.eventType)
      } else {
        // For ALL non-scoring events, return to scoring tab
        setActiveKickoutTab(null)

        if (isKickoutEvent) {
          // After kickout/break event, update possession based on who won
          if (isDungloeWonKickout) {
            // Dungloe won the kickout/break → Dungloe gets possession
            setBallPosition(prev => ({
              ...prev,
              team: PossessionTeam.DUNGLOE
            }))

            // Record possession change to backend
            try {
              await recordPossession.mutateAsync({
                match_id: matchId,
                x_coord: pendingEvent.position.x,
                y_coord: pendingEvent.position.y,
                team: 'home',  // Dungloe
                timestamp: new Date(),
                minute: minute,
                half: currentHalf
              })
              console.log('Dungloe won kickout - possession updated')
            } catch (error) {
              console.error('Failed to record kickout possession:', error)
            }
          } else if (isOppositionWonKickout) {
            // Opposition won the kickout/break → Opposition gets possession
            setBallPosition(prev => ({
              ...prev,
              team: PossessionTeam.OPPONENT
            }))

            // Record possession change to backend
            try {
              await recordPossession.mutateAsync({
                match_id: matchId,
                x_coord: pendingEvent.position.x,
                y_coord: pendingEvent.position.y,
                team: 'away',  // Opposition
                timestamp: new Date(),
                minute: minute,
                half: currentHalf
              })
              console.log('Opposition won kickout - possession updated')
            } catch (error) {
              console.error('Failed to record kickout possession:', error)
            }
          }

          // Unlock ball - kickout resolved!
          setAwaitingKickout(false)

          console.log('Kickout/breaking ball event with player resolved, returning to scoring tab')
        }
      }

      // Auto-change possession for turnover events, shots that drop short, and saved shots
      const turnoverEventStr = String(pendingEvent.eventType).toUpperCase()
      if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED')) {
        // Determine new possession based on event type
        let newTeam: PossessionTeam

        if (turnoverEventStr.includes('TURNOVER_WON')) {
          // Dungloe won the ball → Dungloe gets possession
          newTeam = PossessionTeam.DUNGLOE
        } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
          // Dungloe lost the ball → Opponent gets possession
          newTeam = PossessionTeam.OPPONENT
        } else if (turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED')) {
          // Shot dropped short or saved (keeper has it) → Opponent gets possession
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        } else if (turnoverEventStr.includes('UNFORCED_ERROR')) {
          // Unforced error → Other team gets possession
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        } else {
          // Fallback (shouldn't reach here)
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        }

        const newBallPosition = { ...pendingEvent.position, team: newTeam }
        setBallPosition(newBallPosition)

        // Record the possession change to backend
        try {
          await recordPossession.mutateAsync({
            match_id: matchId,
            x_coord: newBallPosition.x,
            y_coord: newBallPosition.y,
            team: newTeam === PossessionTeam.DUNGLOE ? 'home' : 'away',
            timestamp: new Date(),
            minute: minute,
            half: currentHalf
          })
          console.log('Possession change recorded:', newTeam, 'after:', pendingEvent.eventType)
        } catch (error) {
          console.error('Failed to record possession:', error)
        }
      }

      // Force refetch stats immediately after event
      await queryClient.invalidateQueries({ queryKey: ['match', matchId, 'stats'] })

      console.log('Event recorded successfully!')
    } catch (error) {
      console.error('Failed to record event:', error)
      alert('Failed to record event. Please try again.')
    }

    // Close modal and reset
    setIsPlayerModalOpen(false)
    setPendingEvent(null)
  }

  const startHalf = async () => {
    if (!matchId) return

    if (matchPhase === 'not_started') {
      // Show possession modal instead of starting immediately
      setIsPossessionModalOpen(true)
    } else if (matchPhase === 'half_time') {
      // Show possession modal for second half
      setIsPossessionModalOpen(true)
    }
  }

  const handlePossessionSelected = async (team: 'home' | 'away') => {
    setIsPossessionModalOpen(false)

    // Set initial possession
    setBallPosition(prev => ({
      ...prev,
      team: team === 'home' ? PossessionTeam.DUNGLOE : PossessionTeam.OPPONENT
    }))

    // Start the match/half
    if (matchPhase === 'not_started') {
      try {
        if (matchId) {
          await startMatch.mutateAsync(matchId)
        }
        setMatchPhase('first_half')
        setCurrentHalf(1)
        setMinute(0)
        setSeconds(0)
      } catch (error) {
        console.error('Failed to start match:', error)
        alert('Failed to start match. Please try again.')
      }
    } else if (matchPhase === 'half_time') {
      setMatchPhase('second_half')
      setCurrentHalf(2)
      setMinute(30)
      setSeconds(0)
    }
  }

  const endMatch = async () => {
    if (!matchId) return

    try {
      await completeMatch.mutateAsync(matchId)
      setMatchPhase('finished')
      navigate('/')
    } catch (error) {
      console.error('Failed to end match:', error)
      alert('Failed to end match. Please try again.')
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
      {/* Loading State - Only on initial load, not refetches */}
      {(matchLoading || statsLoading) && !match && (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-white text-lg">Loading match data...</div>
        </div>
      )}

      {/* Compact Match Header */}
      {match && (
        <>
          <div className="glass-card p-4 mb-6">
            <div className="grid grid-cols-3 gap-4 items-center">
              {/* Left: Match Info & Timer */}
              <div className="space-y-2">
                <h1 className="text-xl font-bold text-white">
                  Dungloe vs {matchDisplay.opponent}
                </h1>
                <p className="text-white/60 text-sm">League Match - {matchPhase === 'not_started' ? 'Ready' : 'Live'}</p>
                {matchPhase !== 'not_started' && (
                  <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 animate-pulse">
                    <Clock size={20} className="text-emerald-400" />
                    <span className="font-mono text-2xl font-bold text-white">{formatTime()}</span>
                  </div>
                )}
              </div>

              {/* Center: Score */}
              <div className="flex items-center justify-center space-x-4 text-center">
                <div>
                  <div className="text-4xl font-bold text-white">
                    {matchDisplay.score.dungloe.goals}-{String(matchDisplay.score.dungloe.points).padStart(2, '0')}
                  </div>
                  <div className="text-white/60 text-xs mt-1">Dungloe</div>
                </div>
                <div className="text-xl text-white/40">vs</div>
                <div>
                  <div className="text-4xl font-bold text-white/80">
                    {matchDisplay.score.opponent.goals}-{String(matchDisplay.score.opponent.points).padStart(2, '0')}
                  </div>
                  <div className="text-white/60 text-xs mt-1">{matchDisplay.opponent}</div>
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
                  <button className="px-4 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white font-medium shadow-lg hover:shadow-xl hover:from-orange-700 hover:to-amber-700 transition-all text-sm" onClick={endMatch}>
                    End Match
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Pitch Area */}
            <div className="lg:col-span-2">
              {/* Kickout Warning Banner */}
              {awaitingKickout && (
                <div className="glass-card p-4 mb-4 bg-gradient-to-r from-amber-600/20 to-orange-600/20 border-2 border-amber-500/50 animate-pulse">
                  <div className="flex items-center justify-center space-x-3">
                    <AlertCircle size={24} className="text-amber-400" />
                    <p className="text-white font-semibold text-lg">
                      ⚽ Select kickout winner to continue
                    </p>
                  </div>
                </div>
              )}

              {/* Pitch */}
              <div className="glass-card p-6 relative mb-4">
                <GAAPitch
                  ballPosition={ballPosition}
                  onBallMove={handleBallMove}
                  showZones={true}
                  readonly={matchPhase === 'not_started' || matchPhase === 'finished' || awaitingKickout}
                />

                {/* Categorized Action Buttons - Lower position */}
                <div className="absolute z-10 w-full max-w-xl px-4 left-1/2 -translate-x-1/2" style={{ bottom: '-2.75rem' }}>
                  <CategorizedActionButtons
                    onActionSelect={handleQuickAction}
                    disabled={matchPhase !== 'first_half' && matchPhase !== 'second_half'}
                    activeCategory={activeKickoutTab}
                    onCategoryChange={setActiveKickoutTab}
                    currentPossession={ballPosition.team}
                  />
                </div>
              </div>

              {/* In-Game Analysis Section - Extra spacing for buttons */}
              <div className="glass-card p-6" style={{ marginTop: '5rem' }}>
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
                    <div className="py-2 px-3 text-center text-sm font-bold text-white">{matchDisplay.opponent}</div>
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
                  {recentEvents.length > 0 ? (
                    recentEvents.map((event, i) => {
                      const eventPlayer = players.find(p => p.id === event.player_id)
                      const eventTypeLabel = event.event_type.replace(/_/g, ' ')
                      const teamLabel = event.is_home_team ? '' : `(${matchDisplay.opponent})`

                      return (
                        <div
                          key={event.id}
                          className={`flex items-center space-x-3 p-3 rounded-lg transition-colors ${i % 2 === 0 ? 'bg-white/[0.07]' : 'bg-white/[0.03]'
                            } hover:bg-white/10`}
                        >
                          <div className="badge badge-info w-12 text-center text-white">{event.minute}'</div>
                          <div className="flex-1 text-white/90">
                            {eventTypeLabel} - {eventPlayer?.name || 'Unknown'} {teamLabel}
                          </div>
                        </div>
                      )
                    })
                  ) : (
                    <div className="text-center text-white/60 py-8">
                      No events recorded yet. Start the match and record your first action!
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}

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
          players={players}
        />
      )}

      {/* Possession Selection Modal */}
      <PossessionSelectionModal
        isOpen={isPossessionModalOpen}
        homeTeam="Dungloe"
        awayTeam={matchDisplay.opponent}
        onSelect={handlePossessionSelected}
      />
    </div>
  )
}
