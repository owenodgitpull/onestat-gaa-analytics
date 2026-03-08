import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import GAAPitch from '@/components/GAAPitch'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import PitchPlayerSelector from '@/components/PitchPlayerSelector'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import ConfirmationModal from '@/components/ConfirmationModal'
import ManualEventEntryModal from '@/components/ManualEventEntryModal'
import StartingLineupModal, { type LineupEntry } from '@/components/StartingLineupModal'
import LiveInsightDisplay from '@/components/LiveInsightDisplay'
import EventFilterToggles, { getEventTypesForFilters } from '@/components/EventFilterToggles'
import PossessionTerritoryChart from '@/components/charts/PossessionTerritoryChart'
import ScoringTimeline from '@/components/charts/ScoringTimeline'
import ShotOutcomeChart from '@/components/charts/ShotOutcomeChart'
import PathsTakenChart from '@/components/charts/PathsTakenChart'
import FullscreenPitchMode from '@/components/FullscreenPitchMode'
import JerseyNumberStrip from '@/components/JerseyNumberStrip'
import FormationSnapshotButton from '@/components/FormationSnapshotButton'
import FormationSnapshotMode from '@/components/FormationSnapshotMode'
import TacticalTagButton from '@/components/TacticalTagButton'
import BlackCardTimer, { type BlackCardEntry } from '@/components/BlackCardTimer'
import WeatherPickerPopover, { getWeatherIcon, getWeatherLabel } from '@/components/WeatherPickerPopover'
import { BallPosition, PossessionTeam, EventType, Player, MatchEvent } from '@/types'
import { useMatch, useMatchStats, useStartMatch, useCompleteMatch, useUpdateMatchPhase } from '@/hooks/useMatches'
import { useRecordEvent, useMatchEvents, useDeleteEvent } from '@/hooks/useMatchEvents'
import { useRecordPossession } from '@/hooks/usePossession'
import { usePlayers } from '@/hooks/usePlayers'
import { api } from '@/services/api'
import { usePlayerMovement } from '@/hooks/usePlayerMovement'
import { useClubName, useClub } from '@/contexts/ClubContext'
import { useTour } from '@/hooks/useTour'
import { matchRecordingSteps } from '@/config/tourSteps'
import {
  Clock,
  Activity,
  Play,
  AlertCircle,
  Plus,
  Maximize,
  Target,
  ArrowLeftRight,
  Pause
} from 'lucide-react'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

// Dev mode: Speed multiplier for testing (10 = 10x speed, so 3 real mins = 30 match mins)
// Set VITE_DEV_MATCH_SPEED=10 in .env.local for faster testing
const DEV_SPEED_MULTIPLIER = parseInt(import.meta.env.VITE_DEV_MATCH_SPEED || '1', 10)
const IS_DEV_SPEED = DEV_SPEED_MULTIPLIER > 1

interface PendingEvent {
  eventType: EventType
  team: 'own' | 'opponent'
  position: BallPosition
}

