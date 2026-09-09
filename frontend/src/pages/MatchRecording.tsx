import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import GAAPitch from '@/components/GAAPitch'
import BallCarrierPicker from '@/components/BallCarrierPicker'
import PitchReceiverDots from '@/components/PitchReceiverDots'
import PlayerSelectionModal from '@/components/PlayerSelectionModal'
import PitchPlayerSelector from '@/components/PitchPlayerSelector'
import PossessionSelectionModal from '@/components/PossessionSelectionModal'
import CategorizedActionButtons from '@/components/CategorizedActionButtons'
import ConfirmationModal from '@/components/ConfirmationModal'
import ManualEventEntryModal from '@/components/ManualEventEntryModal'
import StartingLineupModal, { type LineupEntry } from '@/components/StartingLineupModal'
import SubstitutionModal from '@/components/SubstitutionModal'
import LiveInsightDisplay from '@/components/LiveInsightDisplay'
import EventFilterToggles, { getEventTypesForFilters, EventMapLegend } from '@/components/EventFilterToggles'
import ExtendedStatsModal from '@/components/ExtendedStatsModal'
import PossessionTerritoryChart from '@/components/charts/PossessionTerritoryChart'
import AttackingThirdsChart from '@/components/charts/AttackingThirdsChart'
import ScoringTimeline from '@/components/charts/ScoringTimeline'
import ShotOutcomeChart from '@/components/charts/ShotOutcomeChart'
import PathsTakenChart from '@/components/charts/PathsTakenChart'
import MatchKickoutZones from '@/components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '@/components/charts/MatchKickoutOutcomes'
import ScoringZoneMap from '@/components/charts/ScoringZoneMap'
import TurnoverMap from '@/components/charts/TurnoverMap'
import ScoreOrigins from '@/components/charts/ScoreOrigins'
import ScoreableFreesAnalysis from '@/components/charts/ScoreableFreesAnalysis'
import AttackEfficiencyCard from '@/components/charts/AttackEfficiencyCard'
import SeasonBenchmarkCard from '@/components/charts/SeasonBenchmarkCard'
import KickoutSequence from '@/components/charts/KickoutSequence'
import ShootingEfficiencyHeatmap from '@/components/charts/ShootingEfficiencyHeatmap'
import FullscreenPitchMode from '@/components/FullscreenPitchMode'
import PitchActionOverlay from '@/components/PitchActionOverlay'
import JerseyNumberStrip from '@/components/JerseyNumberStrip'
import FormationSnapshotButton from '@/components/FormationSnapshotButton'
import FormationSnapshotMode from '@/components/FormationSnapshotMode'
import TacticalTagButton from '@/components/TacticalTagButton'
import VoiceNoteButton from '@/components/VoiceNoteButton'
import BlackCardTimer, { type BlackCardEntry } from '@/components/BlackCardTimer'
import OppositionScorerStrip from '@/components/OppositionScorerStrip'
import WeatherPickerPopover, { getWeatherIcon, getWeatherLabel } from '@/components/WeatherPickerPopover'
import { BallPosition, PossessionTeam, EventType, Player, MatchEvent } from '@/types'
import { useMatch, useMatchStats, useStartMatch, useCompleteMatch, useUpdateMatchPhase, matchKeys } from '@/hooks/useMatches'
import { useRecordEvent, useMatchEvents, useDeleteEvent, matchEventKeys } from '@/hooks/useMatchEvents'
import { useRecordPossession } from '@/hooks/usePossession'
import { usePlayers } from '@/hooks/usePlayers'
import { api } from '@/services/api'
import { usePlayerMovement } from '@/hooks/usePlayerMovement'
import { useClubName, useClub } from '@/contexts/ClubContext'
import { useTour } from '@/hooks/useTour'
import { matchRecordingSteps } from '@/config/tourSteps'
import MatchRecordingTutorial, { type TutorialMatchState, consumePendingTutorial } from '@/components/MatchRecordingTutorial'
import NetworkStatusIndicator from '@/components/NetworkStatusIndicator'
import {
  UNFORCED_ERROR_SUBTYPES, FOUL_SUBTYPES,
  TURNOVER_REASON_CONFIG, type TurnoverReason,
} from '@/constants/turnoverSubtypes'
import ChartZoomModal from '@/components/ChartZoomModal'
import { useMatchStateRestore } from '@/hooks/useMatchStateRestore'
import { startActiveMonitoring, stopActiveMonitoring, offlineMatchEvents } from '@/services/offline'
import {
  Clock,
  Activity,
  Play,
  AlertCircle,
  Plus,
  Maximize,
  Target,
  ArrowLeftRight,
  Pause,
  RotateCcw,
  Users,
  HelpCircle,
  Pencil,
  CircleSlash,
  LayoutDashboard,
  X,
  Minus,
  Share2,
  Loader2,
} from 'lucide-react'

type MatchPhase = 'not_started' | 'first_half' | 'half_time' | 'second_half' | 'finished'

// Dev mode: Speed multiplier for testing (10 = 10x speed, so 3 real mins = 30 match mins)
// Set VITE_DEV_MATCH_SPEED=10 in .env.local for faster testing
const DEV_SPEED_MULTIPLIER = parseInt(import.meta.env.VITE_DEV_MATCH_SPEED || '1', 10)
const IS_DEV_SPEED = DEV_SPEED_MULTIPLIER > 1

