import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import GAAPitch from '@/components/GAAPitch'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import ConfirmationModal from '@/components/ConfirmationModal'
import ManualEventEntryModal from '@/components/ManualEventEntryModal'
import StartingLineupModal from '@/components/StartingLineupModal'
import LiveInsightDisplay from '@/components/LiveInsightDisplay'
import { BallPosition, PossessionTeam, EventType, Player, MatchEvent } from '@/types'
import { useMatch, useMatchStats, useStartMatch, useCompleteMatch } from '@/hooks/useMatches'
import { useRecordEvent, useMatchEvents, useDeleteEvent } from '@/hooks/useMatchEvents'
import { useRecordPossession } from '@/hooks/usePossession'
import { usePlayers } from '@/hooks/usePlayers'
import { api } from '@/services/api'
import {
  Clock,
  Activity,
  Play,
  Zap,
  AlertCircle,
  Plus
} from 'lucide-react'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

// Dev mode: Speed multiplier for testing (10 = 10x speed, so 3 real mins = 30 match mins)
// Set VITE_DEV_MATCH_SPEED=10 in .env.local for faster testing
const DEV_SPEED_MULTIPLIER = parseInt(import.meta.env.VITE_DEV_MATCH_SPEED || '1', 10)
const IS_DEV_SPEED = DEV_SPEED_MULTIPLIER > 1

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
  const [matchLineup, setMatchLineup] = useState<any[]>([])

  // Mutations
  const startMatch = useStartMatch()
  const completeMatch = useCompleteMatch()
  const recordEvent = useRecordEvent()
  const recordPossession = useRecordPossession()
  const deleteEvent = useDeleteEvent()

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
  const [pendingKickoutEvent, setPendingKickoutEvent] = useState<{
    eventType: EventType
    isHomeTeam: boolean
    playerId?: string
  } | null>(null) // Kickout event waiting for position selection
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<number | null>(null)
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false)
  const [isLineupModalOpen, setIsLineupModalOpen] = useState(false)
  const [startingLineup, setStartingLineup] = useState<Record<string, string>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, string> | undefined>(undefined)
  const [dungloeAttackingRight, setDungloeAttackingRight] = useState<boolean>(true) // true = attacking towards x=100
  const [pendingFreeKick, setPendingFreeKick] = useState<{ position: BallPosition; player?: Player } | null>(null) // Track free kick state with optional player
  const [pending45, setPending45] = useState<{ position: BallPosition } | null>(null) // Track 45 state
  const [selectingFoulPlayer, setSelectingFoulPlayer] = useState<boolean>(false) // True when selecting Dungloe player who fouled
  const [pendingFoul, setPendingFoul] = useState<'dungloe' | 'opponent' | null>(null) // Track which team committed the foul

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

  // Load match lineup
  useEffect(() => {
    const loadLineup = async () => {
      if (matchId) {
        try {
          const lineup = await api.matchLineups.getLineup(matchId)
          setMatchLineup(lineup)

          // Rebuild startingLineup object from loaded lineup
          const lineupObj: Record<string, string> = {}
          lineup.forEach((entry) => {
            lineupObj[entry.position_id] = entry.player_id
          })
          setStartingLineup(lineupObj)
        } catch (error) {
          console.log('No lineup found or error loading lineup')
        }
      }
    }
    loadLineup()
  }, [matchId])

  // Load last match lineup for quick re-use
  useEffect(() => {
    const loadLastLineup = async () => {
      try {
        const lastLineup = await api.matchLineups.getLastLineup()
        if (lastLineup && lastLineup.length > 0) {
          const lineupObj: Record<string, string> = {}
          lastLineup.forEach((entry) => {
            lineupObj[entry.position_id] = entry.player_id
          })
          setLastMatchLineup(lineupObj)
        }
      } catch (error) {
        console.log('No previous lineup found')
      }
    }
    loadLastLineup()
  }, [])

  // Track if full time has been reached (but not yet ended by user)
  const [fullTimeReached, setFullTimeReached] = useState(false)

  // Timer effect - uses DEV_SPEED_MULTIPLIER for faster testing
  // At 10x speed: 1 real second = 10 match seconds, so 3 real mins = 30 match mins
  useEffect(() => {
    if (matchPhase === 'first_half' || matchPhase === 'second_half') {
      const intervalMs = Math.floor(1000 / DEV_SPEED_MULTIPLIER)
      const interval = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= 59) {
            setMinute((m) => {
              // Auto-pause at 30 minutes (half-time)
              if (m >= 29 && matchPhase === 'first_half') {
                setMatchPhase('half_time')
                return m + 1
              }
              // At 60 minutes, just mark full time reached but DON'T auto-finish
              // User must click "End Match" to properly complete and trigger AI analysis
              if (m >= 59 && matchPhase === 'second_half') {
                setFullTimeReached(true)
                // Keep timer running for injury time, don't auto-finish
                return m + 1
              }
              return m + 1
            })
            return 0
          }
          return prev + 1
        })
      }, intervalMs)
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
  // Always derive opponent from Dungloe to ensure they add up to 100% (avoids race condition flicker)
  const dungloePossessionPct = Math.round(matchStats?.dungloe_possession_percentage || 0)
  const opponentPossessionPct = 100 - dungloePossessionPct

  // Use backend matchStats for all statistics (already calculated correctly)
  const dungloeTurnoversWon = matchStats?.dungloe_turnovers_won || 0
  const dungloeTurnoversLost = matchStats?.dungloe_turnovers_lost || 0
  const dungloeKickoutsWon = matchStats?.dungloe_kickouts_won || 0
  const dungloeKickoutsLost = matchStats?.dungloe_kickouts_lost || 0
  const opponentKickoutsWon = matchStats?.opponent_kickouts_won || 0
  const opponentKickoutsLost = matchStats?.opponent_kickouts_lost || 0

  // Calculate kickout totals for each team
  const totalDungloeKickouts = dungloeKickoutsWon + dungloeKickoutsLost
  const totalOpponentKickouts = opponentKickoutsWon + opponentKickoutsLost
  const dungloeKickoutRetention = totalDungloeKickouts > 0 ? ((dungloeKickoutsWon / totalDungloeKickouts) * 100).toFixed(1) : '0.0'
  const opponentKickoutRetention = totalOpponentKickouts > 0 ? ((opponentKickoutsWon / totalOpponentKickouts) * 100).toFixed(1) : '0.0'

  // Recent events - fetch from backend and show last 15
  const { data: matchEventsData } = useMatchEvents(matchId)
  const recentEvents = matchEventsData?.events?.slice(0, 15).reverse() || []

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
    possession: { dungloe: dungloePossessionPct, opponent: opponentPossessionPct },
    shots: { dungloe: dungloeShots, opponent: opponentShots },
    scores: { dungloe: dungloeScores, opponent: opponentScores },
    wides: { dungloe: dungloeWides, opponent: opponentWides },
    accuracy: parseFloat(dungloeAccuracy),
    conversionRate: dungloeShots > 0 ? parseFloat(((dungloeScores / dungloeShots) * 100).toFixed(1)) : 0,
    turnovers: { won: dungloeTurnoversWon, lost: dungloeTurnoversLost },
    kickouts: {
      dungloeWon: dungloeKickoutsWon,
      dungloeTotal: totalDungloeKickouts,
      opponentWon: opponentKickoutsWon,
      opponentTotal: totalOpponentKickouts
    }
  }

  // Helper function to check if position is in 2-point zone (outside 40m arc)
  // GAA pitch ~145m long, 40m from goal = ~27.6% of pitch
  // Now accounts for dungloeAttackingRight direction setting
  const isIn2PointZone = (x: number, y: number, team: PossessionTeam): boolean => {
    // GAA pitch: 40m arc from goal center (2-point line)
    // CALIBRATED VALUES based on actual SVG pitch measurements:
    // - At centerline (y=50), the arc is at x=68.6
    // - This gives us X_RADIUS = 100 - 68.6 = 31.4%
    // - Y_RADIUS calculated assuming 90m pitch width: 40m/90m × 100 = 44.444%

    const X_RADIUS_PERCENT = 31.4
    const Y_RADIUS_PERCENT = 44.444

    // Determine which goal the team is attacking based on attack direction
    let attackingGoalX: number

    if (team === PossessionTeam.DUNGLOE) {
      // Dungloe's attacking goal depends on direction setting
      attackingGoalX = dungloeAttackingRight ? 100 : 0
    } else if (team === PossessionTeam.OPPONENT) {
      // Opponent attacks the opposite direction
      attackingGoalX = dungloeAttackingRight ? 0 : 100
    } else {
      return false  // Contested or unknown
    }

    // Calculate distance from the attacking goal
    const dx_percent = Math.abs(attackingGoalX - x)
    const dy_percent = y - 50

    // Calculate normalized elliptical distance
    const normalizedDistance = Math.sqrt(
      Math.pow(dx_percent / X_RADIUS_PERCENT, 2) +
      Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
    )

    return normalizedDistance > 1.0  // > 1.0 means outside the 40m arc = 2-point zone
  }

  // Helper function to get pitch area description from coordinates
  // Now contextual based on attack direction and which team the event is for
  // GAA pitch is ~145m long, with key zones at 13m, 20m, 40m arc, 45m from each end
  const getPitchArea = (
    x: number | null,
    y: number | null,
    eventTeamIsDungloe: boolean = true,
    opponentName: string = 'Opposition'
  ): string => {
    if (x === null || y === null) return 'the field'

    // Special case: Exact center (kickout position)
    if (x === 50 && y === 50) return 'midfield'

    // Left/Right description (y-axis: 0-100)
    let lateral = ''
    if (y < 25) lateral = ' (left wing)'
    else if (y > 75) lateral = ' (right wing)'
    else if (y >= 40 && y <= 60) lateral = ' (center)'

    // Determine which goal is Dungloe's based on attack direction
    // If Dungloe attacking right: Dungloe defends x=0, attacks x=100
    // If Dungloe attacking left: Dungloe defends x=100, attacks x=0
    const dungloeDefendsLeft = dungloeAttackingRight // Dungloe's goal is at x=0

    // Calculate distances from both goals
    const distFromLeftGoal = x  // Distance from x=0 goal
    const distFromRightGoal = 100 - x  // Distance from x=100 goal

    // Determine which goal is the attacking goal for the event's team
    let distFromAttackingGoal: number
    let distFromDefendingGoal: number
    let attackingTeamName: string
    let defendingTeamName: string

    if (eventTeamIsDungloe) {
      // Dungloe's event - their attacking goal depends on direction
      if (dungloeDefendsLeft) {
        // Dungloe attacks right (towards x=100)
        distFromAttackingGoal = distFromRightGoal
        distFromDefendingGoal = distFromLeftGoal
      } else {
        // Dungloe attacks left (towards x=0)
        distFromAttackingGoal = distFromLeftGoal
        distFromDefendingGoal = distFromRightGoal
      }
      attackingTeamName = 'Dungloe'
      defendingTeamName = opponentName
    } else {
      // Opponent's event - they attack the opposite direction
      if (dungloeDefendsLeft) {
        // Opponent attacks left (towards x=0, Dungloe's goal)
        distFromAttackingGoal = distFromLeftGoal
        distFromDefendingGoal = distFromRightGoal
      } else {
        // Opponent attacks right (towards x=100, Dungloe's goal)
        distFromAttackingGoal = distFromRightGoal
        distFromDefendingGoal = distFromLeftGoal
      }
      attackingTeamName = opponentName
      defendingTeamName = 'Dungloe'
    }

    // Check if outside 40m arc using elliptical calculation (for attacking goal)
    const X_RADIUS_PERCENT = 31.4
    const Y_RADIUS_PERCENT = 44.444
    const dy_percent = y - 50
    const normalizedArcDistance = Math.sqrt(
      Math.pow(distFromAttackingGoal / X_RADIUS_PERCENT, 2) +
      Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
    )
    const isOutsideAttackingArc = normalizedArcDistance > 1.0

    // Check if in defending goal area (for own half descriptions)
    const normalizedDefendingArcDistance = Math.sqrt(
      Math.pow(distFromDefendingGoal / X_RADIUS_PERCENT, 2) +
      Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
    )
    const isInsideDefendingArc = normalizedDefendingArcDistance <= 1.0

    // ATTACKING ZONES (near opponent's goal) - must be closer to attacking goal
    if (distFromAttackingGoal < distFromDefendingGoal) {
      if (distFromAttackingGoal <= 6.2) return `inside ${defendingTeamName}'s small rectangle${lateral}`
      if (distFromAttackingGoal <= 9) return `${defendingTeamName}'s 13-meter line${lateral}`
      if (distFromAttackingGoal <= 13.8) return `${defendingTeamName}'s 20-meter line${lateral}`
      if (!isOutsideAttackingArc) return `inside ${defendingTeamName}'s 40-meter arc${lateral}`
      if (distFromAttackingGoal <= 38) return `outside ${defendingTeamName}'s 40-meter arc${lateral}` // 2-point zone
      return `${defendingTeamName}'s half${lateral}`
    }

    // MIDFIELD ZONES
    if (distFromAttackingGoal <= 50 && distFromDefendingGoal <= 50) {
      return `around midfield${lateral}`
    }

    // DEFENSIVE ZONES (in own half) - closer to defending goal
    if (distFromDefendingGoal <= 6.2) return `inside ${attackingTeamName}'s small rectangle${lateral}`
    if (distFromDefendingGoal <= 9) return `${attackingTeamName}'s 13-meter line${lateral}`
    if (distFromDefendingGoal <= 13.8) return `${attackingTeamName}'s 20-meter line${lateral}`
    if (isInsideDefendingArc) return `inside ${attackingTeamName}'s 40-meter arc${lateral}`
    if (distFromDefendingGoal <= 38) return `${attackingTeamName}'s 45-meter line${lateral}`

    return `${attackingTeamName}'s half${lateral}`
  }

  // Handle deleting an event
  const handleDeleteEvent = async (eventId: number) => {
    setEventToDelete(eventId)
    setDeleteConfirmOpen(true)
  }

  const confirmDeleteEvent = async () => {
    if (!matchId || !eventToDelete) return

    try {
      await deleteEvent.mutateAsync({
        eventId: String(eventToDelete),
        matchId: matchId
      })
      setEventToDelete(null)
    } catch (error) {
      console.error('Failed to delete event:', error)
      alert('Failed to delete event. Please try again.')
    }
  }

  // Helper function to format event description
  const formatEventDescription = (event: MatchEvent): string => {
    const player = players.find(p => p.id === String(event.player_id))
    const teamName = match?.opponent || 'Opposition'
    // Backend returns team as 'dungloe' or 'opponent', fallback to is_home_team logic
    const eventTeam = (event as any).team
    const isDungloe = eventTeam ? eventTeam === 'dungloe' : (event.is_home_team === match?.is_home)
    // Get contextual area description based on which team the event is for
    const area = getPitchArea(event.pitch_x, event.pitch_y, isDungloe, teamName)
    // For Dungloe events, use player name; for opponent events, use team name
    const playerName = isDungloe ? (player?.name || 'Dungloe player') : teamName

    switch (event.event_type) {
      case 'point':
        return isDungloe
          ? `${playerName} scored a point from ${area}`
          : `${teamName} scored a point from ${area}`

      case 'two_point':
        return isDungloe
          ? `${playerName} scored a 2-pointer from ${area}`
          : `${teamName} scored a 2-pointer from ${area}`

      case 'goal':
        return isDungloe
          ? `${playerName} scored a goal from ${area}`
          : `${teamName} scored a goal from ${area}`

      case 'wide':
        return isDungloe
          ? `${playerName} hit a wide from ${area}`
          : `${teamName} hit a wide from ${area}`

      case 'short':
        return isDungloe
          ? `${playerName}'s shot fell short from ${area}`
          : `${teamName} shot fell short from ${area}`

      case 'saved':
        return isDungloe
          ? `${playerName}'s shot was saved from ${area}`
          : `${teamName} shot was saved from ${area}`

      case 'point_free':
        return isDungloe
          ? `${playerName} scored a point from a free in ${area}`
          : `${teamName} scored a point from a free in ${area}`

      case 'two_point_free':
        return isDungloe
          ? `${playerName} scored a 2-pointer from a free in ${area}`
          : `${teamName} scored a 2-pointer from a free in ${area}`

      case 'wide_free':
        return isDungloe
          ? `${playerName} hit a wide from a free in ${area}`
          : `${teamName} hit a wide from a free in ${area}`

      case 'forty_five':
        return isDungloe
          ? `${playerName} scored from a 45`
          : `${teamName} scored from a 45`

      case 'forty_five_missed':
        return isDungloe
          ? `${playerName} missed a 45`
          : `${teamName} missed a 45`

      case 'turnover_won':
        return isDungloe
          ? `${playerName} won a turnover in ${area}`
          : `${teamName} won a turnover in ${area}`

      case 'turnover_lost':
        return isDungloe
          ? `${playerName} conceded a turnover in ${area}`
          : `${teamName} conceded a turnover in ${area}`

      case 'our_unforced_error':
        return isDungloe
          ? `${playerName} made an unforced error in ${area}`
          : `${teamName} made an unforced error in ${area}`

      case 'opp_unforced_error':
        return `${teamName} made an unforced error in ${area}`

      case 'kickout_won':
        // Backend stores kickout_won for both teams - check who actually won
        return isDungloe
          ? `${playerName} won kickout clean in ${area}`
          : `${teamName} won kickout clean in ${area}`

      case 'kickout_lost':
        // Backend stores kickout_lost when Dungloe loses their own kickout
        return `Dungloe lost kickout to ${teamName} in ${area}`

      // Own kickouts (Dungloe kicking out)
      case 'own_kickout_dungloe_won':
        return `${playerName} won own kickout clean in ${area}`
      case 'own_kickout_opposition_won':
        return `${teamName} won Dungloe's kickout in ${area}`
      case 'own_kickout_dungloe_won_break':
        return `${playerName} won breaking ball from own kickout in ${area}`
      case 'own_kickout_opposition_won_break':
        return `${teamName} won breaking ball from Dungloe's kickout in ${area}`

      // Opposition kickouts (opponent kicking out)
      case 'opp_kickout_dungloe_won':
        return `${playerName} won ${teamName} kickout clean in ${area}`
      case 'opp_kickout_opposition_won':
        return `${teamName} won own kickout clean in ${area}`
      case 'opp_kickout_dungloe_won_break':
        return `${playerName} won breaking ball from ${teamName} kickout in ${area}`
      case 'opp_kickout_opposition_won_break':
        return `${teamName} won breaking ball from own kickout in ${area}`

      case 'breaking_ball_won':
        // Breaking ball from kickout
        return isDungloe
          ? `${playerName} won breaking ball in ${area}`
          : `${teamName} won breaking ball in ${area}`

      case 'free_won':
        return isDungloe
          ? `${playerName} won a free in ${area}`
          : `${teamName} won a free in ${area}`

      case 'free_conceded':
        return isDungloe
          ? `${playerName} conceded a free in ${area}`
          : `${teamName} conceded a free in ${area}`

      case 'foul_won':
        return isDungloe
          ? `${playerName} was fouled by ${teamName} in ${area}`
          : `${teamName} player was fouled by Dungloe in ${area}`

      case 'foul_committed':
        return isDungloe
          ? `${playerName} committed a foul in ${area}`
          : `${teamName} committed a foul in ${area}`

      case 'yellow_card':
        return isDungloe
          ? `${playerName} received a yellow card`
          : `${teamName} player received a yellow card`

      case 'red_card':
        return isDungloe
          ? `${playerName} received a red card`
          : `${teamName} player received a red card`

      case 'block':
        return isDungloe
          ? `${playerName} made a block in ${area}`
          : `${teamName} made a block in ${area}`

      case 'interception':
        return isDungloe
          ? `${playerName} made an interception in ${area}`
          : `${teamName} made an interception in ${area}`

      case 'substitution':
        // Extract substitution details from notes if available
        if (event.notes) {
          return `Substitution: ${event.notes}`
        }
        return isDungloe
          ? `${playerName} substituted off`
          : `${teamName} substitution`

      default:
        return isDungloe
          ? `${event.event_type.replace(/_/g, ' ')} - ${playerName}`
          : `${event.event_type.replace(/_/g, ' ')} - ${teamName}`
    }
  }

  const handleBallMove = async (newPosition: BallPosition) => {
    // Check if there's a pending kickout event waiting for position
    if (pendingKickoutEvent) {
      console.log('Recording pending kickout at position:', newPosition)
      await recordKickoutAtPosition(pendingKickoutEvent, newPosition)
      return
    }

    // Block ball movement if awaiting kickout resolution
    if (awaitingKickout) {
      console.log('Ball movement blocked - awaiting kickout resolution')
      return
    }

    // Only record if match is in progress
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished' || matchPhase === 'half_time') {
      return
    }

    // If there's a pending free kick and user moves ball, cancel the free (short free played)
    if (pendingFreeKick) {
      console.log('Ball moved - cancelling pending free kick (short free played)')
      setPendingFreeKick(null)
      setPendingFoul(null)
    }

    // If there's a pending 45 and user moves ball, cancel it
    if (pending45) {
      console.log('Ball moved - cancelling pending 45')
      setPending45(null)
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

  // Record a kickout event at the selected position
  const recordKickoutAtPosition = async (
    kickout: { eventType: EventType; isHomeTeam: boolean; playerId?: string },
    position: BallPosition
  ) => {
    if (!matchId) return

    try {
      const backendEventType = mapEventTypeToBackend(kickout.eventType)

      console.log('Recording kickout at position:', {
        eventType: kickout.eventType,
        backendType: backendEventType,
        position,
        playerId: kickout.playerId
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: kickout.playerId,
        event_type: backendEventType,
        minute: minute,
        half: currentHalf,
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: kickout.isHomeTeam,
        notes: undefined
      })

      // Determine who won the kickout based on event type
      const eventTypeStr = String(kickout.eventType).toUpperCase()
      const isDungloeWon = eventTypeStr.includes('DUNGLOE_WON')
      const newTeam = isDungloeWon ? PossessionTeam.DUNGLOE : PossessionTeam.OPPONENT

      // Update ball position to where kickout was won with correct team
      const newBallPosition = {
        x: position.x,
        y: position.y,
        team: newTeam
      }
      setBallPosition(newBallPosition)

      // Record possession change to backend
      try {
        await recordPossession.mutateAsync({
          match_id: matchId,
          x_coord: position.x,
          y_coord: position.y,
          team: isDungloeWon ? 'home' : 'away',
          timestamp: new Date(),
          minute: minute,
          half: currentHalf
        })
        console.log('Kickout possession recorded:', isDungloeWon ? 'Dungloe' : 'Opposition')
      } catch (error) {
        console.error('Failed to record kickout possession:', error)
      }

      // Clear pending kickout
      setPendingKickoutEvent(null)
      setAwaitingKickout(false)

      // Switch to scoring tab after kickout resolved
      setActiveKickoutTab('scoring')

      // Force refetch stats
      await queryClient.invalidateQueries({ queryKey: ['match', matchId, 'stats'] })

      console.log('Kickout recorded and ball moved to:', newBallPosition)
    } catch (error) {
      console.error('Failed to record kickout:', error)
      alert('Failed to record kickout. Please try again.')
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
      'two_point': 'two_point',
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

      // Frees
      'point_free': 'point_free',
      'two_point_free': 'two_point_free',
      'wide_free': 'wide_free',

      // 45s (ball went wide off defender)
      'forty_five': 'forty_five',  // 45 scored - always 1 point
      'forty_five_missed': 'forty_five_missed',  // 45 missed
    }

    return mapping[eventLower] || eventLower  // Fallback to original if no mapping
  }

  // Handle "Foul" button - receives which team committed the foul
  const handleFoulClick = (team: 'dungloe' | 'opponent') => {
    console.log('Foul committed by:', team)
    setPendingFoul(team)

    if (team === 'dungloe') {
      // Dungloe fouled - need to select which player committed the foul
      setSelectingFoulPlayer(true)
      setIsPlayerModalOpen(true)
      console.log('Dungloe foul - selecting player who fouled...')
    } else {
      // Opposition fouled - Dungloe wins free, go straight to free options
      setPendingFreeKick({ position: ballPosition })
      // Dungloe now has possession (they won the free)
      setBallPosition(prev => ({
        ...prev,
        team: PossessionTeam.DUNGLOE
      }))
      console.log('Opposition foul - Dungloe wins free at:', ballPosition)
    }
  }

  // Handle player selected for foul (Dungloe player who committed the foul)
  const handleFoulPlayerSelected = async (player: Player) => {
    if (!matchId) return

    // Record foul_committed event for this Dungloe player
    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: player.id,
        event_type: 'foul_committed',
        minute: minute,
        half: currentHalf,
        x_coord: ballPosition.x,
        y_coord: ballPosition.y,
        is_home_team: true, // Dungloe committed the foul
        notes: undefined
      })
      console.log('Foul committed recorded for:', player.name)

      // Now show free kick options for opponent
      setPendingFreeKick({ position: ballPosition, player })
      // Opponent now has possession (they get the free)
      setBallPosition(prev => ({
        ...prev,
        team: PossessionTeam.OPPONENT
      }))
    } catch (error) {
      console.error('Failed to record foul:', error)
      alert('Failed to record foul. Please try again.')
    }

    // Close player modal and reset foul player selection flag
    setIsPlayerModalOpen(false)
    setSelectingFoulPlayer(false)
  }

  // Cancel pending free kick
  const handleCancelFree = () => {
    setPendingFreeKick(null)
    setPendingFoul(null)
    console.log('Free kick cancelled')
  }

  // Handle "45" button - opens 45 options menu (scored/missed)
  const handle45Click = () => {
    setPending45({ position: ballPosition })
    console.log('45 initiated at position:', ballPosition)
  }

  // Cancel pending 45
  const handleCancel45 = () => {
    setPending45(null)
    console.log('45 cancelled')
  }

  // Handle manual event entry
  const handleManualEventSubmit = async (data: {
    eventType: EventType
    playerId: string | null
    playerComingOn?: string | null
    minute: number
    half: number
    team: PossessionTeam
    pitchX?: number
    pitchY?: number
  }) => {
    if (!matchId) return

    try {
      const isHomeTeam = data.team === PossessionTeam.DUNGLOE ? (match?.is_home || false) : !(match?.is_home || false)

      // For substitutions, record event and update field status
      if (data.eventType === EventType.SUBSTITUTION && data.playerId && data.playerComingOn) {
        const playerOff = players.find(p => p.id === data.playerId)
        const playerOn = players.find(p => p.id === data.playerComingOn)

        // Record substitution event with notes
        await recordEvent.mutateAsync({
          match_id: matchId,
          player_id: data.playerId,
          event_type: data.eventType,
          minute: data.minute,
          half: data.half,
          x_coord: data.pitchX || ballPosition.x,
          y_coord: data.pitchY || ballPosition.y,
          is_home_team: isHomeTeam,
          notes: `${playerOff?.name || 'Player'} off, ${playerOn?.name || 'Player'} on`
        })

        // Update field status for both players
        if (data.playerId) {
          await api.matchLineups.updateFieldStatus(matchId, data.playerId)
        }
        if (data.playerComingOn) {
          await api.matchLineups.updateFieldStatus(matchId, data.playerComingOn)
        }

        // Reload lineup
        const lineup = await api.matchLineups.getLineup(matchId)
        setMatchLineup(lineup)
      } else {
        // Regular event
        await recordEvent.mutateAsync({
          match_id: matchId,
          player_id: data.playerId || undefined,
          event_type: data.eventType,
          minute: data.minute,
          half: data.half,
          x_coord: data.pitchX || ballPosition.x,
          y_coord: data.pitchY || ballPosition.y,
          is_home_team: isHomeTeam,
          notes: undefined
        })
      }
    } catch (error) {
      console.error('Failed to record manual event:', error)
    }
  }

  // Handle starting lineup confirmation
  const handleLineupConfirm = async (lineup: Record<string, string>) => {
    setStartingLineup(lineup)
    setIsLineupModalOpen(false)

    // Save lineup to backend
    if (matchId) {
      try {
        const lineupEntries = Object.entries(lineup).map(([positionId, playerId]) => ({
          player_id: playerId,
          position_id: positionId,
          is_substitute: positionId.startsWith('sub-')
        }))

        await api.matchLineups.saveLineup(matchId, lineupEntries)
        console.log('Lineup saved successfully')
      } catch (error) {
        console.error('Failed to save lineup:', error)
      }
    }
  }

  const handleQuickAction = (eventType: EventType) => {
    console.log('Quick action:', eventType, 'at position:', ballPosition)
    console.log('Ball possession team:', ballPosition.team)

    // Check if this is a free kick result or 45 result
    const eventStr = String(eventType).toUpperCase()
    const isFreeKickResult = eventStr.includes('FREE')
    const is45Result = eventStr.includes('FORTY_FIVE')

    // Determine action position and player based on pending state
    let actionPosition = ballPosition
    let freeKickPlayer: Player | undefined = undefined
    let isDungloeTakingFree = true
    if (isFreeKickResult && pendingFreeKick) {
      actionPosition = pendingFreeKick.position
      freeKickPlayer = pendingFreeKick.player
      // If pendingFoul is 'dungloe', opponent takes the free. If 'opponent', Dungloe takes the free.
      isDungloeTakingFree = pendingFoul === 'opponent'
      console.log('Recording free kick result, team taking free:', isDungloeTakingFree ? 'Dungloe' : 'Opponent', ', clearing pending free kick')
      setPendingFreeKick(null)
    } else if (is45Result && pending45) {
      actionPosition = pending45.position
      console.log('Recording 45 result, clearing pending 45')
      setPending45(null)
    }

    // NEW PRINCIPLE: Buttons explicitly say "Dungloe Won" or "Opposition Won"
    // "Dungloe Won" → needs Dungloe player selection, is_home_team: true
    // "Opposition Won" → no player needed, is_home_team: false

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
    } else if (isFreeKickResult || is45Result) {
      // Free kick results and 45s are always Dungloe (we won the free / took the 45)
      isHomeTeam = true
    } else {
      // No prefix (GOAL, POINT, WIDE) = use POSSESSION
      isHomeTeam = actionPosition.team === PossessionTeam.DUNGLOE
    }

    console.log('Determined isHomeTeam:', isHomeTeam, 'for event:', eventType)

    // Events that don't require player selection
    // Only "Opposition Won" events and opponent errors (we don't track their players)
    const noPlayerNeeded = [
      EventType.OWN_KICKOUT_OPPOSITION_WON,
      EventType.OPP_KICKOUT_OPPOSITION_WON,
      EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
      EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
      EventType.OPP_UNFORCED_ERROR,  // Opponent's mistake - we don't track their players
    ]

    // Opponent scoring/shooting - check if opponent has possession
    // We don't track opponent players for ANY events
    const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SAVED]
    const isOpponentScoring = scoringEvents.includes(eventType) && !isHomeTeam

    // Free kick results - record with context of which team is taking the free
    if (isFreeKickResult) {
      recordFreeKickResult(eventType, actionPosition, isDungloeTakingFree, freeKickPlayer)
    } else if (noPlayerNeeded.includes(eventType as EventType) || isOpponentScoring) {
      // Record immediately without player selection
      recordEventWithoutPlayer(eventType, isHomeTeam, actionPosition)
    } else {
      // Open player selection modal for Dungloe players
      // This includes ALL "Dungloe Won" events and Dungloe scoring
      setPendingEvent({
        eventType: eventType as EventType,
        team: isHomeTeam ? 'dungloe' : 'opponent',
        position: actionPosition
      })
      setIsPlayerModalOpen(true)
    }
  }

  // Record free kick result - works for both Dungloe and opponent frees
  const recordFreeKickResult = async (eventType: EventType, position: BallPosition, isDungloeTakingFree: boolean, player?: Player) => {
    if (!matchId) return

    try {
      const backendEventType = mapEventTypeToBackend(eventType)

      console.log('Recording free kick result:', {
        eventType,
        backendType: backendEventType,
        player: player?.name || 'Opponent',
        position,
        isDungloeTakingFree
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: isDungloeTakingFree ? undefined : player?.id, // Only include player if Dungloe fouled (player who fouled is already recorded)
        event_type: backendEventType,
        minute: minute,
        half: currentHalf,
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: isDungloeTakingFree, // true if Dungloe takes the free, false if opponent takes
        notes: undefined
      })

      // Free kick scores result in kickout
      const scoringFrees = [EventType.POINT_FREE, EventType.TWO_POINT_FREE]
      const isScore = scoringFrees.includes(eventType)
      const isWide = eventType === EventType.WIDE_FREE

      if (isScore || isWide) {
        // Ball moves to goalkeeper area for kickout
        // The team that conceded the score takes the kickout
        const kickoutTeam = isDungloeTakingFree ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        const kickoutX = isDungloeTakingFree ? 95 : 5 // Goal area of team taking kickout

        setBallPosition({
          x: kickoutX,
          y: 50,
          team: kickoutTeam
        })

        setActiveKickoutTab(isDungloeTakingFree ? 'opp_kickouts' : 'our_kickouts')
        setAwaitingKickout(true)

        console.log('Ball moved to goalkeeper area for kickout after free:', eventType)
      }

      // Reset foul state
      setPendingFoul(null)

      // Force refetch stats
      await queryClient.invalidateQueries({ queryKey: ['match', matchId, 'stats'] })

      console.log('Free kick result recorded successfully')
    } catch (error) {
      console.error('Failed to record free kick result:', error)
      alert('Failed to record free kick. Please try again.')
    }
  }

  const recordEventWithoutPlayer = async (eventType: EventType, isHomeTeam: boolean, position: BallPosition = ballPosition) => {
    if (!matchId) return

    // Check if this is a kickout event - these need position selection first
    const eventTypeStr = String(eventType).toUpperCase()
    const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')

    if (isKickoutEvent) {
      // Don't record immediately - wait for user to select position on pitch
      console.log('Setting pending kickout event (no player):', eventType)
      setPendingKickoutEvent({
        eventType,
        isHomeTeam,
        playerId: undefined
      })
      // Keep awaitingKickout false so user can click on pitch
      setAwaitingKickout(false)
      return
    }

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
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: isHomeTeam,
        notes: undefined
      })

      // Check if this was a scoring event - reset ball and auto-select kickout tab
      // Include free kick scores and 45 scored
      const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]
      const isScore = scoringEvents.includes(eventType)

      // Check if this was a dead ball event - WIDE, WIDE_FREE, and 45_MISSED result in kickout
      // SAVED stays in play (keeper can run with it or pass)
      const deadBallEvents = [EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED]
      const isDeadBall = deadBallEvents.includes(eventType)

      if (isScore || isDeadBall) {
        // After score/wide, ball moves to goalkeeper area for kickout
        const kickoutTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        // Ball goes to the goal area of the team taking the kickout
        const kickoutX = kickoutTeam === PossessionTeam.DUNGLOE ? 5 : 95

        setBallPosition({
          x: kickoutX,  // Edge of small rectangle (goalkeeper area)
          y: 50,        // Center vertically
          team: kickoutTeam  // Other team gets kickout
        })

        // Auto-select appropriate kickout tab
        setActiveKickoutTab(isHomeTeam ? 'opp_kickouts' : 'our_kickouts')

        // Lock ball until kickout is resolved
        setAwaitingKickout(true)

        console.log('Ball moved to goalkeeper area for kickout after:', eventType)
      } else {
        // For ALL non-scoring events, return to scoring tab
        setActiveKickoutTab(null)

        // Handle possession change for non-kickout, non-scoring events
        // (e.g., turnovers, unforced errors, saved shots)
        // Note: Kickout events are handled via pendingKickoutEvent pattern
        const turnoverEventStr = String(eventType).toUpperCase()

        if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED')) {
          // Determine new possession based on event type
          let newTeam: PossessionTeam
          let newX = position.x
          let newY = position.y

          if (turnoverEventStr.includes('TURNOVER_WON')) {
            // Dungloe won the ball → Dungloe gets possession
            newTeam = PossessionTeam.DUNGLOE
          } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
            // Dungloe lost the ball → Opponent gets possession
            newTeam = PossessionTeam.OPPONENT
          } else if (turnoverEventStr.includes('SAVED')) {
            // Shot saved → Defending team gets possession at goalkeeper position
            // Use ball position to determine which goal: if shot was in opponent's half (x > 50),
            // opponent keeper saved it. If in our half (x < 50), Dungloe keeper saved it.
            const shotInOpponentHalf = position.x > 50

            if (shotInOpponentHalf) {
              // Shot was at opponent's goal → Opponent keeper saved it
              newTeam = PossessionTeam.OPPONENT
              newX = 95 // Opponent goal area
              newY = 50
            } else {
              // Shot was at Dungloe's goal → Dungloe keeper saved it
              newTeam = PossessionTeam.DUNGLOE
              newX = 5 // Dungloe goal area
              newY = 50
            }
          } else if (turnoverEventStr.includes('SHORT')) {
            // Shot dropped short → Opponent gets possession (stays where it is)
            newTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
          } else if (turnoverEventStr.includes('OPP_UNFORCED_ERROR')) {
            // Opponent unforced error → Dungloe gets possession
            newTeam = PossessionTeam.DUNGLOE
          } else if (turnoverEventStr.includes('OUR_UNFORCED_ERROR')) {
            // Our unforced error → Opponent gets possession
            newTeam = PossessionTeam.OPPONENT
          } else {
            // Fallback (shouldn't reach here)
            newTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
          }

          const newBallPosition = { x: newX, y: newY, team: newTeam }
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
            console.log('Possession change recorded:', newTeam, 'after:', eventType)
          } catch (error) {
            console.error('Failed to record possession:', error)
          }
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
    console.log('handlePlayerSelected called with player:', player.name)
    console.log('pendingEvent:', pendingEvent)
    console.log('matchId:', matchId)

    if (!pendingEvent || !matchId) {
      console.error('handlePlayerSelected early return - pendingEvent:', pendingEvent, 'matchId:', matchId)
      // Still close modal to avoid UI stuck state
      setIsPlayerModalOpen(false)
      setPendingEvent(null)
      return
    }

    console.log('Recording event:', {
      eventType: pendingEvent.eventType,
      team: pendingEvent.team,
      player: player.name,
      minute: minute,
      second: seconds
    })

    // Check if this is a kickout/breaking ball event - these need position selection
    const eventTypeStr = String(pendingEvent.eventType).toUpperCase()
    const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')

    if (isKickoutEvent) {
      // Don't record immediately - set pending kickout and wait for position selection
      console.log('Setting pending kickout event (with player):', pendingEvent.eventType, player.name)
      setPendingKickoutEvent({
        eventType: pendingEvent.eventType,
        isHomeTeam: pendingEvent.team === 'dungloe',
        playerId: player.id
      })
      // Unlock ball so user can click on pitch to select position
      setAwaitingKickout(false)
      // Close modal and reset pendingEvent
      setIsPlayerModalOpen(false)
      setPendingEvent(null)
      return
    }

    // Record event to backend (non-kickout events)
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

      // Check if this was a scoring event (includes free kicks and 45 scored)
      const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]
      const isScore = scoringEvents.includes(pendingEvent.eventType as EventType)

      // Check if this was a dead ball event - WIDE, WIDE_FREE, 45_MISSED result in kickout
      // SAVED stays in play (keeper can run with it or pass)
      const deadBallEvents = [EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED]
      const isDeadBall = deadBallEvents.includes(pendingEvent.eventType as EventType)

      if (isScore || isDeadBall) {
        // After score/wide/short, ball moves to goalkeeper area for kickout
        // After score/wide/short/saved, the defending team takes kickout
        const kickoutTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        // Ball goes to the goal area of the team taking the kickout
        const kickoutX = kickoutTeam === PossessionTeam.DUNGLOE ? 5 : 95
        setBallPosition({
          x: kickoutX,  // Edge of small rectangle (goalkeeper area)
          y: 50,        // Center vertically
          team: kickoutTeam  // Other team gets kickout
        })

        // Auto-select appropriate kickout tab
        setActiveKickoutTab(pendingEvent.team === 'dungloe' ? 'opp_kickouts' : 'our_kickouts')

        // Lock ball until kickout is resolved
        setAwaitingKickout(true)

        console.log('Ball moved to goalkeeper area for kickout after:', pendingEvent.eventType)
      } else {
        // For ALL non-scoring events, return to scoring tab
        setActiveKickoutTab(null)
      }

      // Auto-change possession for turnover events, shots that drop short, and saved shots
      const turnoverEventStr = String(pendingEvent.eventType).toUpperCase()
      if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED')) {
        // Determine new possession based on event type
        let newTeam: PossessionTeam
        let newX = pendingEvent.position.x
        let newY = pendingEvent.position.y

        if (turnoverEventStr.includes('TURNOVER_WON')) {
          // Dungloe won the ball → Dungloe gets possession
          newTeam = PossessionTeam.DUNGLOE
        } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
          // Dungloe lost the ball → Opponent gets possession
          newTeam = PossessionTeam.OPPONENT
        } else if (turnoverEventStr.includes('SAVED')) {
          // Use ball position to determine which goal: if shot was in opponent's half (x > 50),
          // opponent keeper saved it. If in our half (x < 50), Dungloe keeper saved it.
          const shotInOpponentHalf = pendingEvent.position.x > 50

          if (shotInOpponentHalf) {
            newTeam = PossessionTeam.OPPONENT
            newX = 95 // Opponent goal area
            newY = 50
          } else {
            newTeam = PossessionTeam.DUNGLOE
            newX = 5 // Dungloe goal area
            newY = 50
          }
        } else if (turnoverEventStr.includes('SHORT')) {
          // Shot dropped short → Opponent gets possession (stays where it is)
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        } else if (turnoverEventStr.includes('UNFORCED_ERROR')) {
          // Unforced error → Other team gets possession
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        } else {
          // Fallback (shouldn't reach here)
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
        }

        const newBallPosition = { x: newX, y: newY, team: newTeam }
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

  const handlePossessionSelected = async (team: 'home' | 'away', attackingRight: boolean) => {
    setIsPossessionModalOpen(false)

    // Set initial possession
    setBallPosition(prev => ({
      ...prev,
      team: team === 'home' ? PossessionTeam.DUNGLOE : PossessionTeam.OPPONENT
    }))

    // Start the match/half
    if (matchPhase === 'not_started') {
      // Set attack direction for first half
      setDungloeAttackingRight(attackingRight)

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
      // Auto-flip attack direction for second half
      setDungloeAttackingRight(!dungloeAttackingRight)

      setMatchPhase('second_half')
      setCurrentHalf(2)
      setMinute(30)
      setSeconds(0)
    }
  }

  const endFirstHalf = async () => {
    if (!matchId || minute < 30) return

    // Pause the timer
    setMatchPhase('half_time')
    console.log('First half ended at', minute, ':', seconds)

    // Trigger half-time AI insight
    try {
      await api.liveInsights.triggerHalfTime(matchId)
      console.log('Half-time insight triggered')
    } catch (error) {
      console.error('Failed to trigger half-time insight:', error)
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

  const getEndButtonText = () => {
    if (matchPhase === 'first_half') return 'End First Half'
    if (matchPhase === 'second_half') {
      return fullTimeReached ? 'End Match (Full Time!)' : 'End Match'
    }
    return null
  }

  const isEndButtonEnabled = () => {
    if (matchPhase === 'first_half') return minute >= 30
    if (matchPhase === 'second_half') return true
    return false
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
                  <div className="flex items-center gap-2">
                    <div className="inline-flex items-center space-x-3 px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/30 animate-pulse">
                      <Clock size={20} className="text-emerald-400" />
                      <span className="font-mono text-2xl font-bold text-white">{formatTime()}</span>
                    </div>
                    {IS_DEV_SPEED && (
                      <span className="px-2 py-1 text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg">
                        {DEV_SPEED_MULTIPLIER}x
                      </span>
                    )}
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
                  {matchPhase === 'not_started' && (
                    <button
                      className="glass-card-hover flex items-center space-x-2 !py-2 !px-4 text-sm"
                      onClick={() => setIsLineupModalOpen(true)}
                    >
                      <Activity size={16} />
                      <span>Select Lineup</span>
                    </button>
                  )}
                  {getPhaseButtonText() && (
                    <button
                      className="btn-primary flex items-center space-x-1 !py-1 !px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={startHalf}
                      disabled={matchPhase === 'not_started' && Object.keys(startingLineup).length === 0}
                      title={matchPhase === 'not_started' && Object.keys(startingLineup).length === 0 ? 'Please select a lineup first' : ''}
                    >
                      <Play size={14} />
                      <span>{getPhaseButtonText()}</span>
                    </button>
                  )}
                  {matchPhase !== 'not_started' && matchPhase !== 'finished' && (
                    <button
                      className="glass-card-hover flex items-center space-x-1 !py-1 !px-3 text-sm"
                      onClick={() => setIsManualEntryOpen(true)}
                    >
                      <Plus size={14} />
                      <span>Manual Entry</span>
                    </button>
                  )}
                  {getEndButtonText() && (
                    <button
                      className={`px-4 py-2 rounded-xl bg-gradient-to-r text-white font-medium shadow-lg hover:shadow-xl transition-all text-sm ${
                        !isEndButtonEnabled()
                          ? 'from-orange-600 to-amber-600 opacity-50 cursor-not-allowed'
                          : fullTimeReached
                            ? 'from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700 animate-pulse ring-2 ring-red-400'
                            : 'from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700'
                      }`}
                      onClick={matchPhase === 'first_half' ? endFirstHalf : endMatch}
                      disabled={!isEndButtonEnabled()}
                    >
                      {getEndButtonText()}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Main Pitch Area */}
            <div className="lg:col-span-2">
              {/* Full Time Banner */}
              {fullTimeReached && matchPhase === 'second_half' && (
                <div className="glass-card p-4 mb-4 bg-gradient-to-r from-red-600/30 to-rose-600/30 border-2 border-red-500/50 animate-pulse">
                  <div className="flex items-center justify-center space-x-3">
                    <Clock size={24} className="text-red-400" />
                    <p className="text-white font-bold text-xl">
                      FULL TIME! Click "End Match" to save and generate AI analysis
                    </p>
                  </div>
                </div>
              )}

              {/* Kickout Warning Banner */}
              {awaitingKickout && !pendingKickoutEvent && (
                <div className="glass-card p-4 mb-4 bg-gradient-to-r from-amber-600/20 to-orange-600/20 border-2 border-amber-500/50 animate-pulse">
                  <div className="flex items-center justify-center space-x-3">
                    <AlertCircle size={24} className="text-amber-400" />
                    <p className="text-white font-semibold text-lg">
                      Select kickout winner to continue
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
                  readonly={matchPhase === 'not_started' || matchPhase === 'finished' || (awaitingKickout && !pendingKickoutEvent)}
                />

                {/* Coordinate Debug Display */}
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs text-white/80 font-mono">
                  x: {ballPosition.x.toFixed(1)}, y: {ballPosition.y.toFixed(1)}
                </div>

                {/* Categorized Action Buttons - Lower position */}
                <div className="absolute z-10 w-full max-w-xl px-4 left-1/2 -translate-x-1/2" style={{ bottom: '-2.75rem' }}>
                  <CategorizedActionButtons
                    onActionSelect={handleQuickAction}
                    onFoulClick={handleFoulClick}
                    on45Click={handle45Click}
                    disabled={matchPhase !== 'first_half' && matchPhase !== 'second_half'}
                    activeCategory={activeKickoutTab}
                    onCategoryChange={setActiveKickoutTab}
                    currentPossession={ballPosition.team}
                    isIn2PointZone={isIn2PointZone(ballPosition.x, ballPosition.y, ballPosition.team)}
                    pendingFreeKick={!!pendingFreeKick}
                    pendingFoul={pendingFoul}
                    pending45={!!pending45}
                    pendingKickoutPosition={!!pendingKickoutEvent}
                    onCancelFree={handleCancelFree}
                    onCancel45={handleCancel45}
                    onCancelKickout={() => setPendingKickoutEvent(null)}
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
              {/* AI Live Insights */}
              <LiveInsightDisplay
                matchId={matchId}
                minute={minute}
                half={currentHalf}
                isMatchActive={matchPhase === 'first_half' || matchPhase === 'second_half'}
              />

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
                      {stats.shots.opponent > 0 ? (stats.scores.opponent / stats.shots.opponent * 100).toFixed(1) : '0.0'}%
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
                      {(stats.scores.opponent + stats.wides.opponent) > 0 ? ((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1) : '0.0'}%
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
                      {stats.kickouts.dungloeWon}/{stats.kickouts.dungloeTotal}
                    </div>
                    <div className="py-2 px-3 text-center bg-gradient-to-r from-indigo-600 to-purple-600 text-sm font-semibold text-white border-r border-white/10 flex items-center justify-center">
                      KICKOUTS WON
                    </div>
                    <div className="py-2 px-3 text-center bg-white text-lg font-bold text-black flex items-center justify-center">
                      {stats.kickouts.opponentWon}/{stats.kickouts.opponentTotal}
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
                <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white">
                  <Clock size={20} className="text-white" />
                  <span>Recent Events</span>
                </h3>
                <div className="space-y-2 text-sm max-h-[500px] overflow-y-auto">
                  {recentEvents.length > 0 ? (
                    recentEvents.map((event) => {
                      const description = formatEventDescription(event)
                      const isDungloe = event.is_home_team

                      // Determine event color based on type
                      let eventColor = 'bg-slate-700/40 border-slate-600/30'
                      if (['point', 'goal'].includes(event.event_type)) {
                        eventColor = isDungloe
                          ? 'bg-emerald-900/30 border-emerald-700/40'
                          : 'bg-rose-900/30 border-rose-700/40'
                      } else if (['wide', 'saved'].includes(event.event_type)) {
                        eventColor = 'bg-amber-900/30 border-amber-700/40'
                      } else if (event.event_type.includes('turnover') || event.event_type.includes('unforced')) {
                        eventColor = 'bg-orange-900/30 border-orange-700/40'
                      }

                      return (
                        <div
                          key={event.id}
                          className={`flex items-start space-x-3 p-3 rounded-lg border ${eventColor} backdrop-blur-sm transition-all hover:scale-[1.02] hover:shadow-lg`}
                        >
                          <div className="flex-shrink-0 w-10 h-10 rounded-md bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center font-bold text-white text-sm shadow-md">
                            {event.minute}'
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-white/95 leading-relaxed">
                              {description}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeleteEvent(event.id)}
                            className="flex-shrink-0 text-white/60 hover:text-red-400 transition-colors p-1"
                            title="Delete Event"
                          >
                            <AlertCircle size={16} />
                          </button>
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
      {(pendingEvent || selectingFoulPlayer) && (
        <PlayerSelectionModal
          isOpen={isPlayerModalOpen}
          onClose={() => {
            setIsPlayerModalOpen(false)
            setPendingEvent(null)
            setSelectingFoulPlayer(false)
            setPendingFoul(null)
          }}
          onSelectPlayer={selectingFoulPlayer ? handleFoulPlayerSelected : handlePlayerSelected}
          eventType={selectingFoulPlayer ? EventType.FOUL_COMMITTED : (pendingEvent?.eventType as any)}
          team="dungloe"
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

      {/* Delete Confirmation Modal */}
      <ConfirmationModal
        isOpen={deleteConfirmOpen}
        onClose={() => {
          setDeleteConfirmOpen(false)
          setEventToDelete(null)
        }}
        onConfirm={confirmDeleteEvent}
        title="Delete Event?"
        message="Are you sure you want to delete this event? The match scores and statistics will be recalculated automatically."
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Manual Event Entry Modal */}
      <ManualEventEntryModal
        isOpen={isManualEntryOpen}
        onClose={() => setIsManualEntryOpen(false)}
        onSubmit={handleManualEventSubmit}
        players={players}
        opponentName={matchDisplay.opponent}
        matchLineup={matchLineup}
      />

      {/* Starting Lineup Modal */}
      <StartingLineupModal
        isOpen={isLineupModalOpen}
        onClose={() => setIsLineupModalOpen(false)}
        onConfirm={handleLineupConfirm}
        players={players}
        lastMatchLineup={lastMatchLineup}
      />
    </div>
  )
}
