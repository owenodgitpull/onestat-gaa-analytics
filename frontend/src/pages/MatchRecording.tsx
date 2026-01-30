import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import GAAPitch from '@/components/GAAPitch'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import ConfirmationModal from '@/components/ConfirmationModal'
import FoulModal from '@/components/FoulModal'
import ManualEventEntryModal from '@/components/ManualEventEntryModal'
import StartingLineupModal from '@/components/StartingLineupModal'
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<number | null>(null)
  const [isFoulModalOpen, setIsFoulModalOpen] = useState(false)
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false)
  const [isLineupModalOpen, setIsLineupModalOpen] = useState(false)
  const [startingLineup, setStartingLineup] = useState<Record<string, string>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, string> | undefined>(undefined)

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
    possession: { dungloe: parseInt(dungloePossessionPct), opponent: parseInt(opponentPossessionPct) },
    shots: { dungloe: dungloeShots, opponent: opponentShots },
    scores: { dungloe: dungloeScores, opponent: opponentScores },
    wides: { dungloe: dungloeWides, opponent: opponentWides },
    accuracy: parseFloat(dungloeAccuracy),
    conversionRate: dungloeShots > 0 ? parseFloat(((dungloeScores / dungloeShots) * 100).toFixed(1)) : 0,
    turnovers: { won: dungloeTurnoversWon, lost: dungloeTurnoversLost },
    kickouts: { won: dungloeKickoutsWon, lost: dungloeKickoutsLost }
  }

  // Helper function to check if position is in 2-point zone (outside 40m arc)
  // GAA pitch ~145m long, 40m from goal = ~27.6% of pitch
  // Coordinates: x=0 (own goal), x=100 (opposition goal)
  const isIn2PointZone = (x: number, y: number, team: PossessionTeam): boolean => {
    // GAA pitch: 40m arc from goal center (2-point line)
    // CALIBRATED VALUES based on actual SVG pitch measurements:
    // - At centerline (y=50), the arc is at x=68.6
    // - This gives us X_RADIUS = 100 - 68.6 = 31.4%
    // - Y_RADIUS calculated assuming 90m pitch width: 40m/90m × 100 = 44.444%

    // We normalize to a unit circle for accurate elliptical distance
    const X_RADIUS_PERCENT = 31.4  // Empirically calibrated from SVG
    const Y_RADIUS_PERCENT = 44.444  // Based on 90m pitch width

    if (team === PossessionTeam.DUNGLOE) {
      // Dungloe attacks towards goal at (100, 50)
      const dx_percent = 100 - x
      const dy_percent = y - 50

      // Calculate normalized elliptical distance
      const normalizedDistance = Math.sqrt(
        Math.pow(dx_percent / X_RADIUS_PERCENT, 2) +
        Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
      )

      return normalizedDistance > 1.0  // > 1.0 means outside the 40m arc = 2-point zone
    } else if (team === PossessionTeam.OPPONENT) {
      // Opposition attacks towards goal at (0, 50)
      const dx_percent = x
      const dy_percent = y - 50

      // Calculate normalized elliptical distance
      const normalizedDistance = Math.sqrt(
        Math.pow(dx_percent / X_RADIUS_PERCENT, 2) +
        Math.pow(dy_percent / Y_RADIUS_PERCENT, 2)
      )

      return normalizedDistance > 1.0  // > 1.0 means outside the 40m arc = 2-point zone
    }

    return false  // Contested or unknown
  }

  // Helper function to get pitch area description from coordinates
  // GAA pitch is ~145m long, with key zones at 13m, 20m, 40m arc, 45m from each end
  // Coordinates: x=0 (own goal), x=100 (opposition goal), y=0 (left), y=100 (right)
  const getPitchArea = (x: number | null, y: number | null): string => {
    if (x === null || y === null) return 'the field'

    // Special case: Exact center (kickout position)
    if (x === 50 && y === 50) return 'center midfield'

    // Left/Right description (y-axis: 0-100)
    let lateral = ''
    if (y < 25) lateral = ' (left wing)'
    else if (y > 75) lateral = ' (right wing)'
    else if (y >= 40 && y <= 60) lateral = ' (center)'

    // For attacking zones (near opposition goal at x=100):
    // GAA zones measured from goal LINE, not center: 9m, 13m, 20m, 40m arc, 45m line
    // Distance from goal line = 100 - x (as percentage of 145m pitch)
    // 9m = 6.2%, 13m = 9%, 20m = 13.8%, 40m = 27.6%, 45m = 31%
    const distanceFromGoalLine = 100 - x

    if (distanceFromGoalLine <= 6.2) return `inside the small rectangle${lateral}` // Within 9m
    if (distanceFromGoalLine <= 9) return `the 13-meter line${lateral}` // 9-13m
    if (distanceFromGoalLine <= 13.8) return `the 20-meter line${lateral}` // 13-20m
    if (distanceFromGoalLine <= 27.6) return `inside the 40-meter arc${lateral}` // Inside 40m arc
    if (distanceFromGoalLine <= 31) return `just outside the 40-meter arc${lateral}` // 40-45m (2-point zone)
    if (distanceFromGoalLine <= 38) return `outside the 45-meter line${lateral}` // Beyond 45m (2-point zone)

    // Further back zones based on x position
    if (x >= 55) return `deep in the attacking half${lateral}`
    if (x >= 50) return `just past midfield${lateral}`
    if (x >= 45) return `around midfield${lateral}`
    if (x >= 38) return `just inside their own half${lateral}`
    if (x >= 31) return `the defensive half${lateral}`
    if (x >= 22) return `the defensive 45-meter line${lateral}`
    if (x >= 14) return `the defensive 20-meter line${lateral}`
    if (x >= 9) return `the defensive 13-meter line${lateral}`
    return `inside the defensive square${lateral}`
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
    const area = getPitchArea(event.pitch_x, event.pitch_y)
    const teamName = match?.opponent || 'Opposition'
    // Backend returns team as 'dungloe' or 'opponent', fallback to is_home_team logic
    const eventTeam = (event as any).team
    const isDungloe = eventTeam ? eventTeam === 'dungloe' : (event.is_home_team === match?.is_home)
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
    }

    return mapping[eventLower] || eventLower  // Fallback to original if no mapping
  }

  // Handle foul button click
  const handleFoulClick = () => {
    setIsFoulModalOpen(true)
  }

  // Handle foul modal confirm
  const handleFoulConfirm = async (playerId: string) => {
    if (!matchId) return

    const isOppositionFoul = ballPosition.team === PossessionTeam.OPPONENT

    try {
      // Determine event type and team
      const eventType = isOppositionFoul ? EventType.FOUL_WON : EventType.FOUL_COMMITTED
      const isHomeTeam = match?.is_home || false

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: playerId,
        event_type: eventType,
        minute: minute,
        half: currentHalf,
        x_coord: ballPosition.x,
        y_coord: ballPosition.y,
        is_home_team: isHomeTeam,
        notes: undefined
      })

      // Possession stays with fouled team (already correct in ballPosition)
      // No ball movement needed - free kick taken from foul location or user moves ball for short free
    } catch (error) {
      console.error('Failed to record foul:', error)
    }
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
      const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
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
        } else {
          // Handle possession change for non-kickout, non-scoring events
          // (e.g., turnovers, unforced errors, saved shots)
          const turnoverEventStr = String(eventType).toUpperCase()
          
          if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED')) {
            // Determine new possession based on event type
            let newTeam: PossessionTeam
            let newX = ballPosition.x
            let newY = ballPosition.y
            
            if (turnoverEventStr.includes('TURNOVER_WON')) {
              // Dungloe won the ball → Dungloe gets possession
              newTeam = PossessionTeam.DUNGLOE
            } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
              // Dungloe lost the ball → Opponent gets possession
              newTeam = PossessionTeam.OPPONENT
            } else if (turnoverEventStr.includes('SAVED')) {
              // Shot saved → Defending team gets possession at goalkeeper position
              newTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
              
              // Move ball to goalkeeper position (inside small rectangle/goal area)
              if (newTeam === PossessionTeam.DUNGLOE) {
                // Dungloe keeper saved it → Ball at Dungloe goal
                newX = 5  // Inside Dungloe goal area (x=0 is goal line)
                newY = 50 // Center of goal
              } else {
                // Opponent keeper saved it → Ball at opponent goal
                newX = 95 // Inside opponent goal area (x=100 is goal line)
                newY = 50 // Center of goal
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

      // Check if this was a scoring event (goal, point, or 2-pointer)
      const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
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
        let newX = pendingEvent.position.x
        let newY = pendingEvent.position.y

        if (turnoverEventStr.includes('TURNOVER_WON')) {
          // Dungloe won the ball → Dungloe gets possession
          newTeam = PossessionTeam.DUNGLOE
        } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
          // Dungloe lost the ball → Opponent gets possession
          newTeam = PossessionTeam.OPPONENT
        } else if (turnoverEventStr.includes('SAVED')) {
          // Shot saved → Defending team gets possession at goalkeeper position
          newTeam = pendingEvent.team === 'dungloe' ? PossessionTeam.OPPONENT : PossessionTeam.DUNGLOE
          
          // Move ball to goalkeeper position (inside small rectangle/goal area)
          if (newTeam === PossessionTeam.DUNGLOE) {
            // Dungloe keeper saved it → Ball at Dungloe goal
            newX = 5  // Inside Dungloe goal area (x=0 is goal line)
            newY = 50 // Center of goal
          } else {
            // Opponent keeper saved it → Ball at opponent goal
            newX = 95 // Inside opponent goal area (x=100 is goal line)
            newY = 50 // Center of goal
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

  const endFirstHalf = () => {
    if (!matchId || minute < 30) return
    
    // Pause the timer
    setMatchPhase('half_time')
    console.log('First half ended at', minute, ':', seconds)
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
    if (matchPhase === 'second_half') return 'End Match'
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
                      className={`px-4 py-2 rounded-xl bg-gradient-to-r from-orange-600 to-amber-600 text-white font-medium shadow-lg hover:shadow-xl transition-all text-sm ${
                        !isEndButtonEnabled() ? 'opacity-50 cursor-not-allowed' : 'hover:from-orange-700 hover:to-amber-700'
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

                {/* Coordinate Debug Display */}
                <div className="absolute top-2 right-2 bg-black/60 backdrop-blur-sm px-3 py-1.5 rounded-lg text-xs text-white/80 font-mono">
                  x: {ballPosition.x.toFixed(1)}, y: {ballPosition.y.toFixed(1)}
                </div>

                {/* Categorized Action Buttons - Lower position */}
                <div className="absolute z-10 w-full max-w-xl px-4 left-1/2 -translate-x-1/2" style={{ bottom: '-2.75rem' }}>
                  <CategorizedActionButtons
                    onActionSelect={handleQuickAction}
                    onFoulClick={handleFoulClick}
                    disabled={matchPhase !== 'first_half' && matchPhase !== 'second_half'}
                    activeCategory={activeKickoutTab}
                    onCategoryChange={setActiveKickoutTab}
                    currentPossession={ballPosition.team}
                    isIn2PointZone={isIn2PointZone(ballPosition.x, ballPosition.y, ballPosition.team)}
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

      {/* Foul Modal */}
      <FoulModal
        isOpen={isFoulModalOpen}
        onClose={() => setIsFoulModalOpen(false)}
        onConfirm={handleFoulConfirm}
        players={players}
        currentPossession={ballPosition.team}
        opponentName={matchDisplay.opponent}
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