// Turnover-reason and sub-type constant lists live in
// constants/turnoverSubtypes.ts, shared with VideoTagging.tsx's reason
// picker so the two pickers can never drift apart.


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
  const { data: match, isLoading: matchLoading } = useMatch(matchId, { live: true })
  const { data: matchStats, isLoading: statsLoading } = useMatchStats(matchId, undefined, true)
  const { data: players = [] } = usePlayers()
  const [matchLineup, setMatchLineup] = useState<any[]>([])
  const [lineupLoaded, setLineupLoaded] = useState(false)

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
  const [halfTimeInsightLoading, setHalfTimeInsightLoading] = useState(false)
  const [halfTimeInsight, setHalfTimeInsight] = useState<import('@/services/api').LiveInsight | null>(null)
  const [eventMapTeamFilter, setEventMapTeamFilter] = useState<'all' | 'own' | 'opponent'>('all')
  const [eventMapFilters, setEventMapFilters] = useState<Set<string>>(new Set(['all']))
  const [eventMapHalfFilter, setEventMapHalfFilter] = useState<'all' | 1 | 2>('all')
  const [pendingKickoutEvent, setPendingKickoutEvent] = useState<{
    eventType: EventType
    isHomeTeam: boolean
    playerId?: string
    targetPlayerId?: string
  } | null>(null) // Kickout event waiting for position selection
  // Collapses the "awaiting kickout" banner (both the pre-selection state and
  // the "tap landing position" banner) into a small pill so the user can log
  // a sub/card/correction without the banner in the way. Lives here (not in
  // FullscreenPitchMode) so it's a single source of truth shared by both the
  // normal and fullscreen views — reset below whenever a fresh kickout cycle
  // starts so it can never stay stuck minimised into the next one.
  const [kickoutBannerMinimised, setKickoutBannerMinimised] = useState(false)

  // Optional, auto-dismissing "who assisted?" prompt shown briefly after an
  // own-team GOAL/POINT/TWO_POINT is recorded. The score itself is already
  // saved by the time this appears — tapping a jersey PATCHes assist_player_id
  // onto that event; ignoring it (or the next kickout starting) just lets it
  // fade with zero consequence. Never blocks recording the next kickout.
  const [pendingAssist, setPendingAssist] = useState<{
    eventId: string
    scorerId: string
    scorerName: string
  } | null>(null)
  const pendingAssistTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const PENDING_ASSIST_TIMEOUT_MS = 6000
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [editingEventId, setEditingEventId] = useState<number | null>(null) // event being player-edited
  const [editingEventType, setEditingEventType] = useState<string | null>(null) // event type for edit modal title
  // Set only when the player picker was opened to complete a team swap
  // (opponent score corrected to own team, or similar) rather than a plain
  // "fix who scored" edit — tells handleEditPlayerSelected to also send the
  // new team, and tells its Skip path to still commit the team change alone.
  const [pendingTeamForEdit, setPendingTeamForEdit] = useState<'own' | 'opponent' | null>(null)
  // Drives the small "what do you want to change?" card that opens instead
  // of jumping straight to the player picker for kickout-sideline and
  // scoring/shot events — see handleEditEventClick.
  const [editChoice, setEditChoice] = useState<{ eventId: number; kind: 'sideline' | 'scoring'; currentTeam: 'own' | 'opponent' } | null>(null)
  const [pendingOpponentScore, setPendingOpponentScore] = useState<{ eventType: EventType; position: BallPosition; isFreeKick?: boolean } | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [pendingBlockRecovery, setPendingBlockRecovery] = useState<{ position: BallPosition } | null>(null)
  const [pendingSidelineDecision, setPendingSidelineDecision] = useState<{ position: BallPosition } | null>(null)
  const [resetting, setResetting] = useState(false)
  const [eventToDelete, setEventToDelete] = useState<number | null>(null)
  const [errorAlert, setErrorAlert] = useState<string | null>(null)
  const [isManualEntryOpen, setIsManualEntryOpen] = useState(false)
  const [manualEntryDefaultType, setManualEntryDefaultType] = useState<EventType | undefined>(undefined)
  const [isLineupModalOpen, setIsLineupModalOpen] = useState(false)
  const [isSubModalOpen, setIsSubModalOpen] = useState(false)
  const [isViewLineupOpen, setIsViewLineupOpen] = useState(false)
  const [startingLineup, setStartingLineup] = useState<Record<string, LineupEntry>>({})
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, LineupEntry> | undefined>(undefined)
  const [teamAttackingRight, setTeamAttackingRight] = useState<boolean>(true) // true = attacking towards x=100
  const [ballTrail, setBallTrail] = useState<Array<{ x: number; y: number }>>([])
  const prevTeamRef = useRef(ballPosition.team)
  const preTutorialBallRef = useRef<BallPosition | null>(null)

  // Clear trail and carrier on possession change (team switch)
  useEffect(() => {
    if (ballPosition.team !== prevTeamRef.current) {
      setBallTrail([])
      setActiveCarrierId(null)
      prevTeamRef.current = ballPosition.team
    }
  }, [ballPosition.team])

  const [pendingFreeKick, setPendingFreeKick] = useState<{ position: BallPosition; player?: Player } | null>(null) // Track free kick state with optional player
  // "Adjust Free Position" — temporarily hides the outcome overlay so the pitch
  // is visible/draggable; handleBallMove already repositions pendingFreeKick
  // while it's set, this just exposes that via the UI.
  const [isAdjustingFreePosition, setIsAdjustingFreePosition] = useState(false)
  useEffect(() => {
    if (!pendingFreeKick) setIsAdjustingFreePosition(false)
  }, [pendingFreeKick])
  const [pending45, setPending45] = useState<{ position: BallPosition } | null>(null) // Track 45 state
  // Set once "45 Scored"/"45 Missed" is picked — the actual kick is always
  // taken from the 45m line, so this waits for a pitch tap (same pattern as
  // pendingKickoutEvent) instead of trusting wherever the ball happened to
  // be sitting when the "45" button was first tapped. handleBallMove resolves
  // this and snaps the tapped x to the real 45m line — the tap only decides
  // left/right (y).
  const [pendingFortyFivePosition, setPendingFortyFivePosition] = useState<{ eventType: EventType; isHomeTeam: boolean } | null>(null)
  const [selectingFoulPlayer, setSelectingFoulPlayer] = useState<boolean>(false) // True when selecting own player who fouled
  const [pendingFoul, setPendingFoul] = useState<'own' | 'opponent' | null>(null) // Track which team committed the foul
  const [tacticalFoul, setTacticalFoul] = useState(false)
  const [weatherOverride, setWeatherOverride] = useState<{ conditions: string[]; temp: number | null; notes: string | null } | null>(null)
  const [isWeatherPickerOpen, setIsWeatherPickerOpen] = useState(false)
  const [isFullscreenPitch, setIsFullscreenPitch] = useState(false)
  // Half-time view — a pure visual overlay (no recording state touched at
  // all) that covers the touch pitch/carrier UI with the same stats/charts
  // already rendered further down the page, so a manager can see everything
  // at the break without the recording surface in the way. Purely additive:
  // toggling it never unmounts the pitch, so it can't interfere with an
  // in-progress recording.
  const [showHalfTimeView, setShowHalfTimeView] = useState(false)
  // Half-time "Share" button — captures the overlay's content to an image
  // and hands it to the device's native share sheet. html2canvas is dynamic-
  // imported only when this fires (same lazy pattern the PDF report exports
  // already use), so it adds nothing to the recording page's own bundle or
  // runtime — it can't slow down anything on the touch pitch.
  const [isSharingHalfTime, setIsSharingHalfTime] = useState(false)
  const halfTimeContentRef = useRef<HTMLDivElement>(null)
  const [isStopped, setIsStopped] = useState(false)
  // Dead ball / stoppage — ball isn't anyone's, but unlike isStopped the clock
  // keeps running (real GAA club matches don't stop the clock for stoppages;
  // the ref just plays discretionary added time). Blocks ball movement and
  // possession tracking the same way isStopped does, without freezing the timer.
  const [isDeadBall, setIsDeadBall] = useState(false)
  const [isClockEditorOpen, setIsClockEditorOpen] = useState(false)
  const [clockEditorDraft, setClockEditorDraft] = useState({ minute: 0, seconds: 0 })
  const [showExtendedStats, setShowExtendedStats] = useState(false)
  // Set to true by crash-restore when the match was stopped — forces match data effect to re-sync time from server
  const [forceServerTimeSync, setForceServerTimeSync] = useState(false)

  // Sub-type picker — shown after player selection for unforced errors and fouls
  const [pendingSubType, setPendingSubType] = useState<{
    player?: Player
    eventType: string
    foulMode: boolean
    subtypeOptions?: { value: string; label: string }[]
    capturedMinute: number
    capturedHalf: number
    position: BallPosition
  } | null>(null)

  // "T/O Lost" reason picker — shown before the sub-type list, so a turnover
  // gets classified as one of the three real reasons (active dispossession /
  // unforced error / offensive foul) up front rather than always landing as
  // a bare, undifferentiated TURNOVER_LOST.
  const [pendingTurnoverReason, setPendingTurnoverReason] = useState<{
    player?: Player
    capturedMinute: number
    capturedHalf: number
    position: BallPosition
  } | null>(null)

  // Guided tour (basic driver.js)
  const { startTour: startMatchTour } = useTour('matchRecording', matchRecordingSteps)
  const matchTourTriggered = useRef(false)

  // Interactive tutorial
  const [searchParams, setSearchParams] = useSearchParams()
  const [tutorialActive, setTutorialActive] = useState(false)
  const [lastEventType, setLastEventType] = useState<string | null>(null)

  // Instant tap confirmation — fires synchronously on tap, before any network
  // call, so the user never has to wonder whether it registered. Also guards
  // against the same quick action firing twice within a short window (a
  // real double-tap, or a second tap fired because the first one gave no
  // visible feedback in time).
  const [actionToast, setActionToast] = useState<string | null>(null)
  const actionToastTimeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const lastQuickActionRef = useRef<{ key: string; at: number } | null>(null)
  const QUICK_ACTION_DEBOUNCE_MS = 1200

  const flashActionToast = (label: string) => {
    setActionToast(label)
    if (actionToastTimeoutRef.current) clearTimeout(actionToastTimeoutRef.current)
    actionToastTimeoutRef.current = setTimeout(() => setActionToast(null), 1100)
  }

  const formatActionLabel = (type: string): string =>
    type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())

  /** True (and records the tap) if this isn't a repeat of the same action within the debounce window. */
  const shouldProceedWithQuickAction = (key: string): boolean => {
    const now = Date.now()
    const last = lastQuickActionRef.current
    if (last && last.key === key && now - last.at < QUICK_ACTION_DEBOUNCE_MS) {
      console.warn('Ignored duplicate quick action within debounce window:', key)
      return false
    }
    lastQuickActionRef.current = { key, at: now }
    return true
  }

  // Black card sin bin timers
  const [blackCardTimers, setBlackCardTimers] = useState<BlackCardEntry[]>([])

  // Compute players currently on the field (starting 15 + subbed on, minus subbed off)
  const playersOnField = useMemo(() => {
    // While lineup is still loading, return empty to avoid showing full squad in modals
    if (!lineupLoaded) return []
    // Lineup loaded but no entries — coach hasn't set one, fall back to all active players
    if (!matchLineup.length) return players.filter(p => p.active)
    const onFieldIds = new Set(matchLineup.filter(l => l.is_on_field).map(l => l.player_id))
    return players.filter(p => onFieldIds.has(p.id))
  }, [matchLineup, lineupLoaded, players])

  // Player movement tracking (ball carrier)
  const [activeCarrierId, setActiveCarrierId] = useState<string | null>(null)
  const playerMovement = usePlayerMovement({
    matchId: matchId,
    half: currentHalf,
    minute: minute,
    team: ballPosition.team === PossessionTeam.OWN ? 'own' : 'opponent',
  })

  // ── Active network monitoring — health pings only during match recording ──
  useEffect(() => {
    startActiveMonitoring()
    return () => stopActiveMonitoring()
  }, [])

  // ── Crash state restoration ────────────────────────────────────────────
  const { restoreSavedState, wasRestored, dismissRestore, clearSavedState } = useMatchStateRestore(
    matchId,
    () => ({
      ballX: ballPosition.x,
      ballY: ballPosition.y,
      possession: ballPosition.team === PossessionTeam.OWN ? 'own' : 'opponent',
      matchPhase,
      currentHalf,
      minute,
      seconds,
      isStopped,
      activeCarrierId,
    }),
  )

  // Auto-dismiss restore toast after 4 seconds
  useEffect(() => {
    if (wasRestored) {
      const t = setTimeout(dismissRestore, 4000)
      return () => clearTimeout(t)
    }
  }, [wasRestored, dismissRestore])

  // Attempt restore on mount (only if backend hasn't loaded match status yet)
  const restoreAttempted = useRef(false)
  useEffect(() => {
    if (restoreAttempted.current || !matchId) return
    restoreAttempted.current = true

    restoreSavedState().then((saved) => {
      if (!saved) return
      setBallPosition({
        x: saved.ballX,
        y: saved.ballY,
        team: saved.possession === 'own' ? PossessionTeam.OWN : PossessionTeam.OPPONENT,
      })
      setMatchPhase(saved.matchPhase as MatchPhase)
      setCurrentHalf(saved.currentHalf as 1 | 2)

      // Restore timer — always set minute/seconds from saved state.
      // Only add catch-up time when the clock was actively running (not stopped/half-time).
      const isClockRunning = !saved.isStopped && (saved.matchPhase === 'first_half' || saved.matchPhase === 'second_half')
      if (isClockRunning) {
        // Clock was running when we saved — add elapsed real time since last save
        const elapsedSinceSave = Math.floor((Date.now() - saved.lastSavedAt) / 1000)
        const totalSeconds = saved.minute * 60 + saved.seconds + elapsedSinceSave
        setMinute(Math.min(Math.floor(totalSeconds / 60), 120))
        setSeconds(totalSeconds % 60)
      } else if (saved.isStopped) {
        // Clock was stopped at a stoppage — the backend already has stopped_*:ELAPSED.
        // Don't restore IndexedDB time and don't trigger forceSync (risks stale-cache race).
        // The match data effect on initial load already froze the timer from server data.
      } else if (saved.matchPhase !== 'half_time') {
        setMinute(saved.minute)
        setSeconds(saved.seconds)
      }
      // During half-time, let the server state handler set the minute instead

      setIsStopped(saved.isStopped)
      if (saved.activeCarrierId) setActiveCarrierId(saved.activeCarrierId)
    })
  }, [matchId, restoreSavedState])

  // Map position_id to short label for carrier strip fallback
  const POSITION_LABELS: Record<string, string> = {
    'gk': 'GK', 'fb-left': 'CB', 'fb-center': 'FB', 'fb-right': 'CB',
    'hb-left': 'HB', 'hb-center': 'CHB', 'hb-right': 'HB',
    'mf-left': 'MF', 'mf-right': 'MF',
    'hf-left': 'HF', 'hf-center': 'CHF', 'hf-right': 'HF',
    'ff-left': 'CF', 'ff-center': 'FF', 'ff-right': 'CF',
  }

  // Same 15-slot layout as StartingLineupModal/MatchPrep's FORMATION_POSITIONS
  // — reused here so a formation snapshot starts with players exactly where
  // Select Lineup already put them, rather than an empty pitch the coach has
  // to place from scratch. x assumes "attacking right"; flipped per-half below.
  const FORMATION_POSITION_COORDS: Record<string, { x: number; y: number }> = {
    'gk': { x: 7, y: 50 },
    'fb-left': { x: 20, y: 18 }, 'fb-center': { x: 20, y: 50 }, 'fb-right': { x: 20, y: 82 },
    'hb-left': { x: 35, y: 18 }, 'hb-center': { x: 35, y: 50 }, 'hb-right': { x: 35, y: 82 },
    'mf-left': { x: 50, y: 35 }, 'mf-right': { x: 50, y: 65 },
    'hf-left': { x: 65, y: 18 }, 'hf-center': { x: 65, y: 50 }, 'hf-right': { x: 65, y: 82 },
    'ff-left': { x: 80, y: 18 }, 'ff-center': { x: 80, y: 50 }, 'ff-right': { x: 80, y: 82 },
  }

  // Whether the ball-carrier radial is currently open — hides the separate
  // pitch-spread receiver dots while it's open, since showing both at once
  // is redundant.
  const [isCarrierRadialOpen, setIsCarrierRadialOpen] = useState(false)

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
        positionId: entry.position_id || '',
      }
    })
  }, [matchLineup, players])

  // Own-team players pre-placed at their actual lineup slot, for Formation
  // Snapshot — the coach only needs to drag them to where they really are
  // and tap around to mark opposition shape, not build the whole XV from
  // scratch. FORMATION_POSITION_COORDS assumes attacking right; mirrored on
  // x when the team is actually attacking left this half, so the snapshot
  // always reflects which end is really being attacked right now.
  const snapshotOwnPlayers = useMemo(() => {
    return jerseyStripPlayers
      .filter(p => p.isOnField)
      .map(p => {
        const base = FORMATION_POSITION_COORDS[p.positionId] || { x: 50, y: 50 }
        const x = teamAttackingRight ? base.x : 100 - base.x
        return {
          playerId: p.playerId,
          jerseyNumber: p.jerseyNumber,
          playerName: p.playerName,
          x,
          y: base.y,
        }
      })
  }, [jerseyStripPlayers, teamAttackingRight])

  // Track recent carrier selections (most recent first) for quick-pick shortcuts
  const [recentCarrierIds, setRecentCarrierIds] = useState<string[]>([])

  const handleCarrierSelect = (playerId: string, jerseyNumber: number | null) => {
    // Update the visible carrier (status label, jersey strip highlight) immediately —
    // playerMovement.selectCarrier tracks start/end of the segment via its own
    // internal ref, independently of this state, so there's no ordering
    // requirement forcing it to go first. Previously this awaited the network
    // call before updating anything visible, which made every carrier switch
    // feel like it needed a second to register.
    if (activeCarrierId === playerId) {
      setActiveCarrierId(null)
    } else {
      setActiveCarrierId(playerId)
      setRecentCarrierIds(prev => [playerId, ...prev.filter(id => id !== playerId)].slice(0, 10))
    }
    playerMovement.selectCarrier(playerId, jerseyNumber, ballPosition.x, ballPosition.y).catch(err => {
      console.error('Failed to update carrier segment:', err)
    })
  }

  // Formation snapshot state
  const [isSnapshotMode, setIsSnapshotMode] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)
  const [shouldPulseSnapshot, setShouldPulseSnapshot] = useState(false)

  // Tactical tag state
  const [tacticalTagCount, setTacticalTagCount] = useState(0)

  const handleFormationSave = async (positions: Array<{ playerId: string | null; jerseyNumber: number | null; team: 'own' | 'opponent'; x: number; y: number }>, label: string) => {
    if (!matchId) return
    try {
      await api.playerMovement.createSnapshot({
        match_id: matchId,
        half: currentHalf,
        minute,
        label,
        // `positions` is a free-form JSON column — team is an additive field
        // alongside the existing {player_id, jersey_number, x, y} shape, not
        // a schema change. Opposition markers carry player_id/jersey_number
        // null, same convention the old "unassigned" own-team markers used,
        // now disambiguated by `team` instead of being indistinguishable.
        positions: positions.map(p => ({
          player_id: p.playerId,
          jersey_number: p.jerseyNumber,
          team: p.team,
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

  // Half-time "Share" button. html2canvas is dynamic-imported here (same
  // pattern as the report pages' PDF export) so it's never fetched or run
  // during normal recording — only when a coach actually taps Share while
  // the half-time overlay (itself opened on demand) is open.
  const handleShareHalfTime = async () => {
    if (!halfTimeContentRef.current || isSharingHalfTime) return
    setIsSharingHalfTime(true)
    try {
      const html2canvas = (await import('html2canvas')).default
      const canvas = await html2canvas(halfTimeContentRef.current, {
        backgroundColor: '#060a14',
        useCORS: true,
        scale: 2,
      })
      const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('Failed to generate image')

      const dateStr = new Date().toISOString().slice(0, 10)
      const filename = `half-time-${(matchDisplay.opponent || 'match').toLowerCase().replace(/\s+/g, '-')}-${dateStr}.png`
      const file = new File([blob], filename, { type: 'image/png' })
      const shareText = `${clubName || 'Us'} ${teamGoals}-${String(teamPoints).padStart(2, '0')} : ${opponentGoals}-${String(opponentPoints).padStart(2, '0')} ${matchDisplay.opponent} — Half-Time`

      if (typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'Half-Time Stats', text: shareText })
      } else {
        // Desktop / unsupported browser fallback — download the image so it
        // can be attached manually wherever the coach wants to send it.
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    } catch (err) {
      // AbortError fires when the user just closes the native share sheet
      // without picking anything — not a real failure, don't alarm them.
      if ((err as any)?.name !== 'AbortError') {
        console.error('Failed to share half-time view:', err)
        setErrorAlert('Failed to create the share image. Please try again.')
      }
    } finally {
      setIsSharingHalfTime(false)
    }
  }

  // Query client for manual refetching
  const queryClient = useQueryClient()

  // Debounced stats invalidation — batches rapid event/possession writes into one refetch per 10s.
  // Stats are now pushed via SSE (useMatchStats streams from /stats/stream).
  // invalidateStats is kept as a no-op to avoid touching every call site.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const invalidateStats = () => { /* no-op — SSE keeps stats current */ }

  // Sync match status with backend — resume timer from DB timestamps
  useEffect(() => {
    if (!match) return

    const serverPhase = match.current_phase || 'first_half'
    const serverIsStopped = serverPhase.startsWith('stopped_')
    // Fire when: initial load, half-time, minute=0, forceSync, server says stopped, or server resumed but we're still locally stopped
    if (match.status === 'in_progress' && (matchPhase === 'not_started' || matchPhase === 'half_time' || minute === 0 || forceServerTimeSync || serverIsStopped || (isStopped && !serverIsStopped))) {
      if (forceServerTimeSync) setForceServerTimeSync(false)

      // Stoppage persisted to backend — restore frozen timer and stopped state
      if (serverIsStopped) {
        const parts = serverPhase.split(':')
        const elapsedSeconds = parts[1] ? parseInt(parts[1], 10) : 0
        const half = serverPhase.includes('second') ? 'second_half' : 'first_half'
        setMatchPhase(half as MatchPhase)
        setCurrentHalf(serverPhase.includes('second') ? 2 : 1)
        setMinute(Math.floor(elapsedSeconds / 60))
        setSeconds(elapsedSeconds % 60)
        setIsStopped(true)
        if (match.attacking_right_first_half != null) {
          setTeamAttackingRight(
            half === 'second_half' ? !match.attacking_right_first_half : match.attacking_right_first_half
          )
        }
        return
      }

      // Server says running — clear any local stoppage state
      setIsStopped(false)

      const phase = serverPhase as MatchPhase
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
        const hdm = match.half_duration_mins || 30
        if (mins >= hdm) {
          // Timer has overrun half duration without half-time being clicked — freeze clock at hdm
          setMinute(hdm)
          setSeconds(0)
          setIsStopped(true)
        } else {
          setMinute(mins)
          setSeconds(secs)
          setIsStopped(false)
        }
        setCurrentHalf(1)
      } else if (phase === 'half_time') {
        // Force half-time minute — overrides any crash restore value
        setTimeout(() => {
          setMinute(match.half_duration_mins || 30)
          setSeconds(0)
        }, 100)
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

  }, [match, forceServerTimeSync])

  // Weather: use local override (optimistic) if set, otherwise fall back to match data.
  // weather_conditions (plural) is the source of truth; matches recorded
  // before multi-select weather existed only have the legacy single field.
  const weatherConditions = weatherOverride
    ? weatherOverride.conditions
    : (match?.weather_conditions ?? (match?.weather_condition ? [match.weather_condition] : []))
  const temperatureCelsius = weatherOverride ? weatherOverride.temp : (match?.temperature_celsius ?? null)
  const matchNotesText = weatherOverride ? weatherOverride.notes : (match?.notes ?? null)

  // Save weather change to backend
  const handleWeatherSave = async (conditions: string[], temp: number | null, notes: string | null) => {
    // Set optimistic override immediately so UI updates
    setWeatherOverride({ conditions, temp, notes })
    if (matchId) {
      try {
        await api.matches.update(matchId, {
          weather_conditions: conditions,
          temperature_celsius: temp,
          notes,
        } as any)
        // Refetch match data, then clear override (server data now matches)
        await queryClient.invalidateQueries({ queryKey: ['matches', matchId] })
        setWeatherOverride(null)
      } catch (err) {
        console.error('Failed to update weather:', err)
      }
    }
  }

  // Trigger guided tour on first visit, or interactive tutorial via ?tutorial=1
  useEffect(() => {
    if (match && !matchLoading && !matchTourTriggered.current) {
      matchTourTriggered.current = true
      if (searchParams.get('tutorial') === '1' || consumePendingTutorial()) {
        setTutorialActive(true)
        // Start ball at half-back line for more realistic tutorial flow
        setBallPosition({ x: 30, y: 50, team: PossessionTeam.OWN })
        // Remove query param without navigation
        if (searchParams.get('tutorial') === '1') {
          setSearchParams({}, { replace: true })
        }
      } else {
        startMatchTour()
      }
    }
  }, [match, matchLoading, startMatchTour, searchParams, setSearchParams])

  // Auto-resync any unsynced local events on page load
  useEffect(() => {
    if (matchId) {
      import('@/services/offline').then(({ resyncLocalEvents }) => {
        resyncLocalEvents(matchId).then(count => {
          if (count > 0) console.log(`[MatchRecording] Auto-resynced ${count} events`)
        })
      })
    }
  }, [matchId])

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
        } finally {
          setLineupLoaded(true)
        }
      }
    }
    loadLineup()
  }, [matchId])

  // Periodic lineup refresh during live play — self-healing safety net.
  // Substitutions update matchLineup imperatively (setMatchLineup right
  // after the field-status PATCH calls), but that path is a plain fetch
  // with no offline-first retry, unlike event recording. On a pitch with
  // patchy signal, a transient failure there leaves the on-field/bench
  // display stuck showing pre-substitution state indefinitely, with no
  // automatic recovery — confirmed live where the database was correct but
  // the pitch UI kept showing a subbed-off player as still on the field
  // until the page was manually refreshed. Mirrors the same 20s poll
  // already used for the live events list (useMatchEvents' `live: true`).
  useEffect(() => {
    const isLive = matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time'
    if (!isLive || !matchId) return
    const poll = setInterval(async () => {
      try {
        const lineup = await api.matchLineups.getLineup(matchId)
        setMatchLineup(lineup)
      } catch {
        // Best-effort — keep showing whatever we last had, try again next tick
      }
    }, 20000)
    return () => clearInterval(poll)
  }, [matchId, matchPhase])

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
              const next = m + 1
              const hdm = match?.half_duration_mins || 30
              const fullTimeMins = (hdm * 2) - 1
              if (next >= fullTimeMins && matchPhase === 'second_half') {
                setFullTimeReached(true)
              }
              // Freeze first-half timer at hdm — user must click "Half Time" to advance
              if (matchPhase === 'first_half' && next >= hdm) {
                setIsStopped(true)
                return hdm
              }
              return Math.min(next, 120)
            })
            return 0
          }
          return prev + 1
        })
      }, intervalMs)
      return () => clearInterval(interval)
    }
  }, [matchPhase, isStopped])

  // Possession tick — records ball position every 8s, flushed as a single bulk POST every 15s
  const possTickBallRef = useRef(ballPosition)
  const possTickMinuteRef = useRef(minute)
  possTickBallRef.current = ballPosition
  possTickMinuteRef.current = minute
  const possTickBufferRef = useRef<Array<{ x: number; y: number; team: 'own' | 'opponent'; minute: number }>>([])
  // Guards against overlapping flush() calls — a backgrounded/throttled tab
  // can queue up several setInterval fires and then dispatch them back-to-
  // back once foregrounded. Without this, concurrent bulk-create requests
  // each independently read "the most recent possession event" (no row
  // locking) and attribute their own elapsed time to it, so a burst of
  // queued flushes compounds into wildly inflated possession durations —
  // this produced a real ~28min own-possession over-count during a live
  // match (traced and corrected in prod on 2026-08-17). Skipping a flush
  // tick outright if the previous one hasn't finished is simpler and safer
  // than trying to serialize/merge them — the buffer just carries over to
  // the next tick.
  const isFlushingRef = useRef(false)

  useEffect(() => {
    const isPlaying = (matchPhase === 'first_half' || matchPhase === 'second_half') && !isStopped && !isDeadBall && !awaitingKickout && !pendingFreeKick
    if (!isPlaying || !matchId) return

    // Accumulate a waypoint every 8s
    const tick = setInterval(() => {
      const bp = possTickBallRef.current
      const m = possTickMinuteRef.current
      possTickBufferRef.current.push({
        x: bp.x,
        y: bp.y,
        team: bp.team === PossessionTeam.OWN ? 'own' : 'opponent',
        minute: Math.min(m, 120),
      })
    }, 8000)

    // Flush buffer as bulk POSTs every 15s — one request per distinct team
    const flush = setInterval(async () => {
      if (isFlushingRef.current) return
      const batch = possTickBufferRef.current.splice(0)
      if (!batch.length) return
      isFlushingRef.current = true
      const byTeam = new Map<'own' | 'opponent', typeof batch>()
      for (const w of batch) {
        if (!byTeam.has(w.team)) byTeam.set(w.team, [])
        byTeam.get(w.team)!.push(w)
      }
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        for (const [team, pts] of byTeam) {
          await fetch(`${baseUrl}/possession-events/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
              match_id: matchId,
              team,
              minute: pts[pts.length - 1].minute,
              waypoints: pts.map(w => ({ x: w.x, y: w.y })),
            }),
          })
        }
      } catch {
        // Best-effort — drop buffer on failure
      } finally {
        isFlushingRef.current = false
      }
    }, 15000)

    return () => {
      clearInterval(tick)
      clearInterval(flush)
    }
  }, [matchPhase, isStopped, isDeadBall, awaitingKickout, pendingFreeKick, matchId])

  // Haptic pulse when action is required (kickout or free kick pending)
  useEffect(() => {
    if ((awaitingKickout || !!pendingFreeKick) && 'vibrate' in navigator) {
      navigator.vibrate(150)
    }
  }, [awaitingKickout, pendingFreeKick])

  // Un-minimise the kickout banner the moment a fresh kickout cycle starts —
  // otherwise a banner minimised on a previous kickout would silently stay
  // hidden for the next one.
  useEffect(() => {
    if (awaitingKickout || pendingKickoutEvent) {
      setKickoutBannerMinimised(false)
    }
  }, [awaitingKickout, pendingKickoutEvent])

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

  // Recent events - fetch from backend, display newest first
  const { data: matchEventsData } = useMatchEvents(matchId, { live: true })
  const allEvents = [...(matchEventsData?.events || [])].reverse()

  // Match-insight cards — same event-driven aggregations the post-match
  // report uses (score origins, scoreable frees, attack efficiency, vs
  // season average). None of these are gated on the match being completed
  // server-side, so they're safe to surface live for a half-time view —
  // unlike Expected Points, which the xP endpoint's own docstring flags as
  // "post-match reporting only, never poll from live match tracking"
  // (its shot-quality model rebuild is too heavy to run on a live cadence).
  const hasTaggedEvents = (matchEventsData?.events?.length ?? 0) > 0
  // refetchInterval keeps these live during the match — without it each one
  // fetches once the moment hasTaggedEvents first flips true (i.e. right after
  // the very first event of the match, when there's essentially no data yet),
  // and since the cards below are only rendered `{data && (...)}`, an empty
  // first response means the card just never appears again for the rest of
  // the match — confirmed as the cause of charts missing data at half-time.
  const { data: scoreOriginsData } = useQuery({
    queryKey: ['score-origins', matchId],
    queryFn: () => api.matchAnalytics.getScoreOrigins(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: scoreableFreesData } = useQuery({
    queryKey: ['scoreable-frees', matchId],
    queryFn: () => api.matchAnalytics.getScoreableFrees(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: attackEfficiencyData } = useQuery({
    queryKey: ['attack-efficiency', matchId],
    queryFn: () => api.matchAnalytics.getAttackEfficiency(matchId!),
    enabled: !!matchId && hasTaggedEvents,
    refetchInterval: 20_000,
  })
  const { data: seasonBenchmarkData } = useQuery({
    queryKey: ['season-benchmark', matchId],
    queryFn: () => api.matchAnalytics.getSeasonBenchmark(matchId!),
    enabled: !!matchId,
    refetchInterval: 20_000,
  })

  // Shot locations for the shooting-efficiency heatmap — same
  // half-aware normalization ShootingEfficiencyHeatmap/PathsTakenChart
  // already rely on elsewhere (getPitchArea, MatchResult.tsx), since which
  // end a team is attacking flips at half-time.
  const shotLocations = useMemo(() => {
    const shotTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss'])
    const scoreTypes = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])
    const halfDuration = match?.half_duration_mins || 30
    const attackingRightFirstHalf = match?.attacking_right_first_half ?? true
    const normalizeX = (rawX: number, isOwn: boolean, minute: number | null | undefined): number => {
      const isFirstHalf = (minute ?? 0) <= halfDuration
      const teamAttackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
      const attackingRight = isOwn ? teamAttackingRight : !teamAttackingRight
      return attackingRight ? rawX : 100 - rawX
    }
    return (matchEventsData?.events || [])
      .filter((e: any) => shotTypes.has(e.event_type) && e.pitch_x != null)
      .map((e: any) => {
        const isOwn = e.team === 'own' || e.is_home_team
        return {
          x: normalizeX(e.pitch_x as number, isOwn, e.minute),
          y: e.pitch_y ?? 50,
          event_type: e.event_type,
          is_score: scoreTypes.has(e.event_type),
          team: e.team || (e.is_home_team ? 'own' : 'opponent'),
          match_id: e.match_id,
        }
      })
  }, [matchEventsData, match?.half_duration_mins, match?.attacking_right_first_half])
  const [visibleEventCount, setVisibleEventCount] = useState(15)

  // Scorers — per-player breakdown of own-team scores, GAA-style, updates live
  const scorers = useMemo(() => {
    const scoreTypes: Record<string, 'goal' | 'point' | 'two_point'> = {
      goal: 'goal', penalty_goal: 'goal',
      point: 'point', point_free: 'point', forty_five: 'point',
      two_point: 'two_point', two_point_free: 'two_point',
    }
    const byPlayer: Record<string, { goals: number; points: number; twoPointers: number }> = {}
    for (const e of allEvents as any[]) {
      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== 'own' || !e.player_id) continue
      const kind = scoreTypes[e.event_type]
      if (!kind) continue
      const pid = String(e.player_id)
      if (!byPlayer[pid]) byPlayer[pid] = { goals: 0, points: 0, twoPointers: 0 }
      if (kind === 'goal') byPlayer[pid].goals++
      else if (kind === 'point') byPlayer[pid].points++
      else byPlayer[pid].twoPointers++
    }
    return Object.entries(byPlayer)
      .map(([pid, b]) => {
        const player = players.find((p: any) => p.id === pid)
        const pointsValue = b.points + b.twoPointers * 2
        return {
          playerId: pid,
          name: player?.name || 'Unknown',
          goals: b.goals,
          pointsValue,
          twoPointers: b.twoPointers,
          totalValue: b.goals * 3 + pointsValue,
        }
      })
      .sort((a, b) => b.totalValue - a.totalValue)
  }, [allEvents, players])

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

  // The full set of match-insight charts — rendered in its normal spot in
  // the page (below the pitch) when the half-time view is closed, and
  // re-rendered *instead* inside the half-time overlay when it's open (see
  // showHalfTimeView below). Kept as one value referenced from exactly one
  // of those two places at a time, never both at once, so nothing here
  // ever double-fetches.
  // Memoized so the once-a-second match-clock tick (setSeconds, above) doesn't
  // force React to rebuild this ~15-chart element tree on every single render
  // of this giant component — it only needs to change when the data feeding
  // the charts actually changes. This block renders on the normal recording
  // page too (below the touch pitch), not just inside the half-time overlay,
  // so an unmemoized rebuild here was previously happening every second
  // during live recording, on top of the touch-pitch/action-button UI in the
  // same render pass.
  const matchInsightsCharts = useMemo(() => matchId && matchEventsData?.events && (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartZoomModal title="Paths Taken">
          <PathsTakenChart
            matchId={matchId}
            pollInterval={20000}
          />
        </ChartZoomModal>
        <ChartZoomModal title="Possession & Territory">
          <PossessionTerritoryChart
            stats={matchStats}
            events={matchEventsData.events}
            matchId={matchId}
            opponent={matchDisplay.opponent}
            pollInterval={20000}
            attackingRightFirstHalf={match?.attacking_right_first_half}
            halfDurationMins={match?.half_duration_mins || 30}
          />
        </ChartZoomModal>
      </div>
      <div className="[&>div]:h-full [&_.glass-card]:h-full">
        <ChartZoomModal title="Attacking Thirds">
          <AttackingThirdsChart
            matchId={matchId}
            opponent={matchDisplay.opponent}
            events={matchEventsData.events}
            pollInterval={20000}
            attackingRightFirstHalf={match?.attacking_right_first_half}
            halfDurationMins={match?.half_duration_mins || 30}
          />
        </ChartZoomModal>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <ChartZoomModal title="Scoring Timeline">
          <ScoringTimeline
            events={matchEventsData.events}
            opponent={matchDisplay.opponent}
            teamName={clubName}
          />
        </ChartZoomModal>
        <ChartZoomModal title="Shot Outcomes">
          <ShotOutcomeChart
            events={matchEventsData.events}
            opponent={matchDisplay.opponent}
          />
        </ChartZoomModal>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
        <ChartZoomModal title="Kickout Zones">
          <MatchKickoutZones events={matchEventsData.events} attackingRightFirstHalf={match?.attacking_right_first_half} teamName={clubName} opponentName={matchDisplay.opponent} />
        </ChartZoomModal>
        <ChartZoomModal title="Kickout Outcomes">
          <MatchKickoutOutcomes events={matchEventsData.events} teamName={clubName} opponentName={matchDisplay.opponent} />
        </ChartZoomModal>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
        <ChartZoomModal title="Scoring Zone Map">
          <ScoringZoneMap events={matchEventsData.events} teamName={clubName || 'Us'} opponent={matchDisplay.opponent} />
        </ChartZoomModal>
        <ChartZoomModal title="Possession Battle Map">
          <TurnoverMap events={matchEventsData.events} teamName={clubName || 'Us'} />
        </ChartZoomModal>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
        <ChartZoomModal title="Shooting Efficiency">
          <ShootingEfficiencyHeatmap shots={shotLocations} />
        </ChartZoomModal>
        {scoreOriginsData && (
          <ChartZoomModal title="Score Origins">
            <ScoreOrigins data={scoreOriginsData} teamName={clubName} opponentName={matchDisplay.opponent} />
          </ChartZoomModal>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
        {scoreableFreesData && (
          <ChartZoomModal title="Scoreable Frees">
            <ScoreableFreesAnalysis data={scoreableFreesData} teamName={clubName} />
          </ChartZoomModal>
        )}
        {attackEfficiencyData && (
          <ChartZoomModal title="Attack Efficiency">
            <AttackEfficiencyCard data={attackEfficiencyData} teamName={clubName} opponentName={matchDisplay.opponent} />
          </ChartZoomModal>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
        <ChartZoomModal title="Kickout Sequence">
          <KickoutSequence events={matchEventsData.events} teamName={clubName} opponentName={matchDisplay.opponent} />
        </ChartZoomModal>
        {seasonBenchmarkData && (
          <ChartZoomModal title="vs Season Average">
            <SeasonBenchmarkCard data={seasonBenchmarkData} teamName={clubName} />
          </ChartZoomModal>
        )}
      </div>
    </>
  ), [
    matchId,
    matchEventsData?.events,
    matchStats,
    clubName,
    matchDisplay.opponent,
    match?.attacking_right_first_half,
    match?.half_duration_mins,
    shotLocations,
    scoreOriginsData,
    scoreableFreesData,
    attackEfficiencyData,
    seasonBenchmarkData,
  ])

  // Head-to-head stat table — same numbers shown below the touch pitch during
  // normal recording, also rendered inside the half-time overlay (see
  // showHalfTimeView below) so a coach reading the half-time view actually
  // sees the stat line, not just the charts. A plain const, not useMemo like
  // matchInsightsCharts above — this is a ~15-row table, not a chart tree, so
  // recomputing it every render (as it always has, inline) costs nothing.
  const matchStatsPanel = (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold flex items-center space-x-2 text-white">
          <Activity size={20} className="text-emerald-400" />
          <span>Match Statistics</span>
        </h3>
        {allEvents.length > 0 && (
          <button
            onClick={() => setShowExtendedStats(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/60 hover:text-white text-xs font-medium transition-colors"
          >
            More Stats
          </button>
        )}
      </div>

      <div className="rounded-xl border border-white/[0.08] overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)' }}>
        {/* Header row */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
          <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider">{clubName}</div>
          <div className="min-w-[90px]" />
          <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider">{matchDisplay.opponent}</div>
        </div>

        {[
          { label: 'Possession', left: `${stats.possession.team}%`, right: `${stats.possession.opponent}%`, leftVal: stats.possession.team, rightVal: stats.possession.opponent },
          { label: 'Poss. Count', left: matchStats?.team_possession_count ?? 0, right: matchStats?.opponent_possession_count ?? 0, leftVal: matchStats?.team_possession_count ?? 0, rightVal: matchStats?.opponent_possession_count ?? 0 },
          { label: 'Shots', left: stats.shots.team, right: stats.shots.opponent, leftVal: stats.shots.team, rightVal: stats.shots.opponent },
          { label: 'Scores', left: stats.scores.team, right: stats.scores.opponent, leftVal: stats.scores.team, rightVal: stats.scores.opponent },
          { label: 'Goal Chances', left: matchStats?.team_goal_chances ?? 0, right: matchStats?.opponent_goal_chances ?? 0, leftVal: matchStats?.team_goal_chances ?? 0, rightVal: matchStats?.opponent_goal_chances ?? 0 },
          { label: 'Wides', left: stats.wides.team, right: stats.wides.opponent, leftVal: stats.wides.opponent, rightVal: stats.wides.team },
          { label: 'Accuracy', left: `${stats.accuracy}%`, right: `${stats.shots.opponent > 0 ? (stats.scores.opponent / stats.shots.opponent * 100).toFixed(1) : '0.0'}%`, leftVal: Number(stats.accuracy), rightVal: stats.shots.opponent > 0 ? stats.scores.opponent / stats.shots.opponent * 100 : 0 },
          { label: 'Conversion', left: `${stats.conversionRate}%`, right: `${(stats.scores.opponent + stats.wides.opponent) > 0 ? ((stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100).toFixed(1) : '0.0'}%`, leftVal: Number(stats.conversionRate), rightVal: (stats.scores.opponent + stats.wides.opponent) > 0 ? (stats.scores.opponent / (stats.scores.opponent + stats.wides.opponent)) * 100 : 0 },
          { label: 'Turnovers Won', left: stats.turnovers.won, right: stats.turnovers.lost, leftVal: stats.turnovers.won, rightVal: stats.turnovers.lost },
          ...((matchStats?.team_ball_recovery_avg_min != null || matchStats?.opponent_ball_recovery_avg_min != null) ? [{
            label: 'Ball Recovery',
            left: matchStats?.team_ball_recovery_avg_min != null ? `${matchStats.team_ball_recovery_avg_min}m` : '–',
            right: matchStats?.opponent_ball_recovery_avg_min != null ? `${matchStats.opponent_ball_recovery_avg_min}m` : '–',
            leftVal: matchStats?.opponent_ball_recovery_avg_min ?? 0,
            rightVal: matchStats?.team_ball_recovery_avg_min ?? 0,
          }] : []),
          { label: 'Unforced Errors', left: matchStats?.team_unforced_errors ?? 0, right: matchStats?.opponent_unforced_errors ?? 0, leftVal: matchStats?.opponent_unforced_errors ?? 0, rightVal: matchStats?.team_unforced_errors ?? 0 },
          { label: 'Kickouts Won', left: `${stats.kickouts.teamWon}/${stats.kickouts.teamTotal}`, right: `${stats.kickouts.opponentWon}/${stats.kickouts.opponentTotal}`, leftVal: stats.kickouts.teamWon, rightVal: stats.kickouts.opponentWon },
          { label: 'Kickout Ret. %', left: `${teamKickoutRetention}%`, right: `${opponentKickoutRetention}%`, leftVal: parseFloat(teamKickoutRetention), rightVal: parseFloat(opponentKickoutRetention) },
          { label: 'Fouls', left: matchStats?.team_fouls || 0, right: matchStats?.opponent_fouls || 0, leftVal: matchStats?.opponent_fouls || 0, rightVal: matchStats?.team_fouls || 0 },
          { label: '🟡 Yellow', left: matchStats?.team_yellow_cards || 0, right: matchStats?.opponent_yellow_cards || 0, leftVal: matchStats?.opponent_yellow_cards || 0, rightVal: matchStats?.team_yellow_cards || 0 },
          ...((matchStats?.team_black_cards || 0) + (matchStats?.opponent_black_cards || 0) > 0 ? [{ label: '⬛ Black', left: matchStats?.team_black_cards || 0, right: matchStats?.opponent_black_cards || 0, leftVal: matchStats?.opponent_black_cards || 0, rightVal: matchStats?.team_black_cards || 0 }] : []),
          ...((matchStats?.team_red_cards || 0) + (matchStats?.opponent_red_cards || 0) > 0 ? [{ label: '🔴 Red', left: matchStats?.team_red_cards || 0, right: matchStats?.opponent_red_cards || 0, leftVal: matchStats?.opponent_red_cards || 0, rightVal: matchStats?.team_red_cards || 0 }] : []),
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
  )

  // Event map filtered events (same logic as MatchResult)
  const filteredMapEvents = useMemo(() => {
    if (!matchEventsData?.events) return []
    const eventTypes = getEventTypesForFilters(eventMapFilters)
    const halfDuration = match?.half_duration_mins || 30
    let events = matchEventsData.events.map((e: any) => ({
      id: e.id,
      pitch_x: e.pitch_x,
      pitch_y: e.pitch_y,
      event_type: e.event_type,
      team: e.team || (e.is_home_team ? 'own' : 'opponent'),
      player_name: e.player_name,
      minute: e.minute,
      half: e.half ?? (e.minute != null ? (e.minute <= halfDuration ? 1 : 2) : 1),
    }))
    if (eventMapTeamFilter !== 'all') {
      events = events.filter((e: any) => e.team === eventMapTeamFilter)
    }
    if (eventMapHalfFilter !== 'all') {
      events = events.filter((e: any) => e.half === eventMapHalfFilter)
    }
    if (eventTypes) {
      events = events.filter((e: any) => eventTypes.includes(e.event_type))
    }
    const CARD_TYPES = ['yellow_card', 'black_card', 'red_card']
    return events.filter((e: any) => e.pitch_x !== null && e.pitch_y !== null && !CARD_TYPES.includes(e.event_type))
  }, [matchEventsData, eventMapFilters, eventMapTeamFilter, eventMapHalfFilter])

  // Helper function to check if position is in 2-point zone (outside 40m arc)
  // Coordinates are pitch-area %: 0-100 maps to playable pitch only
  // Now accounts for teamAttackingRight direction setting
  const isIn2PointZone = (x: number, y: number, team: PossessionTeam): boolean => {
    // GAA pitch: 40m arc from goal center (2-point line)
    // CALIBRATED from SVG pitch, converted to pitch-area coords:
    // Radii increased slightly to avoid false 2-pointer triggers at arc edges
    // - X_RADIUS = ~29% (40m along 145m pitch = 27.6%, padded for visual accuracy)
    // - Y_RADIUS = ~46% (40m on 90m wide pitch = 44.4%, padded for arc curvature at sides)

    const X_RADIUS_PERCENT = 29.0
    const Y_RADIUS_PERCENT = 46.0

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

    // Left/Right is relative to the team's attacking direction.
    // Attacking right (facing right): top of screen (low y) = left wing, bottom = right wing.
    // Attacking left (facing left): top of screen (low y) = right wing, bottom = left wing.
    const facingRight = eventTeamIsOwn ? teamAttackingRight : !teamAttackingRight
    let lateral = ''
    if (y < 33) lateral = facingRight ? ' (left wing)' : ' (right wing)'
    else if (y > 67) lateral = facingRight ? ' (right wing)' : ' (left wing)'
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

  // Kickout-sideline pairs — editing "which team" here means flipping BOTH
  // the event_type (whose restart it was) and team together, since for this
  // pair (unlike the WON/OPPOSITION_WON kickout family, deliberately left
  // alone below) they move in lockstep: team is exactly the OWN_/OPP_ prefix.
  const KICKOUT_SIDELINE_SWAP: Record<string, string> = {
    own_kickout_sideline: 'opp_kickout_sideline',
    opp_kickout_sideline: 'own_kickout_sideline',
  }
  // Every shot/scoring outcome — the category CategorizedActionButtons calls
  // "Shooting". Team here is a plain field on the same event_type (a point is
  // a point whoever scored it), so "change team" is just flipping `team`.
  const SCORING_SHOT_EVENT_TYPES = new Set([
    'goal', 'point', 'two_point', 'wide', 'saved', 'short', 'hit_post',
    'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed',
    'penalty_goal', 'penalty_miss',
  ])

  // Shared PUT for any event edit (player, team, or both). One place to keep
  // the optimistic-update/rollback and scoreboard refresh correct, instead of
  // three separate fetches risking three different answers to "did the score
  // update?". The backend recalculates team_goals/team_points/etc. from
  // scratch on every event PUT — rather than re-deriving that delta here for
  // every possible from/to team+event_type combination (error-prone, exactly
  // the kind of mistake "needs more care" was about), this just invalidates
  // the match query so the scoreboard refetches the authoritative total.
  const putEventEdit = async (eventId: number, patch: Record<string, unknown>) => {
    if (!matchId) return
    const queryKey = matchEventKeys.byMatch(matchId)
    const previous = queryClient.getQueryData(queryKey)
    queryClient.setQueryData(queryKey, (old: any) => {
      if (!old?.events) return old
      return {
        ...old,
        events: old.events.map((e: any) => (e.id === eventId ? { ...e, ...patch } : e)),
      }
    })

    try {
      const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
      const res = await fetch(`${baseUrl}/match-events/${eventId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(patch),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      if ('team' in patch || 'event_type' in patch) {
        queryClient.invalidateQueries({ queryKey: matchKeys.detail(matchId) })
      }
    } catch (err) {
      queryClient.setQueryData(queryKey, previous)
      console.error('Failed to update event:', err)
      setErrorAlert('Failed to update event. Please try again.')
    }
  }

  // Open player picker to assign/change the player on an existing event
  const handleEditEventPlayer = (eventId: number) => {
    const event = allEvents.find(e => e.id === eventId)
    setEditingEventId(eventId)
    setEditingEventType(event?.event_type ?? null)
    setIsPlayerModalOpen(true)
  }

  // Pencil tap on an event in the Recent Events list. Kickout-sideline and
  // scoring events get a small "what's wrong here?" choice instead of jumping
  // straight to the player picker — for sideline kickouts there's no player
  // to pick in the first place (the mistake is always "wrong team"), and for
  // scores the actual reported mistake ("St Marys' point should have been
  // ours") is a team fix, not a player fix, so the player picker alone was a
  // dead end for exactly the case that prompted this. Everything else keeps
  // the original one-tap-to-player-picker behaviour, unchanged.
  const handleEditEventClick = (eventId: number) => {
    const event = allEvents.find(e => e.id === eventId)
    if (!event) return
    const eventType = String(event.event_type)
    const currentTeam: 'own' | 'opponent' = eventIsOwn(event) ? 'own' : 'opponent'

    if (KICKOUT_SIDELINE_SWAP[eventType] || SCORING_SHOT_EVENT_TYPES.has(eventType)) {
      setEditChoice({
        eventId,
        kind: KICKOUT_SIDELINE_SWAP[eventType] ? 'sideline' : 'scoring',
        currentTeam,
      })
      return
    }
    handleEditEventPlayer(eventId)
  }

  // Kickout-sideline "swap to the other team" — event_type and team flip
  // together (see KICKOUT_SIDELINE_SWAP above). No player involved either
  // way, so this is the whole edit, no follow-up step.
  const handleConfirmSidelineSwap = async () => {
    if (!editChoice) return
    const { eventId } = editChoice
    const event = allEvents.find(e => e.id === eventId)
    setEditChoice(null)
    if (!event) return
    const eventType = String(event.event_type)
    const newEventType = KICKOUT_SIDELINE_SWAP[eventType]
    if (!newEventType) return
    const newTeam = eventIsOwn(event) ? 'opponent' : 'own'
    await putEventEdit(eventId, { event_type: newEventType, team: newTeam })
  }

  // Scoring/shot "swap to the other team". Switching TO opponent clears
  // player_id outright — opponent events never carry one of our players.
  // Switching TO own team needs to know who actually took it, so this closes
  // the choice card and chains straight into the normal player picker;
  // handleEditPlayerSelected (and its Skip path) finish the job from there.
  const handleSwapScoringTeam = async () => {
    if (!editChoice) return
    const { eventId, currentTeam } = editChoice
    const targetTeam = currentTeam === 'own' ? 'opponent' : 'own'
    const event = allEvents.find(e => e.id === eventId)
    setEditChoice(null)

    if (targetTeam === 'own') {
      setPendingTeamForEdit('own')
      setEditingEventId(eventId)
      setEditingEventType(event?.event_type ?? null)
      setIsPlayerModalOpen(true)
      return
    }
    await putEventEdit(eventId, { team: 'opponent', player_id: null })
  }

  // Closes the edit-mode player picker. A plain player-only edit just
  // cancels (unchanged from before). But if this picker was opened to finish
  // a team swap (pendingTeamForEdit set) and the coach hits Skip because they
  // don't know/care who exactly touched it, the team correction — the actual
  // point of the edit — still goes through; only the player attribution is
  // left blank, same spirit as "Skip Player" everywhere else in recording.
  const handleEditPlayerModalClose = () => {
    setIsPlayerModalOpen(false)
    const targetEventId = editingEventId
    const teamPatch = pendingTeamForEdit
    setEditingEventId(null)
    setEditingEventType(null)
    setPendingTeamForEdit(null)
    if (teamPatch && targetEventId !== null) {
      putEventEdit(targetEventId, { team: teamPatch, player_id: null })
    }
  }

  // Called when a player is selected from the edit-event modal
  const handleEditPlayerSelected = async (player: Player) => {
    if (!matchId || editingEventId === null) return
    setIsPlayerModalOpen(false)
    const targetEventId = editingEventId
    const teamPatch = pendingTeamForEdit
    setEditingEventId(null)
    setEditingEventType(null)
    setPendingTeamForEdit(null)

    await putEventEdit(targetEventId, teamPatch ? { player_id: player.id, team: teamPatch } : { player_id: player.id })
  }

  // Real API-fetched events carry `team: 'own'|'opponent'` (the actual backend
  // field) — `is_home_team` only ever exists on a locally-synthesized event
  // object from the moment it's first recorded, and stops being reliable the
  // instant the next background refetch (every 20s while live) replaces it
  // with the server's own shape. Anything reading "which team is this" must
  // check `team` first and only fall back to `is_home_team` for that brief
  // pre-refetch window — shared here so the event list's colour-coding and
  // its description text can never quietly disagree with each other.
  const eventIsOwn = (event: any): boolean => {
    const eventTeam = event?.team
    return eventTeam ? eventTeam === 'own' : !!event?.is_home_team
  }

  // Helper function to format event description
  const formatEventDescription = (event: MatchEvent): string => {
    const player = players.find(p => p.id === String(event.player_id))
    const teamName = match?.opponent || 'Opposition'
    const isOwn = eventIsOwn(event)
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

      case 'free_short_pass':
        return isOwn
          ? `${playerName} played a free short in ${area}`
          : `${teamName} played a free short in ${area}`

      case 'free_high_ball':
        return isOwn
          ? `${playerName} played a free long/high into ${area}`
          : `${teamName} played a free long/high into ${area}`

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
        if (event.notes === 'block_recovery') {
          const oppName = isOwn ? (match?.opponent || 'Opposition') : clubName
          return `${oppName} recovered the ball after a block ${area}`
        }
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

      case 'own_kickout_sideline':
        return 'Our kickout went over the sideline'
      case 'opp_kickout_sideline':
        return `${teamName} kickout went over the sideline`
      case 'sideline_ball':
        return `Sideline ball ${area}`

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
    // Check if there's a pending 45 waiting for its line position
    if (pendingFortyFivePosition) {
      const pending = pendingFortyFivePosition
      setPendingFortyFivePosition(null)
      try {
        await recordFortyFiveAtPosition(pending, newPosition)
      } catch (err) {
        console.error('45 recording failed in handleBallMove:', err)
      }
      return
    }

    // Check if there's a pending kickout event waiting for position
    if (pendingKickoutEvent) {
      // Capture and clear immediately — prevents a second pitch tap from firing
      // another kickout record before the async save completes
      const kickout = pendingKickoutEvent
      setPendingKickoutEvent(null)
      console.log('Recording pending kickout at position:', newPosition)
      try {
        await recordKickoutAtPosition(kickout, newPosition)
      } catch (err) {
        console.error('Kickout recording failed in handleBallMove:', err)
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

    // Block ball movement during stoppage (paused) or dead ball (nobody has it)
    if (isStopped || isDeadBall) {
      console.log('Ball movement blocked - stoppage or dead ball in progress')
      return
    }

    // Only record if match is actively in play
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished' || matchPhase === 'half_time') {
      return
    }

    // If there's a pending free kick and user moves ball, update the free position
    // This allows the user to reposition the free kick location (e.g. move outside/inside arc for 2PT/1PT)
    if (pendingFreeKick) {
      // Always stamp the correct team on the position — the team taking the free
      // doesn't change just because the ball moved, and GAAPitch localBallPosition
      // may be stale (useEffect runs async), which would otherwise give us the wrong
      // attacking direction for isIn2PointZone.
      const freeTeam = pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
      const correctedPosition = { ...newPosition, team: freeTeam }
      setPendingFreeKick({ position: correctedPosition })
      setBallPosition(correctedPosition)
      setBallTrail(prev => [...prev.slice(-49), { x: newPosition.x, y: newPosition.y }])
      return  // Don't record a possession event during a dead-ball free kick
    }

    // If there's a pending 45 and user moves ball, cancel it
    if (pending45) {
      console.log('Ball moved - cancelling pending 45')
      setPending45(null)
    }

    // Update local ball position
    setBallPosition(newPosition)
    setBallTrail(prev => [...prev.slice(-49), { x: newPosition.x, y: newPosition.y }])

    // Don't record possession during dead ball (awaiting kickout)
    if (awaitingKickout) return

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
    if (!matchId || matchPhase === 'not_started' || matchPhase === 'finished' || isStopped || isDeadBall) return
    // Dead-ball restarts in progress — a free kick being repositioned, a
    // kickout whose landing spot hasn't been tapped yet, or a 45 whose line
    // position hasn't been tapped yet — aren't open play, and shouldn't tick
    // possession in either team's favour while waiting. handleBallMove
    // already skips recording for the single tap/drag-release that resolves
    // each of these; this is the equivalent guard for the continuous drag
    // itself (a genuinely separate code path, bulk-recording waypoints as
    // they happen, that handleBallMove's own guards never reach).
    if (pendingFreeKick || pendingKickoutEvent || pendingFortyFivePosition) return
    const team = ballPosition.team === PossessionTeam.OWN ? 'own' : 'opponent'
    api.possession.bulkCreate({
      match_id: matchId,
      team: team as 'own' | 'opponent',
      minute,
      waypoints,
    }).then(res => {
      console.log(`Drag path: ${res.created} waypoints recorded`)
      invalidateStats()
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
    kickout: { eventType: EventType; isHomeTeam: boolean; playerId?: string; targetPlayerId?: string },
    position: BallPosition
  ) => {
    if (!matchId) return

    try {
      const backendEventType = mapEventTypeToBackend(kickout.eventType)

      console.log('Recording kickout at position:', {
        eventType: kickout.eventType,
        backendType: backendEventType,
        position,
        playerId: kickout.playerId,
        targetPlayerId: kickout.targetPlayerId,
      })

      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: kickout.playerId,
        kickout_target_player_id: kickout.targetPlayerId,
        event_type: backendEventType,
        minute: minute,
        half: currentHalf,
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: kickout.isHomeTeam,
        notes: undefined
      })

      // Determine who won the kickout based on event type.
      // Sideline is its own case, not a "who won it" contest — the kicking
      // team always loses possession (matches the OWN_KICKOUT_SIDELINE /
      // OPP_KICKOUT_SIDELINE model comment). Checked first: eventTypeStr for
      // a sideline event contains neither "_WON" nor "OPPOSITION_WON", so it
      // used to fall through to the generic branch below and always resolve
      // to OPPONENT regardless of which team actually kicked it out — right
      // for OWN_KICKOUT_SIDELINE by coincidence, wrong for OPP_KICKOUT_SIDELINE.
      const eventTypeStr = String(kickout.eventType).toUpperCase()
      let newTeam: PossessionTeam
      if (eventTypeStr.includes('KICKOUT_SIDELINE')) {
        newTeam = eventTypeStr.startsWith('OWN_') ? PossessionTeam.OPPONENT : PossessionTeam.OWN
      } else {
        const isTeamWon = eventTypeStr.includes('_WON') && !eventTypeStr.includes('OPPOSITION_WON')
        newTeam = isTeamWon ? PossessionTeam.OWN : PossessionTeam.OPPONENT
      }

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
          team: newTeam === PossessionTeam.OWN ? 'home' : 'away',
          timestamp: new Date(),
          minute: minute,
          half: currentHalf
        })
        console.log('Kickout possession recorded:', newTeam === PossessionTeam.OWN ? 'Own team' : 'Opposition')
      } catch (error) {
        console.error('Failed to record kickout possession:', error)
      }

      // Track for tutorial
      setLastEventType(String(kickout.eventType).toLowerCase())

      // Clear pending kickout
      setPendingKickoutEvent(null)
      setAwaitingKickout(false)

      // Switch to scoring tab after kickout resolved
      setActiveKickoutTab('scoring')

      // Force refetch stats
      await invalidateStats()

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
      'tackle_won': 'tackle_won',          // We won via a tackle specifically
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

      // Kickout over sideline
      'own_kickout_sideline': 'own_kickout_sideline',
      'opp_kickout_sideline': 'opp_kickout_sideline',

      // Sideline ball (general — ball out of play)
      'sideline_ball': 'sideline_ball',

      // Frees
      'point_free': 'point_free',
      'two_point_free': 'two_point_free',
      'wide_free': 'wide_free',
      'free_short_pass': 'free_short_pass',
      'free_high_ball': 'free_high_ball',

      // 45s (ball went wide off defender)
      'forty_five': 'forty_five',  // 45 scored - always 1 point
      'forty_five_missed': 'forty_five_missed',  // 45 missed

      // Penalties
      'penalty_goal': 'penalty_goal',
      'penalty_miss': 'penalty_miss',
    }

    return mapping[eventLower] || eventLower  // Fallback to original if no mapping
  }

  // Shared close/skip handler for the player selection modal.
  // For kickout events: proceed to pitch-position step with no player.
  // For foul player selection: record the foul without a player, then proceed to free kick step.
  // For all other own-team events: record immediately with no player ("our player").
  const handlePlayerModalClose = () => {
    const event = pendingEvent
    const wasFoulSelect = selectingFoulPlayer
    const foulPosition = ballPosition
    setIsPlayerModalOpen(false)
    setPendingEvent(null)
    setSelectingFoulPlayer(false)
    setPendingFoul(null)

    if (wasFoulSelect && matchId) {
      // Skip player for foul — still record the foul_committed event (player_id = null),
      // then open the free kick options so the possession flow isn't broken.
      setTacticalFoul(false)
      recordEvent.mutateAsync({
        match_id: matchId,
        player_id: undefined,
        event_type: 'foul_committed',
        minute: minute,
        half: currentHalf,
        x_coord: foulPosition.x,
        y_coord: foulPosition.y,
        is_home_team: true,
        notes: undefined,
      }).then(() => {
        void playerMovement.endSegment(foulPosition.x, foulPosition.y, 'foul')
        setPendingFreeKick({ position: foulPosition })
        setBallPosition(prev => ({ ...prev, team: PossessionTeam.OPPONENT }))
      }).catch((error) => {
        console.error('Failed to record foul without player:', error)
        setErrorAlert('Failed to record foul. Please try again.')
      })
      return
    }

    if (event) {
      const eventTypeStr = String(event.eventType).toUpperCase()
      const isKickoutEvent = eventTypeStr.includes('KICKOUT') || eventTypeStr.includes('BREAK')
      if (isKickoutEvent) {
        // Proceed to pitch-position selection with no player assigned
        setPendingKickoutEvent({
          eventType: event.eventType,
          isHomeTeam: event.team === 'own',
          playerId: undefined,
        })
        setAwaitingKickout(false)
      } else {
        // Record the event without a player — shows "our player" in description
        recordEventWithoutPlayer(event.eventType, event.team === 'own', event.position)
      }
    }
  }

  // Handle "Foul" button - receives which team committed the foul
  const handleFoulClick = (team: 'own' | 'opponent') => {
    setPendingFoul(team)

    if (team === 'own') {
      // Our team fouled — select which player committed it
      setSelectingFoulPlayer(true)
      setIsPlayerModalOpen(true)
    } else {
      // Opposition fouled — record foul_won event immediately (counts opponent foul in stats)
      void playerMovement.endSegment(ballPosition.x, ballPosition.y, 'foul')
      if (matchId) {
        void offlineMatchEvents.create({
          match_id: matchId,
          event_type: 'foul_won',
          minute,
          half: currentHalf,
          x_coord: ballPosition.x,
          y_coord: ballPosition.y,
          is_home_team: true,
        })
      }
      setPendingFreeKick({ position: ballPosition })
      setBallPosition(prev => ({ ...prev, team: PossessionTeam.OWN }))
    }
  }

  // Handle player selected for foul (our player who committed the foul)
  const handleFoulPlayerSelected = async (player: Player) => {
    if (!matchId) return

    // Show sub-type picker before recording foul
    setSelectingFoulPlayer(false)
    setIsPlayerModalOpen(false)
    setPendingSubType({
      player,
      eventType: 'foul_committed',
      foulMode: true,
      capturedMinute: minute,
      capturedHalf: currentHalf,
      position: ballPosition,
    })
  }

  // Record event after sub-type selection (or skip)
  // Turn a "T/O Lost" reason choice into the matching sub-type picker —
  // Active Dispossession stays a TURNOVER_LOST (forced, no free conceded),
  // Unforced Error becomes the same OUR_UNFORCED_ERROR flow the dedicated
  // button already uses, Offensive Foul becomes a genuine FOUL_COMMITTED
  // (it concedes a free, same as any other foul — foulMode:true gets it
  // the same post-record free-kick handling).
  const handleTurnoverReasonSelected = (reason: TurnoverReason) => {
    if (!pendingTurnoverReason) return
    const { player, capturedMinute, capturedHalf, position } = pendingTurnoverReason
    setPendingTurnoverReason(null)
    const { eventType, foulMode, subtypeOptions } = TURNOVER_REASON_CONFIG[reason]
    setPendingSubType({ player, capturedMinute, capturedHalf, position, eventType, foulMode, subtypeOptions })
  }

  const handleSubTypeSelected = async (subType?: string) => {
    if (!pendingSubType || !matchId) { setPendingSubType(null); return }
    const { player, eventType, foulMode, capturedMinute, capturedHalf, position } = pendingSubType
    setPendingSubType(null)
    const resolvedSubType = foulMode && tacticalFoul ? 'tactical' : subType
    if (foulMode) setTacticalFoul(false)

    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: player?.id,
        event_type: eventType,
        minute: capturedMinute,
        half: capturedHalf,
        x_coord: position.x,
        y_coord: position.y,
        is_home_team: true,
        sub_type: resolvedSubType,
      })
      setLastEventType(eventType)
      await invalidateStats()

      if (foulMode) {
        await playerMovement.endSegment(position.x, position.y, 'foul')
        setPendingFreeKick({ position, player })
        setBallPosition(prev => ({ ...prev, team: PossessionTeam.OPPONENT }))
      } else {
        // Unforced error — opponent gets possession
        setBallPosition({ x: position.x, y: position.y, team: PossessionTeam.OPPONENT })
      }
    } catch {
      setErrorAlert('Failed to record event. Please try again.')
    }
  }

  // Cancel pending free kick — fully reset foul state
  const handleCancelFree = () => {
    setPendingFreeKick(null)
    setPendingFoul(null)
    setSelectingFoulPlayer(false)
    setIsPlayerModalOpen(false)
    console.log('Free kick cancelled, all foul state cleared')
  }

  // Handle "45" button - opens 45 options menu (scored/missed)
  const handle45Click = () => {
    // Snap the ball onto the 45m line right away — the moment "45" is
    // pressed, not only after Scored/Missed is picked — so the user sees
    // immediately where the kick is being placed instead of the ball just
    // sitting wherever it happened to be. Team is whoever currently has
    // possession, same as is45Result derives it later.
    setBallPosition(prev => ({ ...prev, x: compute45LineX(prev.team === PossessionTeam.OWN) }))
    setPending45({ position: ballPosition })
    console.log('45 initiated at position:', ballPosition)
  }

  // Cancel pending 45
  const handleCancel45 = () => {
    setPending45(null)
    console.log('45 cancelled')
  }

  // Cancel a pending 45 that's already past Scored/Missed and just waiting
  // on a pitch tap for its line position.
  const handleCancelFortyFivePosition = () => {
    setPendingFortyFivePosition(null)
    console.log('45 position selection cancelled')
  }

  // Resolve a pending 45 once the line has been tapped. A 45 is always taken
  // from ON the 45m line — the tap only ever decides left/right (y), so x is
  // snapped to the real line rather than trusting whatever the tap's x
  // happened to be. 31/69 on the 0-100 pitch-% scale = 45m in from either
  // goal on a 145m pitch (45/145 * 100 ≈ 31), same geometry ScoringZoneMap
  // uses for its 45m zone divider. Which line depends on which team is
  // actually taking the kick and which end they're currently attacking —
  // pitch_x is a raw screen-relative coordinate (GAAPitch has no notion of
  // "own"/"opponent" goal itself), same as every other pitch-tapped event,
  // so this mirrors the exact ownGoalX/oppGoalX pattern used for kickouts.
  const recordFortyFiveAtPosition = async (
    pending: { eventType: EventType; isHomeTeam: boolean },
    tappedPosition: BallPosition
  ) => {
    const { eventType, isHomeTeam } = pending
    const snappedPosition: BallPosition = {
      x: compute45LineX(isHomeTeam),
      y: tappedPosition.y,
      team: isHomeTeam ? PossessionTeam.OWN : PossessionTeam.OPPONENT,
    }

    if (isHomeTeam) {
      // Own team 45 — ask which player takes it, same as any other own-team free
      setPendingEvent({ eventType, team: 'own', position: snappedPosition })
      setIsPlayerModalOpen(true)
    } else {
      // Opponent 45 — no player to attribute, record directly
      await recordFreeKickResult(eventType, snappedPosition, false)
    }
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

  // Tap a jersey on the optional post-score assist prompt. Fire-and-forget,
  // same as the rest of live recording — clear the UI immediately, PATCH in
  // the background, and don't let a failed request leave the prompt stuck.
  const handleAssistSelect = (assistPlayerId: string) => {
    const assist = pendingAssist
    if (!assist) return
    if (pendingAssistTimeoutRef.current) clearTimeout(pendingAssistTimeoutRef.current)
    setPendingAssist(null)

    // Can't assist your own score
    if (assistPlayerId === assist.scorerId) return

    api.matchEvents.update(assist.eventId, { assist_player_id: assistPlayerId })
      .then(() => flashActionToast('Assist'))
      .catch((error) => console.error('Failed to record assist:', error))
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
      const isHomeTeam = data.team === PossessionTeam.OWN

      // Kickouts don't get recorded immediately — same as the quick-action kickout
      // buttons, they need a pitch position. Hand off to the existing
      // pendingKickoutEvent flow (resolved by the next tap on the pitch in
      // handleBallMove) instead of writing the event here.
      if (String(data.eventType).toUpperCase().includes('KICKOUT')) {
        const eventStr = String(data.eventType).toUpperCase()
        // Sideline is whose kickout it was (OWN_/OPP_ prefix), not a "who
        // won it" contest — kept separate from the _WON/OPPOSITION_WON
        // check below, which doesn't apply to it.
        const isTeamWon = eventStr.includes('_WON') && !eventStr.includes('OPPOSITION_WON')
        const isOppositionWon = eventStr.includes('OPPOSITION_WON')
        const kickoutIsHomeTeam = eventStr.includes('KICKOUT_SIDELINE')
          ? eventStr.startsWith('OWN_')
          : isTeamWon ? true : isOppositionWon ? false : isHomeTeam
        setPendingKickoutEvent({
          eventType: data.eventType,
          isHomeTeam: kickoutIsHomeTeam,
          playerId: data.playerId || undefined,
        })
        setAwaitingKickout(false)
        return
      }

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

        // Update field status for both players.
        // Pass the outgoing player's position_id to the incoming player so
        // their circle appears at the same spot on the pitch selector.
        const outgoingLineupEntry = matchLineup.find(l => l.player_id === data.playerId)
        if (data.playerId) {
          await api.matchLineups.updateFieldStatus(matchId, data.playerId)
        }
        if (data.playerComingOn) {
          await api.matchLineups.updateFieldStatus(matchId, data.playerComingOn, outgoingLineupEntry?.position_id)
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
        // Reload lineup data so carrier strip updates immediately
        const freshLineup = await api.matchLineups.getLineup(matchId)
        setMatchLineup(freshLineup)
        console.log('Lineup saved and reloaded successfully')
      } catch (error) {
        console.error('Failed to save lineup:', error)
      }
    }
  }

  const handleSubstitutionConfirm = async (playerOffId: string, playerOnId: string) => {
    if (!matchId) return
    const playerOff = players.find(p => p.id === playerOffId)
    const playerOn = players.find(p => p.id === playerOnId)
    const outgoing = matchLineup.find(l => l.player_id === playerOffId)

    // Optimistic update — SubstitutionModal now closes the instant this is
    // called rather than waiting for it, so the on-field roster needs to
    // reflect the sub immediately, not after 2 sequential network calls +
    // a full lineup refetch (previously ~1-2s of the modal just sitting
    // there before the coach could get back to recording).
    setMatchLineup(prev => prev.map(l => {
      if (l.player_id === playerOffId) return { ...l, is_on_field: false }
      if (l.player_id === playerOnId) return { ...l, is_on_field: true, position_id: outgoing?.position_id ?? l.position_id }
      return l
    }))

    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        player_id: playerOffId,
        sub_in_player_id: playerOnId,
        event_type: EventType.SUBSTITUTION,
        minute,
        half: currentHalf,
        x_coord: ballPosition.x,
        y_coord: ballPosition.y,
        is_home_team: true,
        notes: `${playerOff?.name ?? 'Player'} off, ${playerOn?.name ?? 'Player'} on`,
      })
      await Promise.all([
        api.matchLineups.updateFieldStatus(matchId, playerOffId),
        api.matchLineups.updateFieldStatus(matchId, playerOnId, outgoing?.position_id),
      ])
      const refreshed = await api.matchLineups.getLineup(matchId)
      setMatchLineup(refreshed)
    } catch (err) {
      // Optimistic update above already reflects the sub — a background
      // sync failure here just means the server-side lineup may lag until
      // the next natural refetch, not worth reverting mid-match over.
      console.error('Failed to sync substitution:', err)
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

  // Single source of truth for "which 45m line" — used to snap the ball
  // there the instant a 45 is selected, to highlight the line, and to snap
  // the final recorded position once tapped. All three call this so they
  // can never drift out of sync with each other again.
  const compute45LineX = (isHomeTeam: boolean): number => {
    const kickingTeamAttacksRight = isHomeTeam ? teamAttackingRight : !teamAttackingRight
    return kickingTeamAttacksRight ? 66 : 34
  }

  const handleQuickAction = (eventType: EventType) => {
    console.log('[QuickAction] event:', eventType, 'ballPos:', JSON.stringify(ballPosition), 'possession:', ballPosition.team)

    // Check if this is a free kick result or 45 result
    const eventStr = String(eventType).toUpperCase()
    // SHORT during a pending free kick = "free dropped short" (same flow as WIDE_FREE etc.)
    const isFreeKickResult = eventStr.includes('FREE') || (eventType === EventType.SHORT && !!pendingFreeKick)
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

    if (eventStr.includes('KICKOUT_SIDELINE')) {
      // Whose kickout it was (OWN_/OPP_ prefix), not a "who won it" contest —
      // this used to fall into the isOppositionWon bucket below, which made
      // OWN_KICKOUT_SIDELINE record as an opponent event and set the wrong
      // possession outcome later in recordKickoutAtPosition.
      isHomeTeam = eventStr.startsWith('OWN_')
    } else if (isTeamWon) {
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
    } else if (isFreeKickResult) {
      isHomeTeam = isTeamTakingFree
    } else if (is45Result) {
      // 45 is awarded to whichever team was attacking (had possession)
      isHomeTeam = actionPosition.team === PossessionTeam.OWN
    } else {
      // No prefix (GOAL, POINT, WIDE) = use POSSESSION
      isHomeTeam = actionPosition.team === PossessionTeam.OWN
    }

    console.log('[QuickAction] DETERMINED isHomeTeam:', isHomeTeam, 'for event:', eventType, 'actionPosition.team:', actionPosition.team)

    // Events that don't require player selection
    // Only "Opposition Won" events and opponent errors (we don't track their players)
    const noPlayerNeeded = [
      EventType.OWN_KICKOUT_OPPOSITION_WON,
      EventType.OPP_KICKOUT_OPPOSITION_WON,
      EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
      EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
      EventType.OWN_KICKOUT_SIDELINE,
      EventType.OPP_KICKOUT_SIDELINE,
      EventType.SIDELINE_BALL,
      EventType.OPP_UNFORCED_ERROR,  // Opponent's mistake - we don't track their players
    ]

    // Opponent scoring/shooting/interception
    const allOpponentEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.WIDE, EventType.SAVED, EventType.SHORT, EventType.HIT_POST]
    const opponentScoringOnly = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]
    const isOpponentScoring = allOpponentEvents.includes(eventType) && !isHomeTeam
    const isOpponentActualScore = opponentScoringOnly.includes(eventType) && !isHomeTeam
    const isOpponentDefence = (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) && !isHomeTeam
    const oppositionRoster = match?.opposition_roster || []

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
        // Opponent taking the free — if it's a score and we have their roster, let user pick scorer
        const oppScoringFrees = [EventType.POINT_FREE, EventType.TWO_POINT_FREE]
        if (oppScoringFrees.includes(eventType as EventType) && oppositionRoster.length > 0) {
          setPendingOpponentScore({ eventType: eventType as EventType, position: actionPosition, isFreeKick: true })
        } else {
          recordFreeKickResult(eventType, actionPosition, false)
        }
      }
    } else if (is45Result) {
      // A 45 is always taken from the 45m line, not wherever the ball
      // happened to be sitting when "45" was first tapped. Snap the ball
      // marker onto the line right away, at its current left/right — instant
      // visual confirmation of where the kick will be taken from, rather
      // than just a highlighted zone with no marker on it. The user can then
      // tap anywhere on the line to adjust left/right before it's recorded;
      // handleBallMove resolves that tap and does the actual recording.
      setBallPosition(prev => ({ ...prev, x: compute45LineX(isHomeTeam) }))
      setPendingFortyFivePosition({ eventType: eventType as EventType, isHomeTeam })
    } else if (isOpponentActualScore && oppositionRoster.length > 0) {
      // Opponent scored and we have a roster — show opposition scorer strip
      setPendingOpponentScore({ eventType, position: actionPosition })
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
  const recordFreeKickResult = async (eventType: EventType, position: BallPosition, isTeamTakingFree: boolean, player?: Player, scorerName?: string) => {
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
        notes: scorerName ? `Scored by ${scorerName}` : undefined
      })

      // Track for tutorial
      setLastEventType(String(eventType).toLowerCase())

      // Free kick scores, misses, and 45 outcomes all result in kickout
      const scoringFrees = [EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]
      const isScore = scoringFrees.includes(eventType)
      const isWide = eventType === EventType.WIDE_FREE || eventType === EventType.FORTY_FIVE_MISSED

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
      await invalidateStats()

      console.log('Free kick result recorded successfully')
    } catch (error) {
      console.error('Failed to record free kick result:', error)
      setErrorAlert('Failed to record free kick. Please try again.')
    }
  }

  const recordEventWithoutPlayer = async (eventType: EventType, isHomeTeam: boolean, position: BallPosition = ballPosition, opponentPlayerName?: string) => {
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

    // Ignore a repeat of the exact same tap within the debounce window, and
    // give instant confirmation regardless of how long the network call takes.
    const actionKey = `${eventType}:${isHomeTeam ? 'own' : 'opp'}`
    if (!shouldProceedWithQuickAction(actionKey)) return
    flashActionToast(formatActionLabel(String(eventType)))

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
        notes: undefined,
        opponent_player_name: opponentPlayerName,
      })

      // Track for tutorial
      setLastEventType(String(eventType).toLowerCase())

      // Block recovery prompt — ask who recovered the ball
      if (eventType === EventType.BLOCK) {
        setPendingBlockRecovery({ position })
        return // Don't auto-switch tabs — wait for recovery decision
      }

      // Sideline ball prompt — ask who's in possession, rather than
      // inferring it from whichever team the ball happened to be marked as
      // when the button was pressed (a 50/50 contested ball or a
      // deliberate defensive clearance can go either way regardless of
      // that).
      if (eventType === EventType.SIDELINE_BALL) {
        setPendingSidelineDecision({ position })
        return
      }

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
      await invalidateStats()

      console.log('Event recorded without player selection')
    } catch (error) {
      console.error('Failed to record event:', error)
      setErrorAlert('Failed to record event. Please try again.')
    }
  }

  // Reset match events and restart
  const handleResetMatch = async () => {
    if (!matchId) return
    setResetting(true)
    try {
      await api.matchEvents.resetMatch(matchId)
      // Clear offline state (timer, ball position, etc.)
      const { deleteMatchState } = await import('@/services/offline')
      await deleteMatchState(matchId)
      // Clear local state
      queryClient.invalidateQueries({ queryKey: ['matches', matchId] })
      invalidateStats()
      queryClient.invalidateQueries({ queryKey: ['matchEvents', matchId] })
      setShowResetConfirm(false)
      // Reload page to get clean state
      window.location.reload()
    } catch (err) {
      console.error('Failed to reset match:', err)
      setErrorAlert('Failed to reset match events.')
    } finally {
      setResetting(false)
    }
  }

  // Handle block recovery — who got the ball after the block?
  const handleBlockRecovery = async (weRecovered: boolean) => {
    if (!pendingBlockRecovery || !matchId) return
    const pos = pendingBlockRecovery.position

    if (!weRecovered) {
      // They recovered → turnover lost for us
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        await fetch(`${baseUrl}/match-events/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            match_id: matchId,
            event_type: 'turnover_lost',
            team: 'own',
            minute: Math.min(minute, 120),
            pitch_x: pos.x,
            pitch_y: pos.y,
            notes: 'block_recovery',
          }),
        })
      } catch { /* best effort */ }
      // Swap possession to opponent
      setBallPosition(prev => ({ ...prev, team: PossessionTeam.OPPONENT }))
    } else {
      // We recovered → possession comes to us (block = we stopped their attack)
      setBallPosition(prev => ({ ...prev, team: PossessionTeam.OWN }))
    }
    setPendingBlockRecovery(null)
  }

  // Block deflected out over the sideline — not a clean recovery either way.
  // Records the sideline_ball event at the block's own position (same as a
  // normal sideline-ball tap would), then hands off to the same "who's in
  // possession now" decision every sideline ball goes through.
  const handleBlockResultSideline = async () => {
    if (!pendingBlockRecovery || !matchId) return
    const pos = pendingBlockRecovery.position
    setPendingBlockRecovery(null)
    try {
      await recordEvent.mutateAsync({
        match_id: matchId,
        event_type: mapEventTypeToBackend(EventType.SIDELINE_BALL),
        minute,
        half: currentHalf,
        x_coord: pos.x,
        y_coord: pos.y,
        is_home_team: pos.team === PossessionTeam.OWN,
      })
      setLastEventType(String(EventType.SIDELINE_BALL).toLowerCase())
    } catch (err) {
      console.error('Failed to record sideline ball after block:', err)
    }
    setPendingSidelineDecision({ position: pos })
  }

  // Block deflected behind the end line for a 45 — awarded to whoever was
  // actually attacking (shooting) when the block happened, which is exactly
  // what pendingBlockRecovery.position.team already holds (the ball's team
  // at block time, untouched by the block itself). Hands off directly into
  // the normal 45 flow (Scored/Missed, then tap the line) — handleQuickAction
  // reads that same position.team to work out who the 45 belongs to.
  const handleBlockResultFortyFive = () => {
    if (!pendingBlockRecovery) return
    const pos = pendingBlockRecovery.position
    setPendingBlockRecovery(null)
    // Snap the ball onto the 45m line immediately, same as tapping "45"
    // from the Shooting tab does — don't leave it sitting at the block spot.
    setBallPosition(prev => ({ ...prev, x: compute45LineX(pos.team === PossessionTeam.OWN) }))
    setPending45({ position: pos })
  }

  // Handle sideline ball decision — who's in possession now?
  const handleSidelineDecision = async (weWonIt: boolean) => {
    if (!pendingSidelineDecision || !matchId) return
    setBallPosition(prev => ({ ...prev, team: weWonIt ? PossessionTeam.OWN : PossessionTeam.OPPONENT }))
    try {
      await recordPossession.mutateAsync({
        match_id: matchId,
        x_coord: pendingSidelineDecision.position.x,
        y_coord: pendingSidelineDecision.position.y,
        team: weWonIt ? 'home' : 'away',
        timestamp: new Date(),
        minute: minute,
        half: currentHalf,
      })
    } catch (error) {
      console.error('Failed to record possession after sideline ball:', error)
    }
    setPendingSidelineDecision(null)
  }

  // Handle opposition scorer selection
  const handleOpponentScorerSelect = (name: string) => {
    if (!pendingOpponentScore) return
    const { eventType, position, isFreeKick } = pendingOpponentScore
    setPendingOpponentScore(null)
    if (isFreeKick) {
      recordFreeKickResult(eventType, position, false, undefined, name)
    } else {
      recordEventWithoutPlayer(eventType, false, position, name)
    }
  }

  const handleOpponentScorerSkip = () => {
    if (!pendingOpponentScore) return
    const { eventType, position, isFreeKick } = pendingOpponentScore
    setPendingOpponentScore(null)
    if (isFreeKick) {
      recordFreeKickResult(eventType, position, false)
    } else {
      recordEventWithoutPlayer(eventType, false, position)
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

    // Show sub-type picker for unforced errors before recording
    if (event.eventType === EventType.OUR_UNFORCED_ERROR) {
      setPendingSubType({
        player,
        eventType: 'unforced_error',
        foulMode: false,
        subtypeOptions: UNFORCED_ERROR_SUBTYPES,
        capturedMinute,
        capturedHalf,
        position: event.position,
      })
      return
    }

    // "T/O Lost" — ask WHY before recording anything, rather than always
    // logging a bare TURNOVER_LOST. See the reason picker render + its
    // handlers below for what each of the three choices actually records.
    if (event.eventType === EventType.TURNOVER_LOST) {
      setPendingTurnoverReason({
        player,
        capturedMinute,
        capturedHalf,
        position: event.position,
      })
      return
    }

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

    // Own team made the block — record it (this path was previously a dead end:
    // it set up the recovery prompt but never actually persisted the block event,
    // so player/team selected here was silently discarded and the block never
    // appeared anywhere). Then prompt who recovered.
    if (event.eventType === EventType.BLOCK) {
      try {
        await recordEvent.mutateAsync({
          match_id: matchId,
          player_id: player.id,
          event_type: mapEventTypeToBackend(event.eventType),
          minute: capturedMinute,
          half: capturedHalf,
          x_coord: event.position.x,
          y_coord: event.position.y,
          is_home_team: true,
        })
      } catch (err) {
        console.error('Failed to record block event:', err)
      }
      setLastEventType(String(event.eventType).toLowerCase())
      setPendingBlockRecovery({ position: event.position })
      return // Wait for recovery decision
    }

    // Apply immediate UI state changes (ball position, tabs, kickout lock)
    const scoringEvents = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT, EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE, EventType.PENALTY_GOAL]
    const isScore = scoringEvents.includes(event.eventType as EventType)

    // Guard against logging the same score twice — confirmed live on
    // 2026-08-17 (twice in one match): a score is tapped, the recorder isn't
    // fully sure it registered (no strong confirmation before this point),
    // and the same player/event/minute gets logged again minutes later as a
    // genuinely separate action, not a rapid double-tap a debounce would
    // catch. Both real duplicates that night matched on player + event type
    // + exact same minute, so that's the check — a confirm, not a hard
    // block, since a genuine same-minute brace is rare but possible.
    if (isScore) {
      const backendType = mapEventTypeToBackend(event.eventType)
      const alreadyLogged = allEvents.some((e: any) =>
        e.player_id === player.id &&
        e.event_type === backendType &&
        e.minute === capturedMinute
      )
      if (alreadyLogged) {
        const label = String(event.eventType).toLowerCase().replace(/_/g, ' ')
        const confirmed = window.confirm(
          `${player.name} already has a ${label} logged at minute ${capturedMinute}. Log another one?`
        )
        if (!confirmed) return
      }
    }
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

    // Auto-change possession for turnover events, shots that drop short, saved shots, and hit post
    const turnoverEventStr = String(event.eventType).toUpperCase()
    let possessionPayload: { x: number; y: number; team: PossessionTeam } | null = null

    if (turnoverEventStr.includes('TURNOVER') || turnoverEventStr.includes('UNFORCED_ERROR') || turnoverEventStr.includes('SHORT') || turnoverEventStr.includes('SAVED') || turnoverEventStr === 'HIT_POST' || turnoverEventStr === 'INTERCEPTION' || turnoverEventStr === 'TACKLE_WON') {
      let newTeam: PossessionTeam
      let newX = event.position.x
      let newY = event.position.y

      if (turnoverEventStr === 'INTERCEPTION') {
        // Interception → the intercepting team gets possession
        newTeam = event.team === 'own' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
      } else if (turnoverEventStr === 'TACKLE_WON') {
        // Tackle won by own team → own team gets possession
        newTeam = PossessionTeam.OWN
      } else if (turnoverEventStr.includes('TURNOVER_WON')) {
        newTeam = PossessionTeam.OWN
      } else if (turnoverEventStr.includes('TURNOVER_LOST')) {
        newTeam = PossessionTeam.OPPONENT
      } else if (turnoverEventStr.includes('SAVED') || turnoverEventStr === 'HIT_POST') {
        // Save or post → ball goes to defending goalkeeper
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

    // Assist prompting only applies to own-team GOAL/POINT/TWO_POINT — matches
    // the backend's own validator (assist_player_id is rejected on any other
    // event type), so there's no point offering it elsewhere.
    const assistEligible = event.team === 'own' &&
      [EventType.GOAL, EventType.POINT, EventType.TWO_POINT].includes(event.eventType as EventType)

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
    }).then((result) => {
      invalidateStats()
      setLastEventType(String(event.eventType).toLowerCase())
      console.log('Event recorded successfully!')

      if (assistEligible && result?.id) {
        if (pendingAssistTimeoutRef.current) clearTimeout(pendingAssistTimeoutRef.current)
        setPendingAssist({ eventId: String(result.id), scorerId: player.id, scorerName: player.name })
        pendingAssistTimeoutRef.current = setTimeout(() => setPendingAssist(null), PENDING_ASSIST_TIMEOUT_MS)
      }
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
      setMinute(match?.half_duration_mins || 30)
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
    setHalfTimeInsightLoading(true)
    try {
      const insight = await api.liveInsights.triggerHalfTime(matchId)
      setHalfTimeInsight(insight)
      setInsightRefresh(prev => prev + 1)
      console.log('Half-time insight triggered')
    } catch (error) {
      console.error('Failed to trigger half-time insight:', error)
    } finally {
      setHalfTimeInsightLoading(false)
    }
  }

  const endMatch = async () => {
    if (!matchId) return

    try {
      await completeMatch.mutateAsync(matchId)
      setMatchPhase('finished')
      await clearSavedState()
      navigate(`/results/${matchId}`)
    } catch (error) {
      console.error('Failed to end match:', error)
      setErrorAlert('Failed to end match. Please try again.')
    }
  }

  const getEndButtonText = () => {
    const hdm = match?.half_duration_mins || 30
    if (matchPhase === 'first_half') return minute >= hdm ? 'Half Time' : 'End Half'
    if (matchPhase === 'second_half') {
      return fullTimeReached ? 'Full Time' : 'End Match'
    }
    return null
  }

  const isEndButtonEnabled = () => {
    if (matchPhase === 'first_half') return true
    if (matchPhase === 'second_half') return true
    return false
  }

  const getPhaseButtonText = () => {
    if (matchPhase === 'not_started') return 'Start Match'
    if (matchPhase === 'half_time') return 'Start 2nd Half'
    return null
  }

  const formatTime = () => {
    const hdm = match?.half_duration_mins || 30
    const fullTime = hdm * 2
    // Injury time format: "35 (+1:32)" for first half, "70 (+2:15)" for second half
    if (matchPhase === 'first_half' && minute >= hdm) {
      const injuryMin = minute - hdm
      return `${hdm} (+${injuryMin}:${seconds.toString().padStart(2, '0')})`
    }
    if (matchPhase === 'second_half' && minute >= fullTime) {
      const injuryMin = minute - fullTime
      return `${fullTime} (+${injuryMin}:${seconds.toString().padStart(2, '0')})`
    }
    return `${minute}:${seconds.toString().padStart(2, '0')}`
  }

  // Toggle stoppage — persists state to backend so refresh doesn't lose it
  const handleToggleStoppage = async () => {
    if (!matchId) {
      setIsStopped(prev => !prev)
      return
    }
    const elapsed = minute * 60 + seconds
    if (!isStopped) {
      // Pause: freeze timer and persist stopped phase + elapsed to DB
      setIsStopped(true)
      const halfStr = currentHalf === 1 ? 'first_half' : 'second_half'
      const phaseStr = `stopped_${halfStr}:${elapsed}`
      // Optimistically update cache so match data effect sees stopped state immediately
      queryClient.setQueryData(['matches', matchId], (old: any) =>
        old ? { ...old, current_phase: phaseStr } : old
      )
      try {
        await api.matches.update(matchId, {
          current_phase: phaseStr,
        } as any)
      } catch (err) {
        console.error('Failed to persist stoppage:', err)
      }
    } else {
      // Resume: adjust the START TIMESTAMP FOR THE CURRENT HALF to account for
      // stoppage duration, restore running phase. Must target started_at in the
      // first half but second_half_started_at in the second half — the resync
      // effect derives elapsed time from second_half_started_at once in the
      // second half, so writing started_at there would silently do nothing and
      // the clock would jump back to its pre-stoppage value on next resync.
      setIsStopped(false)
      const halfStr = currentHalf === 1 ? 'first_half' : 'second_half'
      // Second half elapsed is measured from second_half_started_at alone (see
      // the resync effect: `mins = 30 + elapsed since second_half_started_at`),
      // so the timestamp only needs to encode time-into-the-half, not hdm + that.
      const hdm = match?.half_duration_mins || 30
      const elapsedForTimestamp = currentHalf === 2 ? Math.max(0, elapsed - hdm * 60) : elapsed
      const newStartedAt = new Date(Date.now() - elapsedForTimestamp * 1000).toISOString()
      const startedAtField = currentHalf === 1 ? 'started_at' : 'second_half_started_at'
      // Optimistically update cache so a concurrent refetch doesn't re-trigger stopped detection
      queryClient.setQueryData(['matches', matchId], (old: any) =>
        old ? { ...old, current_phase: halfStr, [startedAtField]: newStartedAt } : old
      )
      try {
        await api.matches.update(matchId, {
          current_phase: halfStr,
          [startedAtField]: newStartedAt,
        } as any)
      } catch (err) {
        console.error('Failed to persist resume:', err)
      }
    }
  }

  // Toggle dead ball — ball isn't anyone's possession, but unlike Stoppage the
  // clock keeps running (matches real GAA club-match timekeeping). Nothing to
  // persist server-side since it never touches the timer.
  const handleToggleDeadBall = () => {
    setIsDeadBall(prev => !prev)
  }

  // Manually correct the match clock. Branches on whether the clock is
  // currently frozen (isStopped) or running, and which half we're in, mirroring
  // handleToggleStoppage's approach to keeping the server's timer source of
  // truth (current_phase checkpoint, or started_at/second_half_started_at)
  // consistent with what's shown on screen.
  const handleManualClockEdit = async (newMinute: number, newSeconds: number) => {
    if (!matchId) return
    const targetTotal = newMinute * 60 + newSeconds
    setMinute(newMinute)
    setSeconds(newSeconds)
    setIsClockEditorOpen(false)

    const halfStr = currentHalf === 1 ? 'first_half' : 'second_half'

    if (isStopped) {
      // Clock is frozen — just rewrite the checkpoint the server holds.
      const phaseStr = `stopped_${halfStr}:${targetTotal}`
      queryClient.setQueryData(['matches', matchId], (old: any) =>
        old ? { ...old, current_phase: phaseStr } : old
      )
      try {
        await api.matches.update(matchId, { current_phase: phaseStr } as any)
      } catch (err) {
        console.error('Failed to persist manual clock edit:', err)
      }
      return
    }

    // Clock is running — shift the relevant start timestamp so elapsed-time
    // derivation lands on the target value (same trick as resume-from-stoppage).
    const hdm = match?.half_duration_mins || 30
    const elapsedForTimestamp = currentHalf === 2 ? Math.max(0, targetTotal - hdm * 60) : targetTotal
    const newStartedAt = new Date(Date.now() - elapsedForTimestamp * 1000).toISOString()
    const startedAtField = currentHalf === 1 ? 'started_at' : 'second_half_started_at'
    queryClient.setQueryData(['matches', matchId], (old: any) =>
      old ? { ...old, [startedAtField]: newStartedAt } : old
    )
    try {
      await api.matches.update(matchId, { [startedAtField]: newStartedAt } as any)
    } catch (err) {
      console.error('Failed to persist manual clock edit:', err)
    }
  }

  // Dynamic status label — shows what's currently being tracked
  const getStatusLabel = (): { text: string; subtext: string; bg: string; accent: string } => {
    if (matchPhase === 'not_started') {
      return { text: 'Match not started', subtext: 'Select lineup and start first half', bg: 'from-slate-600/20 to-slate-700/20 border-white/10', accent: 'text-white/50' }
    }
    if (matchPhase === 'half_time') {
      return { text: 'Half Time', subtext: 'Tap "Start 2nd Half" to continue', bg: 'from-emerald-600/20 to-cyan-600/20 border-emerald-500/40', accent: 'text-emerald-400' }
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

    // GAA pitch zones mapped to % (145m pitch):
    // 13m = 9%, 20m = 14%, 45m = 31%, midfield = 50%, 40m arc = 72%
    let text: string
    if (isOwn) {
      if (attackingProgress >= 91) text = `${displayName} inside the 13m line${side}`
      else if (attackingProgress >= 86) text = `${displayName} inside the 20m line${side}`
      else if (attackingProgress >= 72) text = `${displayName} inside the 40m arc${side}`
      else if (attackingProgress >= 69) text = `${displayName} inside the 45m line${side}`
      else if (attackingProgress >= 50) text = `${displayName} past midfield${side}`
      else if (attackingProgress >= 31) text = `${displayName} in their own half${side}`
      else if (attackingProgress >= 14) text = `${displayName} inside own 45m line${side}`
      else if (attackingProgress >= 9) text = `${displayName} inside own 20m line${side}`
      else text = `${displayName} inside own 13m line${side}`
    } else {
      if (attackingProgress <= 9) text = `${teamName} inside our 13m line${side}`
      else if (attackingProgress <= 14) text = `${teamName} inside our 20m line${side}`
      else if (attackingProgress <= 28) text = `${teamName} inside our 40m arc${side}`
      else if (attackingProgress <= 31) text = `${teamName} inside our 45m line${side}`
      else if (attackingProgress <= 50) text = `${teamName} in our half${side}`
      else if (attackingProgress <= 69) text = `${teamName} past midfield${side}`
      else if (attackingProgress <= 86) text = `${teamName} inside their 45m line${side}`
      else if (attackingProgress <= 91) text = `${teamName} inside their 20m line${side}`
      else text = `${teamName} inside their 13m line${side}`
    }

    const bg = isOwn
      ? 'from-emerald-600/20 to-blue-600/20 border-emerald-500/40'
      : 'from-orange-600/10 to-white/5 border-orange-500/30'
    const accent = isOwn ? 'text-emerald-400' : 'text-orange-300'

    return { text, subtext: '', bg, accent }
  }

  const statusLabel = getStatusLabel()

  // True while the pending kickout is specifically "went out over the
  // sideline" — the pitch needs to highlight the touchlines themselves so
  // the tappable strip isn't hidden/guessed at, unlike a normal kickout
  // landing spot which can be anywhere on the pitch.
  const sidelineTapPending = !!pendingKickoutEvent &&
    String(pendingKickoutEvent.eventType).toLowerCase().includes('kickout_sideline')

  // Which 45m line to highlight while pendingFortyFivePosition is waiting on
  // a tap — same geometry as recordFortyFiveAtPosition, kept in sync so the
  // highlighted line and the actually-recorded position always agree.
  const fortyFiveLineX = pendingFortyFivePosition
    ? compute45LineX(pendingFortyFivePosition.isHomeTeam)
    : null

  // On a score, highlight the last tracked ball carrier in the scorer-select
  // UI as a hint (they're the likeliest scorer) — never a lock, any other
  // player is still one tap away. Originally only the scoring outcomes
  // (the backend's assist-eligible types plus frees/45s), which meant a
  // miss — wide, short, saved, hit post — never got the same hint even
  // though "who took the shot" is exactly as answerable from the active
  // carrier for a miss as it is for a score. Broadened to every shot
  // outcome (matches the SHOT_EVENTS set leaderboard_service.py uses) so
  // the hint is consistent across every way a shot can end, not just the
  // ones that go over the bar.
  const SHOT_CARRIER_HINT_TYPES = [
    EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
    EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
    EventType.WIDE, EventType.WIDE_FREE, EventType.SHORT, EventType.SAVED,
    EventType.HIT_POST, EventType.FORTY_FIVE_MISSED,
    EventType.PENALTY_GOAL, EventType.PENALTY_MISS,
  ]
  const suggestedScorerId = pendingEvent && SHOT_CARRIER_HINT_TYPES.includes(pendingEvent.eventType as EventType)
    ? activeCarrierId
    : null

  // Tutorial match state for interactive walkthrough
  const tutorialMatchState = useMemo<TutorialMatchState>(() => ({
    matchPhase,
    ballPosition: { x: ballPosition.x, y: ballPosition.y },
    lastEventType,
    eventCount: allEvents.length,
    isStopped,
    activeCarrierId,
    snapshotCount,
  }), [matchPhase, ballPosition.x, ballPosition.y, lastEventType, allEvents.length, isStopped, activeCarrierId, snapshotCount])

  return (
    <div className="min-h-screen pb-8">
      {/* Instant tap confirmation — fixed so it's visible over both normal and fullscreen pitch */}
      {actionToast && (
        <div
          className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] px-4 py-2 rounded-full text-sm font-bold text-white shadow-lg animate-fade-in pointer-events-none"
          style={{
            background: 'rgba(16,185,129,0.92)',
            boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
          }}
        >
          ✓ {actionToast} logged
        </div>
      )}

      {/* Optional "who assisted?" prompt — fixed page-level so it shows over
          both normal and fullscreen pitch, same as the toast above. Purely
          additive: auto-dismisses on its own timeout, and skipping it has
          zero effect on the already-recorded score. */}
      {pendingAssist && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] animate-fade-in">
          <div
            className="flex items-center gap-2 rounded-2xl px-3 py-2 max-w-[92vw] overflow-x-auto no-scrollbar"
            style={{
              background: 'rgba(15,23,42,0.92)',
              border: '1px solid rgba(6,182,212,0.35)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
            }}
          >
            <span className="text-cyan-300 text-xs font-bold flex-shrink-0">Assist? (optional)</span>
            {jerseyStripPlayers.filter(p => p.isOnField && p.playerId !== pendingAssist.scorerId)
              .sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99)).map(p => (
                <button
                  key={p.playerId}
                  onClick={() => handleAssistSelect(p.playerId)}
                  className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold bg-white/10 text-white/70 hover:bg-cyan-500/30 hover:text-white transition-all"
                >
                  {p.jerseyNumber ?? '?'}
                </button>
              ))}
            <button
              onClick={() => { if (pendingAssistTimeoutRef.current) clearTimeout(pendingAssistTimeoutRef.current); setPendingAssist(null) }}
              className="flex-shrink-0 text-white/40 hover:text-white text-xs px-1.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Loading State - Only on initial load, not refetches */}
      {(matchLoading || statsLoading) && !match && (
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-white text-lg">Loading match data...</div>
        </div>
      )}

      {/* Restored from crash toast */}
      {wasRestored && (
        <div className="mb-4 px-4 py-3 bg-emerald-500/20 border border-emerald-500/40 rounded-lg flex items-center justify-between animate-fade-in">
          <span className="text-emerald-300 text-sm font-medium">
            Restored from previous session — {minute}:{seconds.toString().padStart(2, '0')} {currentHalf === 1 ? '1st Half' : '2nd Half'}
          </span>
          <button onClick={dismissRestore} className="text-emerald-300/60 hover:text-emerald-300 text-xs ml-4">Dismiss</button>
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
                  <p className="text-white/60 text-sm">{match?.competition || 'Match'} - {matchPhase === 'not_started' ? 'Ready' : 'Live'}</p>
                  <NetworkStatusIndicator compact />
                  <button
                    onClick={() => {
                      preTutorialBallRef.current = { ...ballPosition }
                      setTutorialActive(true)
                      setBallPosition({ x: 30, y: 50, team: PossessionTeam.OWN })
                    }}
                    className="p-1 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all"
                    title="Start tutorial"
                  >
                    <HelpCircle size={14} className="text-white/40 hover:text-white/70" />
                  </button>
                  <button
                    data-tour="weather-btn"
                    onClick={() => setIsWeatherPickerOpen(true)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-all cursor-pointer"
                    title="Update weather"
                  >
                    {(() => { const WeatherIcon = getWeatherIcon(weatherConditions[0]); return <WeatherIcon size={13} className={weatherConditions.length > 0 ? 'text-white/70' : 'text-white/40'} />; })()}
                    {weatherConditions.length > 0 && (
                      <span className="text-[10px] text-white/60">
                        {weatherConditions.map(c => getWeatherLabel(c)).join(' + ')}
                      </span>
                    )}
                    {temperatureCelsius !== null && (
                      <span className="text-[10px] text-white/60">{temperatureCelsius}°C</span>
                    )}
                  </button>
                </div>
                {matchPhase !== 'not_started' && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (matchPhase === 'first_half' || matchPhase === 'second_half') {
                          setClockEditorDraft({ minute, seconds })
                          setIsClockEditorOpen(true)
                        }
                      }}
                      disabled={matchPhase !== 'first_half' && matchPhase !== 'second_half'}
                      title={matchPhase === 'first_half' || matchPhase === 'second_half' ? 'Tap to correct the clock' : undefined}
                      className={`inline-flex items-center space-x-3 px-4 py-2 rounded-xl ${
                        isStopped
                          ? 'bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40'
                          : 'bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-500/30 animate-pulse'
                      }`}
                    >
                      {isStopped ? <Pause size={20} className="text-amber-400" /> : <Clock size={20} className="text-emerald-400" />}
                      <span className="font-mono text-2xl font-bold text-white">{formatTime()}</span>
                    </button>
                    {IS_DEV_SPEED && (
                      <span className="px-2 py-1 text-xs font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg">
                        {DEV_SPEED_MULTIPLIER}x
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Center: Score */}
              <div className="flex flex-col items-center justify-center gap-1.5">
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
                {matchPhase === 'half_time' && (
                  <span className="px-3 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold tracking-wider">
                    HALF TIME
                  </span>
                )}
              </div>

              {/* Right: Quick Stats & Actions */}
              <div data-tour="phase-controls" className="flex flex-col items-center md:items-end space-y-2">
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
                      className="glass-card-hover flex items-center space-x-1 !py-1 !px-3 text-sm"
                      onClick={() => setIsLineupModalOpen(true)}
                    >
                      <Users size={14} />
                      <span>Lineup</span>
                    </button>
                  )}
                  {(matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time') && matchLineup.length > 0 && (
                    <>
                      <button
                        className="glass-card-hover flex items-center space-x-1 !py-1 !px-3 text-sm"
                        onClick={() => setIsViewLineupOpen(true)}
                        title="View current on-field lineup"
                      >
                        <Users size={14} />
                        <span>Lineup</span>
                      </button>
                      <button
                        className="glass-card-hover flex items-center space-x-1 !py-1 !px-3 text-sm"
                        onClick={() => setIsSubModalOpen(true)}
                      >
                        <Users size={14} />
                        <span>Sub</span>
                      </button>
                    </>
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
                      title="Manual Event Entry — log something not covered by the quick-action buttons"
                    >
                      <Plus size={14} />
                      <span>Event</span>
                    </button>
                  )}
                  {getEndButtonText() && (
                    <button
                      className={`px-4 py-2 rounded-xl font-medium transition-all text-sm backdrop-blur-md ${
                        !isEndButtonEnabled()
                          ? 'bg-white/10 text-white/40 border border-white/10 cursor-not-allowed'
                          : (fullTimeReached || (matchPhase === 'first_half' && minute >= (match?.half_duration_mins || 30)))
                            ? 'bg-white/15 text-white border border-amber-500/40 shadow-lg shadow-amber-500/10 ring-1 ring-amber-400/30'
                            : 'bg-white/10 text-white/80 border border-white/15 hover:bg-white/15 hover:text-white hover:border-white/25'
                      }`}
                      onClick={matchPhase === 'first_half' ? endFirstHalf : endMatch}
                      disabled={!isEndButtonEnabled()}
                    >
                      {getEndButtonText()}
                    </button>
                  )}
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="p-2 rounded-xl bg-white/5 text-white/30 hover:text-red-400 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 transition-all"
                    title="Reset match events"
                  >
                    <RotateCcw size={14} />
                  </button>
                </div>
              </div>
            </div>

            {/* Scorers — live, updates as events are logged. Lives inside the
                same glass-card as the score (matches MatchResult.tsx's
                layout) — previously this sat in its own block below the
                closed header card, rendering above the pitch as a separate
                floating section instead of inside the scoreline container. */}
            {scorers.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white/10">
                <div className="text-xs text-white/40 font-semibold uppercase tracking-wide mb-2">Scorers</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {scorers.map(s => (
                    <div key={s.playerId} className="text-sm text-white/70 whitespace-nowrap">
                      <span className="text-white font-medium">{s.name}</span>
                      {' '}
                      {s.goals}-{String(s.pointsValue).padStart(2, '0')}
                      {s.twoPointers > 0 && <span className="text-cyan-400/80 text-xs"> (+{s.twoPointers}x2pt)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col md:flex-row gap-6">
            {/* Left column — pitch, action buttons, event map */}
            <div className="flex-[2] min-w-0 space-y-6">
              {/* Half Time Banner */}
              {minute >= (match?.half_duration_mins || 30) && matchPhase === 'first_half' && (
                <div className="backdrop-blur-xl bg-white/5 border border-amber-500/20 rounded-xl px-4 py-3 mb-4">
                  <div className="flex items-center justify-center space-x-2">
                    <Clock size={16} className="text-amber-400" />
                    <p className="text-sm font-medium text-white/90">
                      Injury time — tap "Half Time" when ready
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
                      Full time — tap "Full Time" to save and generate AI analysis
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

              {/* Pitch */}
              <div data-tour="pitch-container" className="glass-card p-6 relative mb-4">
                <GAAPitch
                  ballPosition={ballPosition}
                  onBallMove={handleBallMove}
                  showZones={true}
                  readonly={matchPhase === 'not_started' || matchPhase === 'finished' || matchPhase === 'half_time' || (awaitingKickout && !pendingKickoutEvent) || (!!pendingFreeKick && !isAdjustingFreePosition)}
                  trail={ballTrail}
                  onTrailUpdate={setBallTrail}
                  onDragPath={handleDragPath}
                  onDragUpdate={(pos) => {
                    setBallPosition(pos)
                    setBallTrail(prev => [...prev.slice(-49), { x: pos.x, y: pos.y }])
                  }}
                  carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
                  highlightSidelines={sidelineTapPending}
                  highlight45LineX={fortyFiveLineX}
                  ballAnchoredOverlay={
                    (matchPhase === 'first_half' || matchPhase === 'second_half') && !awaitingKickout && !pendingFreeKick && ballPosition.team === PossessionTeam.OWN
                      ? (ballSvgX, ballSvgY, ballPctX, ballPctY) => (
                        <BallCarrierPicker
                          players={jerseyStripPlayers}
                          activeCarrierId={activeCarrierId}
                          onSelect={handleCarrierSelect}
                          attackingRight={teamAttackingRight}
                          teamPrimaryColor={club?.primary_colour || '#10B981'}
                          teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
                          ballSvgX={ballSvgX}
                          ballSvgY={ballSvgY}
                          ballPctX={ballPctX}
                          ballPctY={ballPctY}
                          recentCarrierIds={recentCarrierIds}
                          onOpenChange={setIsCarrierRadialOpen}
                        />
                      )
                      : undefined
                  }
                  pitchOverlay={
                    (matchPhase === 'first_half' || matchPhase === 'second_half') && !awaitingKickout && !pendingFreeKick && ballPosition.team === PossessionTeam.OWN
                      ? (ballPctX, ballPctY) => (
                        <PitchReceiverDots
                          players={jerseyStripPlayers}
                          activeCarrierId={activeCarrierId}
                          onSelect={handleCarrierSelect}
                          attackingRight={teamAttackingRight}
                          teamPrimaryColor={club?.primary_colour || '#10B981'}
                          teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
                          ballPctX={ballPctX}
                          ballPctY={ballPctY}
                          disabled={isCarrierRadialOpen}
                          recentCarrierIds={recentCarrierIds}
                        />
                      )
                      : undefined
                  }
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
                      </div>
                    ) : undefined
                  }
                />

                {/* Action-required overlay — kickout & free kick */}
                <PitchActionOverlay
                  awaitingKickout={awaitingKickout && !pendingKickoutEvent && !kickoutBannerMinimised}
                  pendingFreeKick={!!pendingFreeKick && !isAdjustingFreePosition}
                  pendingFoul={pendingFoul}
                  kickoutTab={activeKickoutTab}
                  isIn2PointZone={isIn2PointZone(
                    ballPosition.x,
                    ballPosition.y,
                    pendingFreeKick
                      ? (pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
                      : ballPosition.team
                  )}
                  onAction={handleQuickAction}
                  onCancelFree={handleCancelFree}
                  onCancelKickout={handleCancelKickout}
                  onAdjustFreePosition={() => setIsAdjustingFreePosition(true)}
                  onMinimize={() => setKickoutBannerMinimised(true)}
                />

                {/* Opposition scorer selector — centered overlay, same treatment as the
                    kickout/free-kick modal above, since this also blocks the flow until resolved */}
                {pendingOpponentScore && (
                  <OppositionScorerStrip
                    players={match?.opposition_roster || []}
                    onSelect={handleOpponentScorerSelect}
                    onSkip={handleOpponentScorerSkip}
                    eventType={String(pendingOpponentScore.eventType).toLowerCase()}
                  />
                )}

                {/* Adjust Free Position mode — overlay hidden, pitch is draggable */}
                {!!pendingFreeKick && isAdjustingFreePosition && (
                  <div className="absolute inset-x-3 top-3 z-20 animate-fade-in">
                    <div
                      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
                      style={{
                        background: 'linear-gradient(90deg, rgba(6,182,212,0.25), rgba(59,130,246,0.12))',
                        border: '1px solid rgba(6,182,212,0.4)',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
                      }}
                    >
                      <span className="text-cyan-200 text-sm font-semibold">Drag the ball to the free's real spot</span>
                      <button
                        onClick={() => setIsAdjustingFreePosition(false)}
                        className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/35 transition-colors flex-shrink-0"
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}

                {/* Kickout landing strip — floats at the bottom of the pitch
                    card normally, but a sideline kickout needs the user to
                    tap the touchline itself, which sits right where this
                    banner would otherwise cover it — moved to the top for
                    that case instead (same slot the free-kick-adjust banner
                    uses), so both touchlines stay fully tappable. */}
                {!!pendingKickoutEvent && !kickoutBannerMinimised && (
                  <div className={`absolute inset-x-3 z-10 animate-fade-in space-y-1.5 ${sidelineTapPending ? 'top-3' : 'bottom-3'}`}>
                    <div
                      className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
                      style={{
                        background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))',
                        border: '1px solid rgba(245,158,11,0.38)',
                        backdropFilter: 'blur(14px)',
                        WebkitBackdropFilter: 'blur(14px)',
                        boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                        <span className="text-amber-200 text-sm font-bold flex-shrink-0">Tap landing position</span>
                        <span className="text-amber-300/60 text-xs hidden sm:block truncate">tap the pitch to mark where the ball landed</span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button
                          onClick={() => setKickoutBannerMinimised(true)}
                          title="Minimise — log a sub, card, or correction first"
                          className="text-amber-400/60 hover:text-amber-300 p-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                        >
                          <Minus size={13} />
                        </button>
                        <button
                          onClick={handleCancelKickout}
                          className="text-amber-400/60 hover:text-amber-300 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {/* Optional "aimed for" jersey tap — own kickouts only. Purely
                        additive: tapping the pitch above always completes the
                        kickout regardless of whether a target was tapped here. */}
                    {String(pendingKickoutEvent.eventType).toLowerCase().startsWith('own_kickout') && jerseyStripPlayers.filter(p => p.isOnField).length > 0 && (
                      <div
                        className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 overflow-x-auto no-scrollbar"
                        style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
                      >
                        <span className="text-white/40 text-[10px] font-semibold flex-shrink-0 pr-0.5">Aimed for (optional):</span>
                        {jerseyStripPlayers.filter(p => p.isOnField).sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99)).map(p => (
                          <button
                            key={p.playerId}
                            onClick={() => setPendingKickoutEvent(prev => prev ? {
                              ...prev,
                              targetPlayerId: prev.targetPlayerId === p.playerId ? undefined : p.playerId,
                            } : prev)}
                            className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                              pendingKickoutEvent.targetPlayerId === p.playerId
                                ? 'bg-amber-400 text-black scale-110'
                                : 'bg-white/10 text-white/60 hover:bg-white/20'
                            }`}
                          >
                            {p.jerseyNumber ?? '?'}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Pitch control buttons — top-right */}
                {matchPhase !== 'not_started' && matchPhase !== 'finished' && (
                  <div className="absolute top-2 right-2 left-2 z-10 flex items-center justify-end gap-1.5 flex-nowrap overflow-x-auto min-w-0 whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {/* Minimised kickout pill — parked here (not over the pitch)
                        so it never crowds the action buttons below. Tapping it
                        restores the full banner/overlay exactly as it was. */}
                    {kickoutBannerMinimised && (awaitingKickout || !!pendingKickoutEvent) && (
                      <button
                        onClick={() => setKickoutBannerMinimised(false)}
                        className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-500/20 border-2 border-amber-400/40 text-amber-200 hover:bg-amber-500/30 text-xs font-semibold transition-all animate-fade-in"
                        title="Resume the kickout prompt"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
                        <span>Kickout pending</span>
                      </button>
                    )}
                    <button
                      onClick={() => {
                        // Guard first, flip the label-driving state next — both
                        // synchronous — so the "who has it" label updates the
                        // instant this is tapped and a fast double-tap can't
                        // fire the swap twice and flip it back. The carrier
                        // segment close is a side effect, not a prerequisite,
                        // so it runs in the background instead of delaying the
                        // label (see usePlayerMovement/offlineApi — it only
                        // touches IndexedDB, no network round-trip either way).
                        if (!shouldProceedWithQuickAction('possession-swap')) return
                        const newTeam = ballPosition.team === PossessionTeam.OWN ? PossessionTeam.OPPONENT : PossessionTeam.OWN
                        setBallPosition(prev => ({ ...prev, team: newTeam }))
                        if (activeCarrierId) {
                          playerMovement.onPossessionSwap(ballPosition.x, ballPosition.y).catch(err =>
                            console.error('Failed to close carrier segment on possession swap:', err)
                          )
                          setActiveCarrierId(null)
                        }
                      }}
                      className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-white/10 border-2 border-white/20 text-white/70 hover:text-white hover:bg-white/20 text-xs font-semibold transition-all"
                      title="Swap possession — flip which team has the ball"
                    >
                      <ArrowLeftRight size={16} />
                      <span>Possession</span>
                    </button>
                    <button
                      data-tour="stoppage-btn"
                      onClick={handleToggleStoppage}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                        isStopped
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-400'
                          : 'bg-white/10 border-white/20 text-white/70 hover:text-white hover:bg-white/20'
                      }`}
                      title={isStopped ? 'Resume play — clock was frozen' : 'Stoppage — freezes the clock (injury, sideline delay, etc.)'}
                    >
                      {isStopped ? <Play size={16} /> : <Pause size={16} />}
                      <span>{isStopped ? 'Resume' : 'Stoppage'}</span>
                    </button>
                    <button
                      data-tour="dead-ball-btn"
                      onClick={handleToggleDeadBall}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl border-2 text-xs font-semibold transition-all ${
                        isDeadBall
                          ? 'bg-sky-500/20 border-sky-500/40 text-sky-400'
                          : 'bg-white/10 border-white/20 text-white/70 hover:text-white hover:bg-white/20'
                      }`}
                      title={isDeadBall ? 'Ball back in play' : 'Dead ball — clock keeps running (unlike Stoppage)'}
                    >
                      <CircleSlash size={16} />
                      <span>{isDeadBall ? 'Ball Live' : 'Dead Ball'}</span>
                    </button>
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
                      className="flex-shrink-0 p-2.5 rounded-xl bg-white/10 border-2 border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all"
                      title="Fullscreen pitch mode"
                    >
                      <Maximize size={18} />
                    </button>
                    <button
                      onClick={() => setShowHalfTimeView(true)}
                      className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-2 rounded-xl bg-amber-500/15 border-2 border-amber-500/30 text-amber-300 hover:bg-amber-500/25 hover:border-amber-500/50 text-xs font-semibold transition-all"
                      title="Half-Time View — full-screen stats, no pitch. Great for a dressing-room TV."
                    >
                      <LayoutDashboard size={16} />
                      <span>Half-Time View</span>
                    </button>
                  </div>
                )}

                {/* Jersey Number Strip for carrier tracking — bottom-attached
                    overlay inside the pitch card, mirroring the top buttons'
                    technique exactly. Hidden while the kickout-landing-strip
                    banner is showing (also bottom-anchored in this same card,
                    see "Kickout landing strip" above) — at that point you're
                    tapping the landing spot, not picking a carrier, so
                    showing both here would visually collide. */}
                {!pendingOpponentScore && jerseyStripPlayers.length > 0 && matchPhase !== 'not_started' && matchPhase !== 'finished' && !(!!pendingKickoutEvent && !kickoutBannerMinimised) && (
                  <div data-tour="jersey-strip" className="absolute bottom-2 left-2 right-2 z-10">
                    <div className="text-center text-[9px] text-white/40 font-semibold uppercase tracking-wider mb-1">
                      Switch Carrier
                    </div>
                    <JerseyNumberStrip
                      players={jerseyStripPlayers}
                      activeCarrierId={activeCarrierId}
                      currentPossession={ballPosition.team}
                      onCarrierSelect={handleCarrierSelect}
                      teamPrimaryColor={club?.primary_colour || '#10B981'}
                      teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
                      currentHalf={currentHalf}
                      attackingRight={teamAttackingRight}
                      recentCarrierIds={recentCarrierIds}
                    />
                  </div>
                )}

              </div>

              {/* Categorized Action Buttons */}
              <div className="max-w-2xl mx-auto -mt-6">
                <CategorizedActionButtons
                  onActionSelect={handleQuickAction}
                  onFoulClick={handleFoulClick}
                  on45Click={handle45Click}
                  onDiscipline={handleDiscipline}
                  disabled={matchPhase === 'not_started' || matchPhase === 'finished'}
                  activeCategory={activeKickoutTab}
                  onCategoryChange={setActiveKickoutTab}
                  currentPossession={ballPosition.team}
                  isIn2PointZone={isIn2PointZone(
                    ballPosition.x,
                    ballPosition.y,
                    pendingFreeKick
                      ? (pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
                      : ballPosition.team
                  )}
                  isInPenaltyArea={(() => {
                    // Ball is near opponent's goal = inside 13m line
                    const freeTeam = pendingFreeKick
                      ? (pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
                      : ballPosition.team
                    const attackingGoalX = freeTeam === PossessionTeam.OWN
                      ? (teamAttackingRight ? 100 : 0)
                      : (teamAttackingRight ? 0 : 100)
                    return Math.abs(attackingGoalX - ballPosition.x) <= 10.5
                  })()}
                  pendingFreeKick={false}
                  pendingFoul={pendingFoul}
                  pendingBlockRecovery={!!pendingBlockRecovery}
                  onBlockRecovery={handleBlockRecovery}
                  onBlockResultSideline={handleBlockResultSideline}
                  onBlockResultFortyFive={handleBlockResultFortyFive}
                  pendingSidelineDecision={!!pendingSidelineDecision}
                  onSidelineDecision={handleSidelineDecision}
                  pending45={!!pending45}
                  pendingKickoutPosition={!!pendingKickoutEvent}
                  pendingFortyFivePosition={!!pendingFortyFivePosition}
                  awaitingKickout={awaitingKickout && !kickoutBannerMinimised}
                  onCancelFree={handleCancelFree}
                  onCancel45={handleCancel45}
                  onCancelKickout={handleCancelKickout}
                  onCancelFortyFivePosition={handleCancelFortyFivePosition}
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
                      <div className="flex flex-wrap items-center gap-1.5">
                        {/* Half filter */}
                        {(['all', 1, 2] as const).map((h) => (
                          <button
                            key={h}
                            onClick={() => setEventMapHalfFilter(h)}
                            className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-all ${
                              eventMapHalfFilter === h
                                ? 'bg-white/25 text-white'
                                : 'bg-white/8 text-white/40 hover:bg-white/15'
                            }`}
                          >
                            {h === 'all' ? 'All' : h === 1 ? '1st' : '2nd'}
                          </button>
                        ))}
                        <span className="text-white/20 text-xs">·</span>
                        {/* Team filter */}
                        <button
                          onClick={() => setEventMapTeamFilter('all')}
                          className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                            eventMapTeamFilter === 'all'
                              ? 'bg-cyan-600 text-white'
                              : 'bg-white/10 text-white/60 hover:bg-white/20'
                          }`}
                        >
                          All
                        </button>
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
                      <span className="ml-1 text-white/25">— tap event to see details</span>
                    </div>
                    <GAAPitch readonly={true} events={filteredMapEvents} showZones={true} />
                  </div>
                  <EventFilterToggles activeFilters={eventMapFilters} onToggle={setEventMapFilters} />
                  <EventMapLegend />
                </div>
              )}

              {!showHalfTimeView && matchInsightsCharts}
            </div>

            {/* Live Stats Sidebar */}
            <div className="flex-1 min-w-0 flex flex-col gap-4 overflow-hidden">
              {/* AI Live Insights */}
              <LiveInsightDisplay
                matchId={matchId}
                minute={minute}
                half={currentHalf}
                isMatchActive={matchPhase === 'first_half' || matchPhase === 'second_half' || matchPhase === 'half_time'}
                isStopped={isStopped}
                refreshTrigger={insightRefresh}
                externalLoading={halfTimeInsightLoading}
                externalInsight={halfTimeInsight}
              />

              {/* Match Statistics */}
              {matchStatsPanel}

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
                        const isOwn = eventIsOwn(event)

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
                              onClick={() => handleEditEventClick(event.id)}
                              className="flex-shrink-0 text-white/40 hover:text-blue-400 transition-colors p-1"
                              title="Edit Event"
                            >
                              <Pencil size={14} />
                            </button>
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
      {/* Also renders for event-player edits (editingEventId set) */}
      {(pendingEvent || selectingFoulPlayer || editingEventId !== null) && (
        editingEventId !== null ? (
          // Edit mode — pitch selector when lineup exists, list modal otherwise
          lineupLoaded && matchLineup.length > 0 ? (
            <PitchPlayerSelector
              isOpen={isPlayerModalOpen}
              onClose={handleEditPlayerModalClose}
              onSelectPlayer={handleEditPlayerSelected}
              eventType={(editingEventType ?? EventType.TURNOVER_WON) as any}
              team="own"
              players={players}
              matchLineup={matchLineup}
              teamPrimaryColor={club?.primary_colour || '#10B981'}
              teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
              attackingRight={teamAttackingRight}
            />
          ) : (
            <PlayerSelectionModal
              isOpen={isPlayerModalOpen}
              onClose={handleEditPlayerModalClose}
              onSelectPlayer={handleEditPlayerSelected}
              eventType={(editingEventType ?? EventType.TURNOVER_WON) as any}
              team="own"
              players={players}
              attackingRight={teamAttackingRight}
              teamPrimaryColor={club?.primary_colour || '#10B981'}
              teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
            />
          )
        ) : lineupLoaded && matchLineup.length > 0 ? (
          <PitchPlayerSelector
            isOpen={isPlayerModalOpen}
            onClose={handlePlayerModalClose}
            onSelectPlayer={selectingFoulPlayer ? handleFoulPlayerSelected : handlePlayerSelected}
            eventType={selectingFoulPlayer ? EventType.FOUL_COMMITTED : (pendingEvent?.eventType as any)}
            team="own"
            players={playersOnField}
            matchLineup={matchLineup}
            teamPrimaryColor={club?.primary_colour || '#10B981'}
            teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
            attackingRight={teamAttackingRight}
            ballPosition={pendingEvent?.position ?? ballPosition}
            suggestedPlayerId={selectingFoulPlayer ? null : suggestedScorerId}
          />
        ) : (
          <PlayerSelectionModal
            isOpen={isPlayerModalOpen}
            onClose={handlePlayerModalClose}
            onSelectPlayer={selectingFoulPlayer ? handleFoulPlayerSelected : handlePlayerSelected}
            eventType={selectingFoulPlayer ? EventType.FOUL_COMMITTED : (pendingEvent?.eventType as any)}
            team="own"
            players={playersOnField}
            attackingRight={teamAttackingRight}
            teamPrimaryColor={club?.primary_colour || '#10B981'}
            teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
            suggestedPlayerId={selectingFoulPlayer ? null : suggestedScorerId}
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

      {/* Edit Event — team/player choice. Opened by the pencil on a kickout-
          sideline or scoring event instead of jumping straight to the player
          picker, since "wrong team" (not "wrong player") is the mistake this
          exists to fix — see handleEditEventClick. */}
      {editChoice && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          onClick={() => setEditChoice(null)}
        >
          <div
            className="w-full max-w-sm bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-bold text-white mb-1">
              {editChoice.kind === 'sideline' ? 'Edit Kickout' : 'Edit This Event'}
            </p>
            <p className="text-xs text-white/40 mb-4">
              Currently recorded as {editChoice.currentTeam === 'own' ? (clubName || 'Us') : matchDisplay.opponent}
            </p>
            <div className="flex flex-col gap-2">
              {editChoice.kind === 'sideline' ? (
                <button
                  onClick={handleConfirmSidelineSwap}
                  className="w-full py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-200 text-sm font-bold hover:bg-amber-500/30 transition-all active:scale-[0.98]"
                >
                  Actually {editChoice.currentTeam === 'own' ? matchDisplay.opponent : (clubName || 'Us')}'s kickout
                </button>
              ) : (
                <>
                  <button
                    onClick={handleSwapScoringTeam}
                    className="w-full py-3 rounded-xl bg-amber-500/20 border border-amber-400/30 text-amber-200 text-sm font-bold hover:bg-amber-500/30 transition-all active:scale-[0.98]"
                  >
                    Change Team → {editChoice.currentTeam === 'own' ? matchDisplay.opponent : (clubName || 'Us')}
                  </button>
                  <button
                    onClick={() => {
                      const id = editChoice.eventId
                      setEditChoice(null)
                      handleEditEventPlayer(id)
                    }}
                    className="w-full py-3 rounded-xl bg-white/10 border border-white/15 text-white/80 text-sm font-bold hover:bg-white/15 transition-all active:scale-[0.98]"
                  >
                    Change Player
                  </button>
                </>
              )}
              <button
                onClick={() => setEditChoice(null)}
                className="w-full py-2 rounded-xl text-white/40 hover:text-white/70 text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

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

      {/* Reset Match Confirmation */}
      <ConfirmationModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        onConfirm={handleResetMatch}
        title="Reset Match Events?"
        message="This will delete ALL recorded events, possession data, and ball carrier segments for this match. Scores will reset to 0-0 and you can start recording again. Your lineup, opposition roster, weather settings, and tactical notes will be kept."
        confirmText={resetting ? 'Resetting...' : 'Reset & Restart'}
        cancelText="Cancel"
        variant="danger"
      />

      {/* Manual Event Entry Modal */}
      <ManualEventEntryModal
        isOpen={isManualEntryOpen}
        onClose={() => { setIsManualEntryOpen(false); setManualEntryDefaultType(undefined) }}
        onSubmit={handleManualEventSubmit}
        players={players}
        opponentName={matchDisplay.opponent}
        matchLineup={matchLineup}
        currentMinute={minute}
        currentHalf={currentHalf}
        defaultEventType={manualEntryDefaultType}
      />

      {/* Substitution Modal */}
      <SubstitutionModal
        isOpen={isSubModalOpen}
        onClose={() => setIsSubModalOpen(false)}
        onConfirm={handleSubstitutionConfirm}
        matchLineup={matchLineup}
        players={players}
        minute={minute}
      />

      {/* View current on-field lineup — read-only, same formation view used for player selection */}
      <PitchPlayerSelector
        isOpen={isViewLineupOpen}
        onClose={() => setIsViewLineupOpen(false)}
        onSelectPlayer={() => {}}
        eventType=""
        team="own"
        players={players}
        matchLineup={matchLineup}
        teamPrimaryColor={club?.primary_colour || '#10B981'}
        teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
        attackingRight={teamAttackingRight}
        readOnly
      />

      {/* Starting Lineup Modal */}
      <StartingLineupModal
        isOpen={isLineupModalOpen}
        onClose={() => setIsLineupModalOpen(false)}
        onConfirm={handleLineupConfirm}
        players={players}
        lastMatchLineup={lastMatchLineup}
        savedLineup={startingLineup}
      />
      <WeatherPickerPopover
        isOpen={isWeatherPickerOpen}
        onClose={() => setIsWeatherPickerOpen(false)}
        onSave={handleWeatherSave}
        currentConditions={weatherConditions}
        currentTemperature={temperatureCelsius}
        currentNotes={matchNotesText}
      />

      {/* Manual clock correction */}
      {isClockEditorOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
          <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-white/15 p-5 space-y-5">
            <div>
              <h3 className="text-white font-bold text-lg">Correct match clock</h3>
              <p className="text-white/50 text-xs mt-1">
                Are you sure? This only changes what the clock shows from now on — it won't renumber events you've already tagged.
              </p>
            </div>

            <div className="text-center">
              <span className="font-mono text-4xl font-bold text-white">
                {clockEditorDraft.minute}:{clockEditorDraft.seconds.toString().padStart(2, '0')}
              </span>
            </div>

            <div>
              <input
                type="range"
                min={0}
                max={(match?.half_duration_mins || 30) * 2 + 10}
                step={1}
                value={clockEditorDraft.minute}
                onChange={(e) => setClockEditorDraft(prev => ({ ...prev, minute: parseInt(e.target.value, 10) }))}
                className="w-full accent-emerald-500"
              />
              <div className="flex justify-between text-[10px] text-white/40 mt-1">
                <span>0</span>
                <span>{(match?.half_duration_mins || 30) * 2 + 10} min</span>
              </div>
            </div>

            <div className="flex items-center gap-3 justify-center">
              <label className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">Min</span>
                <input
                  type="number"
                  min={0}
                  max={140}
                  value={clockEditorDraft.minute}
                  onChange={(e) => setClockEditorDraft(prev => ({ ...prev, minute: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
                  className="w-20 text-center font-mono text-lg bg-white/10 border border-white/20 rounded-lg py-1.5 text-white"
                />
              </label>
              <span className="text-white/40 text-2xl mt-4">:</span>
              <label className="flex flex-col items-center gap-1">
                <span className="text-[10px] uppercase tracking-wide text-white/40">Sec</span>
                <input
                  type="number"
                  min={0}
                  max={59}
                  value={clockEditorDraft.seconds}
                  onChange={(e) => setClockEditorDraft(prev => ({ ...prev, seconds: Math.min(59, Math.max(0, parseInt(e.target.value, 10) || 0)) }))}
                  className="w-20 text-center font-mono text-lg bg-white/10 border border-white/20 rounded-lg py-1.5 text-white"
                />
              </label>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setIsClockEditorOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-white/10 border border-white/20 text-white/70 hover:text-white hover:bg-white/20 transition-all font-semibold"
              >
                Cancel
              </button>
              <button
                onClick={() => handleManualClockEdit(clockEditorDraft.minute, clockEditorDraft.seconds)}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all font-semibold"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Notes — a single instance, rendered once regardless of
          standard vs. fullscreen pitch mode. It portals its own fixed-
          position UI straight to <body>, so it stays reachable and visible
          on top of either view (FullscreenPitchMode's own overlay included)
          without needing a second copy mounted inside it — two copies would
          double up the floating button and each track recording state
          independently of the other. */}
      {matchId && (matchPhase === 'first_half' || matchPhase === 'second_half') && (
        <VoiceNoteButton
          matchId={matchId}
          half={currentHalf}
          minute={minute}
        />
      )}

      {/* Fullscreen Pitch Mode */}
      <FullscreenPitchMode
        isOpen={isFullscreenPitch}
        onClose={() => setIsFullscreenPitch(false)}
        ballPosition={ballPosition}
        onBallMove={handleBallMove}
        readonly={matchPhase === 'not_started' || matchPhase === 'finished' || matchPhase === 'half_time' || (awaitingKickout && !pendingKickoutEvent) || (!!pendingFreeKick && !isAdjustingFreePosition)}
        trail={ballTrail}
        onTrailUpdate={setBallTrail}
        onDragPath={handleDragPath}
        matchPhase={matchPhase}
        minute={minute}
        halfDurationMins={match?.half_duration_mins || 30}
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
        isIn2PointZone={isIn2PointZone(
          ballPosition.x,
          ballPosition.y,
          pendingFreeKick
            ? (pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
            : ballPosition.team
        )}
        isInPenaltyArea={(() => {
          const freeTeam = pendingFreeKick
            ? (pendingFoul === 'opponent' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
            : ballPosition.team
          const attackingGoalX = freeTeam === PossessionTeam.OWN
            ? (teamAttackingRight ? 100 : 0)
            : (teamAttackingRight ? 0 : 100)
          return Math.abs(attackingGoalX - ballPosition.x) <= 10.5
        })()}
        pendingFreeKick={!!pendingFreeKick && !isAdjustingFreePosition}
        pendingFoul={pendingFoul}
        pendingBlockRecovery={!!pendingBlockRecovery}
        onBlockRecovery={handleBlockRecovery}
        onBlockResultSideline={handleBlockResultSideline}
        onBlockResultFortyFive={handleBlockResultFortyFive}
        pendingSidelineDecision={!!pendingSidelineDecision}
        onSidelineDecision={handleSidelineDecision}
        pending45={!!pending45}
        pendingKickoutPosition={!!pendingKickoutEvent}
        pendingKickoutEventType={pendingKickoutEvent ? String(pendingKickoutEvent.eventType) : undefined}
        pendingKickoutTargetPlayerId={pendingKickoutEvent?.targetPlayerId}
        highlightSidelines={sidelineTapPending}
        highlight45LineX={fortyFiveLineX}
        pendingFortyFivePosition={!!pendingFortyFivePosition}
        onCancelFortyFivePosition={handleCancelFortyFivePosition}
        onSelectKickoutTarget={(playerId) => setPendingKickoutEvent(prev => prev ? {
          ...prev,
          targetPlayerId: prev.targetPlayerId === playerId ? undefined : playerId,
        } : prev)}
        onCancelFree={handleCancelFree}
        onCancel45={handleCancel45}
        onCancelKickout={handleCancelKickout}
        isAdjustingFreePosition={isAdjustingFreePosition}
        onAdjustFreePosition={() => setIsAdjustingFreePosition(true)}
        onDoneAdjustingFreePosition={() => setIsAdjustingFreePosition(false)}
        activeCategory={activeKickoutTab}
        onCategoryChange={setActiveKickoutTab}
        awaitingKickout={awaitingKickout}
        kickoutBannerMinimised={kickoutBannerMinimised}
        onMinimizeKickout={() => setKickoutBannerMinimised(true)}
        onRestoreKickout={() => setKickoutBannerMinimised(false)}
        teamAttackingRight={teamAttackingRight}
        statusText={statusLabel.text}
        statusAccent={statusLabel.accent}
        onSwapPossession={() => {
          // See the matching handler above — guard + synchronous label flip
          // first, carrier-segment close is a fire-and-forget side effect.
          if (!shouldProceedWithQuickAction('possession-swap')) return
          const newTeam = ballPosition.team === PossessionTeam.OWN ? PossessionTeam.OPPONENT : PossessionTeam.OWN
          setBallPosition(prev => ({ ...prev, team: newTeam }))
          if (activeCarrierId) {
            playerMovement.onPossessionSwap(ballPosition.x, ballPosition.y).catch(err =>
              console.error('Failed to close carrier segment on possession swap:', err)
            )
            setActiveCarrierId(null)
          }
        }}
        onManualEntry={() => setIsManualEntryOpen(true)}
        jerseyStripPlayers={jerseyStripPlayers}
        activeCarrierId={activeCarrierId}
        onCarrierSelect={handleCarrierSelect}
        recentCarrierIds={recentCarrierIds}
        carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
        selectingFoulPlayer={selectingFoulPlayer}
        onStartSecondHalf={matchPhase === 'half_time' ? startHalf : undefined}
        onEndFirstHalf={endFirstHalf}
        onEndMatch={endMatch}
        fullTimeReached={fullTimeReached}
        blackCardTimers={blackCardTimers}
        onRemoveBlackCard={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))}
        isStopped={isStopped}
        onToggleStoppage={handleToggleStoppage}
        isDeadBall={isDeadBall}
        onToggleDeadBall={handleToggleDeadBall}
        onSubstitution={() => {
          setManualEntryDefaultType(EventType.SUBSTITUTION)
          setIsManualEntryOpen(true)
        }}
        teamPrimaryColor={club?.primary_colour || '#10B981'}
        teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
        pendingOpponentScore={pendingOpponentScore}
        oppositionRoster={match?.opposition_roster || []}
        onOpponentScorerSelect={handleOpponentScorerSelect}
        onOpponentScorerSkip={handleOpponentScorerSkip}
      />

      {/* Half-Time View — full-screen stats overlay, no touch pitch or
          carrier UI. Built for a dressing-room TV: big score header, high
          contrast, generous spacing. Purely visual — sits on top of the
          pitch/recording UI without unmounting it, so closing it just
          removes the overlay and recording continues exactly as it was. */}
      {showHalfTimeView && (
        <div className="fixed inset-0 z-[200] bg-[#060a14] overflow-y-auto">
          <div className="sticky top-0 z-10 bg-[#060a14]/95 backdrop-blur-xl border-b border-white/10">
            <div className="max-w-[1600px] mx-auto px-6 py-5 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 sm:gap-6 min-w-0">
                <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 flex-shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-300 text-[11px] sm:text-xs font-black uppercase tracking-widest">Half-Time</span>
                </div>
                <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                  <span className="text-sm sm:text-lg font-bold text-white truncate">{clubName || 'Us'}</span>
                  <span className="text-lg sm:text-2xl font-black text-emerald-400 tabular-nums whitespace-nowrap">
                    {teamGoals}-{String(teamPoints).padStart(2, '0')}
                  </span>
                  <span className="text-white/30 text-sm sm:text-lg font-bold">:</span>
                  <span className="text-lg sm:text-2xl font-black text-white/80 tabular-nums whitespace-nowrap">
                    {opponentGoals}-{String(opponentPoints).padStart(2, '0')}
                  </span>
                  <span className="text-sm sm:text-lg font-bold text-white/60 truncate">{matchDisplay.opponent}</span>
                </div>
              </div>
              <div className="flex-shrink-0 flex items-center gap-2">
                <button
                  onClick={handleShareHalfTime}
                  disabled={isSharingHalfTime}
                  className="flex items-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-cyan-500/15 hover:bg-cyan-500/25 border-2 border-cyan-500/30 text-cyan-300 font-bold text-sm sm:text-base transition-all disabled:opacity-60"
                  title="Share this view as an image — coaching staff, WhatsApp, etc."
                >
                  {isSharingHalfTime ? <Loader2 size={20} className="animate-spin" /> : <Share2 size={20} />}
                  <span className="hidden sm:inline">{isSharingHalfTime ? 'Preparing…' : 'Share'}</span>
                </button>
                <button
                  onClick={() => setShowHalfTimeView(false)}
                  className="flex items-center gap-2 px-4 py-2.5 sm:px-5 sm:py-3 rounded-xl bg-white/10 hover:bg-white/20 border-2 border-white/20 text-white font-bold text-sm sm:text-base transition-all"
                  title="Close half-time view"
                >
                  <X size={20} />
                  <span className="hidden sm:inline">Close</span>
                </button>
              </div>
            </div>
          </div>
          <div ref={halfTimeContentRef} className="max-w-[1600px] mx-auto px-6 py-6 space-y-4 bg-[#060a14]">
            {matchStatsPanel}
            {matchInsightsCharts}
          </div>
        </div>
      )}

      {/* Formation Snapshot Mode */}
      <FormationSnapshotMode
        isOpen={isSnapshotMode}
        onClose={() => setIsSnapshotMode(false)}
        onSave={handleFormationSave}
        ownPlayers={snapshotOwnPlayers}
      />

      {/* Error Alert Modal */}
      <ConfirmationModal
        isOpen={!!errorAlert}
        onClose={() => setErrorAlert(null)}
        title="Something Went Wrong"
        message={errorAlert || ''}
        variant="danger"
      />

      {/* Interactive Tutorial Overlay */}
      <MatchRecordingTutorial
        active={tutorialActive}
        onComplete={() => {
          setTutorialActive(false)
          if (preTutorialBallRef.current) {
            setBallPosition(preTutorialBallRef.current)
            preTutorialBallRef.current = null
          }
        }}
        matchState={tutorialMatchState}
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

      {/* "T/O Lost" reason picker — WHY the ball was lost, before any event
          is recorded. Determines both the final event_type and which
          sub-type list appears next. */}
      {pendingTurnoverReason && (
        <div className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl p-5">
            <p className="text-sm font-bold text-white mb-1">How was it lost?</p>
            <p className="text-xs text-white/40 mb-4">
              {pendingTurnoverReason.player?.name ?? 'Player'} — pick the reason
            </p>
            <div className="flex flex-col gap-2 mb-4">
              <button
                onClick={() => handleTurnoverReasonSelected('dispossession')}
                className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-red-600/25 border border-white/10 hover:border-red-500/40 text-left transition-all"
              >
                <span className="block text-sm font-semibold text-white">Active Dispossession</span>
                <span className="block text-xs text-white/40">They won it — strip, tackle, forced interception</span>
              </button>
              <button
                onClick={() => handleTurnoverReasonSelected('unforced')}
                className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-amber-600/25 border border-white/10 hover:border-amber-500/40 text-left transition-all"
              >
                <span className="block text-sm font-semibold text-white">Unforced Error</span>
                <span className="block text-xs text-white/40">We gave it away — stray pass, dropped ball, miscue</span>
              </button>
              <button
                onClick={() => handleTurnoverReasonSelected('offensive_foul')}
                className="px-3 py-2.5 rounded-xl bg-white/10 hover:bg-orange-600/25 border border-white/10 hover:border-orange-500/40 text-left transition-all"
              >
                <span className="block text-sm font-semibold text-white">Offensive Foul</span>
                <span className="block text-xs text-white/40">Overcarrying, picked off the ground — concedes a free</span>
              </button>
            </div>
            <button
              onClick={() => setPendingTurnoverReason(null)}
              className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Sub-type picker — shown after player selection for unforced errors / fouls */}
      {pendingSubType && (
        <div className="fixed inset-0 z-[180] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-1">
              <p className="text-sm font-bold text-white">
                {pendingSubType.eventType === 'turnover_lost' ? 'What type of dispossession?' : pendingSubType.foulMode ? 'What type of foul?' : 'What type of error?'}
              </p>
              {pendingSubType.foulMode && (
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={tacticalFoul} onChange={e => setTacticalFoul(e.target.checked)} className="w-4 h-4 rounded" />
                  <span className="text-xs text-white/70">Tactical</span>
                </label>
              )}
            </div>
            <p className="text-xs text-white/40 mb-4">
              {pendingSubType.player?.name ?? 'Player'} — tap to categorise or skip
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {(pendingSubType.subtypeOptions ?? (pendingSubType.foulMode ? FOUL_SUBTYPES : UNFORCED_ERROR_SUBTYPES)).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleSubTypeSelected(value)}
                  className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-emerald-600/30 border border-white/10 hover:border-emerald-500/40 text-white/80 hover:text-white text-xs font-medium transition-all"
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleSubTypeSelected(undefined)}
              className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 text-xs transition-colors"
            >
              Skip categorisation
            </button>
          </div>
        </div>
      )}

      {/* Extended Stats Modal */}
      {showExtendedStats && matchDisplay && (
        <ExtendedStatsModal
          events={allEvents}
          opponent={matchDisplay.opponent}
          teamName={clubName || 'Us'}
          halfDurationMins={match?.half_duration_mins || 30}
          onClose={() => setShowExtendedStats(false)}
        />
      )}
    </div>
  )
}