export default function MatchRecording() {
  const { matchId: matchIdParam } = useParams()
  const matchId = matchIdParam || null
  const navigate = useNavigate()
  const clubName = useClubName()
  const { club } = useClub()

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
  useUpdateMatchPhase() // initialized for future use

  // Local state
  const [ballPosition, setBallPosition] = useState<BallPosition>({
    x: 50,
    y: 50,
    team: PossessionTeam.OWN
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
  const [insightRefresh, setInsightRefresh] = useState(0)
  const [eventMapTeamFilter, setEventMapTeamFilter] = useState<'own' | 'opponent'>('own')
  const [eventMapFilters, setEventMapFilters] = useState<Set<string>>(new Set(['all']))
  const [pendingKickoutEvent, setPendingKickoutEvent] = useState<{
    eventType: EventType
    isHomeTeam: boolean
    playerId?: string
  } | null>(null) // Kickout event waiting for position selection
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<number | null>(null)
  const [errorAlert, setErrorAlert] = useState<string | null>(null)
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false)
  const [isLineupModalOpen, setIsLineupModalOpen] = useState(false)
  const [startingLineup, setStartingLineup] = useState<Record<string, LineupEntry>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, LineupEntry> | undefined>(undefined)
  const [teamAttackingRight, setTeamAttackingRight] = useState<boolean>(true) // true = attacking towards x=100
  const [ballTrail, setBallTrail] = useState<Array<{ x: number; y: number }>>([])
  const prevTeamRef = useRef(ballPosition.team)

  // Clear trail and carrier on possession change (team switch)
  useEffect(() => {
    if (ballPosition.team !== prevTeamRef.current) {
      setBallTrail([])
      setActiveCarrierId(null)
      prevTeamRef.current = ballPosition.team
    }
  }, [ballPosition.team])

  const [pendingFreeKick, setPendingFreeKick] = useState<{ position: BallPosition; player?: Player } | null>(null) // Track free kick state with optional player
  const [pending45, setPending45] = useState<{ position: BallPosition } | null>(null) // Track 45 state
  const [selectingFoulPlayer, setSelectingFoulPlayer] = useState<boolean>(false) // True when selecting own player who fouled
  const [pendingFoul, setPendingFoul] = useState<'own' | 'opponent' | null>(null) // Track which team committed the foul
  const [weatherOverride, setWeatherOverride] = useState<{ condition: string | null; temp: number | null } | null>(null)
  const [isWeatherPickerOpen, setIsWeatherPickerOpen] = useState(false)
  const [isFullscreenPitch, setIsFullscreenPitch] = useState(false)
  const [isStopped, setIsStopped] = useState(false)

  // Guided tour
  const { startTour: startMatchTour } = useTour('matchRecording', matchRecordingSteps)
  const matchTourTriggered = useRef(false)

  // Black card sin bin timers
  const [blackCardTimers, setBlackCardTimers] = useState<BlackCardEntry[]>([])

  // Compute players currently on the field (starting 15 + subbed on, minus subbed off)
  const playersOnField = useMemo(() => {
    if (!matchLineup.length) return players.filter(p => p.active)
    const onFieldIds = new Set(matchLineup.filter(l => l.is_on_field).map(l => l.player_id))
    return players.filter(p => onFieldIds.has(p.id))
  }, [matchLineup, players])

  // Player movement tracking (ball carrier)
  const [activeCarrierId, setActiveCarrierId] = useState<string | null>(null)
  const playerMovement = usePlayerMovement({
    matchId: matchId,
    half: currentHalf,
    minute: minute,
    team: ballPosition.team === PossessionTeam.OWN ? 'own' : 'opponent',
  })

  // Map position_id to short label for carrier strip fallback
  const POSITION_LABELS: Record<string, string> = {
    'gk': 'GK', 'fb-left': 'CB', 'fb-center': 'FB', 'fb-right': 'CB',
    'hb-left': 'HB', 'hb-center': 'CHB', 'hb-right': 'HB',
    'mf-left': 'MF', 'mf-right': 'MF',
    'hf-left': 'HF', 'hf-center': 'CHF', 'hf-right': 'HF',
    'ff-left': 'CF', 'ff-center': 'FF', 'ff-right': 'CF',
  }

  // Build jersey strip player list from lineup data
  const jerseyStripPlayers = useMemo(() => {
    if (!matchLineup.length) return []
    return matchLineup.map((entry: any) => {
      const player = players.find(p => p.id === entry.player_id)
      return {
        playerId: entry.player_id,
        jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number ?? player?.jersey_number ?? null,
        playerName: player?.name ?? entry.player_name ?? 'Unknown',
        isOnField: entry.is_on_field,
        positionLabel: POSITION_LABELS[entry.position_id] || entry.position_id || '',
      }
    })
  }, [matchLineup, players])

  const handleCarrierSelect = async (playerId: string, jerseyNumber: number | null) => {
    if (activeCarrierId === playerId) {
      // Deselect
      await playerMovement.selectCarrier(playerId, jerseyNumber, ballPosition.x, ballPosition.y)
      setActiveCarrierId(null)
    } else {
      // Select new carrier
      await playerMovement.selectCarrier(playerId, jerseyNumber, ballPosition.x, ballPosition.y)
      setActiveCarrierId(playerId)
    }
  }

  // Formation snapshot state
  const [isSnapshotMode, setIsSnapshotMode] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [shouldPulseSnapshot, setShouldPulseSnapshot] = useState(false)

  // Tactical tag state
  const [tacticalTagCount, setTacticalTagCount] = useState(0)

  const handleFormationSave = async (positions: Array<{ playerId: string; jerseyNumber: number | null; x: number; y: number }>, label: string) => {
    if (!matchId) return
    try {
      await api.playerMovement.createSnapshot({
        match_id: matchId,
        half: currentHalf,
        minute,
        label,
        positions: positions.map(p => ({
          player_id: p.playerId,
          jersey_number: p.jerseyNumber,
          x: p.x,
          y: p.y,
        })),
      })
      setSnapshotCount(prev => prev + 1)
    } catch (err) {
      console.error('Failed to save formation snapshot:', err)
    }
  }

  const handleTacticalTag = async (tagType: string, label?: string) => {
    if (!matchId) return
    try {
      await api.playerMovement.createTacticalTag({
        match_id: matchId,
        tag_type: tagType,
        label,
        half: currentHalf,
        minute,
        pitch_x: ballPosition.x,
        pitch_y: ballPosition.y,
      })
      setTacticalTagCount(prev => prev + 1)
    } catch (err) {
      console.error('Failed to create tactical tag:', err)
    }
  }

  // Query client for manual refetching
  const queryClient = useQueryClient()

  // Sync match status with backend — resume timer from DB timestamps
  useEffect(() => {
    if (!match) return

    if (match.status === 'in_progress' && matchPhase === 'not_started') {
      const phase = (match.current_phase as MatchPhase) || 'first_half'
      setMatchPhase(phase)

      // Restore attack direction
      if (match.attacking_right_first_half != null) {
        // In 2nd half, flip direction
        setTeamAttackingRight(
          phase === 'second_half' ? !match.attacking_right_first_half : match.attacking_right_first_half
        )
      }

      // Derive timer from timestamps
      const parseTS = (ts: string) => new Date(ts + (ts.endsWith('Z') ? '' : 'Z')).getTime()

      if (phase === 'first_half' && match.started_at) {
        const elapsed = (Date.now() - parseTS(match.started_at)) * DEV_SPEED_MULTIPLIER
        const mins = Math.floor(elapsed / 60000)
        const secs = Math.floor((elapsed % 60000) / 1000)
        setMinute(Math.min(mins, 29)) // cap at 29 so timer auto-pauses at 30
        setSeconds(secs)
        setCurrentHalf(1)
      } else if (phase === 'half_time') {
        setMinute(30)
        setSeconds(0)
        setCurrentHalf(1)
      } else if (phase === 'second_half' && match.second_half_started_at) {
        const elapsed = (Date.now() - parseTS(match.second_half_started_at)) * DEV_SPEED_MULTIPLIER
        const mins = 30 + Math.floor(elapsed / 60000)
        const secs = Math.floor((elapsed % 60000) / 1000)
        setMinute(mins)
        setSeconds(secs)
        setCurrentHalf(2)
        if (mins >= 60) setFullTimeReached(true)
      }
    } else if (match.status === 'completed' && matchPhase !== 'finished') {
      setMatchPhase('finished')
    }

  }, [match])

  // Weather: use local override (optimistic) if set, otherwise fall back to match data
  const weatherCondition = weatherOverride ? weatherOverride.condition : (match?.weather_condition ?? null)
  const temperatureCelsius = weatherOverride ? weatherOverride.temp : (match?.temperature_celsius ?? null)

  // Save weather change to backend
  const handleWeatherSave = async (condition: string | null, temp: number | null) => {
    // Set optimistic override immediately so UI updates
    setWeatherOverride({ condition, temp })
    if (matchId) {
      try {
        await api.matches.update(matchId, {
          weather_condition: condition,
          temperature_celsius: temp,
        } as any)
        // Refetch match data, then clear override (server data now matches)
        await queryClient.invalidateQueries({ queryKey: ['matches', matchId] })
        setWeatherOverride(null)
      } catch (err) {
        console.error('Failed to update weather:', err)
      }
    }
  }

  // Trigger guided tour on first visit with valid match
  useEffect(() => {
    if (match && !matchLoading && !matchTourTriggered.current) {
      matchTourTriggered.current = true
      startMatchTour()
    }
  }, [match, matchLoading, startMatchTour])

  // Load match lineup
  useEffect(() => {
    const loadLineup = async () => {
      if (matchId) {
        try {
          const lineup = await api.matchLineups.getLineup(matchId)
          setMatchLineup(lineup)

          // Rebuild startingLineup object from loaded lineup
          const lineupObj: Record<string, LineupEntry> = {}
          lineup.forEach((entry) => {
            lineupObj[entry.position_id] = {
              playerId: entry.player_id,
              jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number,
            }
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
          const lineupObj: Record<string, LineupEntry> = {}
          lastLineup.forEach((entry) => {
            lineupObj[entry.position_id] = {
              playerId: entry.player_id,
              jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number,
            }
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
  // Pauses during stoppages
  useEffect(() => {
    if ((matchPhase === 'first_half' || matchPhase === 'second_half') && !isStopped) {
      const intervalMs = Math.floor(1000 / DEV_SPEED_MULTIPLIER)
      const interval = setInterval(() => {
        setSeconds((prev) => {
          if (prev >= 59) {
            setMinute((m) => {
              // At 60 minutes, just mark full time reached but DON'T auto-finish
              // User must click "End Match" to properly complete and trigger AI analysis
              if (m >= 59 && matchPhase === 'second_half') {
                setFullTimeReached(true)
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
  }, [matchPhase, isStopped])

  // Calculate real-time stats from backend - now using MatchStats directly
  // Backend calculates scores as (goals*3 + points), so we need to reverse-engineer for display
  const teamGoals = match?.team_goals || 0
  const teamPoints = match?.team_points || 0
  const opponentGoals = match?.opponent_goals || 0
  const opponentPoints = match?.opponent_points || 0

  // Get other stats directly from matchStats API response
  const teamShots = matchStats?.team_total_shots || 0
  const opponentShots = matchStats?.opponent_total_shots || 0
  const teamWides = matchStats?.team_wides || 0
  const opponentWides = matchStats?.opponent_wides || 0
  const teamScores = matchStats?.team_scores || 0
  const opponentScores = matchStats?.opponent_scores || 0

  // Calculate accuracy
  const teamAccuracy = matchStats?.team_accuracy?.toFixed(1) || '0'

  // Calculate possession % from backend stats (time-based, not event count)
  // When no possession events exist (match not started), show 0/0 instead of 0/100
  const rawTeamPct = matchStats?.team_possession_percentage ?? 0
  const rawOppPct = matchStats?.opponent_possession_percentage ?? 0
  const hasPossessionData = rawTeamPct > 0 || rawOppPct > 0
  const teamPossessionPct = hasPossessionData ? Math.round(rawTeamPct) : 0
  const opponentPossessionPct = hasPossessionData ? 100 - teamPossessionPct : 0

  // Use backend matchStats for all statistics (already calculated correctly)
  const teamTurnoversWon = matchStats?.team_turnovers_won || 0
  const teamTurnoversLost = matchStats?.team_turnovers_lost || 0
  const teamKickoutsWon = matchStats?.team_kickouts_won || 0
  const teamKickoutsLost = matchStats?.team_kickouts_lost || 0
  const opponentKickoutsWon = matchStats?.opponent_kickouts_won || 0
  const opponentKickoutsLost = matchStats?.opponent_kickouts_lost || 0

  // Calculate kickout totals for each team
  const totalTeamKickouts = teamKickoutsWon + teamKickoutsLost
  const totalOpponentKickouts = opponentKickoutsWon + opponentKickoutsLost
  const teamKickoutRetention = totalTeamKickouts > 0 ? ((teamKickoutsWon / totalTeamKickouts) * 100).toFixed(1) : '0.0'
  const opponentKickoutRetention = totalOpponentKickouts > 0 ? ((opponentKickoutsWon / totalOpponentKickouts) * 100).toFixed(1) : '0.0'

  // Recent events - fetch from backend, newest first
  const { data: matchEventsData } = useMatchEvents(matchId)
  const allEvents = matchEventsData?.events || []
  const [visibleEventCount, setVisibleEventCount] = useState(15)

  // Track players on yellow cards (for second yellow → automatic red)
  const yellowCardPlayerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ev of allEvents) {
      if (ev.event_type === 'yellow_card' && ev.player_id) {
        ids.add(String(ev.player_id))
      }
    }
    return ids
  }, [allEvents])

  // Flash state for second-yellow animation
  const [secondYellowFlash, setSecondYellowFlash] = useState(false)

  // Match display data
  const matchDisplay = {
    opponent: match?.opponent || 'Loading...',
    score: {
      team: { goals: teamGoals, points: teamPoints },
      opponent: { goals: opponentGoals, points: opponentPoints }
    },
    minute: minute,
    status: matchPhase
  }

  const stats = {
    possession: { team: teamPossessionPct, opponent: opponentPossessionPct },
    shots: { team: teamShots, opponent: opponentShots },
    scores: { team: teamScores, opponent: opponentScores },
    wides: { team: teamWides, opponent: opponentWides },
    accuracy: parseFloat(teamAccuracy),
    conversionRate: teamShots > 0 ? parseFloat(((teamScores / teamShots) * 100).toFixed(1)) : 0,
    turnovers: { won: teamTurnoversWon, lost: teamTurnoversLost },
    kickouts: {
      teamWon: teamKickoutsWon,
      teamTotal: totalTeamKickouts,
      opponentWon: opponentKickoutsWon,
      opponentTotal: totalOpponentKickouts
    }
  }

  // Event map filtered events (same logic as MatchResult)
  const filteredMapEvents = useMemo(() => {
    if (!matchEventsData?.events) return []
    const eventTypes = getEventTypesForFilters(eventMapFilters)
    let events = matchEventsData.events.map((e: any) => ({
      id: e.id,
      pitch_x: e.pitch_x,
      pitch_y: e.pitch_y,
      event_type: e.event_type,
      team: e.team || (e.is_home_team ? 'own' : 'opponent'),
      player_name: e.player_name,
      minute: e.minute
    }))
    events = events.filter((e: any) => e.team === eventMapTeamFilter)
    if (eventTypes) {
      events = events.filter((e: any) => eventTypes.includes(e.event_type))
    }
    const CARD_TYPES = ['yellow_card', 'black_card', 'red_card']
    return events.filter((e: any) => e.pitch_x !== null && e.pitch_y !== null && !CARD_TYPES.includes(e.event_type))
  }, [matchEventsData, eventMapFilters, eventMapTeamFilter])

  // Helper function to check if position is in 2-point zone (outside 40m arc)
  // Coordinates are pitch-area %: 0-100 maps to playable pitch only
  // Now accounts for teamAttackingRight direction setting
  const isIn2PointZone = (x: number, y: number, team: PossessionTeam): boolean => {
    // GAA pitch: 40m arc from goal center (2-point line)
    // CALIBRATED from SVG pitch, converted to pitch-area coords:
    // - At centerline (y=50), the arc is at pitch-area x=72.28
    // - X_RADIUS = 100 - 72.28 = 27.72%
    // - Y_RADIUS = 40m / 90m * 100 = 44.44% (40m arc on 90m wide pitch)

    const X_RADIUS_PERCENT = 27.72
    const Y_RADIUS_PERCENT = 44.44

    // Determine which goal the team is attacking based on attack direction
    let attackingGoalX: number

    if (team === PossessionTeam.OWN) {
      // Our team's attacking goal depends on direction setting
      attackingGoalX = teamAttackingRight ? 100 : 0
    } else if (team === PossessionTeam.OPPONENT) {
      // Opponent attacks the opposite direction
      attackingGoalX = teamAttackingRight ? 0 : 100
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
    eventTeamIsOwn: boolean = true,
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

    // Determine which goal is ours based on attack direction
    // If attacking right: we defend x=0, attack x=100
    // If attacking left: we defend x=100, attack x=0
    const ownTeamDefendsLeft = teamAttackingRight // Our goal is at x=0

    // Calculate distances from both goals
    const distFromLeftGoal = x  // Distance from x=0 goal
    const distFromRightGoal = 100 - x  // Distance from x=100 goal

    // Determine which goal is the attacking goal for the event's team
    let distFromAttackingGoal: number
    let distFromDefendingGoal: number
    let attackingTeamName: string
    let defendingTeamName: string

    if (eventTeamIsOwn) {
      // Our team's event - attacking goal depends on direction
      if (ownTeamDefendsLeft) {
        // We attack right (towards x=100)
        distFromAttackingGoal = distFromRightGoal
        distFromDefendingGoal = distFromLeftGoal
      } else {
        // We attack left (towards x=0)
        distFromAttackingGoal = distFromLeftGoal
        distFromDefendingGoal = distFromRightGoal
      }
      attackingTeamName = 'our team'
      defendingTeamName = opponentName
    } else {
      // Opponent's event - they attack the opposite direction
      if (ownTeamDefendsLeft) {
        // Opponent attacks left (towards x=0, our goal)
        distFromAttackingGoal = distFromLeftGoal
        distFromDefendingGoal = distFromRightGoal
      } else {
        // Opponent attacks right (towards x=100, our goal)
        distFromAttackingGoal = distFromRightGoal
        distFromDefendingGoal = distFromLeftGoal
      }
      attackingTeamName = opponentName
      defendingTeamName = 'our team'
    }

    // Check if outside 40m arc using elliptical calculation (for attacking goal)
    // Pitch-area coords: X_RADIUS=27.72, Y_RADIUS=55.06
    const X_RADIUS_PERCENT = 27.72
    const Y_RADIUS_PERCENT = 55.06
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
    // Thresholds calibrated to pitch-area coords (0=goal line, 100=opposite goal)
    if (distFromAttackingGoal < distFromDefendingGoal) {
      if (distFromAttackingGoal <= 3.2) return `inside ${defendingTeamName}'s small rectangle${lateral}`
      if (distFromAttackingGoal <= 10.5) return `${defendingTeamName}'s 13-meter line${lateral}`
      if (distFromAttackingGoal <= 14) return `${defendingTeamName}'s 20-meter line${lateral}`
      if (!isOutsideAttackingArc) return `inside ${defendingTeamName}'s 40-meter arc${lateral}`
      if (distFromAttackingGoal <= 35) return `outside ${defendingTeamName}'s 40-meter arc${lateral}` // 2-point zone
      return `${defendingTeamName}'s half${lateral}`
    }

    // MIDFIELD ZONES
    if (distFromAttackingGoal <= 50 && distFromDefendingGoal <= 50) {
      return `around midfield${lateral}`
    }

    // DEFENSIVE ZONES (in own half) - closer to defending goal
    if (distFromDefendingGoal <= 3.2) return `inside ${attackingTeamName}'s small rectangle${lateral}`
    if (distFromDefendingGoal <= 10.5) return `${attackingTeamName}'s 13-meter line${lateral}`
    if (distFromDefendingGoal <= 14) return `${attackingTeamName}'s 20-meter line${lateral}`
    if (isInsideDefendingArc) return `inside ${attackingTeamName}'s 40-meter arc${lateral}`
    if (distFromDefendingGoal <= 35) return `${attackingTeamName}'s 45-meter line${lateral}`

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
      setErrorAlert('Failed to delete event. Please try again.')
    }
  }

  // Helper function to format event description
  const formatEventDescription = (event: MatchEvent): string => {
    const player = players.find(p => p.id === String(event.player_id))
    const teamName = match?.opponent || 'Opposition'
    // Backend returns team as 'own' or 'opponent', fallback to is_home_team logic
    const eventTeam = (event as any).team
    const isOwn = eventTeam ? eventTeam === 'own' : (event.is_home_team === match?.is_home)
    // Get contextual area description based on which team the event is for
    const area = getPitchArea(event.pitch_x, event.pitch_y, isOwn, teamName)
    // For own team events, use player name; for opponent events, use team name
    const playerName = isOwn ? (player?.name || 'our player') : teamName

    switch (event.event_type) {
      case 'point':
        return isOwn
          ? `${playerName} scored a point from ${area}`
          : `${teamName} scored a point from ${area}`

      case 'two_point':
        return isOwn
          ? `${playerName} scored a 2-pointer from ${area}`
          : `${teamName} scored a 2-pointer from ${area}`

      case 'goal':
        return isOwn
          ? `${playerName} scored a goal from ${area}`
          : `${teamName} scored a goal from ${area}`

      case 'wide':
        return isOwn
          ? `${playerName} hit a wide from ${area}`
          : `${teamName} hit a wide from ${area}`

      case 'short':
        return isOwn
          ? `${playerName}'s shot fell short from ${area}`
          : `${teamName} shot fell short from ${area}`

      case 'saved':
        return isOwn
          ? `${playerName}'s shot was saved from ${area}`
          : `${teamName} shot was saved from ${area}`

      case 'point_free':
        return isOwn
          ? `${playerName} scored a point from a free in ${area}`
          : `${teamName} scored a point from a free in ${area}`

      case 'two_point_free':
        return isOwn
          ? `${playerName} scored a 2-pointer from a free in ${area}`
          : `${teamName} scored a 2-pointer from a free in ${area}`

      case 'wide_free':
        return isOwn
          ? `${playerName} hit a wide from a free in ${area}`
          : `${teamName} hit a wide from a free in ${area}`

      case 'forty_five':
        return isOwn
          ? `${playerName} scored from a 45`
          : `${teamName} scored from a 45`

      case 'forty_five_missed':
        return isOwn
          ? `${playerName} missed a 45`
          : `${teamName} missed a 45`

      case 'penalty_goal':
        return isOwn
          ? `${playerName} scored a penalty goal`
          : `${teamName} scored a penalty goal`

      case 'penalty_miss':
        return isOwn
          ? `${playerName} missed a penalty`
          : `${teamName} missed a penalty`

      case 'turnover_won':
        return isOwn
          ? `${playerName} won a turnover in ${area}`
          : `${teamName} won a turnover in ${area}`

      case 'turnover_lost':
        return isOwn
          ? `${playerName} conceded a turnover in ${area}`
          : `${teamName} conceded a turnover in ${area}`

      case 'our_unforced_error':
        return isOwn
          ? `${playerName} made an unforced error in ${area}`
          : `${teamName} made an unforced error in ${area}`

      case 'opp_unforced_error':
        return `${teamName} made an unforced error in ${area}`

      case 'kickout_won':
        // Backend stores kickout_won for both teams - check who actually won
        return isOwn
          ? `${playerName} won kickout clean in ${area}`
          : `${teamName} won kickout clean in ${area}`

      case 'kickout_lost':
        // Backend stores kickout_lost when our team loses their own kickout
        return `We lost kickout to ${teamName} in ${area}`

      // Own kickouts (our team kicking out)
      // Replace team name in area with "their" to avoid "Ardara ... in Ardara's half"
      case 'own_kickout_won':
        return `${playerName} won own kickout clean in ${area}`
      case 'own_kickout_opposition_won':
        return `${teamName} won our kickout in ${area.replace(`${teamName}'s`, 'their')}`
      case 'own_kickout_won_break':
        return `${playerName} won breaking ball from own kickout in ${area}`
      case 'own_kickout_opposition_won_break':
        return `${teamName} won breaking ball from our kickout in ${area.replace(`${teamName}'s`, 'their')}`

      // Opposition kickouts (opponent kicking out)
      case 'opp_kickout_won':
        return `${playerName} won ${teamName} kickout clean in ${area.replace(`${teamName}'s`, 'their')}`
      case 'opp_kickout_opposition_won':
        return `${teamName} won own kickout clean in ${area.replace(`${teamName}'s`, 'their')}`
      case 'opp_kickout_won_break':
        return `${playerName} won breaking ball from ${teamName} kickout in ${area.replace(`${teamName}'s`, 'their')}`
      case 'opp_kickout_opposition_won_break':
        return `${teamName} won breaking ball from own kickout in ${area.replace(`${teamName}'s`, 'their')}`

      case 'breaking_ball_won':
        // Breaking ball from kickout
        return isOwn
          ? `${playerName} won breaking ball in ${area}`
          : `${teamName} won breaking ball in ${area}`

      case 'free_won':
        return isOwn
          ? `${playerName} won a free in ${area}`
          : `${teamName} won a free in ${area}`

      case 'free_conceded':
        return isOwn
          ? `${playerName} conceded a free in ${area}`
          : `${teamName} conceded a free in ${area}`

      case 'foul_won':
        return isOwn
          ? `${playerName} was fouled by ${teamName} in ${area}`
          : `${teamName} player was fouled by us in ${area}`

      case 'foul_committed':
        return isOwn
          ? `${playerName} committed a foul in ${area}`
          : `${teamName} committed a foul in ${area}`

      case 'yellow_card':
        return isOwn
          ? `${playerName} received a yellow card`
          : `${teamName} player received a yellow card`

      case 'black_card':
        return isOwn
          ? `${playerName} received a black card (10 min sin bin)`
          : `${teamName} player received a black card (10 min sin bin)`

      case 'red_card': {
        // Check if this player already had a yellow card (second yellow → automatic red)
        const playerId = String(event.player_id)
        const priorYellows = allEvents.filter(
          e => e.event_type === 'yellow_card' && String(e.player_id) === playerId
        )
        if (isOwn && priorYellows.length > 0) {
          return `${playerName} sent off after receiving a second yellow card (Automatic Red Card)`
        }
        return isOwn
          ? `${playerName} sent off with a straight red card`
          : `${teamName} player sent off with a straight red card`
      }

      case 'block':
        return isOwn
          ? `${playerName} made a block in ${area}`
          : `${teamName} made a block in ${area}`

      case 'interception':
        return isOwn
          ? `${playerName} made an interception in ${area}`
          : `${teamName} made an interception in ${area}`

      case 'substitution':
        // Extract substitution details from notes if available
        if (event.notes) {
          return `Substitution: ${event.notes}`
        }
        return isOwn
          ? `${playerName} substituted off`
          : `${teamName} substitution`

      default:
        return isOwn
          ? `${event.event_type.replace(/_/g, ' ')} - ${playerName}`
          : `${event.event_type.replace(/_/g, ' ')} - ${teamName}`
    }
  }

  const handleBallMove = async (newPosition: BallPosition) => {
    // Check if there's a pending kickout event waiting for position
    if (pendingKickoutEvent) {
      console.log('Recording pending kickout at position:', newPosition)
      try {
        await recordKickoutAtPosition(pendingKickoutEvent, newPosition)
      } catch (err) {
        console.error('Kickout recording failed in handleBallMove:', err)
        // Always clear pending state so user isn't stuck
        setPendingKickoutEvent(null)
        setAwaitingKickout(false)
        setActiveKickoutTab('scoring')
      }
      return
    }

    // Block ball movement if awaiting kickout resolution
    if (awaitingKickout) {
      console.log('Ball movement blocked - awaiting kickout resolution')
      return
    }

    // Block ball movement during stoppage
    if (isStopped) {
      console.log('Ball movement blocked - stoppage in progress')
      return
    }

    // Only record if match is in progress (pitch stays active at half-time for late data capture)
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished') {
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
    setBallTrail(prev => [...prev.slice(-49), { x: newPosition.x, y: newPosition.y }])

    // Record possession event to backend
    try {
      await recordPossession.mutateAsync({
        match_id: matchId,
        x_coord: newPosition.x,
        y_coord: newPosition.y,
        team: newPosition.team === PossessionTeam.OWN ? 'home' : 'away',
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

  // Batch-record drag waypoints as possession events (single bulk request on drag-end)
  const handleDragPath = (waypoints: Array<{ x: number; y: number }>) => {
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished' || isStopped) return
    const team = ballPosition.team === PossessionTeam.OWN ? 'own' : 'opponent'
    api.possession.bulkCreate({
      match_id: matchId,
      team: team as 'own' | 'opponent',
      minute,
      waypoints,
    }).then(res => {
      console.log(`Drag path: ${res.created} waypoints recorded`)
      queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })
    }).catch(err => {
      console.error('Failed to record drag path:', err)
    })

    // Append path points to active carrier segment
    if (activeCarrierId) {
      for (const wp of waypoints) {
        playerMovement.appendPathPoint(wp.x, wp.y)
      }
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
      const isTeamWon = eventTypeStr.includes('_WON') && !eventTypeStr.includes('OPPOSITION_WON')
      const newTeam = isTeamWon ? PossessionTeam.OWN : PossessionTeam.OPPONENT

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
          team: isTeamWon ? 'home' : 'away',
          timestamp: new Date(),
          minute: minute,
          half: currentHalf
        })
        console.log('Kickout possession recorded:', isTeamWon ? 'Own team' : 'Opposition')
      } catch (error) {
        console.error('Failed to record kickout possession:', error)
      }

      // Clear pending kickout
      setPendingKickoutEvent(null)
      setAwaitingKickout(false)

      // Switch to scoring tab after kickout resolved
      setActiveKickoutTab('scoring')

      // Force refetch stats
      await queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })

      console.log('Kickout recorded and ball moved to:', newBallPosition)
    } catch (error) {
      console.error('Failed to record kickout:', error)
      // Always clear the pending state so the user isn't stuck
      setPendingKickoutEvent(null)
      setAwaitingKickout(false)
      setActiveKickoutTab('scoring')
      setErrorAlert('Failed to record kickout. Please try again.')
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

      // Kickouts — pass through detailed types to backend
      'own_kickout_won': 'own_kickout_won',
      'own_kickout_opposition_won': 'own_kickout_opposition_won',
      'opp_kickout_won': 'opp_kickout_won',
      'opp_kickout_opposition_won': 'opp_kickout_opposition_won',

      // Breaking balls — pass through detailed types to backend
      'own_kickout_won_break': 'own_kickout_won_break',
      'own_kickout_opposition_won_break': 'own_kickout_opposition_won_break',
      'opp_kickout_won_break': 'opp_kickout_won_break',
      'opp_kickout_opposition_won_break': 'opp_kickout_opposition_won_break',

      // Frees
      'point_free': 'point_free',
      'two_point_free': 'two_point_free',
      'wide_free': 'wide_free',

      // 45s (ball went wide off defender)
      'forty_five': 'forty_five',  // 45 scored - always 1 point
      'forty_five_missed': 'forty_five_missed',  // 45 missed

      // Penalties
      'penalty_goal': 'penalty_goal',
      'penalty_miss': 'penalty_miss',
    }

    return mapping[eventLower] || eventLower  // Fallback to original if no mapping
  }

  // Handle "Foul" button - receives which team committed the foul
  const handleFoulClick = (team: 'own' | 'opponent') => {
    console.log('Foul committed by:', team)
    setPendingFoul(team)

    if (team === 'own') {
      // Our team fouled - need to select which player committed the foul
      setSelectingFoulPlayer(true)
      setIsPlayerModalOpen(true)
      console.log('Own team foul - selecting player who fouled...')
    } else {
      // Opposition fouled - our team wins free, go straight to free options
      setPendingFreeKick({ position: ballPosition })
      // Our team now has possession (they won the free)
      setBallPosition(prev => ({
        ...prev,
        team: PossessionTeam.OWN
      }))
      console.log('Opposition foul - own team wins free at:', ballPosition)
    }
  }

  // Handle player selected for foul (our player who committed the foul)
  const handleFoulPlayerSelected = async (player: Player) => {
    if (!matchId) return

    // Record foul_committed event for this own team player
    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: player.id,
        event_type: 'foul_committed',
        minute: minute,
        half: currentHalf,
        x_coord: ballPosition.x,
        y_coord: ballPosition.y,
        is_home_team: true, // Own team committed the foul
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
      setErrorAlert('Failed to record foul. Please try again.')
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

  // Cancel pending kickout position selection
  const handleCancelKickout = () => {
    const pending = pendingKickoutEvent
    setPendingKickoutEvent(null)
    setAwaitingKickout(false)
    setActiveKickoutTab('scoring')

    // Restore possession based on what kickout was pending
    // If it was a "We Won" kickout, give possession to own team
    if (pending) {
      const eventTypeStr = String(pending.eventType).toUpperCase()
      const isTeamWon = eventTypeStr.includes('_WON') && !eventTypeStr.includes('OPPOSITION_WON')
      if (isTeamWon) {
        setBallPosition(prev => ({ ...prev, team: PossessionTeam.OWN }))
      }
    }
    console.log('Kickout cancelled, possession restored')
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
      const isHomeTeam = data.team === PossessionTeam.OWN ? (match?.is_home || false) : !(match?.is_home || false)

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
  const handleLineupConfirm = async (lineup: Record<string, LineupEntry>) => {
    setStartingLineup(lineup)
    setIsLineupModalOpen(false)

    // Save lineup to backend
    if (matchId) {
      try {
        const lineupEntries = Object.entries(lineup).map(([positionId, entry]) => ({
          player_id: entry.playerId,
          position_id: positionId,
          is_substitute: positionId.startsWith('sub-'),
          jersey_number: entry.jerseyNumber,
        }))

        await api.matchLineups.saveLineup(matchId, lineupEntries)
        console.log('Lineup saved successfully')
      } catch (error) {
        console.error('Failed to save lineup:', error)
      }
    }
  }

  /** Handle discipline card events — opens player modal then records */
  const handleDiscipline = (eventType: EventType) => {
    if (!matchId) return
    // Open player modal to select who received the card
    setPendingEvent({
      eventType,
      team: 'own',
      position: ballPosition,
    })
    setIsPlayerModalOpen(true)
  }

  const handleQuickAction = (eventType: EventType) => {
    console.log('Quick action:', eventType, 'at position:', ballPosition)
    console.log('Ball possession team:', ballPosition.team)

    // Check if this is a free kick result or 45 result
    const eventStr = String(eventType).toUpperCase()
    const isFreeKickResult = eventStr.includes('FREE')
    const is45Result = eventStr.includes('FORTY_FIVE')

    // Determine action position based on pending state
    let actionPosition = ballPosition
    let isTeamTakingFree = true
    if (isFreeKickResult && pendingFreeKick) {
      actionPosition = pendingFreeKick.position
      // If pendingFoul is 'own', opponent takes the free. If 'opponent', own team takes the free.
      isTeamTakingFree = pendingFoul === 'opponent'
      console.log('Recording free kick result, team taking free:', isTeamTakingFree ? 'Own team' : 'Opponent', ', clearing pending free kick')
      setPendingFreeKick(null)
    } else if (is45Result && pending45) {
      actionPosition = pending45.position
      console.log('Recording 45 result, clearing pending 45')
      setPending45(null)
    }

    // NEW PRINCIPLE: Buttons explicitly say "We Won" or "Opposition Won"
    // "We Won" → needs own player selection, is_home_team: true
    // "Opposition Won" → no player needed, is_home_team: false

    const isTeamWon = eventStr.includes('_WON') && !eventStr.includes('OPPOSITION_WON')
    const isOppositionWon = eventStr.includes('OPPOSITION_WON')

    // Determine team based on event type
    let isHomeTeam: boolean

    if (isTeamWon) {
      // ANY "We Won" event → own team
      isHomeTeam = true
    } else if (isOppositionWon) {
      // ANY "Opposition Won" event → opponent team
      isHomeTeam = false
    } else if (eventType === EventType.TURNOVER_WON) {
      // Turnover Won → Always own team (we won the ball)
      isHomeTeam = true
    } else if (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) {
      // Interception / Block → the team WITHOUT possession wins the ball
      // If opponent has ball and we intercept → own team (true)
      // If own team has ball and opponent intercepts → Opponent (false)
      isHomeTeam = actionPosition.team !== PossessionTeam.OWN
    } else if (eventType === EventType.TURNOVER_LOST) {
      // Turnover Lost → our player lost it (we want to track which of our players made the error)
      isHomeTeam = true
    } else if (eventStr.startsWith('OWN_')) {
      // OWN_ prefix = own team action
      isHomeTeam = true
    } else if (isFreeKickResult || is45Result) {
      // Free kick results and 45s are always own team (we won the free / took the 45)
      isHomeTeam = true
    } else {
      // No prefix (GOAL, POINT, WIDE) = use POSSESSION
      isHomeTeam = actionPosition.team === PossessionTeam.OWN
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

    // Opponent scoring/shooting/interception — we don't track opponent players
    const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SAVED]
    const isOpponentScoring = scoringEvents.includes(eventType) && !isHomeTeam
    const isOpponentDefence = (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) && !isHomeTeam

    // Free kick results - record with context of which team is taking the free
    if (isFreeKickResult) {
      if (isTeamTakingFree) {
        // Own team taking the free — open player modal to select who takes it
        setPendingEvent({
          eventType: eventType as EventType,
          team: 'own',
          position: actionPosition
        })
        setIsPlayerModalOpen(true)
      } else {
        // Opponent taking the free — record immediately (we don't track their players)
        recordFreeKickResult(eventType, actionPosition, false)
      }
    } else if (noPlayerNeeded.includes(eventType as EventType) || isOpponentScoring || isOpponentDefence) {
      // Record immediately without player selection
      recordEventWithoutPlayer(eventType, isHomeTeam, actionPosition)
    } else {
      // Open player selection modal for own team players
      // This includes ALL "We Won" events and own team scoring
      setPendingEvent({
        eventType: eventType as EventType,
        team: isHomeTeam ? 'own' : 'opponent',
        position: actionPosition
      })
      setIsPlayerModalOpen(true)
    }
  }

  // Record free kick result - works for both own team and opponent frees
  const recordFreeKickResult = async (eventType: EventType, position: BallPosition, isTeamTakingFree: boolean, player?: Player) => {
    if (!matchId) return

    try {
      const backendEventType = mapEventTypeToBackend(eventType)

      console.log('Recording free kick result:', {
        eventType,
        backendType: backendEventType,
        player: player?.name || 'Opponent',
        position,
        isTeamTakingFree
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: player?.id, // Record which player took the free kick
        event_type: backendEventType,
        minute: minute,
        half: currentHalf,
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: isTeamTakingFree, // true if own team takes the free, false if opponent takes
        notes: undefined
      })

      // Free kick scores result in kickout
      const scoringFrees = [EventType.POINT_FREE, EventType.TWO_POINT_FREE]
      const isScore = scoringFrees.includes(eventType)
      const isWide = eventType === EventType.WIDE_FREE

      if (isScore || isWide) {
        // Ball moves to goalkeeper area for kickout
        // The team that conceded the score takes the kickout
        const kickoutTeam = isTeamTakingFree ? PossessionTeam.OPPONENT : PossessionTeam.OWN
        const ownGoalX = teamAttackingRight ? 5 : 95
        const oppGoalX = teamAttackingRight ? 95 : 5
        const kickoutX = kickoutTeam === PossessionTeam.OWN ? ownGoalX : oppGoalX

        setBallPosition({
          x: kickoutX,
          y: 50,
          team: kickoutTeam
        })

        setActiveKickoutTab(isTeamTakingFree ? 'opp_kickouts' : 'our_kickouts')
        setAwaitingKickout(true)

        console.log('Ball moved to goalkeeper area for kickout after free:', eventType)
      }

      // Reset foul state
      setPendingFoul(null)

      // Force refetch stats
      await queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })

      console.log('Free kick result recorded successfully')
    } catch (error) {
      console.error('Failed to record free kick result:', error)
      setErrorAlert('Failed to record free kick. Please try again.')
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

      // Auto-end carrier segment on terminal events
      if (activeCarrierId) {
        playerMovement.onTerminalEvent(String(eventType).toLowerCase(), position.x, position.y)
        setActiveCarrierId(null)
      }

      // Check if this was a scoring event - reset ball and auto-select kickout tab
      // Include free kick scores and 45 scored
      const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE, EventType.PENALTY_GOAL]
      const isScore = scoringEvents.includes(eventType)

      // Check if this was a dead ball event - WIDE, WIDE_FREE, 45_MISSED, PENALTY_MISS result in kickout
      const deadBallEvents = [EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED, EventType.PENALTY_MISS]
      const isDeadBall = deadBallEvents.includes(eventType)

      if (isScore || isDeadBall) {
        // After score/wide, ball moves to goalkeeper area for kickout
        const kickoutTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.OWN
        // Ball goes to the goal area of the team taking the kickout
        // Our goal area: x=5 when attacking right, x=95 when attacking left
        const ownGoalX = teamAttackingRight ? 5 : 95
        const oppGoalX = teamAttackingRight ? 95 : 5
        const kickoutX = kickoutTeam === PossessionTeam.OWN ? ownGoalX : oppGoalX

        setBallPosition({
          x: kickoutX,  // Edge of small rectangle (goalkeeper area)
          y: 50,        // Center vertically
          team: kickoutTeam  // Other team gets kickout
        })

        // Auto-select appropriate kickout tab
        setActiveKickoutTab(isHomeTeam ? 'opp_kickouts' : 'our_kickouts')

        // Lock ball until kickout is resolved
        setAwaitingKickout(true)

        // Pulse snapshot button — good time to capture formation
        setShouldPulseSnapshot(true)
        setTimeout(() => setShouldPulseSnapshot(false), 5000)

        console.log('Ball moved to goalkeeper area for kickout after:', eventType)
      } else {
        // For ALL non-scoring events, return to scoring tab
        setActiveKickoutTab(null)

        // Handle possession change for non-kickout, non-scoring events
        // (e.g., turnovers, unforced errors, saved shots)
        // Note: Kickout events are handled via pendingKickoutEvent pattern
        const turnoverEventStr = String(eventType).toUpperCase()

        if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED') || turnoverEventStr === 'INTERCEPTION') {
          // Determine new possession based on event type
          let newTeam: PossessionTeam
          let newX = position.x
          let newY = position.y

          if (turnoverEventStr === 'INTERCEPTION') {
            // Interception → team who made it gets possession (clean turnover)
            newTeam = isHomeTeam ? PossessionTeam.OWN : PossessionTeam.OPPONENT
          } else if (turnoverEventStr.includes('TURNOVER_WON')) {
            // Own team won the ball → own team gets possession
            newTeam = PossessionTeam.OWN
          } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
            // Own team lost the ball → Opponent gets possession
            newTeam = PossessionTeam.OPPONENT
          } else if (turnoverEventStr.includes('SAVED')) {
            // Shot saved → Defending team gets possession at goalkeeper position
            // Use ball position to determine which goal: if shot was in opponent's half (x > 50),
            // opponent keeper saved it. If in our half (x < 50), our keeper saved it.
            const shotInOpponentHalf = position.x > 50

            if (shotInOpponentHalf) {
              // Shot was at opponent's goal → Opponent keeper saved it
              newTeam = PossessionTeam.OPPONENT
              newX = 95 // Opponent goal area
              newY = 50
            } else {
              // Shot was at our goal → our keeper saved it
              newTeam = PossessionTeam.OWN
              newX = 5 // Own goal area
              newY = 50
            }
          } else if (turnoverEventStr.includes('SHORT')) {
            // Shot dropped short → Opponent gets possession (stays where it is)
            newTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.OWN
          } else if (turnoverEventStr.includes('OPP_UNFORCED_ERROR')) {
            // Opponent unforced error → own team gets possession
            newTeam = PossessionTeam.OWN
          } else if (turnoverEventStr.includes('OUR_UNFORCED_ERROR')) {
            // Our unforced error → Opponent gets possession
            newTeam = PossessionTeam.OPPONENT
          } else {
            // Fallback (shouldn't reach here)
            newTeam = isHomeTeam ? PossessionTeam.OPPONENT : PossessionTeam.OWN
          }

          const newBallPosition = { x: newX, y: newY, team: newTeam }
          setBallPosition(newBallPosition)

          // Record the possession change to backend
          try {
            await recordPossession.mutateAsync({
              match_id: matchId,
              x_coord: newBallPosition.x,
              y_coord: newBallPosition.y,
              team: newTeam === PossessionTeam.OWN ? 'home' : 'away',
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
      await queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })

      console.log('Event recorded without player selection')
    } catch (error) {
      console.error('Failed to record event:', error)
      setErrorAlert('Failed to record event. Please try again.')
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

    // Capture event data and close modal immediately for snappy UX
    const event = { ...pendingEvent }
    const capturedMinute = minute
    const capturedHalf = currentHalf
    setIsPlayerModalOpen(false)
    setPendingEvent(null)

    // Second yellow card → automatic red card
    if (event.eventType === EventType.YELLOW_CARD && yellowCardPlayerIds.has(player.id)) {
      event.eventType = EventType.RED_CARD
      // Flash animation
      setSecondYellowFlash(true)
      setTimeout(() => setSecondYellowFlash(false), 2000)
    }

    console.log('Recording event:', {
      eventType: event.eventType,
      team: event.team,
      player: player.name,
      minute: capturedMinute,
      second: seconds
    })

    // Check if this is a free kick result (own team taking free — player selected)
    const eventTypeStr = String(event.eventType).toUpperCase()
    const isFreeResult = eventTypeStr.includes('FREE') || eventTypeStr.includes('FORTY_FIVE')
    if (isFreeResult) {
      recordFreeKickResult(event.eventType, event.position, true, player)
      return
    }

    // Check if this is a kickout/breaking ball event - these need position selection
    const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')

    if (isKickoutEvent) {
      // Don't record immediately - set pending kickout and wait for position selection
      console.log('Setting pending kickout event (with player):', event.eventType, player.name)
      setPendingKickoutEvent({
        eventType: event.eventType,
        isHomeTeam: event.team === 'own',
        playerId: player.id
      })
      // Unlock ball so user can click on pitch to select position
      setAwaitingKickout(false)
      return
    }

    // Apply immediate UI state changes (ball position, tabs, kickout lock)
    const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE, EventType.PENALTY_GOAL]
    const isScore = scoringEvents.includes(event.eventType as EventType)
    const deadBallEvents = [EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED, EventType.PENALTY_MISS]
    const isDeadBall = deadBallEvents.includes(event.eventType as EventType)

    if (isScore || isDeadBall) {
      const kickoutTeam = event.team === 'own' ? PossessionTeam.OPPONENT : PossessionTeam.OWN
      const ownGoalX = teamAttackingRight ? 5 : 95
      const oppGoalX = teamAttackingRight ? 95 : 5
      const kickoutX = kickoutTeam === PossessionTeam.OWN ? ownGoalX : oppGoalX
      setBallPosition({
        x: kickoutX,
        y: 50,
        team: kickoutTeam
      })
      setActiveKickoutTab(event.team === 'own' ? 'opp_kickouts' : 'our_kickouts')
      setAwaitingKickout(true)
      console.log('Ball moved to goalkeeper area for kickout after:', event.eventType)
    } else {
      setActiveKickoutTab(null)
    }

    // Auto-change possession for turnover events, shots that drop short, and saved shots
    const turnoverEventStr = String(event.eventType).toUpperCase()
    let possessionPayload: { x: number; y: number; team: PossessionTeam } | null = null

    if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED') || turnoverEventStr === 'INTERCEPTION') {
      let newTeam: PossessionTeam
      let newX = event.position.x
      let newY = event.position.y

      if (turnoverEventStr === 'INTERCEPTION') {
        // Interception → the intercepting team gets possession
        newTeam = event.team === 'own' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
      } else if (turnoverEventStr.includes('TURNOVER_WON')) {
        newTeam = PossessionTeam.OWN
      } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
        newTeam = PossessionTeam.OPPONENT
      } else if (turnoverEventStr.includes('SAVED')) {
        const shotInOpponentHalf = event.position.x > 50
        if (shotInOpponentHalf) {
          newTeam = PossessionTeam.OPPONENT
          newX = 95
          newY = 50
        } else {
          newTeam = PossessionTeam.OWN
          newX = 5
          newY = 50
        }
      } else if (turnoverEventStr.includes('SHORT')) {
        newTeam = event.team === 'own' ? PossessionTeam.OPPONENT : PossessionTeam.OWN
      } else if (turnoverEventStr.includes('UNFORCED_ERROR')) {
        newTeam = event.team === 'own' ? PossessionTeam.OPPONENT : PossessionTeam.OWN
      } else {
        newTeam = event.team === 'own' ? PossessionTeam.OPPONENT : PossessionTeam.OWN
      }

      possessionPayload = { x: newX, y: newY, team: newTeam }
      setBallPosition(possessionPayload)
    }

    // Fire backend calls in background (non-blocking for instant feel)
    const backendEventType = mapEventTypeToBackend(event.eventType)

    recordEvent.mutateAsync({
      match_id: matchId,
      player_id: player.id,
      event_type: backendEventType,
      minute: capturedMinute,
      half: capturedHalf,
      x_coord: event.position.x,
      y_coord: event.position.y,
      is_home_team: event.team === 'own',
      notes: undefined
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ['matches', matchId, 'stats'] })
      console.log('Event recorded successfully!')
    }).catch((error) => {
      console.error('Failed to record event:', error)
    })

    // Record possession change in background if needed
    if (possessionPayload) {
      recordPossession.mutateAsync({
        match_id: matchId,
        x_coord: possessionPayload.x,
        y_coord: possessionPayload.y,
        team: possessionPayload.team === PossessionTeam.OWN ? 'home' : 'away',
        timestamp: new Date(),
        minute: capturedMinute,
        half: capturedHalf
      }).then(() => {
        console.log('Possession change recorded after:', event.eventType)
      }).catch((error) => {
        console.error('Failed to record possession:', error)
      })
    }

    // Start black card 10-min countdown timer
    if (event.eventType === EventType.BLACK_CARD) {
      setBlackCardTimers(prev => [...prev, {
        id: crypto.randomUUID(),
        playerLabel: player.name.split(' ').map(n => n[0]).join('. ') + '.',
        startedAt: Date.now(),
      }])
    }
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
      team: team === 'home' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
    }))

    // Start the match/half
    if (matchPhase === 'not_started') {
      // Set attack direction for first half
      setTeamAttackingRight(attackingRight)

      try {
        if (matchId) {
          await startMatch.mutateAsync(matchId)
          // Persist phase + attack direction
          await api.matches.updatePhase(matchId, 'first_half', attackingRight)
        }
        setMatchPhase('first_half')
        setCurrentHalf(1)
        setMinute(0)
        setSeconds(0)
      } catch (error) {
        console.error('Failed to start match:', error)
        setErrorAlert('Failed to start match. Please try again.')
      }
    } else if (matchPhase === 'half_time') {
      // Auto-flip attack direction for second half
      setTeamAttackingRight(!teamAttackingRight)

      // Clear any leftover state from first half
      setAwaitingKickout(false)
      setPendingKickoutEvent(null)
      setPendingFreeKick(null)
      setPending45(null)
      setActiveKickoutTab('scoring')

      // Reset ball to center and clear trail for second half
      setBallPosition({
        x: 50,
        y: 50,
        team: team === 'home' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
      })
      setBallTrail([])

      // Persist second half start
      if (matchId) {
        api.matches.updatePhase(matchId, 'second_half').catch(console.error)
      }
      setMatchPhase('second_half')
      setCurrentHalf(2)
      setMinute(30)
      setSeconds(0)
    }
  }

  const endFirstHalf = async () => {
    if (!matchId) return

    // Clear any pending kickout/free/foul/stoppage state from last play of the half
    setAwaitingKickout(false)
    setPendingKickoutEvent(null)
    setPendingFreeKick(null)
    setPending45(null)
    setSelectingFoulPlayer(false)
    setPendingFoul(null)
    setActiveKickoutTab('scoring')
    setIsStopped(false)

    // Pause the timer
    setMatchPhase('half_time')
    console.log('First half ended at', minute, ':', seconds)

    // Persist half_time phase
    api.matches.updatePhase(matchId, 'half_time').catch(console.error)

    // Trigger half-time AI insight and refresh display
    try {
      await api.liveInsights.triggerHalfTime(matchId)
      setInsightRefresh(prev => prev + 1)
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
      setErrorAlert('Failed to end match. Please try again.')
    }
  }

  const getEndButtonText = () => {
    if (matchPhase === 'first_half') return minute >= 30 ? 'End First Half (HT)' : 'End First Half'
    if (matchPhase === 'second_half') {
      return fullTimeReached ? 'End Match (FT)' : 'End Match'
    }
    return null
  }

  const isEndButtonEnabled = () => {
    if (matchPhase === 'first_half') return true
    if (matchPhase === 'second_half') return true
    return false
  }

  const getPhaseButtonText = () => {
    if (matchPhase === 'not_started') return 'Start First Half'
    if (matchPhase === 'half_time') return 'Start Second Half'
    return null
  }

  const formatTime = () => {
    // Injury time format: "30 (+1:32)" for first half, "60 (+2:15)" for second half
    if (matchPhase === 'first_half' && minute >= 30) {
      const injuryMin = minute - 30
      return `30 (+${injuryMin}:${seconds.toString().padStart(2, '0')})`
    }
    if (matchPhase === 'second_half' && minute >= 60) {
      const injuryMin = minute - 60
      return `60 (+${injuryMin}:${seconds.toString().padStart(2, '0')})`
    }
    return `${minute}:${seconds.toString().padStart(2, '0')}`
  }

  // Dynamic status label — shows what's currently being tracked
  const getStatusLabel = (): { text: string; subtext: string; bg: string; accent: string } => {
    if (matchPhase === 'not_started') {
      return { text: 'Match not started', subtext: 'Select lineup and start first half', bg: 'from-slate-600/20 to-slate-700/20 border-white/10', accent: 'text-white/50' }
    }
    if (matchPhase === 'half_time') {
      return { text: 'Half Time', subtext: 'Tap "Start Second Half" to continue', bg: 'from-emerald-600/20 to-cyan-600/20 border-emerald-500/40', accent: 'text-emerald-400' }
    }
    if (matchPhase === 'finished') {
      return { text: 'Match Finished', subtext: 'Recording complete', bg: 'from-slate-600/20 to-slate-700/20 border-white/10', accent: 'text-white/50' }
    }

    // Special states take priority
    if (isStopped) {
      return { text: 'Stoppage', subtext: 'Tap play to resume', bg: 'from-amber-600/20 to-yellow-600/20 border-amber-500/40', accent: 'text-amber-400' }
    }
    if (selectingFoulPlayer) {
      return { text: 'Select Player Who Fouled', subtext: 'Tap the player who committed the foul', bg: 'from-red-600/20 to-rose-600/20 border-red-500/40', accent: 'text-red-400' }
    }
    if (awaitingKickout && !pendingKickoutEvent) {
      return { text: 'Awaiting Kickout', subtext: 'Select kickout outcome below', bg: 'from-white/5 to-white/10 border-white/20', accent: 'text-white/80' }
    }
    if (pendingKickoutEvent) {
      return { text: 'Kickout — Tap Landing Position', subtext: 'Tap the pitch where the ball lands', bg: 'from-white/5 to-white/10 border-white/20', accent: 'text-white/80' }
    }
    if (pendingFreeKick) {
      const freeTeam = ballPosition.team === PossessionTeam.OWN ? clubName : matchDisplay.opponent
      return { text: `Free Kick — ${freeTeam}`, subtext: 'Select outcome or move ball for short free', bg: 'from-cyan-600/20 to-blue-600/20 border-cyan-500/40', accent: 'text-cyan-400' }
    }
    if (pending45) {
      return { text: `45m Free — ${clubName}`, subtext: 'Select outcome or move ball to cancel', bg: 'from-cyan-600/20 to-blue-600/20 border-cyan-500/40', accent: 'text-cyan-400' }
    }

    // Normal play — derive zone and side from ball position
    const isOwn = ballPosition.team === PossessionTeam.OWN
    const teamName = isOwn ? clubName : matchDisplay.opponent

    // attackingProgress: 0 = deep in our end, 100 = deep in opponent's end
    const attackingProgress = teamAttackingRight ? ballPosition.x : (100 - ballPosition.x)

    // Side of pitch from team-in-possession's perspective
    // When facing right: top=left, bottom=right. When facing left: top=right, bottom=left.
    const y = ballPosition.y
    const facingRight = isOwn ? teamAttackingRight : !teamAttackingRight
    let side = ''
    if (y < 33) side = facingRight ? ', left side' : ', right side'
    else if (y > 67) side = facingRight ? ', right side' : ', left side'

    // Use carrier player name if one is selected, otherwise team name
    const carrierPlayer = activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId) : null
    const displayName = isOwn && carrierPlayer ? carrierPlayer.playerName : (isOwn ? clubName : teamName)

    let text: string
    if (isOwn) {
      if (attackingProgress >= 78) text = `${displayName} inside the 21m line${side}`
      else if (attackingProgress >= 55) text = `${displayName} inside the 45m line${side}`
      else if (attackingProgress >= 45) text = `${displayName} around midfield${side}`
      else if (attackingProgress >= 22) text = `${displayName} in their own half${side}`
      else text = `${displayName} deep in their own half${side}`
    } else {
      if (attackingProgress <= 22) text = `${teamName} inside our 21m line${side}`
      else if (attackingProgress <= 45) text = `${teamName} inside our 45m line${side}`
      else if (attackingProgress <= 55) text = `${teamName} around midfield${side}`
      else if (attackingProgress <= 78) text = `${teamName} in their own half${side}`
      else text = `${teamName} deep in their own half${side}`
    }

    const bg = isOwn
      ? 'from-emerald-600/20 to-blue-600/20 border-emerald-500/40'
      : 'from-orange-600/10 to-white/5 border-orange-500/30'
    const accent = isOwn ? 'text-emerald-400' : 'text-orange-300'

    return { text, subtext: '', bg, accent }
  }

  const statusLabel = getStatusLabel()

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
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
              {/* Left: Match Info & Timer */}
              <div className="space-y-2">
                <h1 className="text-xl font-bold text-white">
                  vs {matchDisplay.opponent}
                </h1>
                <div className="flex items-center gap-2">
                  <p className="text-white/60 text-sm">League Match - {matchPhase === 'not_started' ? 'Ready' : 'Live'}</p>
                  <button
                    data-tour="weather-btn"
                    onClick={() => setIsWeatherPickerOpen(true)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer"
                    title="Update weather"
                  >
                    {(() => { const WeatherIcon = getWeatherIcon(weatherCondition); return <WeatherIcon size={13} className={weatherCondition ? 'text-white/70' : 'text-white/40'} />; })()}
                    {weatherCondition && (
                      <span className="text-[10px] text-white/60">{getWeatherLabel(weatherCondition)}</span>
                    )}
                    {temperatureCelsius !== null && (
                      <span className="text-[10px] text-white/60">{temperatureCelsius}°C</span>
                    )}
                  </button>
                </div>
                {matchPhase !== 'not_started' && (
                  <div className="flex items-center gap-2">
                    <div className={`inline-flex items-center space-x-3 px-4 py-2 rounded-xl ${
                      isStopped
                        ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40'
                        : 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 animate-pulse'
                    }`}>
                      {isStopped ? <Pause size={20} className="text-amber-400" /> : <Clock size={20} className="text-emerald-400" />}
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
                    {matchDisplay.score.team.goals}-{String(matchDisplay.score.team.points).padStart(2, '0')}
                  </div>
                  <div className="text-white/60 text-xs mt-1">{clubName}</div>
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
              <div className="flex flex-col items-center md:items-end space-y-2">
                <div className="flex items-center space-x-2">
                  <div className="text-right">
                    <div className="text-xs text-white/60">Possession</div>
                    <div className="text-sm font-bold text-emerald-400">{stats.possession.team}%</div>
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
                    matchPhase === 'half_time' ? (
                      <div className="glass-card-live" style={{ borderRadius: '0.75rem' }}>
                        <button
                          className="flex items-center space-x-1 py-1 px-3 text-sm font-semibold text-white"
                          style={{ borderRadius: 'calc(0.75rem - 2px)', background: '#0e1225' }}
                          onClick={startHalf}
                        >
                          <Play size={14} />
                          <span>{getPhaseButtonText()}</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        className="btn-primary flex items-center space-x-1 !py-1 !px-3 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={startHalf}
                        disabled={matchPhase === 'not_started' && Object.keys(startingLineup).length === 0}
                        title={matchPhase === 'not_started' && Object.keys(startingLineup).length === 0 ? 'Please select a lineup first' : ''}
                      >
                        <Play size={14} />
                        <span>{getPhaseButtonText()}</span>
                      </button>
                    )
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
                      className={`px-4 py-2 rounded-xl font-medium transition-all text-sm backdrop-blur-md ${
                        !isEndButtonEnabled()
                          ? 'bg-white/10 text-white/40 border border-white/10 cursor-not-allowed'
                          : (fullTimeReached || (matchPhase === 'first_half' && minute >= 30))
                            ? 'bg-white/15 text-white border border-amber-500/40 shadow-lg shadow-amber-500/10 ring-1 ring-amber-400/30'
                            : 'bg-white/10 text-white/80 border border-white/15 hover:bg-white/15 hover:text-white hover:border-white/25'
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

          <div className="flex flex-col md:flex-row gap-6">
            {/* Left column — pitch, action buttons, event map */}
            <div className="flex-[2] min-w-0 space-y-6">
              {/* Half Time Banner */}
              {minute >= 30 && matchPhase === 'first_half' && (
                <div className="backdrop-blur-xl bg-white/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-4">
                  <div className="flex items-center justify-center space-x-2">
                    <Clock size={16} className="text-amber-400" />
                    <p className="text-sm font-medium text-white/90">
                      Injury time — tap "End First Half" when ready
                    </p>
                  </div>
                </div>
              )}

              {/* Full Time Banner */}
              {fullTimeReached && matchPhase === 'second_half' && (
                <div className="backdrop-blur-xl bg-white/5 border border-emerald-500/20 rounded-xl px-4 py-3 mb-4">
                  <div className="flex items-center justify-center space-x-2">
                    <Clock size={16} className="text-emerald-400" />
                    <p className="text-sm font-medium text-white/90">
                      Full time — tap "End Match" to save and generate AI analysis
                    </p>
                  </div>
                </div>
              )}

              {/* Black card sin bin timers */}
              {blackCardTimers.length > 0 && (
                <div className="flex items-center gap-2 mb-3">
                  <BlackCardTimer entries={blackCardTimers} onRemove={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))} />
                </div>
              )}

              {/* Jersey Number Strip for carrier tracking — above pitch */}
              {jerseyStripPlayers.length > 0 && matchPhase !== 'not_started' && matchPhase !== 'finished' && (
                <div className="max-w-2xl mx-auto mb-1">
                  <JerseyNumberStrip
                    players={jerseyStripPlayers}
                    activeCarrierId={activeCarrierId}
                    currentPossession={ballPosition.team}
                    onCarrierSelect={handleCarrierSelect}
                  />
                </div>
              )}

              {/* Pitch */}
              <div data-tour="pitch-container" className="glass-card p-6 relative mb-4">
                <GAAPitch
                  ballPosition={ballPosition}
                  onBallMove={handleBallMove}
                  showZones={true}
                  readonly={matchPhase === 'not_started' || matchPhase === 'finished' || (awaitingKickout && !pendingKickoutEvent)}
                  trail={ballTrail}
                  onTrailUpdate={setBallTrail}
                  onDragPath={handleDragPath}
                  carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
                  svgOverlay={
                    (matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time') ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 10,
                          padding: '10px 20px', borderRadius: 14,
                          background: 'rgba(0,0,0,0.75)',
                          border: `2px solid ${ballPosition.team === PossessionTeam.OWN ? 'rgba(16,185,129,0.5)' : 'rgba(249,115,22,0.4)'}`,
                        }}
                        data-tour="possession-indicator"
                        >
                          <div style={{
                            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                            background: ballPosition.team === PossessionTeam.OWN ? '#34d399' : '#fb923c',
                          }} />
                          <span style={{
                            fontSize: 30, fontWeight: 700, whiteSpace: 'nowrap',
                            color: ballPosition.team === PossessionTeam.OWN ? '#6ee7b7' : '#fdba74',
                          }}>
                            {statusLabel.text}
                          </span>
                        </div>
                        {!awaitingKickout && !pendingFreeKick && !pending45 && !selectingFoulPlayer && (
                          <>
                            <button
                              onClick={async () => {
                                // End carrier segment on possession swap
                                if (activeCarrierId) {
                                  await playerMovement.onPossessionSwap(ballPosition.x, ballPosition.y)
                                  setActiveCarrierId(null)
                                }
                                const newTeam = ballPosition.team === PossessionTeam.OWN ? PossessionTeam.OPPONENT : PossessionTeam.OWN
                                setBallPosition(prev => ({ ...prev, team: newTeam }))
                              }}
                              style={{
                                padding: 14, borderRadius: 12,
                                background: 'rgba(0,0,0,0.75)',
                                border: '2px solid rgba(255,255,255,0.25)',
                                color: 'rgba(255,255,255,0.7)',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                              title="Swap possession"
                            >
                              <ArrowLeftRight size={28} />
                            </button>
                            <button
                              onClick={() => setIsStopped(prev => !prev)}
                              style={{
                                padding: 14, borderRadius: 12,
                                background: isStopped ? 'rgba(245,158,11,0.3)' : 'rgba(0,0,0,0.75)',
                                border: `2px solid ${isStopped ? 'rgba(245,158,11,0.6)' : 'rgba(255,255,255,0.25)'}`,
                                color: isStopped ? '#fbbf24' : 'rgba(255,255,255,0.7)',
                                cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                              }}
                              title={isStopped ? 'Resume play' : 'Stoppage'}
                            >
                              {isStopped ? <Play size={28} /> : <Pause size={28} />}
                            </button>
                          </>
                        )}
                      </div>
                    ) : undefined
                  }
                />

                {/* Pitch control buttons — top-right */}
                {matchPhase !== 'not_started' && matchPhase !== 'finished' && (
                  <div className="absolute top-8 right-8 z-10 flex items-center gap-1.5">
                    <FormationSnapshotButton
                      onClick={() => setIsSnapshotMode(true)}
                      shouldPulse={shouldPulseSnapshot}
                      snapshotCount={snapshotCount}
                    />
                    <TacticalTagButton
                      onTag={handleTacticalTag}
                      tagCount={tacticalTagCount}
                    />
                    <button
                      data-tour="fullscreen-btn"
                      onClick={() => setIsFullscreenPitch(true)}
                      className="p-2.5 rounded-xl bg-white/10 border-2 border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all"
                      title="Fullscreen pitch mode"
                    >
                      <Maximize size={18} />
                    </button>
                  </div>
                )}

              </div>

              {/* Categorized Action Buttons */}
              <div className="max-w-2xl mx-auto -mt-2">
                <CategorizedActionButtons
                  onActionSelect={handleQuickAction}
                  onFoulClick={handleFoulClick}
                  on45Click={handle45Click}
                  onDiscipline={handleDiscipline}
                  disabled={matchPhase === 'not_started' || matchPhase === 'finished'}
                  activeCategory={activeKickoutTab}
                  onCategoryChange={setActiveKickoutTab}
                  currentPossession={ballPosition.team}
                  isIn2PointZone={isIn2PointZone(ballPosition.x, ballPosition.y, ballPosition.team)}
                  isInPenaltyArea={(() => {
                    // Ball is near opponent's goal = inside 13m line
                    const attackingGoalX = ballPosition.team === PossessionTeam.OWN
                      ? (teamAttackingRight ? 100 : 0)
                      : (teamAttackingRight ? 0 : 100)
                    return Math.abs(attackingGoalX - ballPosition.x) <= 10.5
                  })()}
                  pendingFreeKick={!!pendingFreeKick}
                  pendingFoul={pendingFoul}
                  pending45={!!pending45}
                  pendingKickoutPosition={!!pendingKickoutEvent}
                  onCancelFree={handleCancelFree}
                  onCancel45={handleCancel45}
                  onCancelKickout={handleCancelKickout}
                />
              </div>

              {/* Event Map */}
              {matchId && matchEventsData?.events && (
                <div className="space-y-3">
                  <div className="glass-card p-4">
                    <div className="flex items-center justify-between mb-2">
                      <h2 className="text-sm font-bold text-white flex items-center space-x-2">
                        <Target size={16} />
                        <span>Event Map</span>
                      </h2>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => setEventMapTeamFilter('own')}
                          className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                            eventMapTeamFilter === 'own'
                              ? 'bg-emerald-600 text-white'
                              : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }`}
                        >
                          {clubName}
                        </button>
                        <button
                          onClick={() => setEventMapTeamFilter('opponent')}
                          className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                            eventMapTeamFilter === 'opponent'
                              ? 'bg-orange-600 text-white'
                              : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }`}
                        >
                          {matchDisplay.opponent}
                        </button>
                      </div>
                    </div>
                    <div className="mb-1 text-xs text-white/40 text-center">
                      {filteredMapEvents.length} event{filteredMapEvents.length !== 1 ? 's' : ''} shown
                    </div>
                    <GAAPitch readonly={true} events={filteredMapEvents} showZones={true} />
                  </div>
                  <EventFilterToggles activeFilters={eventMapFilters} onToggle={setEventMapFilters} />
                </div>
              )}

              {/* Paths Taken + Possession — full width, 2 side by side */}
              {matchId && matchEventsData?.events && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <PathsTakenChart
                    matchId={matchId}
                    pollInterval={15000}
                  />
                  <PossessionTerritoryChart
                    stats={matchStats}
                    events={matchEventsData.events}
                    matchId={matchId}
                    opponent={matchDisplay.opponent}
                    pollInterval={15000}
                  />
                </div>
              )}

              {/* Scoring + Shot Outcome — full width, 2 side by side */}
              {matchId && matchEventsData?.events && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ScoringTimeline
                    events={matchEventsData.events}
                    opponent={matchDisplay.opponent}
                  />
                  <ShotOutcomeChart
                    events={matchEventsData.events}
                    opponent={matchDisplay.opponent}
                  />
                </div>
              )}
            </div>

            {/* Live Stats Sidebar */}
            <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
              {/* AI Live Insights */}
              <LiveInsightDisplay
                matchId={matchId}
                minute={minute}
                half={currentHalf}
                isMatchActive={matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time'}
                refreshTrigger={insightRefresh}
              />

              {/* Match Statistics */}
              <div className="glass-card p-5">
                <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white">
                  <Activity size={20} className="text-emerald-400" />
                  <span>Match Statistics</span>
                </h3>

                <div className="rounded-xl border border-white/[0.08] overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)' }}>
                  {/* Header row */}
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
                    <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider">{clubName}</div>
                    <div className="min-w-[90px]" />
                    <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider">{matchDisplay.opponent}</div>
                  </div>

                  {[
                    { label: 'Possession', left: `${stats.possession.team}%`, right: `${stats.possession.opponent}%`, leftVal: stats.possession.team, rightVal: stats.possession.opponent },
                    { label: 'Shots', left: stats.shots.team, right: stats.shots.opponent, leftVal: stats.shots.team, rightVal: stats.shots.opponent },
                    { label: 'Scores', left: stats.scores.team, right: stats.scores.opponent, leftVal: stats.scores.team, rightVal: stats.scores.opponent },
                    { label: 'Wides', left: stats.wides.team, right: stats.wides.opponent, leftVal: stats.wides.opponent, rightVal: stats.wides.team },
                    { label: 'Accuracy', left: `${stats.accuracy}%`, right: `${stats.shots.opponent > 0 ? (stats.scores.opponent / stats.shots.opponent * 100).toFixed(1) : '0.0'}%`, leftVal: Number(stats.accuracy), rightVal: stats.shots.opponent > 0 ? stats.scores.opponent / stats.shots.opponent * 100 : 0 },
                    { label: 'Conversion', left: `${stats.conversionRate}%`, right: `${(stats.scores.opponent + stats.wides.opponent) > 0 ? ((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1) : '0.0'}%`, leftVal: Number(stats.conversionRate), rightVal: (stats.scores.opponent + stats.wides.opponent) > 0 ? (stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100 : 0 },
                    { label: 'Turnovers Won', left: stats.turnovers.won, right: stats.turnovers.lost, leftVal: stats.turnovers.won, rightVal: stats.turnovers.lost },
                    { label: 'Kickouts Won', left: `${stats.kickouts.teamWon}/${stats.kickouts.teamTotal}`, right: `${stats.kickouts.opponentWon}/${stats.kickouts.opponentTotal}`, leftVal: stats.kickouts.teamWon, rightVal: stats.kickouts.opponentWon },
                    { label: 'Kickout Ret. %', left: `${teamKickoutRetention}%`, right: `${opponentKickoutRetention}%`, leftVal: parseFloat(teamKickoutRetention), rightVal: parseFloat(opponentKickoutRetention) },
                  ].map((row, idx) => {
                    const leftWins = row.leftVal > row.rightVal
                    const rightWins = row.rightVal > row.leftVal
                    return (
                      <div key={row.label} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 transition-colors hover:bg-white/[0.05] ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} ${idx > 0 ? 'border-t border-white/[0.05]' : ''}`}>
                        <div className={`text-center text-base font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>
                          {row.left}
                        </div>
                        <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[90px]">
                          {row.label}
                        </div>
                        <div className={`text-center text-base font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>
                          {row.right}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Recent Events — stretches to fill remaining sidebar height */}
              <div data-tour="event-feed" className="glass-card p-6 flex-1 flex flex-col min-h-0">
                <h3 className="text-lg font-semibold mb-4 flex items-center space-x-2 text-white flex-shrink-0">
                  <Clock size={20} className="text-white" />
                  <span>Recent Events</span>
                </h3>
                <div className="space-y-2 text-sm flex-1 overflow-y-auto">
                  {allEvents.length > 0 ? (
                    <>
                      {allEvents.slice(0, visibleEventCount).map((event) => {
                        const description = formatEventDescription(event)
                        const isOwn = event.is_home_team

                        // Determine event color based on type
                        let eventColor = 'bg-slate-700/40 border-slate-600/30'
                        if (['point', 'goal'].includes(event.event_type)) {
                          eventColor = isOwn
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
                            <div className="flex-shrink-0 w-10 h-10 rounded-md bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center font-bold text-white text-xs shadow-md">
                              {event.half === 1 && event.minute > 30
                                ? `30+${event.minute - 30}'`
                                : event.half === 2 && event.minute > 60
                                  ? `60+${event.minute - 60}'`
                                  : `${event.minute}'`}
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
                      })}
                      {visibleEventCount < allEvents.length && (
                        <button
                          onClick={() => setVisibleEventCount(prev => prev + 15)}
                          className="w-full py-2 text-xs text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 rounded-lg transition-all"
                        >
                          Show more ({allEvents.length - visibleEventCount} older events)
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-center text-white/60 py-8">
                      No events recorded yet. Start the match and record your first action.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

        </>
      )}

      {/* Player Selection — on-pitch overlay (lineup available) or fallback modal */}
      {(pendingEvent || selectingFoulPlayer) && (
        matchLineup.length > 0 ? (
          <PitchPlayerSelector
            isOpen={isPlayerModalOpen}
            onClose={() => {
              setIsPlayerModalOpen(false)
              setPendingEvent(null)
              setSelectingFoulPlayer(false)
              setPendingFoul(null)
            }}
            onSelectPlayer={selectingFoulPlayer ? handleFoulPlayerSelected : handlePlayerSelected}
            eventType={selectingFoulPlayer ? EventType.FOUL_COMMITTED : (pendingEvent?.eventType as any)}
            team="own"
            players={playersOnField}
            matchLineup={matchLineup}
            teamPrimaryColor={club?.primary_colour || '#10B981'}
            teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
          />
        ) : (
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
            team="own"
            players={playersOnField}
          />
        )
      )}

      {/* Possession Selection Modal */}
      <PossessionSelectionModal
        isOpen={isPossessionModalOpen}
        homeTeam={clubName}
        awayTeam={matchDisplay.opponent}
        onSelect={handlePossessionSelected}
        skipDirection={matchPhase === 'half_time'}
        defaultAttackingRight={!teamAttackingRight}
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
        currentMinute={minute}
        currentHalf={currentHalf}
      />

      {/* Starting Lineup Modal */}
      <StartingLineupModal
        isOpen={isLineupModalOpen}
        onClose={() => setIsLineupModalOpen(false)}
        onConfirm={handleLineupConfirm}
        players={players}
        lastMatchLineup={lastMatchLineup}
      />
      <WeatherPickerPopover
        isOpen={isWeatherPickerOpen}
        onClose={() => setIsWeatherPickerOpen(false)}
        onSave={handleWeatherSave}
        currentCondition={weatherCondition}
        currentTemperature={temperatureCelsius}
      />

      {/* Fullscreen Pitch Mode */}
      <FullscreenPitchMode
        isOpen={isFullscreenPitch}
        onClose={() => setIsFullscreenPitch(false)}
        ballPosition={ballPosition}
        onBallMove={handleBallMove}
        readonly={matchPhase === 'not_started' || matchPhase === 'finished' || (awaitingKickout && !pendingKickoutEvent)}
        trail={ballTrail}
        onTrailUpdate={setBallTrail}
        onDragPath={handleDragPath}
        matchPhase={matchPhase}
        minute={minute}
        seconds={seconds}
        teamGoals={teamGoals}
        teamPoints={teamPoints}
        opponentGoals={opponentGoals}
        opponentPoints={opponentPoints}
        opponent={matchDisplay.opponent}
        matchStats={matchStats ? {
          possession: stats.possession,
          shots: stats.shots,
          scores: stats.scores,
          wides: stats.wides,
          accuracy: {
            team: String(stats.accuracy),
            opponent: stats.shots.opponent > 0 ? (stats.scores.opponent / stats.shots.opponent * 100).toFixed(1) : '0.0',
          },
          conversion: {
            team: String(stats.conversionRate),
            opponent: (stats.scores.opponent + stats.wides.opponent) > 0 ? ((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1) : '0.0',
          },
          turnovers: { team: stats.turnovers.won, opponent: stats.turnovers.lost },
          kickouts: {
            team: `${stats.kickouts.teamWon}/${stats.kickouts.teamTotal}`,
            opponent: `${stats.kickouts.opponentWon}/${stats.kickouts.opponentTotal}`,
          },
          kickoutRetention: { team: teamKickoutRetention, opponent: opponentKickoutRetention },
        } : null}
        latestEventDescription={
          allEvents.length > 0
            ? formatEventDescription(allEvents[0])
            : undefined
        }
        onActionSelect={handleQuickAction}
        onFoulClick={handleFoulClick}
        on45Click={handle45Click}
        onDiscipline={handleDiscipline}
        currentPossession={ballPosition.team}
        isIn2PointZone={isIn2PointZone(ballPosition.x, ballPosition.y, ballPosition.team)}
        isInPenaltyArea={(() => {
          const attackingGoalX = ballPosition.team === PossessionTeam.OWN
            ? (teamAttackingRight ? 100 : 0)
            : (teamAttackingRight ? 0 : 100)
          return Math.abs(attackingGoalX - ballPosition.x) <= 10.5
        })()}
        pendingFreeKick={!!pendingFreeKick}
        pendingFoul={pendingFoul}
        pending45={!!pending45}
        pendingKickoutPosition={!!pendingKickoutEvent}
        onCancelFree={handleCancelFree}
        onCancel45={handleCancel45}
        onCancelKickout={handleCancelKickout}
        activeCategory={activeKickoutTab}
        onCategoryChange={setActiveKickoutTab}
        awaitingKickout={awaitingKickout}
        teamAttackingRight={teamAttackingRight}
        statusText={statusLabel.text}
        statusAccent={statusLabel.accent}
        onSwapPossession={async () => {
          if (activeCarrierId) {
            await playerMovement.onPossessionSwap(ballPosition.x, ballPosition.y)
            setActiveCarrierId(null)
          }
          const newTeam = ballPosition.team === PossessionTeam.OWN ? PossessionTeam.OPPONENT : PossessionTeam.OWN
          setBallPosition(prev => ({ ...prev, team: newTeam }))
        }}
        jerseyStripPlayers={jerseyStripPlayers}
        activeCarrierId={activeCarrierId}
        onCarrierSelect={handleCarrierSelect}
        carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
        selectingFoulPlayer={selectingFoulPlayer}
        onStartSecondHalf={matchPhase === 'half_time' ? startHalf : undefined}
        onEndFirstHalf={endFirstHalf}
        onEndMatch={endMatch}
        fullTimeReached={fullTimeReached}
        blackCardTimers={blackCardTimers}
        onRemoveBlackCard={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))}
        isStopped={isStopped}
        onToggleStoppage={() => setIsStopped(prev => !prev)}
      />

      {/* Formation Snapshot Mode */}
      <FormationSnapshotMode
        isOpen={isSnapshotMode}
        onClose={() => setIsSnapshotMode(false)}
        onSave={handleFormationSave}
        availablePlayers={jerseyStripPlayers.filter(p => p.isOnField).map(p => ({
          playerId: p.playerId,
          jerseyNumber: p.jerseyNumber,
          playerName: p.playerName,
        }))}
      />

      {/* Error Alert Modal */}
      <ConfirmationModal
        isOpen={!!errorAlert}
        onClose={() => setErrorAlert(null)}
        title="Something Went Wrong"
        message={errorAlert || ''}
        variant="danger"
      />

      {/* Second Yellow → Red Card dramatic overlay */}
      {secondYellowFlash && (
        <div className="fixed inset-0 z-[200] pointer-events-none flex items-center justify-center animate-[secondYellowFade_2s_ease-out_forwards]">
          <div className="bg-black/80 backdrop-blur-xl rounded-2xl border-2 border-red-500/60 px-8 py-6 flex flex-col items-center gap-3 shadow-2xl shadow-red-500/30">
            <div className="flex items-center gap-3">
              <div className="w-8 h-11 rounded bg-yellow-400 border-2 border-yellow-500 animate-[cardToRed_0.6s_0.3s_ease-in-out_forwards]" />
              <div className="w-8 h-11 rounded bg-yellow-400 border-2 border-yellow-500 animate-[cardToRed_0.6s_0.5s_ease-in-out_forwards]" />
              <span className="text-3xl font-black mx-2">=</span>
              <div className="w-8 h-11 rounded bg-red-500 border-2 border-red-600 animate-pulse" />
            </div>
            <span className="text-lg font-bold text-red-400 tracking-wide">AUTOMATIC RED CARD</span>
            <span className="text-sm text-white/60">Second yellow card — player sent off</span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes secondYellowFade {
          0% { opacity: 0; }
          10% { opacity: 1; }
          75% { opacity: 1; }
          100% { opacity: 0; }
        }
        @keyframes cardToRed {
          0% { background-color: #facc15; border-color: #eab308; }
          100% { background-color: #ef4444; border-color: #dc2626; }
        }
      `}</style>
    </div>
  )
}
