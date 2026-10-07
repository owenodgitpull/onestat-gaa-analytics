/**
 * VideoTagging — Main video analysis tagging page.
 *
 * Event flow: tap event → tap player number (own-team events only) → done.
 * Position is always taken from the live ball position on the persistent
 * tracking pitch. Video auto-pauses on event tap and auto-resumes after
 * completion. Uses the same CategorizedActionButtons as Live Recording.
 *
 * Layout (50/50 split, both normal and fullscreen):
 * ┌──────────────────────────────────────────────────┐
 * │  ← Back | Scoreboard | [Auto] [Sync]            │
 * ├─────────────────────────┬────────────────────────┤
 * │   Video Player (50%)    │  TaggingPitch (50%)    │
 * ├─────────────────────────┴────────────────────────┤
 * │  CategorizedActionButtons (centered)              │
 * ├──────────────────────────────────────────────────┤
 * │  Jersey Number Strip                              │
 * ├──────────────────────────────────────────────────┤
 * │  Event Timeline                                   │
 * ├──────────────────────────────────────────────────┤
 * │  ▾ Event Log (collapsible)                        │
 * └──────────────────────────────────────────────────┘
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ChevronsRight, ChevronsDown, BarChart3, PieChart, CloudSun, Plus, RotateCcw, MoreHorizontal, ArrowLeft, FileText, Download, Loader2, Sparkles, X, AlertTriangle, Users, Palette, Maximize, Camera, Play, Target, Undo2, CheckCircle2 } from 'lucide-react'
import VideoPlayer, { type VideoPlayerHandle } from '../components/video/VideoPlayer'
import VideoTacticalView from '../components/video/VideoTacticalView'
import EventTimeline from '../components/video/EventTimeline'
import CategorizedActionButtons from '../components/CategorizedActionButtons'
import VideoEventLog from '../components/video/VideoEventLog'
import TaggingPitch from '../components/video/TaggingPitch'
import PlayerSelectionModal from '../components/PlayerSelectionModal'
import PitchPlayerSelector from '../components/PitchPlayerSelector'
import StartingLineupModal, { type LineupEntry } from '../components/StartingLineupModal'
import WeatherPickerPopover from '../components/WeatherPickerPopover'
import SyncPreviewModal from '../components/video/SyncPreviewModal'
import ConfirmationModal from '../components/ConfirmationModal'
import SetupFlowModal, { type SetupStep } from '../components/video/SetupFlowModal'
import UndoToPointModal from '../components/video/UndoToPointModal'
import AttackDirectionBadge from '../components/video/AttackDirectionBadge'
import MatchStatsPanel from '../components/MatchStatsPanel'
import VideoManualEventModal from '../components/video/VideoManualEventModal'
import OppositionScorerStrip from '../components/OppositionScorerStrip'
import ExtendedStatsModal from '../components/ExtendedStatsModal'
import ChartZoomModal from '../components/ChartZoomModal'
import PossessionTerritoryChart from '../components/charts/PossessionTerritoryChart'
import AttackingThirdsChart from '../components/charts/AttackingThirdsChart'
import ScoringTimeline from '../components/charts/ScoringTimeline'
import ShotOutcomeChart from '../components/charts/ShotOutcomeChart'
import MatchKickoutZones from '../components/charts/MatchKickoutZones'
import MatchKickoutOutcomes from '../components/charts/MatchKickoutOutcomes'
import ScoringZoneMap from '../components/charts/ScoringZoneMap'
import TurnoverMap from '../components/charts/TurnoverMap'
import ShootingEfficiencyHeatmap from '../components/charts/ShootingEfficiencyHeatmap'
import KickoutSequence from '../components/charts/KickoutSequence'
import { videoEventsToChartEvents, computeShotLocations } from '../utils/videoEventChartAdapter'
import { xyToZone } from '../components/video/PitchZoneSelector'
import BlackCardTimer, { type BlackCardEntry } from '../components/BlackCardTimer'
import FormationSnapshotMode from '../components/FormationSnapshotMode'
import { FORMATION_XY } from '@/utils/likelyReceivers'
import { type JerseyPlayer } from '../components/JerseyNumberStrip'
import BallCarrierPicker from '../components/BallCarrierPicker'
import VideoPitchReceiverDots from '../components/video/VideoPitchReceiverDots'
import BallQuickActionIcon from '../components/video/BallQuickActionIcon'
import GAAPitch from '../components/GAAPitch'
import EventFilterToggles, { getEventTypesForFilters, EventMapLegend } from '../components/EventFilterToggles'
import TacticalTagButton from '../components/TacticalTagButton'
import { useClubName, useClub } from '../contexts/ClubContext'
import { useTour } from '../hooks/useTour'
import { videoTaggingSteps } from '../config/tourSteps'
import {
  useVideoSession,
  useSetHalftime,
  useSetFullTime,
  useSetAttackDirection,
  useStartTracking,
  useUpdateTrackingProgress,
  useCompleteTracking,
  useResetVideoSession,
} from '../hooks/useVideoSessions'
import { FOUL_SUBTYPES, UNFORCED_ERROR_SUBTYPES, TURNOVER_REASON_CONFIG, type TurnoverReason } from '../constants/turnoverSubtypes'
import PitchActionOverlay from '../components/PitchActionOverlay'
import {
  SubtypePrompt,
  TurnoverReasonPrompt,
  AimedForChips,
  AdjustFreeBanner,
  type BroughtForwardReason,
} from '../components/video/VideoPitchPrompts'
import {
  useVideoEvents,
  useCreateVideoEvent,
  useUpdateVideoEvent,
  useDeleteVideoEvent,
  useVerifyVideoEvent,
  useSyncPreview,
  useSyncConfirm,
  useDeleteVideoEventsAfter,
  useDeleteCarrierSegmentsAfter,
} from '../hooks/useVideoEvents'
import { videoSessionsAPI, videoEventsAPI } from '../services/videoApi'
import type { VideoEvent, VideoEventCreateData, VideoEventUpdateData, VideoSyncPreview, VideoSyncStatus, BallPositionSampleData, ScoringContext } from '../services/videoApi'
import { api, type BallCarrierSegment } from '../services/api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PossessionTeam, EventType } from '../types'
import type { Player, BallPosition } from '../types'
import { confirmDialog } from '../utils/dialog'

type OverlayState = 'none' | 'player' | 'pitch'
type Category = 'scoring' | 'turnovers' | 'our_kickouts' | 'opp_kickouts'

/** What the on-pitch tap step is for (drives the banner + which CAB panel). */
type PitchPrompt = 'kickout' | 'kickout_sideline' | 'forty_five'

interface ActionButton {
  id: string
  label: string
  eventType: string
  autoFlipTo?: 'us' | 'them'
  autoSwitchTab?: Category
  needsPlayer?: boolean
  needsPitch?: boolean
  /** When the pitch tap happens relative to the player pick. Kickouts: the
   *  player (who won it) first, then the landing tap. 45s: the 45m-line tap
   *  first, then who took it — same orders as live recording. */
  pitchStep?: 'before_player' | 'after_player'
  pitchPrompt?: PitchPrompt
  playerModalTitle?: string
  playerModalEventType?: string
}

interface OverlayPendingEvent {
  action: ActionButton
  eventData: VideoEventCreateData
  freeKickContext?: boolean
}

interface EventConfig {
  videoType: string
  needsPlayer: boolean
  autoFlipTo?: 'us' | 'them'
  autoSwitchTab?: Category
  playerModalTitle?: string
  playerModalEventType?: string
  description?: string
  /** 2-pointer: sent as POINT_SCORED + scoring_context.is_two_pointer (the
   *  backend has no TWO_POINT_SCORED type — it rejected it with a 422). */
  twoPointer?: boolean
  /** Penalty outcome: sent as PENALTY + scoring_context.scored. */
  scored?: boolean
  /** Free that missed: sent as FREE_KICK + scoring_context.wide (maps to WIDE_FREE). */
  wideFree?: boolean
}

/** Scores / wides / 45s / penalties — the ball is dead and the OTHER team
 *  restarts with a kickout (live recording's awaitingKickout). */
const KICKOUT_RESTART_VIDEO_TYPES = new Set([
  'GOAL_SCORED', 'POINT_SCORED', 'WIDE', 'FORTY_FIVE', 'PENALTY', 'FREE_KICK',
])
/** Shot outcomes where play continues and the other team gets the ball, with
 *  no kickout prompt (matches live recording). */
const SHOT_TURNOVER_VIDEO_TYPES = new Set(['SHORT', 'SAVED', 'HIT_POST'])

const EVENT_TYPE_CONFIG: Partial<Record<EventType, EventConfig>> = {
  [EventType.GOAL]: { videoType: 'GOAL_SCORED', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Scored?', playerModalEventType: 'goal' },
  [EventType.POINT]: { videoType: 'POINT_SCORED', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Scored?', playerModalEventType: 'point' },
  [EventType.TWO_POINT]: { videoType: 'POINT_SCORED', twoPointer: true, needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Scored?', playerModalEventType: 'point' },
  [EventType.WIDE]: { videoType: 'WIDE', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'wide' },
  [EventType.SHORT]: { videoType: 'SHORT', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Shot?', playerModalEventType: 'saved' },
  [EventType.SAVED]: { videoType: 'SAVED', needsPlayer: false, autoFlipTo: 'us', autoSwitchTab: 'our_kickouts' },
  [EventType.BLOCK]: { videoType: 'BLOCK_SHOT', needsPlayer: true, playerModalTitle: 'Who Blocked?', playerModalEventType: 'block' },
  [EventType.FREE_SHORT_PASS]: { videoType: 'PASS_HAND', needsPlayer: true, autoSwitchTab: 'scoring', playerModalTitle: 'Who Took the Free?', playerModalEventType: 'point_free', description: 'Free short pass' },
  [EventType.FREE_HIGH_BALL]: { videoType: 'HIGH_BALL', needsPlayer: true, autoSwitchTab: 'scoring', playerModalTitle: 'Who Took the Free?', playerModalEventType: 'point_free', description: 'High ball (free)' },
  [EventType.HIT_POST]: { videoType: 'HIT_POST', needsPlayer: true, autoFlipTo: 'us', autoSwitchTab: 'our_kickouts', playerModalTitle: 'Who Shot?', playerModalEventType: 'wide' },
  [EventType.POINT_FREE]: { videoType: 'POINT_SCORED', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Scored?', playerModalEventType: 'point' },
  [EventType.TWO_POINT_FREE]: { videoType: 'POINT_SCORED', twoPointer: true, needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Scored?', playerModalEventType: 'point' },
  [EventType.WIDE_FREE]: { videoType: 'FREE_KICK', wideFree: true, needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'wide' },
  [EventType.FORTY_FIVE]: { videoType: 'FORTY_FIVE', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'point' },
  [EventType.FORTY_FIVE_MISSED]: { videoType: 'FORTY_FIVE', needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'wide' },
  [EventType.PENALTY_GOAL]: { videoType: 'PENALTY', scored: true, needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'goal' },
  [EventType.PENALTY_MISS]: { videoType: 'PENALTY', scored: false, needsPlayer: true, autoFlipTo: 'them', autoSwitchTab: 'opp_kickouts', playerModalTitle: 'Who Took?', playerModalEventType: 'wide' },
  [EventType.TURNOVER_WON]: { videoType: 'TURNOVER_WON', needsPlayer: true, autoFlipTo: 'us', playerModalTitle: 'Who Won Turnover?', playerModalEventType: 'turnover_won' },
  [EventType.TACKLE_WON]: { videoType: 'TACKLE_WON', needsPlayer: true, autoFlipTo: 'us', playerModalTitle: 'Who Won Tackle?', playerModalEventType: 'turnover_won' },
  [EventType.TURNOVER_LOST]: { videoType: 'TURNOVER_LOST', needsPlayer: true, autoFlipTo: 'them', playerModalTitle: 'Who Lost Possession?', playerModalEventType: 'turnover_lost' },
  [EventType.INTERCEPTION]: { videoType: 'INTERCEPTION', needsPlayer: true, autoFlipTo: 'us', playerModalTitle: 'Who Intercepted?', playerModalEventType: 'turnover_won' },
  [EventType.OUR_UNFORCED_ERROR]: { videoType: 'OUR_UNFORCED_ERROR', needsPlayer: true, autoFlipTo: 'them', playerModalTitle: 'Who Made the Error?', playerModalEventType: 'turnover_lost' },
  [EventType.OPP_UNFORCED_ERROR]: { videoType: 'OPP_UNFORCED_ERROR', needsPlayer: false, autoFlipTo: 'us' },
  [EventType.SIDELINE_BALL]: { videoType: 'SIDELINE_BALL', needsPlayer: false },
  [EventType.OWN_KICKOUT_WON]: { videoType: 'OWN_KICKOUT_WON', needsPlayer: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  [EventType.OWN_KICKOUT_OPPOSITION_WON]: { videoType: 'OWN_KICKOUT_OPPOSITION_WON', needsPlayer: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  [EventType.OWN_KICKOUT_WON_BREAK]: { videoType: 'OWN_KICKOUT_WON_BREAK', needsPlayer: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  [EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK]: { videoType: 'OWN_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  [EventType.OWN_KICKOUT_SIDELINE]: { videoType: 'SIDELINE_KICK', needsPlayer: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  [EventType.OPP_KICKOUT_WON]: { videoType: 'OPP_KICKOUT_WON', needsPlayer: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  [EventType.OPP_KICKOUT_OPPOSITION_WON]: { videoType: 'OPP_KICKOUT_OPPOSITION_WON', needsPlayer: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  [EventType.OPP_KICKOUT_WON_BREAK]: { videoType: 'OPP_KICKOUT_WON_BREAK', needsPlayer: true, autoFlipTo: 'us', autoSwitchTab: 'scoring', playerModalTitle: 'Who Won?', playerModalEventType: 'kickout' },
  [EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK]: { videoType: 'OPP_KICKOUT_OPPOSITION_WON_BREAK', needsPlayer: false, autoFlipTo: 'them', autoSwitchTab: 'scoring' },
  [EventType.OPP_KICKOUT_SIDELINE]: { videoType: 'SIDELINE_KICK', needsPlayer: false, autoFlipTo: 'us', autoSwitchTab: 'scoring' },
  [EventType.YELLOW_CARD]: { videoType: 'YELLOW_CARD', needsPlayer: true, playerModalTitle: 'Who Got a Yellow Card?' },
  [EventType.BLACK_CARD]: { videoType: 'BLACK_CARD', needsPlayer: true, playerModalTitle: 'Who Got a Black Card?' },
  [EventType.RED_CARD]: { videoType: 'RED_CARD', needsPlayer: true, playerModalTitle: 'Who Got a Red Card?' },
}

// Scoring event types that trigger the opposition-scorer name prompt when
// team_b (the opponent) is credited with them.
const OPPONENT_SCORE_TYPES = ['GOAL_SCORED', 'POINT_SCORED', 'WIDE', 'SHORT', 'FREE_KICK']

// Shot attempts (make + miss) eligible for the post-hoc "Under pressure?"
// prompt — own team only, mirrors live recording's PRESSURE_ELIGIBLE_TYPES
// as closely as video's more generic event-type set allows.
const PRESSURE_ELIGIBLE_TYPES = ['GOAL_SCORED', 'POINT_SCORED', 'WIDE', 'SHORT', 'POST_HIT', 'GOAL_CHANCE', 'SAVED', 'HIT_POST']

/** Dead-ball shots (frees, 45s, penalties) are never "under pressure" — no prompt. */
function isDeadBallShot(data: { event_type: string; scoring_context?: any }): boolean {
  if (['FREE_KICK', 'FORTY_FIVE', 'PENALTY'].includes(data.event_type)) return true
  const src = String(data.scoring_context?.source ?? '').toUpperCase()
  return src === 'FROM_FREE' || src === 'FREE' || src === 'FROM_45' || !!data.scoring_context?.wide
}

/** Derive a human-readable status label from ball position and possession.
 *  Mirrors live recording's getStatusLabel — when our own team has the ball
 *  AND a carrier is actively selected, names them specifically ("Mark
 *  Curran past midfield") rather than the generic team name; falls back to
 *  the team name otherwise (opposition possession, or no carrier selected
 *  yet this spell). */
function getStatusLabel(
  pos: { x: number; y: number },
  possession: 'team_a' | 'team_b',
  clubName: string,
  opponentName: string,
  carrierName?: string | null,
): string {
  const teamLabel = possession === 'team_a'
    ? (carrierName || clubName)
    : opponentName
  // x: 0 = own DEF → 100 = attacking SQ
  const zone =
    pos.x < 17 ? 'inside own 21m line' :
    pos.x < 33 ? 'inside own 45m line' :
    pos.x < 50 ? 'around midfield' :
    pos.x < 67 ? 'past the 45m line' :
    pos.x < 83 ? 'inside the 21m line' :
    'in the square'
  const side =
    pos.y < 33 ? ', left side' :
    pos.y > 67 ? ', right side' :
    ''
  return `${teamLabel} ${zone}${side}`
}

export default function VideoTagging() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const playerRef = useRef<VideoPlayerHandle>(null)
  const clubName = useClubName()
  const { club } = useClub()

  // Ball carrier tracking state
  const [activeCarrierId, setActiveCarrierId] = useState<string | null>(null)
  const [recentCarrierIds, setRecentCarrierIds] = useState<string[]>([])
  const [isCarrierRadialOpen, setIsCarrierRadialOpen] = useState(false)
  const activeSegmentRef = useRef<BallCarrierSegment | null>(null)
  const carrierPathBufferRef = useRef<Array<{ x: number; y: number }>>([])
  const carrierFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Core state
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [possession, setPossession] = useState<'team_a' | 'team_b'>('team_a')
  const [activeTab, setActiveTab] = useState<Category>('scoring')

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false)

  // 45m free pending state — mirrors MatchRecording's pending45 for the
  // CategorizedActionButtons' built-in 45 Scored/Missed panel.
  const [pending45, setPending45] = useState(false)

  // Ball tracking (TaggingPitch panel)
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number } | null>({ x: 50, y: 50 })
  const [ballTrail, setBallTrail] = useState<Array<{ x: number; y: number }>>([])
  const positionSamples = useRef<BallPositionSampleData[]>([])

  // Three-tap overlay flow
  const [overlayState, setOverlayState] = useState<OverlayState>('none')
  const [pendingOverlay, setPendingOverlay] = useState<OverlayPendingEvent | null>(null)
  const wasPlayingRef = useRef(false)

  // Event log collapse
  const [eventLogExpanded, setEventLogExpanded] = useState(false)

  // Guided tour
  const { startTour: startVideoTour } = useTour('videoTagging', videoTaggingSteps)
  const videoTourTriggered = useRef(false)

  // Report / sync state
  const [enrichmentReport, setEnrichmentReport] = useState<string | null>(null)
  const [isEnriching, setIsEnriching] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [syncPreviewData, setSyncPreviewData] = useState<VideoSyncPreview | null>(null)
  const [syncStatusData, setSyncStatusData] = useState<VideoSyncStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Halftime state
  const [halftimeSkipped, setHalftimeSkipped] = useState(false)
  const setHalftime = useSetHalftime()

  // Setup-flow state (throw-in / half-time / 2nd-half / full-time / direction / throw-in winner)
  const [secondHalfSkipped, setSecondHalfSkipped] = useState(false)
  const [fullTimeSkipped, setFullTimeSkipped] = useState(false)
  const [throwInWinnerChosen, setThrowInWinnerChosen] = useState(false)
  const setFullTime = useSetFullTime()
  const setAttackDirection = useSetAttackDirection()
  const startTracking = useStartTracking()
  const updateTrackingProgress = useUpdateTrackingProgress()
  const completeTracking = useCompleteTracking()
  const resetSession = useResetVideoSession()
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)

  // Undo-to-point modal
  const [showUndoModal, setShowUndoModal] = useState(false)
  const deleteEventsAfter = useDeleteVideoEventsAfter()
  const deleteSegmentsAfter = useDeleteCarrierSegmentsAfter()

  // Forward-scrub ceiling while tracking — the furthest point reached so
  // far. Initialized from the server-persisted high-water mark once (so a
  // refresh mid-tracking resumes the lock correctly), then only grows.
  const [highWaterMarkMs, setHighWaterMarkMs] = useState(0)
  const highWaterMarkRef = useRef(0)
  const highWaterMarkInitRef = useRef(false)
  const lastPersistedProgressRef = useRef(0)

  // Full-time reached confirmation
  const [showFullTimeConfirm, setShowFullTimeConfirm] = useState(false)
  const fullTimeConfirmShownRef = useRef(false)

  // Stats / Charts sections (below the event log, normal mode only) —
  // scroll-to targets + the "Extra Stats" modal
  const statsRef = useRef<HTMLDivElement>(null)
  const chartsRef = useRef<HTMLDivElement>(null)
  const [showExtraStats, setShowExtraStats] = useState(false)

  // View Lineup (read-only) + Weather picker — both trivial ports since
  // PitchPlayerSelector already has a readOnly mode and WeatherPickerPopover
  // is already the shared component live recording uses.
  const [showViewLineup, setShowViewLineup] = useState(false)
  const [isLineupModalOpen, setIsLineupModalOpen] = useState(false)
  const [lastMatchLineup, setLastMatchLineup] = useState<Record<string, LineupEntry> | undefined>(undefined)
  const [showWeatherPicker, setShowWeatherPicker] = useState(false)
  const [weatherOverride, setWeatherOverride] = useState<{ conditions: string[]; temp: number | null; notes: string | null } | null>(null)

  // Manual event entry (incl. substitution) — deliberately does NOT call
  // api.matchLineups.updateFieldStatus (would mutate the match's live/
  // canonical lineup from what might be a retrospective review session).
  // On-field/bench state for the picker's own purposes lives here, seeded
  // from matchLineup and updated in-memory as subs are logged this session.
  const [showManualEvent, setShowManualEvent] = useState(false)
  const [subOverrides, setSubOverrides] = useState<Record<string, boolean>>({})

  // Tactical tag button — mirrors live recording's TacticalTagButton,
  // using calcMatchTime/ballPosition instead of live match-clock values.
  const [tacticalTagCount, setTacticalTagCount] = useState(0)

  // Opposition quick-pass counter — how many passes logged so far in the
  // CURRENT opposition possession spell, so the "P" icon's badge reads 1,
  // 2, 3... for this move and resets the moment possession changes hands
  // (won back, turned over, scored, etc.) rather than accumulating forever.
  const [oppPassCount, setOppPassCount] = useState(0)
  useEffect(() => {
    setOppPassCount(0)
  }, [possession])

  // Assist prompt — auto-opened after an own-team score finalizes.
  const [assistPromptEventId, setAssistPromptEventId] = useState<string | null>(null)

  // Pressure prompt — auto-opened after any own-team shot attempt (make or
  // miss) finalizes. Stores the created event's existing scoring_context so
  // the PATCH can merge under_pressure in rather than clobbering
  // is_two_pointer/source (the backend update route replaces the whole
  // scoring_context object, it doesn't merge server-side).
  const [pendingPressure, setPendingPressure] = useState<{ eventId: string; scoringContext: ScoringContext } | null>(null)

  // Opposition scorer prompt, block→recovery, sideline-ball decision — all
  // follow-up panels shown after their trigger event finalizes. Also reused
  // for the turnover-forced-from prompt (mode: 'turnover_forced') — same
  // banner, no footedness step, no scoringContext to merge into.
  const [pendingOppScorer, setPendingOppScorer] = useState<{ eventId: string; mode: 'score' | 'turnover_forced'; scoringContext?: ScoringContext } | null>(null)
  const [pendingBlockRecovery, setPendingBlockRecovery] = useState(false)
  const [pendingSidelineDecision, setPendingSidelineDecision] = useState(false)
  const [pendingFreeKick, setPendingFreeKick] = useState<'our_free' | 'opp_free' | null>(null)
  // Holds event data while user picks a foul subtype in the sidebar (Our Foul path)
  const [pendingFoulSubtype, setPendingFoulSubtype] = useState<{
    pending: OverlayPendingEvent
    data: VideoEventCreateData
  } | null>(null)
  // High Ball — armed by tapping the "HB" icon (logs nothing yet), then the
  // very next ball tap/drag-release on the tracking pitch is captured as
  // the landing spot in handleTaggingBallCommit. Mirrors the equivalent
  // pendingLongKick added to live recording's MatchRecording.tsx.
  // `kind` = HB (contestable high ball) vs LK (direct long kick pass); `from` = where it was kicked.
  const [pendingLongKick, setPendingLongKick] = useState<{
    team: 'team_a' | 'team_b'
    playerId?: string | null
    kind: 'high_ball' | 'long_kick_pass'
    from?: { x: number; y: number } | null
  } | null>(null)
  // Awaiting a kickout after a score/wide/45/penalty — the on-pitch kickout
  // outcome overlay (PitchActionOverlay), same as live recording.
  const [awaitingKickout, setAwaitingKickout] = useState(false)
  const [kickoutTab, setKickoutTab] = useState<'our_kickouts' | 'opp_kickouts' | null>(null)
  const [kickoutMinimised, setKickoutMinimised] = useState(false)
  // Optional "aimed for" jersey chosen during the landing-position step.
  const [kickoutAimedForId, setKickoutAimedForId] = useState<string | undefined>(undefined)
  // "Adjust Free Position" — overlay hidden so the ball can be dragged.
  const [isAdjustingFree, setIsAdjustingFree] = useState(false)
  // Why the ref brought the free forward (optional, chosen while adjusting its spot)
  const [broughtForwardReason, setBroughtForwardReason] = useState<BroughtForwardReason | null>(null)
  useEffect(() => { if (!pendingFreeKick) setBroughtForwardReason(null) }, [pendingFreeKick])
  // Foul subtype "Tactical" checkbox + the T/O-lost and unforced-error pickers.
  const [tacticalFoul, setTacticalFoul] = useState(false)
  const [pendingTurnoverReason, setPendingTurnoverReason] = useState<{
    pending: OverlayPendingEvent
    data: VideoEventCreateData
    playerName?: string
  } | null>(null)
  const [pendingErrorSubtype, setPendingErrorSubtype] = useState<{
    pending: OverlayPendingEvent
    data: VideoEventCreateData
    playerName?: string
  } | null>(null)

  // Black card sin bin timers
  const [blackCardTimers, setBlackCardTimers] = useState<BlackCardEntry[]>([])

  // Second yellow → automatic red flash
  const [secondYellowFlash, setSecondYellowFlash] = useState(false)

  // Auto-analyze state
  const [isAutoAnalyzing, setIsAutoAnalyzing] = useState(false)
  const analyzePollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // SSE streaming analysis state
  const [analysisProgress, setAnalysisProgress] = useState<{
    stage: string
    totalFrames?: number
    survivingFrames?: number
    completedBatches?: number
    totalBatches?: number
    eventsSoFar?: number
  } | null>(null)
  const sseAbortRef = useRef<(() => void) | null>(null)

  // AI banner dismiss state
  const [aiDismissed, setAiDismissed] = useState(false)

  // Formation snapshot overlay
  const [isSnapshotOpen, setIsSnapshotOpen] = useState(false)
  const [snapshotCount, setSnapshotCount] = useState(0)

  // Tactical view overlay
  const [showTacticalView, setShowTacticalView] = useState(false)

  // Prereq check modal
  const [prereqModal, setPrereqModal] = useState<{
    missing: { lineup: boolean; colours: boolean }
  } | null>(null)

  // Alert/error modal (replaces native alert())
  const [alertModal, setAlertModal] = useState<{
    title: string; message: string; variant: 'danger' | 'warning' | 'info'; onClose?: () => void
  } | null>(null)

  // Queries
  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useVideoSession(sessionId || null)

  // Lock the download URL to the first value received — prevents video reload on refetch
  // (presigned URLs regenerate on every API call, but the old one is still valid for hours)
  const stableVideoUrl = useRef<string | null>(null)
  if (session?.download_url && !stableVideoUrl.current) {
    stableVideoUrl.current = session.download_url
  }
  const { data: eventsData, refetch: refetchEvents } = useVideoEvents(sessionId || null)
  const events = eventsData?.events || []

  // Track players on yellow cards (for second yellow → automatic red)
  const yellowCardPlayerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const ev of events) {
      if (ev.event_type === 'YELLOW_CARD' && ev.player_id) ids.add(ev.player_id)
    }
    return ids
  }, [events])

  const { data: players } = useQuery({
    queryKey: ['players'],
    queryFn: () => api.players.getAll(),
  })

  const { data: matchData, refetch: refetchMatchData } = useQuery({
    queryKey: ['match', session?.match_id],
    queryFn: () => api.matches.getById(session!.match_id),
    enabled: !!session?.match_id,
  })

  // Tracking mode: derived from session fields, not stored client-side, so
  // it survives a refresh. 'setup' (nothing started) -> 'tracking' (started,
  // not completed) -> 'edit' (completed, free review). Play/pause is a
  // separate signal (isPlaying, above) — deliberately not conflated with
  // this, so tracking-gated interactions (ball drag, possession sampling)
  // require BOTH mode === 'tracking' AND isPlaying.
  const mode: 'setup' | 'tracking' | 'edit' = useMemo(() => {
    if (session?.tracking_completed_at != null) return 'edit'
    if (session?.tracking_started_at != null) return 'tracking'
    return 'setup'
  }, [session?.tracking_completed_at, session?.tracking_started_at])

  // ── Possession is only "live" while the footage is actually playing in
  // tracking mode AND no dead-ball situation is pending (free being taken,
  // kickout/45 restart, any follow-up prompt, block/sideline undecided).
  // Mirrors live recording's `isPlaying` guard on its possession tick
  // (!isStopped && !isDeadBall && !awaitingKickout && !pendingFreeKick).
  // Paused video never accrues: no timeupdate events fire, and isPlaying is
  // false. Time is accumulated in VIDEO time per team (see handleTimeUpdate)
  // and flushed with an explicit duration, because the backend's wall-clock
  // chaining is meaningless for video (pauses, 0.5x playback, scrubbing).
  const deadBall = !!pendingFreeKick || awaitingKickout || overlayState !== 'none' || pending45 ||
    !!pendingFoulSubtype || !!pendingTurnoverReason || !!pendingErrorSubtype ||
    pendingBlockRecovery || pendingSidelineDecision || isAdjustingFree
  // Input is needed ON the pitch (overlay / tap step) — drives the pulsing
  // pitch border that the top banner points to.
  const pitchInputNeeded = overlayState === 'pitch' || !!pendingFoulSubtype || !!pendingTurnoverReason ||
    !!pendingErrorSubtype || !!pendingFreeKick || (awaitingKickout && !kickoutMinimised)
  const possLive = mode === 'tracking' && isPlaying && !deadBall
  const possLiveRef = useRef(false)
  possLiveRef.current = possLive
  const possessionRef = useRef(possession)
  possessionRef.current = possession
  const possAccumMsRef = useRef({ team_a: 0, team_b: 0 })
  const lastPossTickMsRef = useRef<number | null>(null)
  const ballPosRef = useRef(ballPosition)
  ballPosRef.current = ballPosition
  const currentTimeMsRef = useRef(0)
  currentTimeMsRef.current = currentTimeMs

  // Stats/charts data — converts the session's own tagged (but not yet
  // synced to the match) events into the shape live recording's chart
  // components read, so the same charts can render live during tagging.
  // See utils/videoEventChartAdapter.ts for why this is needed and how.
  const chartEvents = useMemo(() => videoEventsToChartEvents(events), [events])
  const shotLocations = useMemo(
    () => computeShotLocations(chartEvents, matchData?.half_duration_mins, matchData?.attacking_right_first_half),
    [chartEvents, matchData?.half_duration_mins, matchData?.attacking_right_first_half]
  )

  // Event Map — exact same filterable pitch view as live recording's,
  // fed the same chartEvents adapter output rather than a live MatchEvent
  // query (see filteredMapEvents in MatchRecording.tsx for the reference).
  const [eventMapTeamFilter, setEventMapTeamFilter] = useState<'all' | 'own' | 'opponent'>('all')
  const [eventMapFilters, setEventMapFilters] = useState<Set<string>>(new Set(['all']))
  const [eventMapHalfFilter, setEventMapHalfFilter] = useState<'all' | 1 | 2>('all')
  const filteredMapEvents = useMemo(() => {
    const eventTypes = getEventTypesForFilters(eventMapFilters)
    let filtered = chartEvents.filter(e => e.pitch_x != null && e.pitch_y != null)
    const CARD_TYPES = ['yellow_card', 'black_card', 'red_card']
    filtered = filtered.filter(e => !CARD_TYPES.includes(e.event_type))
    if (eventMapTeamFilter !== 'all') {
      filtered = filtered.filter(e => e.team === eventMapTeamFilter)
    }
    if (eventMapHalfFilter !== 'all') {
      filtered = filtered.filter(e => e.half === eventMapHalfFilter)
    }
    if (eventTypes) {
      filtered = filtered.filter(e => eventTypes.includes(e.event_type))
    }
    return filtered.map(e => ({ ...e, player_name: e.player_name ?? undefined }))
  }, [chartEvents, eventMapFilters, eventMapTeamFilter, eventMapHalfFilter])

  const { data: matchLineup } = useQuery({
    queryKey: ['matchLineup', session?.match_id],
    queryFn: () => api.matchLineups.getLineup(session!.match_id),
    enabled: !!session?.match_id,
  })

  // Mutations
  const createEvent = useCreateVideoEvent({
    onError: (err, data) => setAlertModal({
      title: 'Event not saved',
      message: `${data.event_type.replace(/_/g, ' ').toLowerCase()} could not be saved (${err.message}). Please try again.`,
      variant: 'danger',
    }),
  })
  const updateEvent = useUpdateVideoEvent()
  const deleteEvent = useDeleteVideoEvent()
  const verifyEvent = useVerifyVideoEvent()
  const syncPreview = useSyncPreview()
  const syncConfirm = useSyncConfirm()

  // Trigger guided tour on first visit with valid session
  useEffect(() => {
    if (session && !sessionLoading && !videoTourTriggered.current) {
      videoTourTriggered.current = true
      startVideoTour()
    }
  }, [session, sessionLoading, startVideoTour])

  const handleMarkFirstHalf = useCallback(async (clockOffsetMs?: number) => {
    if (!sessionId) return
    await videoSessionsAPI.setHalfStarts(sessionId, currentTimeMs, undefined, clockOffsetMs)
    await refetchSession()
  }, [sessionId, currentTimeMs, refetchSession])

  const handleMarkSecondHalf = useCallback(async () => {
    if (!sessionId) return
    await videoSessionsAPI.setHalfStarts(sessionId, undefined, currentTimeMs)
    await refetchSession()
  }, [sessionId, currentTimeMs, refetchSession])

  const handleSkipSecondHalf = useCallback(() => setSecondHalfSkipped(true), [])

  const handleMarkFullTime = useCallback(() => {
    if (!sessionId) return
    setFullTime.mutate({ sessionId, fullTimeMs: currentTimeMs })
  }, [sessionId, currentTimeMs, setFullTime])

  const handleSkipFullTime = useCallback(() => setFullTimeSkipped(true), [])

  const handleSetDirection = useCallback(async (attackingRight: boolean) => {
    if (!sessionId) return
    await setAttackDirection.mutateAsync({ sessionId, attackingRightFirstHalf: attackingRight })
    await refetchMatchData()
  }, [sessionId, setAttackDirection, refetchMatchData])

  const handleWeatherSave = useCallback(async (conditions: string[], temp: number | null, notes: string | null) => {
    setWeatherOverride({ conditions, temp, notes })
    if (!session?.match_id) return
    try {
      await api.matches.update(session.match_id, {
        weather_conditions: conditions,
        temperature_celsius: temp,
        notes,
      } as any)
      await refetchMatchData()
      setWeatherOverride(null)
    } catch (err) {
      console.error('Failed to update weather:', err)
    }
  }, [session?.match_id, refetchMatchData])

  const handleSelectThrowInWinner = useCallback((winner: 'team_a' | 'team_b') => {
    setPossession(winner)
    setThrowInWinnerChosen(true)
  }, [])

  // Handle lineup selection confirmation
  const handleLineupConfirm = useCallback(async (lineup: Record<string, LineupEntry>) => {
    setIsLineupModalOpen(false)

    // Save lineup to backend
    if (session?.match_id) {
      try {
        const lineupEntries = Object.entries(lineup).map(([positionId, entry]) => ({
          player_id: entry.playerId,
          position_id: positionId,
          is_substitute: positionId.startsWith('sub-'),
          jersey_number: entry.jerseyNumber,
        }))

        await api.matchLineups.saveLineup(session.match_id, lineupEntries)
        // Refetch lineup to update matchLineup state
        queryClient.invalidateQueries({ queryKey: ['matchLineup', session.match_id] })
      } catch (error) {
        console.error('Failed to save lineup:', error)
        setAlertModal({
          title: 'Error',
          message: 'Failed to save lineup. Please try again.',
          variant: 'danger'
        })
      }
    }
  }, [session?.match_id, queryClient])

  // Load last match lineup for quick copy
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

  const handleStartTracking = useCallback(async () => {
    if (!sessionId || !session) return

    // Check prerequisites before starting tracking
    if (!matchLineup || matchLineup.length === 0) {
      setAlertModal({
        title: 'Lineup Required',
        message: 'Please select your starting lineup before beginning to tag events.',
        variant: 'warning',
        onClose: () => setIsLineupModalOpen(true)
      })
      return
    }

    const throwInMs = session.first_half_start_ms ?? 0
    // Prime the high-water mark (and its ref) synchronously, before the seek
    // below — otherwise maxSeekMs is still its stale pre-tracking value for
    // one render, which would clamp the throw-in seek right back to 0 (or
    // wherever full-time was just marked, falsely triggering the full-time
    // confirm the instant tracking starts).
    highWaterMarkInitRef.current = true
    setHighWaterMarkMs(throwInMs)
    highWaterMarkRef.current = throwInMs
    lastPersistedProgressRef.current = throwInMs
    fullTimeConfirmShownRef.current = false
    await startTracking.mutateAsync({ sessionId })
    // Fresh tracking run — no stale possession time from an earlier session
    possAccumMsRef.current = { team_a: 0, team_b: 0 }
    lastPossTickMsRef.current = null
    playerRef.current?.seekTo(throwInMs)
    // Start playing from the throw-in straight away — previously it sat
    // paused at the throw-in with a "Resume Tracking" button to press.
    // Small delay so the seek lands before play() (and so the mode flip to
    // 'tracking' has re-rendered, which un-clamps the forward-seek ceiling).
    setTimeout(() => playerRef.current?.play(), 150)
  }, [sessionId, session, startTracking, matchLineup])

  const handleRequestEndTracking = useCallback(() => {
    playerRef.current?.pause()
    setShowFullTimeConfirm(true)
  }, [])

  const handleConfirmFinishTracking = useCallback(async () => {
    if (!sessionId) return
    await completeTracking.mutateAsync({ sessionId })
    setShowFullTimeConfirm(false)
  }, [sessionId, completeTracking])

  const handleUndoToPoint = useCallback(async (timestampMs: number) => {
    if (!sessionId || !matchData) return

    try {
      // Delete events and segments after the selected point
      await Promise.all([
        deleteEventsAfter.mutateAsync({ sessionId, timestampMs }),
        deleteSegmentsAfter.mutateAsync({ matchId: matchData.id, timestampMs }),
      ])

      // Reset high-water mark to allow re-recording from this point
      setHighWaterMarkMs(timestampMs)
      highWaterMarkRef.current = timestampMs

      // Seek video to this point
      playerRef.current?.seekTo(timestampMs)

      // Modal will close automatically via onConfirm
    } catch (error) {
      console.error('Failed to undo to point:', error)
    }
  }, [sessionId, matchData, deleteEventsAfter, deleteSegmentsAfter])

  /** Convert video timestamp to match minute/second/half, accounting for throw-in offsets */
  const calcMatchTime = useCallback((videoMs: number): { minute: number; second: number; half: number } => {
    if (!session) return { minute: 0, second: 0, half: 1 }

    const h1Start = session.first_half_start_ms ?? 0
    const h2Start = session.second_half_start_ms

    // If we have a 2nd half marker and video is past it
    if (h2Start != null && videoMs >= h2Start) {
      const elapsed = Math.max(0, videoMs - h2Start)
      const totalSec = Math.floor(elapsed / 1000)
      const hdm = matchData?.half_duration_mins ?? 30
      return { minute: hdm + Math.floor(totalSec / 60), second: totalSec % 60, half: 2 }
    }

    // Otherwise first half (relative to the 1st-half mark). The offset is the
    // match clock at that mark: 0 for a real throw-in, >0 when the footage
    // joins mid-match (e.g. the TV clock already reads 2:05).
    const elapsed = Math.max(0, videoMs - h1Start) + (session.first_half_clock_offset_ms ?? 0)
    const totalSec = Math.floor(elapsed / 1000)
    return { minute: Math.floor(totalSec / 60), second: totalSec % 60, half: 1 }
  }, [session?.first_half_start_ms, session?.first_half_clock_offset_ms, session?.second_half_start_ms])

  // Clean up polling + SSE on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
      if (analyzePollRef.current) clearInterval(analyzePollRef.current)
      if (sseAbortRef.current) sseAbortRef.current()
    }
  }, [])

  // Resume auto-analyze polling on page refresh (only if no SSE stream active)
  useEffect(() => {
    if (session?.status === 'processing' && !sseAbortRef.current) {
      setIsAutoAnalyzing(true)
      startAnalyzePoll()
    }
  }, [session?.status])

  // Escape key cancels overlay or exits fullscreen; F key toggles fullscreen
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (overlayState !== 'none') {
          cancelOverlay()
        } else if (isFullscreen) {
          setIsFullscreen(false)
        }
      }
      if (e.key === 'f' || e.key === 'F') {
        // Only toggle fullscreen when no overlay active and no input focused
        const tag = (e.target as HTMLElement)?.tagName
        if (overlayState === 'none' && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
          setIsFullscreen(prev => !prev)
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [overlayState, isFullscreen])

  // ── Fullscreen: lock body scroll while active (Escape-to-close already
  // handled by the keydown handler above) ─────────────────────────────
  useEffect(() => {
    if (!isFullscreen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [isFullscreen])

  // ── Tracking high-water mark: grows with playback, never regresses.
  // Initialized once from the server-persisted value (or the throw-in
  // point) so a refresh mid-tracking resumes the scrub lock correctly. ──
  useEffect(() => {
    if (highWaterMarkInitRef.current || !session || mode !== 'tracking') return
    highWaterMarkInitRef.current = true
    const initial = session.tracking_progress_ms ?? session.first_half_start_ms ?? 0
    setHighWaterMarkMs(initial)
    highWaterMarkRef.current = initial
    lastPersistedProgressRef.current = initial
  }, [session, mode])

  useEffect(() => { highWaterMarkRef.current = highWaterMarkMs }, [highWaterMarkMs])

  // Throttled server persistence of the high-water mark while tracking —
  // survives a refresh; the interval reads a ref (not state) so it doesn't
  // get torn down/recreated on every timeupdate tick.
  useEffect(() => {
    if (mode !== 'tracking' || !sessionId) return
    const interval = setInterval(() => {
      const current = highWaterMarkRef.current
      if (current > lastPersistedProgressRef.current) {
        lastPersistedProgressRef.current = current
        updateTrackingProgress.mutate({ sessionId, progressMs: current })
      }
    }, 10000)
    return () => clearInterval(interval)
  }, [mode, sessionId, updateTrackingProgress])

  // Persist immediately on pause too, so the lock is accurate even for a
  // short tracking session that never hits the 10s interval.
  useEffect(() => {
    if (isPlaying || mode !== 'tracking' || !sessionId) return
    const current = highWaterMarkRef.current
    if (current > lastPersistedProgressRef.current) {
      lastPersistedProgressRef.current = current
      updateTrackingProgress.mutate({ sessionId, progressMs: current })
    }
  }, [isPlaying, mode, sessionId, updateTrackingProgress])

  // ── Full-time reached while tracking → prompt to finish & review ────
  // Compares against highWaterMarkMs (only grows from genuine forward
  // playback in tracking mode), not raw currentTimeMs — currentTimeMs can
  // still be near wherever full-time was just marked in setup for one
  // render after "Start Match Tracking", before the throw-in seek lands.
  useEffect(() => {
    if (mode !== 'tracking' || session?.full_time_ms == null) return
    if (highWaterMarkMs >= session.full_time_ms && !fullTimeConfirmShownRef.current) {
      fullTimeConfirmShownRef.current = true
      playerRef.current?.pause()
      setShowFullTimeConfirm(true)
    }
  }, [highWaterMarkMs, mode, session?.full_time_ms])

  // ── Possession writes — buffered and BATCHED. Live recording hit a real
  // backend bottleneck from per-tap/per-tick possession requests (and
  // overlapping flushes), so video tagging never sends one request per tap or
  // drag: points (location + VIDEO-time duration, see possAccumMsRef /
  // handleTimeUpdate) go into a client buffer and are POSTed together to
  // /possession-events/video-batch every 15s, on pause, when 100 points are
  // queued, and on leave. One in-flight request at a time (like live's
  // isFlushingRef guard); a failed batch is put back and retried.
  type PossPoint = { team: 'own' | 'opponent'; pitch_x: number; pitch_y: number; minute: number; duration_seconds: number }
  const possBufferRef = useRef<PossPoint[]>([])
  const isPossSendingRef = useRef(false)

  const sendPossessionBuffer = useCallback(async () => {
    const matchId = session?.match_id
    if (!matchId || isPossSendingRef.current || possBufferRef.current.length === 0) return
    isPossSendingRef.current = true
    const batch = possBufferRef.current.splice(0, 500)
    try {
      await api.possession.videoBatch({ match_id: matchId, points: batch })
      // Possession stats panels read a server-side aggregate — refresh it now
      // that new durations are saved (cheap: ~6 numbers)
      queryClient.invalidateQueries({ queryKey: ['possession-summary', matchId] })
    } catch (err) {
      possBufferRef.current.unshift(...batch)
      console.error('Failed to send possession batch (video tagging):', err)
    } finally {
      isPossSendingRef.current = false
    }
  }, [session?.match_id, queryClient])

  // Turn the accumulated video-time possession into buffered points. With
  // `forcePoint`, also queue a (possibly 0s) location point for the team in
  // possession so territory/heat charts get a position for every placement.
  const flushPossession = useCallback((forcePoint = false, at?: { x: number; y: number }, sendNow = false) => {
    if (!session?.match_id) return
    const pos = at ?? ballPosRef.current
    if (pos) {
      const mt = calcMatchTime(currentTimeMsRef.current)
      for (const team of ['team_a', 'team_b'] as const) {
        const secs = Math.floor(possAccumMsRef.current[team] / 1000)
        const isCurrent = possessionRef.current === team
        if (secs < 1 && !(forcePoint && isCurrent)) continue
        possAccumMsRef.current[team] -= secs * 1000
        possBufferRef.current.push({
          team: team === 'team_a' ? 'own' : 'opponent',
          pitch_x: pos.x, pitch_y: pos.y,
          minute: Math.min(mt.minute, 120),
          duration_seconds: secs,
        })
      }
    }
    if (sendNow || possBufferRef.current.length >= 100) void sendPossessionBuffer()
  }, [session?.match_id, calcMatchTime, sendPossessionBuffer])

  // Flush every 15s while tracking, on pause, and on unmount/leave.
  useEffect(() => {
    if (mode !== 'tracking') return
    const interval = setInterval(() => flushPossession(false, undefined, true), 15000)
    return () => clearInterval(interval)
  }, [mode, flushPossession])
  useEffect(() => {
    if (!isPlaying && mode === 'tracking') flushPossession(false, undefined, true)
  }, [isPlaying, mode, flushPossession])
  useEffect(() => () => flushPossession(false, undefined, true), [flushPossession])
  // Tab close / navigate away: best-effort beacon of whatever is still buffered
  useEffect(() => {
    const onUnload = () => {
      const matchId = session?.match_id
      if (!matchId) return
      flushPossession(false)
      if (possBufferRef.current.length === 0) return
      const blob = new Blob(
        [JSON.stringify({ match_id: matchId, points: possBufferRef.current.splice(0, 500) })],
        { type: 'application/json' },
      )
      navigator.sendBeacon('/api/v1/possession-events/video-batch', blob)
    }
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [session?.match_id, flushPossession])

  // ── Ball position sampling (every 5s while playing AND tracking, and not
  // during a dead-ball situation — same gate as possession time) ────
  useEffect(() => {
    if (!isPlaying || !ballPosition || mode !== 'tracking' || deadBall) return
    const interval = setInterval(() => {
      const ms = playerRef.current?.getCurrentTimeMs?.()
      const tsMs = ms ?? currentTimeMs
      positionSamples.current.push({
        video_timestamp_ms: tsMs,
        pitch_x: ballPosition.x,
        pitch_y: ballPosition.y,
        possession_team: possession,
      })
      setBallTrail(prev => [...prev.slice(-49), { x: ballPosition.x, y: ballPosition.y }])
    }, 5000)
    return () => clearInterval(interval)
  }, [isPlaying, ballPosition, possession, currentTimeMs, deadBall])

  // ── Bulk save samples every 30s + on unmount/beforeunload ──────────
  const flushSamples = useCallback(() => {
    if (!sessionId || positionSamples.current.length === 0) return
    const toSave = [...positionSamples.current]
    positionSamples.current = []
    videoSessionsAPI.saveBallSamples(sessionId, toSave).catch(() => {
      // Re-queue on failure
      positionSamples.current.unshift(...toSave)
    })
  }, [sessionId])

  useEffect(() => {
    const interval = setInterval(flushSamples, 30000)
    const handleBeforeUnload = () => {
      if (!sessionId || positionSamples.current.length === 0) return
      const blob = new Blob(
        [JSON.stringify({ samples: positionSamples.current })],
        { type: 'application/json' },
      )
      navigator.sendBeacon(`/api/v1/video/session/${sessionId}/ball-samples`, blob)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      clearInterval(interval)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      flushSamples()
    }
  }, [flushSamples, sessionId])

  // ── Running score (computed from events) ──────────────────────────────

  const currentScore = useMemo(() => {
    const score = { team_a_goals: 0, team_a_points: 0, team_b_goals: 0, team_b_points: 0 }
    for (const event of events) {
      const isTwoPointer = event.scoring_context?.is_two_pointer
      if (event.event_type === 'GOAL_SCORED') {
        if (event.team === 'team_a') score.team_a_goals++
        else score.team_b_goals++
      } else if (event.event_type === 'POINT_SCORED') {
        const pts = isTwoPointer ? 2 : 1
        if (event.team === 'team_a') score.team_a_points += pts
        else score.team_b_points += pts
      } else if (['FREE_KICK', 'FORTY_FIVE', 'PENALTY'].includes(event.event_type) && event.scoring_context?.scored) {
        if (event.event_type === 'PENALTY') {
          if (event.team === 'team_a') score.team_a_goals++
          else score.team_b_goals++
        } else {
          const pts = isTwoPointer ? 2 : 1
          if (event.team === 'team_a') score.team_a_points += pts
          else score.team_b_points += pts
        }
      }
    }
    return score
  }, [events])

  const teamATotal = currentScore.team_a_goals * 3 + currentScore.team_a_points
  const teamBTotal = currentScore.team_b_goals * 3 + currentScore.team_b_points

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleTimeUpdate = useCallback((ms: number) => {
    // Accrue possession in VIDEO time: only forward deltas small enough to be
    // normal playback (a seek/scrub shows up as a large or negative delta and
    // is ignored), and only while possession is "live" (see possLive).
    const prev = lastPossTickMsRef.current
    lastPossTickMsRef.current = ms
    if (prev != null && possLiveRef.current) {
      const delta = ms - prev
      if (delta > 0 && delta < 2000) possAccumMsRef.current[possessionRef.current] += delta
    }
    setCurrentTimeMs(ms)
    if (mode === 'tracking') {
      setHighWaterMarkMs(prev => (ms > prev ? ms : prev))
    }
  }, [mode])
  const handleDurationChange = useCallback((ms: number) => setVideoDurationMs(ms), [])
  const handleSeek = useCallback((ms: number) => playerRef.current?.seekTo(ms), [])

  // TaggingPitch's ballPosition prop needs a `team` field (for ring/trail
  // colour) — derived from `possession`, not independently tracked. The
  // page's own ballPosition state stays plain {x, y}, as before.
  const taggingBallPosition = useMemo<BallPosition | null>(() => {
    if (!ballPosition) return null
    return {
      x: ballPosition.x,
      y: ballPosition.y,
      team: possession === 'team_a' ? PossessionTeam.OWN : PossessionTeam.OPPONENT,
    }
  }, [ballPosition, possession])

  // TaggingPitch handlers — replaces the old BallMinimap wiring.
  // onBallMove (tap or drag-end commit) and onDragUpdate (live during drag)
  // both just update the display state the sidebar and the 5s/30s
  // position-sample pipeline read from `ballPosition`/`ballTrail`.
  const handleTaggingBallMove = useCallback((position: BallPosition) => {
    setBallPosition({ x: position.x, y: position.y })
    setBallTrail(prev => [...prev.slice(-49), { x: position.x, y: position.y }])
  }, [])

  // Which side the kicking team is attacking right now, for 45m-line
  // placement — mirrors MatchRecording.tsx's compute45LineX (34/66, the
  // live-tuned real line position confirmed against the pitch SVG's actual
  // drawn line, not the theoretical 45/145≈31/69).
  const compute45LineX = useCallback((isHomeTeam: boolean): number => {
    const attackingRightFirstHalf = matchData?.attacking_right_first_half ?? true
    const currentHalf = calcMatchTime(currentTimeMs).half
    const teamAttackingRight = currentHalf === 2 ? !attackingRightFirstHalf : attackingRightFirstHalf
    const kickingTeamAttacksRight = isHomeTeam ? teamAttackingRight : !teamAttackingRight
    return kickingTeamAttacksRight ? 66 : 34
  }, [matchData?.attacking_right_first_half, calcMatchTime, currentTimeMs])

  // Discrete possession-change point — fires on a tap or drag-END commit
  // only (bound to onBallMove, never onDragUpdate's live-drag callback, so
  // this doesn't fire dozens of times per drag). Mirrors MatchRecording.tsx's
  // handleBallMove writing a PossessionEvent on every commit. Also resolves
  // the on-pitch tap steps (kickout landing, 45 line) and the free-position
  // adjust drag, none of which are open-play possession.
  const handleTaggingBallCommit = useCallback((position: BallPosition) => {
    handleTaggingBallMove(position)

    // Dead ball — repositioning a free before it's taken. Just moves the
    // ball; never writes possession (matches live recording).
    if (pendingFreeKick) return

    // If waiting for a pitch tap (kickout landing / 45 line), resolve it
    if (overlayState === 'pitch' && pendingOverlay) {
      const isFortyFive = pendingOverlay.action.pitchPrompt === 'forty_five'
      const isKickout = pendingOverlay.action.pitchPrompt === 'kickout' || pendingOverlay.action.pitchPrompt === 'kickout_sideline'
      // A 45 is always taken ON the 45m line — the tap only decides the y
      // (left/right); x snaps to the real line for the taking team.
      const px = isFortyFive ? compute45LineX(pendingOverlay.eventData.team === 'team_a') : position.x
      const data: VideoEventCreateData = {
        ...pendingOverlay.eventData,
        pitch_x: px,
        pitch_y: position.y,
        pitch_zone: xyToZone(px, position.y),
      }
      if (isFortyFive) {
        setBallPosition(prev => (prev ? { ...prev, x: px } : prev))
        setHighlight45LineX(null)
      }
      // Optional "aimed for" target chosen on the landing banner
      if (isKickout && kickoutAimedForId) {
        const target = (players || []).find((p: any) => p.id === kickoutAimedForId)
        if (target) data.description = `Aimed for: ${(target as any).name}`
      }
      setKickoutAimedForId(undefined)
      const pending = { ...pendingOverlay, eventData: data }

      // 45: the line tap comes first, THEN who took it (own team only)
      if (pending.action.pitchStep === 'before_player' && pending.action.needsPlayer && data.team === 'team_a') {
        setPendingOverlay(pending)
        setOverlayState('player')
        return
      }
      setOverlayState('none')
      setPendingOverlay(null)
      setTimeout(() => finalizeEventRef.current(pending, data), 0)
      return // Don't record possession point - the event will do that
    }

    // If High Ball is armed, this commit IS the landing spot — log it, then
    // keep going: a long kick isn't a dead-ball restart, so the normal
    // possession recording below should still happen exactly as if this
    // were any other tap/drag.
    if (pendingLongKick && sessionId) {
      const kickTeam = pendingLongKick.team
      const kickPlayerId = pendingLongKick.playerId
      const kind = pendingLongKick.kind
      const kickedFrom = pendingLongKick.from ?? { x: position.x, y: position.y }
      setPendingLongKick(null)
      const matchTime = calcMatchTime(currentTimeMs)
      // pitch_x/y = where it was kicked FROM; end_x/y = where it landed
      const data: VideoEventCreateData = {
        event_type: kind === 'high_ball' ? 'HIGH_BALL' : 'LONG_KICK_PASS',
        team: kickTeam,
        half: matchTime.half,
        match_minute: matchTime.minute,
        match_second: matchTime.second,
        video_timestamp_ms: currentTimeMs,
        pitch_x: kickedFrom.x,
        pitch_y: kickedFrom.y,
        end_x: position.x,
        end_y: position.y,
        pitch_zone: xyToZone(kickedFrom.x, kickedFrom.y),
        description: kind === 'high_ball' ? 'High ball' : 'Long kick pass',
        source: 'human_tag',
        ...(kickPlayerId ? { player_id: kickPlayerId } : {}),
      }
      createEvent.mutate({ sessionId, data })
      // A long ball isn't in onCarrierTerminalEvent's terminalMap (that call
      // was a silent no-op) — the launching carrier is NOT who the high
      // ball lands with, so their segment must actually end here, not stay
      // open until something else eventually closes it. 'pass' matches
      // startCarrierSegment's own end-of-previous-segment reason (a high
      // ball IS a same-team pass attempt), keeping a possession chain open
      // rather than wrongly closing it. Own team only — opposition never
      // has a real carrier segment (we don't track their identities), and
      // an opposition high ball shouldn't be able to close out OUR active
      // carrier's segment if one happens to be open.
      if (kickTeam === 'team_a') {
        endCarrierQueued(position.x, position.y, 'pass')
      }
    }

    // Discrete placement point — written with the VIDEO-time possession
    // accumulated since the last flush (and only if there is any, plus one
    // location point for the team in possession). Live possession time is
    // measured in video time, not wall-clock — see flushPossession.
    if (!isPlaying) return // paused: repositioning isn't possession time
    flushPossession(true, { x: position.x, y: position.y })
    // endCarrierSegment deliberately omitted — it's declared further down
    // the component (useCallback with a stable `[]` dep array, so its
    // identity never changes) and including it here would be a genuine
    // TDZ error, not just a lint nit: this callback is created before that
    // declaration is reached.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleTaggingBallMove, flushPossession, compute45LineX, players, sessionId, createEvent, overlayState, pendingOverlay, pendingFreeKick, kickoutAimedForId, isPlaying])


  // Persistent attack-direction indicator — null until direction is known
  // (i.e. until the setup flow's direction step is complete).
  const teamAttackingRightThisHalf = useMemo<boolean | null>(() => {
    const attackingRightFirstHalf = matchData?.attacking_right_first_half
    if (attackingRightFirstHalf == null) return null
    const currentHalf = calcMatchTime(currentTimeMs).half
    return currentHalf === 2 ? !attackingRightFirstHalf : attackingRightFirstHalf
  }, [matchData?.attacking_right_first_half, calcMatchTime, currentTimeMs])

  const [highlight45LineX, setHighlight45LineX] = useState<number | null>(null)

  // Refs for carrier lifecycle callbacks — defined later but needed by
  // handleFoulSubtypeSelect / handleDirectCreate which are declared first.
  const carrierTerminalRef = useRef<(eventType: string) => void>(() => {})
  const carrierPossessionSwapRef = useRef<() => void>(() => {})

  /** Create the event, apply auto-flip/auto-switch, resume video.
   *  Stored in a ref so overlay handlers always call the latest version. */
  const finalizeEventRef = useRef<(pending: OverlayPendingEvent, data: VideoEventCreateData) => void>(() => {})
  /** Creates the event + applies every follow-on effect (possession flip,
   *  kickout restart, tab switch, video resume). Split from finalizeEventRef
   *  so the on-pitch pickers can stash an event and commit it later. */
  const commitEventRef = useRef<(pending: OverlayPendingEvent, data: VideoEventCreateData) => void>(() => {})

  finalizeEventRef.current = (pending: OverlayPendingEvent, data: VideoEventCreateData) => {
    if (!sessionId) return
    const stash = () => { setOverlayState('none'); setPendingOverlay(null) }
    const playerName = data.player_id ? (players || []).find((p: any) => p.id === data.player_id)?.name : undefined

    // "Our Foul" → stash for the on-pitch foul-type picker instead of creating
    // immediately; handleFoulSubtypeSelect finalizes the event.
    if (data.event_type === 'FOUL_COMMITTED' && pending.action.id === 'foul_own') {
      setTacticalFoul(false)
      setPendingFoulSubtype({ pending, data })
      stash()
      return
    }

    // "T/O Lost" → ask WHY first (dispossession / unforced error / offensive
    // foul) instead of always logging a bare TURNOVER_LOST — same flat picker
    // as live recording. Needs a player, like live (skipping the player
    // records the bare event, as live does).
    if (data.event_type === 'TURNOVER_LOST' && data.team === 'team_a' && data.player_id) {
      setPendingTurnoverReason({ pending, data, playerName })
      stash()
      return
    }

    // "Our unforced error" → ask which type of error (stray pass, dropped ball…)
    if (data.event_type === 'OUR_UNFORCED_ERROR' && data.team === 'team_a' && data.player_id) {
      setPendingErrorSubtype({ pending, data, playerName })
      stash()
      return
    }

    commitEventRef.current(pending, data)
  }

  commitEventRef.current = (pending: OverlayPendingEvent, data: VideoEventCreateData) => {
    if (!sessionId) return

    // Second yellow card → automatic red card
    if (data.event_type === 'YELLOW_CARD' && data.player_id && yellowCardPlayerIds.has(data.player_id)) {
      data.event_type = 'RED_CARD'
      setSecondYellowFlash(true)
      setTimeout(() => setSecondYellowFlash(false), 2000)
    }

    // Black card → start 10-min countdown timer
    if (data.event_type === 'BLACK_CARD') {
      const player = playerList.find(p => p.id === data.player_id)
      setBlackCardTimers(prev => [...prev, {
        id: crypto.randomUUID(),
        playerLabel: player ? player.name.split(' ').map(n => n[0]).join('. ') + '.' : (data.jersey_number ? `#${data.jersey_number}` : `${data.match_minute}'`),
        startedAt: Date.now(),
      }])
    }

    // Opposition scorer prompt — the opponent roster generally isn't in the
    // system, so unlike our own scores this only captures a free-text name
    // (mirrors live recording's OppositionScorerStrip + opposition_roster).
    if (data.team === 'team_b' && OPPONENT_SCORE_TYPES.includes(data.event_type)) {
      createEvent.mutate({ sessionId, data }, {
        onSuccess: (created: any) => {
          if (created?.id) setPendingOppScorer({ eventId: created.id, mode: 'score', scoringContext: created.scoring_context || {} })
        },
      })
    } else if (data.team === 'team_a' && data.event_type === 'TURNOVER_WON' && (matchData?.opposition_roster || []).length > 0) {
      // Optional follow-up: which opposition player we forced it from.
      // Same banner, 'turnover_forced' mode (no footedness step).
      createEvent.mutate({ sessionId, data }, {
        onSuccess: (created: any) => { if (created?.id) setPendingOppScorer({ eventId: created.id, mode: 'turnover_forced' }) },
      })
    } else if (data.team === 'team_a' && PRESSURE_ELIGIBLE_TYPES.includes(data.event_type) && !isDeadBallShot(data)) {
      createEvent.mutate({ sessionId, data }, {
        onSuccess: (created: any) => {
          if (created?.id) setPendingPressure({ eventId: created.id, scoringContext: created.scoring_context || {} })
        },
      })
    } else {
      createEvent.mutate({ sessionId, data })
    }

    // Block → who recovered it? (own blocks only — matches live recording,
    // which only asks this after WE make the block)
    if (data.event_type === 'BLOCK_SHOT' && data.team === 'team_a') {
      setPendingBlockRecovery(true)
    }
    // Open-play sideline ball → who's in possession now?
    if (data.event_type === 'SIDELINE_BALL') {
      setPendingSidelineDecision(true)
    }
    // Auto-end carrier on terminal events (scores, turnovers, wides, etc.)
    onCarrierTerminalEvent(data.event_type)

    // Possession flip. Scores/wides/45s/penalties and shot turnovers (short,
    // saved, post) hand the ball to the OTHER team than whoever took the shot
    // (the config's fixed 'us'/'them' assumed it was always our shot, which
    // was wrong whenever the opposition scored); an interception goes to the
    // intercepting team; everything else follows the action's own flip.
    const action = pending.action
    const otherTeam: 'team_a' | 'team_b' = data.team === 'team_a' ? 'team_b' : 'team_a'
    const isRestart = KICKOUT_RESTART_VIDEO_TYPES.has(data.event_type)
    const isShotTurnover = SHOT_TURNOVER_VIDEO_TYPES.has(data.event_type)
    const flipTo: 'team_a' | 'team_b' | null =
      isRestart || isShotTurnover ? otherTeam
      : data.event_type === 'INTERCEPTION' ? (data.team === 'team_a' ? 'team_a' : 'team_b')
      : action.autoFlipTo ? (action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
      : null
    if (flipTo) {
      setPossession(flipTo)
      onCarrierPossessionSwap()
    }

    if (isRestart) {
      // Dead ball — the other team takes a kickout. Ball goes to their
      // goalkeeper area and the kickout outcome overlay appears on the pitch
      // (live recording's awaitingKickout). No possession accrues meanwhile.
      const attackRight = teamAttackingRightThisHalf ?? true
      const kickoutTeamIsOwn = otherTeam === 'team_a'
      const ownGoalX = attackRight ? 5 : 95
      const oppGoalX = attackRight ? 95 : 5
      setBallPosition({ x: kickoutTeamIsOwn ? ownGoalX : oppGoalX, y: 50 })
      const tab = data.team === 'team_a' ? 'opp_kickouts' : 'our_kickouts'
      setKickoutTab(tab)
      setKickoutMinimised(false)
      setAwaitingKickout(true)
      setActiveTab(tab)
    } else {
      // A kickout just resolved (or any non-restart event): clear the await.
      const isKickoutResult = data.event_type.includes('KICKOUT') || data.event_type === 'SIDELINE_KICK'
      // (Only a kickout result clears the await — a card/sub logged while a
      // kickout is pending must not cancel the kickout prompt.)
      if (isKickoutResult) {
        setAwaitingKickout(false)
        setKickoutTab(null)
      }
      if (isShotTurnover) setActiveTab('scoring')
      else if (action.autoSwitchTab && !(awaitingKickout && !isKickoutResult)) setActiveTab(action.autoSwitchTab)
    }

    // Dismiss AI banner on first manual event
    setAiDismissed(true)

    // Clear overlay state
    setOverlayState('none')
    setPendingOverlay(null)

    // Resume video if it was playing when the flow started. Reset the flag so
    // a stale `true` can't resume a video the coach later paused on purpose.
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      setTimeout(() => playerRef.current?.play(), 100)
    }
  }

  /** Start the event-tap flow: pause video → show player overlay if needed.
   *  Position always comes from the persistent tracking pitch's live ball
   *  position — needsPitch used to trigger a separate small tap-to-confirm
   *  overlay for this, but that pitch was the old minimap; now that ball
   *  position is tracked continuously on the big persistent pitch, that
   *  extra tap is redundant and has been removed. needsPitch still exists
   *  on ActionButton (used elsewhere, e.g. the 45m/Free Won flow) but no
   *  longer triggers its own overlay step here. */
  const handleEventTap = useCallback((pending: OverlayPendingEvent, opts?: { keepResumeState?: boolean }) => {
    // The video is usually already paused when a free/45 outcome is picked
    // (it was paused when the foul/45 started), so re-reading isPlaying()
    // there would say "wasn't playing" and the video would never resume
    // after the selection. Those continuations keep the state captured when
    // the flow began.
    const nowPlaying = playerRef.current?.isPlaying() || false
    wasPlayingRef.current = opts?.keepResumeState ? (nowPlaying || wasPlayingRef.current) : nowPlaying
    playerRef.current?.pause()

    // Position always comes from the live tracking-pitch ball position
    if (ballPosition) {
      pending.eventData.pitch_x = ballPosition.x
      pending.eventData.pitch_y = ballPosition.y
      if (!pending.eventData.pitch_zone) {
        pending.eventData.pitch_zone = xyToZone(ballPosition.x, ballPosition.y)
      }
    }
    pending.eventData.possession_team = possession

    setPendingOverlay(pending)

    const a = pending.action
    const isOwn = pending.eventData.team === 'team_a'
    if (a.pitchStep === 'before_player') {
      // 45: tap the 45m line first, who took it second (handled on the tap)
      setOverlayState('pitch')
    } else if (a.needsPlayer && (isOwn || a.id === 'foul_own')) {
      setOverlayState('player')
    } else if (a.pitchStep === 'after_player') {
      // Opposition kickout: no player to pick, straight to the landing tap
      setOverlayState('pitch')
    } else {
      // No player needed, or opponent event — finalize directly
      setOverlayState('none')
      setTimeout(() => finalizeEventRef.current(pending, pending.eventData), 0)
    }
  }, [ballPosition, possession])

  /** Player selected → finalize event, or go on to the pitch tap (kickouts) */
  const handlePlayerSelect = useCallback((player: Player) => {
    setPendingOverlay(prev => {
      if (!prev) return prev
      const data = { ...prev.eventData, player_id: player.id }

      // Kickouts: who won it first, THEN tap where it landed
      if (prev.action.pitchStep === 'after_player') {
        setOverlayState('pitch')
        return { ...prev, eventData: data }
      }

      // Otherwise finalize immediately
      setTimeout(() => finalizeEventRef.current(prev, data), 0)
      return prev
    })
  }, [])

  /** Player skipped → finalize without a player (kickouts still get the landing tap) */
  const handlePlayerSkip = useCallback(() => {
    setPendingOverlay(prev => {
      if (!prev) return prev
      if (prev.action.pitchStep === 'after_player') {
        setOverlayState('pitch')
        return prev
      }
      setTimeout(() => finalizeEventRef.current(prev, prev.eventData), 0)
      return prev
    })
  }, [])

  /** Our team conceded a foul → the opposition takes the free. Shared by the
   *  foul-type picker and the T/O-lost "offensive foul" path. */
  const beginOppositionFree = useCallback((eventType: string) => {
    setPendingFreeKick('opp_free')
    setPossession('team_b')
    carrierPossessionSwapRef.current()
    setActiveTab('scoring')
    carrierTerminalRef.current(eventType)
    setAiDismissed(true)
  }, [])

  /** Foul subtype selected (or skipped) — finalize the stashed Our Foul event */
  const handleFoulSubtypeSelect = useCallback((subtype?: string) => {
    if (!pendingFoulSubtype || !sessionId) {
      setPendingFoulSubtype(null)
      return
    }
    const { data } = pendingFoulSubtype
    const resolved = tacticalFoul ? 'tactical' : subtype
    if (resolved) data.sub_type = resolved
    setTacticalFoul(false)
    setPendingFoulSubtype(null)

    // Create the FOUL_COMMITTED event
    createEvent.mutate({ sessionId, data })

    // Our team fouled → opposition gets the free. Resume the video now so the
    // coach can watch the free being taken; the free-outcome overlay stays up
    // and possession stays frozen (dead ball) until the outcome is picked.
    beginOppositionFree(data.event_type)
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      setTimeout(() => playerRef.current?.play(), 100)
    }
  }, [pendingFoulSubtype, sessionId, createEvent, tacticalFoul, beginOppositionFree])

  /** "How was possession lost?" resolved — dispossession / unforced error /
   *  offensive foul, mirrors live recording's handleTurnoverFlatSelect. */
  const handleTurnoverReasonSelect = useCallback((reason: TurnoverReason, subType?: string, tactical?: boolean) => {
    const stash = pendingTurnoverReason
    setPendingTurnoverReason(null)
    if (!stash || !sessionId) return
    const cfg = TURNOVER_REASON_CONFIG[reason]
    const resolvedSub = cfg.foulMode && tactical ? 'tactical' : subType
    const videoType = reason === 'dispossession' ? 'TURNOVER_LOST' : reason === 'unforced' ? 'OUR_UNFORCED_ERROR' : 'FOUL_COMMITTED'
    const data: VideoEventCreateData = { ...stash.data, event_type: videoType, ...(resolvedSub ? { sub_type: resolvedSub } : {}) }

    if (cfg.foulMode) {
      // Offensive foul concedes a free — same handling as any other foul
      createEvent.mutate({ sessionId, data })
      beginOppositionFree(videoType)
      if (wasPlayingRef.current) {
        wasPlayingRef.current = false
        setTimeout(() => playerRef.current?.play(), 100)
      }
      return
    }
    commitEventRef.current({ ...stash.pending, action: { ...stash.pending.action, autoFlipTo: 'them' } }, data)
  }, [pendingTurnoverReason, sessionId, createEvent, beginOppositionFree])

  /** "Skip" on the turnover-reason picker cancels it (live recording drops
   *  the event too) — just resume the video. */
  const handleTurnoverReasonSkip = useCallback(() => {
    setPendingTurnoverReason(null)
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      setTimeout(() => playerRef.current?.play(), 100)
    }
  }, [])

  /** Unforced-error type chosen (or skipped) */
  const handleErrorSubtypeSelect = useCallback((subtype?: string) => {
    const stash = pendingErrorSubtype
    setPendingErrorSubtype(null)
    if (!stash || !sessionId) return
    const data: VideoEventCreateData = { ...stash.data, ...(subtype ? { sub_type: subtype } : {}) }
    commitEventRef.current(stash.pending, data)
  }, [pendingErrorSubtype, sessionId])

  /** CategorizedActionButtons main dispatcher — translates EventType enum
   *  into the existing OverlayPendingEvent + handleEventTap pipeline. */
  const handleQuickAction = useCallback((eventType: EventType) => {
    const config = EVENT_TYPE_CONFIG[eventType]
    if (!config) return

    const isFreeResult = [EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.WIDE_FREE, EventType.FREE_SHORT_PASS, EventType.FREE_HIGH_BALL].includes(eventType) ||
      (eventType === EventType.SHORT && !!pendingFreeKick)
    const is45Result = eventType === EventType.FORTY_FIVE || eventType === EventType.FORTY_FIVE_MISSED

    // Which team the event belongs to — decided by the event itself, same
    // rules as live recording's handleQuickAction (NOT blindly "whoever has
    // possession": after a score possession has already flipped, so "We Won"
    // a kickout was wrongly treated as an opposition event and skipped the
    // who-won prompt).
    const evStr = String(eventType).toUpperCase()
    const team: 'team_a' | 'team_b' =
      evStr.includes('KICKOUT_SIDELINE') ? (evStr.startsWith('OWN_') ? 'team_a' : 'team_b')
      : evStr.includes('OPPOSITION_WON') ? 'team_b'
      : evStr.includes('_WON') ? 'team_a'
      : (eventType === EventType.TURNOVER_LOST || eventType === EventType.OUR_UNFORCED_ERROR) ? 'team_a'
      : eventType === EventType.OPP_UNFORCED_ERROR ? 'team_b'
      // Interception / block: the team WITHOUT the ball wins it
      : (eventType === EventType.INTERCEPTION || eventType === EventType.BLOCK) ? (possession === 'team_a' ? 'team_b' : 'team_a')
      // Free results: whoever was awarded the free takes it
      : isFreeResult ? (pendingFreeKick === 'our_free' ? 'team_a' : pendingFreeKick === 'opp_free' ? 'team_b' : possession)
      : evStr.startsWith('OWN_') ? 'team_a'
      : possession

    const matchTime = calcMatchTime(currentTimeMs)
    const zone = ballPosition ? xyToZone(ballPosition.x, ballPosition.y) : undefined
    // Two-pointer = outside the taking team's 40m arc, measured on the ACTUAL
    // ball position (so an adjusted free counts from where it's really taken).
    // Same ellipse the Point / 2PT buttons use to enable themselves. The coarse
    // zone grid (TWO_POINTER_ZONES) is NOT used here: it marks whole rows of the
    // pitch, so a free brought inside the arc still came out as a 2-pointer.
    const takingRight = team === 'team_a' ? (teamAttackingRightThisHalf ?? true) : !(teamAttackingRightThisHalf ?? true)
    const takingGoalX = takingRight ? 100 : 0
    const isTwoPointer = ballPosition
      ? (((ballPosition.x - takingGoalX) / 29.0) ** 2 + ((ballPosition.y - 50) / 46.0) ** 2) > 1
      : false

    const scoringContext: Record<string, unknown> = {}
    // Sources use the backend's uppercase vocabulary (FROM_FREE / FROM_PLAY /
    // FROM_45) — the sync mapper and chart adapter key off 'FROM_FREE', so the
    // old lowercase 'free' made every free point sync as an ordinary point.
    if (['GOAL_SCORED', 'POINT_SCORED', 'WIDE', 'SHORT', 'HIT_POST', 'SAVED', 'FREE_KICK'].includes(config.videoType)) {
      scoringContext.is_two_pointer = !!config.twoPointer || isTwoPointer
      scoringContext.source = isFreeResult ? 'FROM_FREE' : 'FROM_PLAY'
    }
    if (config.wideFree) scoringContext.wide = true
    if (config.videoType === 'PENALTY') scoringContext.scored = !!config.scored
    if (is45Result) {
      scoringContext.source = 'FROM_45'
      scoringContext.scored = eventType === EventType.FORTY_FIVE
    }

    const data: VideoEventCreateData = {
      event_type: config.videoType,
      team,
      half: matchTime.half,
      match_minute: matchTime.minute,
      match_second: matchTime.second,
      video_timestamp_ms: currentTimeMs,
      pitch_x: ballPosition?.x,
      pitch_y: ballPosition?.y,
      pitch_zone: zone,
      scoring_context: Object.keys(scoringContext).length > 0 ? scoringContext as any : undefined,
      description: config.description,
      source: 'human_tag',
    }

    if (isFreeResult) {
      // Ref brought the free forward: record it on the FOUL event that won the free
      // (foul spot stays in pitch_x/y, where it was actually taken goes in advanced_position)
      if (broughtForwardReason && ballPosition && sessionId) {
        const foulTeam = pendingFreeKick === 'our_free' ? 'team_b' : 'team_a'
        const reason = broughtForwardReason
        const apply = (attempt = 0) => {
          const cached = queryClient.getQueryData<{ events: VideoEvent[] }>(['videoEvents', sessionId])
          const foul = [...(cached?.events ?? [])].reverse().find(e => e.event_type === 'FOUL_COMMITTED' && e.team === foulTeam)
          if (!foul) return
          // The foul may still be saving (optimistic id) — try again shortly
          if (foul.id.startsWith('temp-') && attempt < 6) { setTimeout(() => apply(attempt + 1), 1000); return }
          updateEvent.mutate({
            eventId: foul.id,
            sessionId,
            data: {
              brought_forward: true,
              brought_forward_reason: reason,
              advanced_position_x: ballPosition.x,
              advanced_position_y: ballPosition.y,
            },
          })
        }
        apply()
      }
      setPendingFreeKick(null)
      setIsAdjustingFree(false)
    }
    // (45: the pending45 outcome panel closes now; the 45m-line highlight
    // stays until the line is tapped — see handleTaggingBallCommit)
    if (is45Result) {
      setPending45(false)
    }

    // Kickouts always need the landing tap (and, for our own, an optional
    // "aimed for") — same as live recording's pendingKickoutEvent step.
    const isKickoutAction = config.videoType.includes('KICKOUT') || config.videoType === 'SIDELINE_KICK'
    const isSidelineKickout = config.videoType === 'SIDELINE_KICK'

    const action: ActionButton = {
      id: eventType,
      label: eventType,
      eventType: config.videoType,
      needsPlayer: config.needsPlayer,
      autoFlipTo: config.autoFlipTo,
      autoSwitchTab: config.autoSwitchTab,
      playerModalTitle: config.playerModalTitle,
      playerModalEventType: config.playerModalEventType,
      ...(isKickoutAction ? {
        pitchStep: 'after_player' as const,
        pitchPrompt: (isSidelineKickout ? 'kickout_sideline' : 'kickout') as PitchPrompt,
      } : {}),
      ...(is45Result ? { pitchStep: 'before_player' as const, pitchPrompt: 'forty_five' as PitchPrompt } : {}),
    }
    setKickoutAimedForId(undefined)

    handleEventTap(
      { action, eventData: data, freeKickContext: isFreeResult },
      { keepResumeState: isFreeResult || is45Result },
    )
  }, [possession, calcMatchTime, currentTimeMs, ballPosition, pendingFreeKick, handleEventTap, teamAttackingRightThisHalf, broughtForwardReason, sessionId, queryClient, updateEvent])

  /** CategorizedActionButtons foul callback */
  const handleFoulClick = useCallback((team: 'own' | 'opponent') => {
    const matchTime = calcMatchTime(currentTimeMs)
    const zone = ballPosition ? xyToZone(ballPosition.x, ballPosition.y) : undefined

    if (team === 'own') {
      const data: VideoEventCreateData = {
        event_type: 'FOUL_COMMITTED',
        team: 'team_a',
        half: matchTime.half,
        match_minute: matchTime.minute,
        match_second: matchTime.second,
        video_timestamp_ms: currentTimeMs,
        pitch_x: ballPosition?.x,
        pitch_y: ballPosition?.y,
        pitch_zone: zone,
        source: 'human_tag',
      }
      const action: ActionButton = {
        id: 'foul_own',
        label: 'Our Foul',
        eventType: 'FOUL_COMMITTED',
        needsPlayer: true,
        playerModalTitle: 'Who Committed the Foul?',
      }
      handleEventTap({ action, eventData: data })
    } else {
      if (!sessionId) return
      // Dead ball from here until the free's outcome is picked, but nothing
      // needs picking first — leave the video playing so the free can be
      // watched; the outcome overlay appears on the pitch and possession is
      // frozen meanwhile. (Picking an own-team taker later pauses briefly.)
      const data: VideoEventCreateData = {
        event_type: 'FOUL_COMMITTED',
        team: 'team_b',
        half: matchTime.half,
        match_minute: matchTime.minute,
        match_second: matchTime.second,
        video_timestamp_ms: currentTimeMs,
        pitch_x: ballPosition?.x,
        pitch_y: ballPosition?.y,
        pitch_zone: zone,
        source: 'human_tag',
      }
      createEvent.mutate({ sessionId, data })
      carrierTerminalRef.current('FOUL_COMMITTED')
      setPossession('team_a')
      carrierPossessionSwapRef.current()
      setPendingFreeKick('our_free')
      setActiveTab('scoring')
      setAiDismissed(true)
    }
  }, [calcMatchTime, currentTimeMs, ballPosition, sessionId, createEvent, handleEventTap])

  /** CategorizedActionButtons 45 callback */
  const handle45Click = useCallback(() => {
    const lineX = compute45LineX(possession === 'team_a')
    setHighlight45LineX(lineX)
    setBallPosition(prev => (prev ? { ...prev, x: lineX } : prev))
    setPending45(true)
  }, [possession, compute45LineX])

  /** CategorizedActionButtons discipline callback (cards) */
  const handleDiscipline = useCallback((eventType: EventType) => {
    const config = EVENT_TYPE_CONFIG[eventType]
    if (!config) return
    const matchTime = calcMatchTime(currentTimeMs)
    const zone = ballPosition ? xyToZone(ballPosition.x, ballPosition.y) : undefined
    const data: VideoEventCreateData = {
      event_type: config.videoType,
      team: 'team_a',
      half: matchTime.half,
      match_minute: matchTime.minute,
      match_second: matchTime.second,
      video_timestamp_ms: currentTimeMs,
      pitch_x: ballPosition?.x,
      pitch_y: ballPosition?.y,
      pitch_zone: zone,
      source: 'human_tag',
    }
    const action: ActionButton = {
      id: eventType,
      label: eventType,
      eventType: config.videoType,
      needsPlayer: true,
      playerModalTitle: config.playerModalTitle,
    }
    handleEventTap({ action, eventData: data })
  }, [calcMatchTime, currentTimeMs, ballPosition, handleEventTap])

  /** Block deflected out for a sideline ball */
  const handleBlockResultSideline = useCallback(() => {
    setPendingBlockRecovery(false)
    setPendingSidelineDecision(true)
  }, [])

  /** Block deflected behind end line → 45 to the attacking team */
  const handleBlockResultFortyFive = useCallback(() => {
    setPendingBlockRecovery(false)
    const lineX = compute45LineX(possession === 'team_a')
    setHighlight45LineX(lineX)
    setBallPosition(prev => (prev ? { ...prev, x: lineX } : prev))
    setPending45(true)
  }, [possession, compute45LineX])

  const handleCancelFree = useCallback(() => {
    setPendingFreeKick(null)
    setIsAdjustingFree(false)
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      setTimeout(() => playerRef.current?.play(), 100)
    }
  }, [])

  const handleCancel45 = useCallback(() => {
    setPending45(false)
    setHighlight45LineX(null)
  }, [])

  /** Cancel a kickout (awaiting outcome, or waiting on the landing tap) or a
   *  45 line-tap and resume the video. Mirrors live recording's
   *  handleCancelKickout / handleCancelFortyFivePosition. */
  const handleCancelPitchStep = useCallback(() => {
    const pend = pendingOverlay
    // Cancelling a "we won it" kickout still leaves the ball with us
    if (pend && pend.action.pitchPrompt?.startsWith('kickout') && pend.eventData.team === 'team_a') {
      setPossession('team_a')
    }
    setAwaitingKickout(false)
    setKickoutTab(null)
    setKickoutAimedForId(undefined)
    setHighlight45LineX(null)
    setOverlayState('none')
    setPendingOverlay(null)
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      setTimeout(() => playerRef.current?.play(), 100)
    }
  }, [pendingOverlay])

  const handleCategoryChange = useCallback((cat: string | null) => {
    setActiveTab((cat || 'scoring') as Category)
  }, [])

  /** Cancel the overlay flow and resume video */
  const cancelOverlay = useCallback(() => {
    setOverlayState('none')
    setPendingOverlay(null)
    setHighlight45LineX(null)
    if (wasPlayingRef.current) {
      wasPlayingRef.current = false
      playerRef.current?.play()
    }
  }, [])

  /** Direct event creation (no overlay needed, e.g. KO Lost, cards) */
  const handleDirectCreate = useCallback((data: VideoEventCreateData) => {
    if (!sessionId) return
    createEvent.mutate({ sessionId, data })
    carrierTerminalRef.current(data.event_type)
    setAiDismissed(true)

    if (data.event_type === 'BLACK_CARD') {
      setBlackCardTimers(prev => [...prev, {
        id: crypto.randomUUID(),
        playerLabel: data.jersey_number ? `#${data.jersey_number}` : `${data.match_minute}'`,
        startedAt: Date.now(),
      }])
    }
  }, [sessionId, createEvent])

  /** Manual event entry modal submit — mirrors live recording's
   *  ManualEventEntryModal, but minute/half always derive from the current
   *  scrub position (calcMatchTime) rather than free-typed inputs, since
   *  scrubbing to the right moment before opening the modal already does
   *  that job for video. Substitution updates the in-memory on-field
   *  override rather than the match's live lineup (see subOverrides). */
  const handleManualEventSubmit = useCallback((payload: {
    eventType: string
    team: 'team_a' | 'team_b'
    playerId: string | null
    subInPlayerId?: string | null
    scoringContext?: Record<string, unknown>
  }) => {
    if (!sessionId) return
    const matchTime = calcMatchTime(currentTimeMs)
    const data: VideoEventCreateData = {
      event_type: payload.eventType,
      team: payload.team,
      half: matchTime.half,
      match_minute: matchTime.minute,
      match_second: matchTime.second,
      video_timestamp_ms: currentTimeMs,
      player_id: payload.playerId ?? undefined,
      sub_in_player_id: payload.subInPlayerId ?? undefined,
      scoring_context: payload.scoringContext as any,
      source: 'human_tag',
    }
    if (ballPosition) {
      data.pitch_x = ballPosition.x
      data.pitch_y = ballPosition.y
      data.pitch_zone = xyToZone(ballPosition.x, ballPosition.y)
    }

    createEvent.mutate({ sessionId, data }, {
      onSuccess: (created: any) => {
        const isOwnScore = payload.team === 'team_a' &&
          (payload.eventType === 'GOAL_SCORED' ||
            (payload.eventType === 'POINT_SCORED') ||
            (payload.eventType === 'FREE_KICK' && payload.scoringContext?.scored))
        if (isOwnScore && created?.id) {
          setAssistPromptEventId(created.id)
        }
      },
    })
    onCarrierTerminalEvent(payload.eventType)
    setAiDismissed(true)

    if (payload.eventType === 'SUB_ON' && payload.playerId && payload.subInPlayerId) {
      setSubOverrides(prev => ({ ...prev, [payload.playerId!]: false, [payload.subInPlayerId!]: true }))
    }
  }, [sessionId, createEvent, calcMatchTime, currentTimeMs, ballPosition])

  /** Opposition-only quick "Pass" log — a lightweight stand-in for the own-
   *  team carrier radial, which can't show for the opposition since we
   *  don't track their player identities. One tap logs a hand-pass event
   *  at the ball's current spot, no follow-up. */
  const handleQuickPass = useCallback(() => {
    if (!sessionId) return
    const matchTime = calcMatchTime(currentTimeMs)
    const data: VideoEventCreateData = {
      event_type: 'PASS_HAND',
      team: 'team_b',
      half: matchTime.half,
      match_minute: matchTime.minute,
      match_second: matchTime.second,
      video_timestamp_ms: currentTimeMs,
      source: 'human_tag',
    }
    if (ballPosition) {
      data.pitch_x = ballPosition.x
      data.pitch_y = ballPosition.y
      data.pitch_zone = xyToZone(ballPosition.x, ballPosition.y)
    }
    handleDirectCreate(data)
    setOppPassCount(c => c + 1)
  }, [sessionId, calcMatchTime, currentTimeMs, ballPosition, handleDirectCreate])

  /** Arm/disarm High Ball — either team, whichever currently has possession
   *  when armed (frozen, so a possession flip before the destination tap
   *  can't retroactively change who gets credited). Doesn't log anything by
   *  itself: the very next ball tap/drag-release on the tracking pitch is
   *  captured as the landing spot by handleTaggingBallCommit below — same
   *  "tap the pitch to resolve a pending action" pattern live recording
   *  uses for kickouts/45s, so nothing new is being trusted here. Tapping
   *  the icon again while armed cancels it. */
  const handleToggleLongKickArm = useCallback((kind: 'high_ball' | 'long_kick_pass') => {
    // Capture the launcher at arm-time (whoever's the active carrier) —
    // was recorded with no player_id at all, so the event read as a bare
    // "our player" instead of a real name. Only meaningful for our own
    // team (activeCarrierId only ever tracks our players).
    // Tapping the SAME icon again cancels; tapping the other one switches kind.
    setPendingLongKick(prev => prev && prev.kind === kind
      ? null
      : {
        team: possession,
        playerId: possession === 'team_a' ? activeCarrierId : null,
        kind,
        from: ballPosition ? { x: ballPosition.x, y: ballPosition.y } : null,
      })
  }, [possession, activeCarrierId, ballPosition])

  const handleTacticalTag = useCallback(async (tagType: string, label?: string) => {
    if (!session?.match_id) return
    const matchTime = calcMatchTime(currentTimeMs)
    try {
      await api.playerMovement.createTacticalTag({
        match_id: session.match_id,
        tag_type: tagType,
        label,
        half: matchTime.half,
        minute: matchTime.minute,
        pitch_x: ballPosition?.x,
        pitch_y: ballPosition?.y,
      })
      setTacticalTagCount(prev => prev + 1)
    } catch (err) {
      console.error('Failed to create tactical tag (video tagging):', err)
    }
  }, [session?.match_id, calcMatchTime, currentTimeMs, ballPosition])

  /** Opposition scorer / turnover-forced-from prompt — captures a name from
   *  Match Prep's opposition key players (not tracked as real Player rows,
   *  so this writes opponent_player_name directly rather than a player_id
   *  — mirrors live recording's OppositionScorerStrip). foot is only ever
   *  passed in 'score' mode; merges into the event's existing
   *  scoring_context rather than replacing it (the backend update route
   *  does a full replace, not a merge — losing source/is_two_pointer etc.
   *  set at creation time would silently break other things that read
   *  them). */
  const handleOppScorerSelect = useCallback((name: string, foot?: 'L' | 'R') => {
    if (sessionId && pendingOppScorer) {
      const data: VideoEventUpdateData = { opponent_player_name: name }
      if (foot) {
        data.scoring_context = { ...(pendingOppScorer.scoringContext || {}), foot }
      }
      updateEvent.mutate({ eventId: pendingOppScorer.eventId, sessionId, data })
    }
    setPendingOppScorer(null)
  }, [sessionId, pendingOppScorer, updateEvent])

  const handleOppScorerSkip = useCallback(() => setPendingOppScorer(null), [])

  /** Block → who recovered it? Own blocks only (matches live recording,
   *  which only asks this after we make the block). No extra event is
   *  logged either way — the BLOCK_SHOT event already stands; this only
   *  decides who has the ball now. */
  const handleBlockRecovery = useCallback((weRecovered: boolean) => {
    setPossession(weRecovered ? 'team_a' : 'team_b')
    onCarrierPossessionSwap()
    setPendingBlockRecovery(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Open-play sideline ball → who's in possession now? */
  const handleSidelineDecision = useCallback((weWonIt: boolean) => {
    setPossession(weWonIt ? 'team_a' : 'team_b')
    onCarrierPossessionSwap()
    setPendingSidelineDecision(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDeleteEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    deleteEvent.mutate({ eventId, sessionId })
  }, [sessionId, deleteEvent])

  const handleVerifyEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    verifyEvent.mutate({ eventId, sessionId })
  }, [sessionId, verifyEvent])

  /** Explicit 1pt <-> 2pt correction from the event log. The pitch position stays as
   *  tagged; only the flag changes (merged into the existing scoring_context, since the
   *  update route replaces it wholesale and would drop source/scored/wide). */
  const handleToggleTwoPointer = useCallback((eventId: string, makeTwoPointer: boolean) => {
    if (!sessionId) return
    const existing = events.find(e => e.id === eventId)?.scoring_context || {}
    updateEvent.mutate({
      eventId,
      sessionId,
      data: { scoring_context: { ...existing, is_two_pointer: makeTwoPointer } },
    })
  }, [sessionId, updateEvent, events])

  // ── Event team/player re-editing — parity with MatchRecording.tsx's
  // handleEditEventClick/editChoice flow. VideoEventLog previously only
  // supported delete/verify/edit-zone. Video events already separate team
  // from event_type (no own_kickout_sideline/opp_kickout_sideline-style
  // paired swap needed like live recording has), so "edit team" is always
  // just PUTting the `team` field — the only nuance is that moving a
  // scoring/shot event TO our team needs a player picked, same reasoning
  // as live recording ("we need to know who actually took it").
  const SCORING_SHOT_VIDEO_TYPES = useMemo(() => new Set([
    'POINT_SCORED', 'GOAL_SCORED', 'WIDE', 'SHORT', 'POST_HIT',
    'FREE_KICK', 'FORTY_FIVE', 'PENALTY',
  ]), [])

  const [editTeamChoice, setEditTeamChoice] = useState<{ eventId: string; currentTeam: 'team_a' | 'team_b' } | null>(null)
  // Set only when the player picker below was opened to FINISH a team swap
  // (a scoring event moving to team_a) — carries the team patch that should
  // land alongside player_id once a player is chosen or skipped. Plain
  // "edit player" (no team change) leaves this null.
  const [editingPlayerEventId, setEditingPlayerEventId] = useState<string | null>(null)
  const [pendingTeamForPlayerEdit, setPendingTeamForPlayerEdit] = useState<'team_a' | 'team_b' | null>(null)

  const handleEditEventTeam = useCallback((eventId: string) => {
    const event = events.find(e => e.id === eventId)
    if (!event) return
    setEditTeamChoice({ eventId, currentTeam: event.team as 'team_a' | 'team_b' })
  }, [events])

  const handleConfirmEventTeamSwap = useCallback(() => {
    if (!editTeamChoice || !sessionId) return
    const { eventId, currentTeam } = editTeamChoice
    const event = events.find(e => e.id === eventId)
    const targetTeam = currentTeam === 'team_a' ? 'team_b' : 'team_a'
    setEditTeamChoice(null)
    if (!event) return

    if (targetTeam === 'team_a' && SCORING_SHOT_VIDEO_TYPES.has(event.event_type)) {
      // Chain into the player picker — same spirit as live recording's
      // handleSwapScoringTeam. Finished by handleEditPlayerSelect/Skip below.
      setPendingTeamForPlayerEdit('team_a')
      setEditingPlayerEventId(eventId)
      return
    }
    updateEvent.mutate({
      eventId,
      sessionId,
      data: { team: targetTeam, player_id: targetTeam === 'team_b' ? null : undefined },
    })
  }, [editTeamChoice, events, sessionId, updateEvent, SCORING_SHOT_VIDEO_TYPES])

  // Plain "edit player" — no team change, mirrors live recording's
  // handleEditEventPlayer.
  const handleEditEventPlayer = useCallback((eventId: string) => {
    setPendingTeamForPlayerEdit(null)
    setEditingPlayerEventId(eventId)
  }, [])

  const handleEditPlayerSelect = useCallback((player: Player) => {
    if (!sessionId || !editingPlayerEventId) return
    const eventId = editingPlayerEventId
    const teamPatch = pendingTeamForPlayerEdit
    setEditingPlayerEventId(null)
    setPendingTeamForPlayerEdit(null)
    updateEvent.mutate({
      eventId,
      sessionId,
      data: { player_id: player.id, ...(teamPatch ? { team: teamPatch } : {}) },
    })
  }, [sessionId, editingPlayerEventId, pendingTeamForPlayerEdit, updateEvent])

  // Skipping the edit-player picker still finishes a pending team swap
  // (player left blank) — same "Skip" spirit as everywhere else in
  // recording; a plain player-only edit (no team change) just cancels.
  const handleEditPlayerSkip = useCallback(() => {
    if (!sessionId || !editingPlayerEventId) return
    const eventId = editingPlayerEventId
    const teamPatch = pendingTeamForPlayerEdit
    setEditingPlayerEventId(null)
    setPendingTeamForPlayerEdit(null)
    if (teamPatch) {
      updateEvent.mutate({ eventId, sessionId, data: { team: teamPatch, player_id: null } })
    }
  }, [sessionId, editingPlayerEventId, pendingTeamForPlayerEdit, updateEvent])

  const handleVerifyAll = useCallback(() => {
    if (!sessionId) return
    events.filter(e => (e.source === 'gemini_auto' || e.source === 'keyframe_auto') && !e.is_verified).forEach(e => {
      verifyEvent.mutate({ eventId: e.id, sessionId })
    })
  }, [sessionId, events, verifyEvent])

  const handleEnrich = async () => {
    if (!sessionId) return
    setIsEnriching(true)
    try {
      const result = await videoSessionsAPI.enrich(sessionId)
      setEnrichmentReport(result.report)
    } catch (err: any) {
      setEnrichmentReport(`Error: ${err.message}`)
    } finally {
      setIsEnriching(false)
    }
  }

  const startAnalyzePoll = () => {
    if (analyzePollRef.current) clearInterval(analyzePollRef.current)
    analyzePollRef.current = setInterval(async () => {
      try {
        const updated = await videoSessionsAPI.get(sessionId!)
        if (updated.status === 'draft_ready' || updated.status === 'error') {
          if (analyzePollRef.current) clearInterval(analyzePollRef.current)
          analyzePollRef.current = null
          setIsAutoAnalyzing(false)
          refetchSession()
          refetchEvents()
          if (updated.status === 'error') {
            setAlertModal({ title: 'Analysis Failed', message: updated.error_message || 'Unknown error', variant: 'danger' })
          }
        }
      } catch (err: any) {
        // Stop polling on auth errors — cookie expired
        if (err?.message?.includes('401') || err?.message?.toLowerCase()?.includes('authentication')) {
          if (analyzePollRef.current) clearInterval(analyzePollRef.current)
          analyzePollRef.current = null
          setIsAutoAnalyzing(false)
        }
      }
    }, 3000)
  }

  const handleAutoAnalyzeClick = async () => {
    if (!sessionId || !session?.match_id) return

    // Check prerequisites: lineup + strip colours
    try {
      const [match, lineup] = await Promise.all([
        api.matches.getById(session.match_id).catch(() => null),
        api.matchLineups.getLineup(session.match_id).catch(() => []),
      ])

      const missingLineup = !lineup || (Array.isArray(lineup) && lineup.length === 0)
      const missingColours = !match?.team_strip_colour || !match?.opponent_strip_colour

      if (missingLineup || missingColours) {
        setPrereqModal({ missing: { lineup: missingLineup, colours: missingColours } })
        return
      }

      // All good — proceed immediately
      startAutoAnalyze()
    } catch {
      // If prereq check fails, assume incomplete and show the modal
      setPrereqModal({ missing: { lineup: true, colours: true } })
    }
  }

  const startAutoAnalyze = async () => {
    if (!sessionId) return
    setPrereqModal(null)
    setIsAutoAnalyzing(true)
    setAnalysisProgress(null)

    // Two-step: POST starts background task, then GET SSE reads progress
    try {
      const { promise, abort } = videoSessionsAPI.streamAnalysis(sessionId, {
        onProgress: (stage, detail) => {
          setAnalysisProgress(prev => ({
            stage,
            totalFrames: detail?.total_frames as number ?? prev?.totalFrames,
            survivingFrames: detail?.surviving as number ?? prev?.survivingFrames,
            completedBatches: detail?.completed as number ?? prev?.completedBatches,
            totalBatches: stage === 'analyzing' ? (detail?.total as number ?? prev?.totalBatches) : prev?.totalBatches,
            eventsSoFar: detail?.events_so_far as number ?? prev?.eventsSoFar,
          }))
        },
        onBatchComplete: () => {
          refetchEvents()
        },
        onDone: (_totalEvents) => {
          setIsAutoAnalyzing(false)
          setAnalysisProgress(null)
          sseAbortRef.current = null
          refetchSession()
          refetchEvents()
        },
        onError: (_message) => {
          sseAbortRef.current = null
          setAnalysisProgress(null)
          // SSE stream failed but background task may still be running — fall back to polling
          startAnalyzePoll()
        },
      })
      sseAbortRef.current = abort
      await promise
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      sseAbortRef.current = null
      setAnalysisProgress(null)
      // Background task already started (POST succeeded) — fall back to polling
      startAnalyzePoll()
    }
  }

  const handleImproveAnalysis = async () => {
    if (!sessionId) return
    setIsAutoAnalyzing(true)
    try {
      await videoSessionsAPI.improveAnalysis(sessionId)
      startAnalyzePoll()
    } catch (err: any) {
      setIsAutoAnalyzing(false)
      setAlertModal({ title: 'Improve Analysis Failed', message: err.message || 'Could not start improved analysis.', variant: 'danger' })
    }
  }

  const handleSyncClick = async () => {
    if (!sessionId) return
    try {
      const preview = await syncPreview.mutateAsync(sessionId)
      setSyncPreviewData(preview)
      setSyncStatusData(null)
      setShowSyncModal(true)
    } catch (err: any) {
      setAlertModal({ title: 'Sync Preview Failed', message: err.message || 'Could not load sync preview.', variant: 'danger' })
    }
  }

  const handleSyncConfirm = async () => {
    if (!sessionId) return
    try {
      await syncConfirm.mutateAsync(sessionId)
      pollRef.current = setInterval(async () => {
        try {
          const status = await videoEventsAPI.syncStatus(sessionId)
          setSyncStatusData(status)
          if (status.status === 'completed' || status.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            refetchSession()
          }
        } catch { /* ignore */ }
      }, 2000)
    } catch (err: any) {
      setSyncStatusData({ status: 'error', synced_count: null, ai_report_ready: false, error_message: err.message })
    }
  }

  const handleCloseSyncModal = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = null
    setShowSyncModal(false)
    setSyncPreviewData(null)
    setSyncStatusData(null)
  }

  const handleViewResult = () => {
    if (session?.match_id) navigate(`/results/${session.match_id}`)
  }

  // Build own players list for formation snapshot from lineup data,
  // Convert matchLineup to saved lineup format for modal
  const savedLineup = useMemo(() => {
    if (!matchLineup || matchLineup.length === 0) return undefined
    const lineupObj: Record<string, LineupEntry> = {}
    matchLineup.forEach((entry: any) => {
      lineupObj[entry.position_id] = {
        playerId: entry.player_id,
        jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number,
      }
    })
    return lineupObj
  }, [matchLineup])

  // pre-placed at their real lineup slot (FORMATION_XY, the same formation
  // coordinates the carrier-selection dots use) — matches live recording's
  // FormationSnapshotMode exactly, so the coach only drags players to where
  // they actually are rather than building the whole XV from scratch.
  // (must be before early returns to satisfy Rules of Hooks)
  const snapshotOwnPlayers = useMemo(() => {
    if (!matchLineup) return []
    const playerMap = new Map(players?.map(p => [p.id, p]) ?? [])
    const attackingRight = teamAttackingRightThisHalf ?? true
    return matchLineup
      .filter((entry: any) => entry.is_on_field ?? true)
      .map((entry: any) => {
        const player = playerMap.get(entry.player_id)
        const jerseyNumber = entry.match_jersey_number ?? entry.player_jersey_number ?? player?.jersey_number ?? null
        const base = FORMATION_XY[entry.position_id || ''] || { x: 50, y: 50 }
        return {
          playerId: entry.player_id,
          jerseyNumber,
          playerName: entry.player_name || player?.name || `#${jerseyNumber ?? '?'}`,
          x: attackingRight ? base.x : 100 - base.x,
          y: base.y,
        }
      })
  }, [matchLineup, players, teamAttackingRightThisHalf])

  // ── Position label map for carrier strip ─────────────────────────────
  const POSITION_LABELS: Record<string, string> = {
    'gk': 'GK', 'fb-left': 'CB', 'fb-center': 'FB', 'fb-right': 'CB',
    'hb-left': 'HB', 'hb-center': 'CHB', 'hb-right': 'HB',
    'mf-left': 'MF', 'mf-right': 'MF',
    'hf-left': 'HF', 'hf-center': 'CHF', 'hf-right': 'HF',
    'ff-left': 'CF', 'ff-center': 'FF', 'ff-right': 'CF',
  }

  // Build jersey strip player list from lineup data, with fallback to players list
  // when no lineup exists (allows ball carrier selection even without a lineup)
  const jerseyStripPlayers: JerseyPlayer[] = useMemo(() => {
    if (matchLineup && matchLineup.length > 0) {
      // Use lineup data when available (preferred - has positions)
      const playerMap = new Map((players || []).map(p => [p.id, p]))
      return matchLineup.map((entry: any) => {
        const player = playerMap.get(entry.player_id)
        return {
          playerId: entry.player_id,
          jerseyNumber: entry.match_jersey_number ?? entry.player_jersey_number ?? player?.jersey_number ?? null,
          playerName: player?.name ?? entry.player_name ?? 'Unknown',
          isOnField: entry.is_on_field ?? true,
          positionLabel: POSITION_LABELS[entry.position_id] || entry.position_id || '',
          positionId: entry.position_id || '',
        }
      })
    } else if (players && players.length > 0) {
      // Fallback: use players list directly when no lineup
      // Assign default GAA formation positions (1=GK, 2-7=backs, 8-9=mids, 10-15=forwards)
      const defaultPositions = [
        'gk', 'fb-right', 'fb-center', 'fb-left', 'hb-right', 'hb-center', 'hb-left',
        'mf-right', 'mf-left', 'hf-right', 'hf-center', 'hf-left', 'ff-right', 'ff-center', 'ff-left'
      ]
      return players.slice(0, 15).map((p, i) => ({
        playerId: p.id,
        jerseyNumber: p.jersey_number ?? null,
        playerName: p.name,
        isOnField: true,
        positionLabel: POSITION_LABELS[defaultPositions[i]] || '',
        positionId: defaultPositions[i] || 'mf-left', // Default to midfielder if > 15 players
      }))
    }
    return []
  }, [matchLineup, players])

  // On-field roster for the manual-event/substitution modal — real lineup
  // is_on_field, overridden in-memory by any subs logged this session.
  const onFieldPlayerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const entry of matchLineup || []) {
      const isOn = subOverrides[entry.player_id] ?? entry.is_on_field ?? true
      if (isOn) ids.add(entry.player_id)
    }
    return ids
  }, [matchLineup, subOverrides])

  // ── Ball carrier segment management ───
  // Selecting a carrier must feel instant — live recording had this exact
  // lag and fixed it in 294ed39 by updating the visible carrier immediately
  // and doing the network work behind it. Same here: activeCarrierId (the
  // highlight + status label) changes synchronously on tap; flushing the path,
  // ending the old segment and starting the new one run behind it in a
  // serialized queue, so rapid taps stay correctly ordered on the server.
  const activeCarrierIdRef = useRef<string | null>(null)
  activeCarrierIdRef.current = activeCarrierId
  const carrierQueueRef = useRef<Promise<unknown>>(Promise.resolve())
  const enqueueCarrierOp = useCallback((op: () => Promise<unknown>) => {
    carrierQueueRef.current = carrierQueueRef.current
      .then(op)
      .catch(err => console.error('Carrier segment operation failed:', err))
  }, [])

  /** Runs inside the queue: flush `points` to the active segment, then end it. */
  const endCarrierSegment = useCallback(async (
    endX: number | null | undefined,
    endY: number | null | undefined,
    endedBy: string | undefined,
    points: Array<{ x: number; y: number }>,
  ) => {
    const seg = activeSegmentRef.current
    if (!seg) return
    activeSegmentRef.current = null // claim it so nothing can double-end it

    if (points.length > 0) {
      try {
        await api.playerMovement.appendPathPoints(seg.id, points)
      } catch (err) {
        console.error('Failed to flush carrier path points:', err)
      }
    }
    try {
      await api.playerMovement.endCarrierSegment(seg.id, {
        end_x: endX ?? undefined,
        end_y: endY ?? undefined,
        ended_by: endedBy,
      })
    } catch (err) {
      console.error('Failed to end carrier segment:', err)
    }
  }, [])

  /** Instant end: clear the visible carrier now, snapshot the buffered path,
   *  and queue the network work. `keepState` when immediately switching carrier. */
  const endCarrierQueued = useCallback((
    endX: number | null | undefined,
    endY: number | null | undefined,
    endedBy: string,
    keepState = false,
  ) => {
    const points = carrierPathBufferRef.current
    carrierPathBufferRef.current = []
    if (carrierFlushTimerRef.current) {
      clearTimeout(carrierFlushTimerRef.current)
      carrierFlushTimerRef.current = null
    }
    if (!keepState) setActiveCarrierId(null)
    enqueueCarrierOp(() => endCarrierSegment(endX, endY, endedBy, points))
  }, [enqueueCarrierOp, endCarrierSegment])

  /** Runs inside the queue: create the new segment, then send any path points
   *  buffered while it was being created. */
  const startCarrierSegment = useCallback(async (
    playerId: string,
    jerseyNumber: number | null,
    startX: number | null,
    startY: number | null,
  ) => {
    if (!session?.match_id) return null
    const matchTime = calcMatchTime(currentTimeMs)
    try {
      const segment = await api.playerMovement.startCarrierSegment({
        match_id: session.match_id,
        player_id: playerId,
        jersey_number: jerseyNumber,
        team: possession === 'team_a' ? 'own' : 'opponent',
        half: matchTime.half,
        minute: matchTime.minute,
        start_x: startX,
        start_y: startY,
        source: 'video',
      })
      activeSegmentRef.current = segment
      if (carrierPathBufferRef.current.length > 0) {
        const pts = carrierPathBufferRef.current
        carrierPathBufferRef.current = []
        api.playerMovement.appendPathPoints(segment.id, pts).catch(err => {
          console.error('Failed to append carrier path points:', err)
        })
      }
      return segment
    } catch (err) {
      console.error('Failed to start carrier segment:', err)
      return null
    }
  }, [session?.match_id, calcMatchTime, currentTimeMs, possession])

  const handleCarrierSelect = useCallback((playerId: string, jerseyNumber: number | null) => {
    const bx = ballPosition?.x ?? null
    const by = ballPosition?.y ?? null
    const current = activeCarrierIdRef.current

    if (current === playerId) {
      // Deselect
      endCarrierQueued(bx, by, 'manual')
      return
    }
    // Switching carrier: close the previous carry at the pass spot, then
    // start the new one — all behind the instant visible update below.
    if (current) endCarrierQueued(bx, by, 'pass', true)
    setActiveCarrierId(playerId)
    // Track recent carriers (most recent first, max 10)
    setRecentCarrierIds(prev => [playerId, ...prev.filter(id => id !== playerId)].slice(0, 10))
    enqueueCarrierOp(() => startCarrierSegment(playerId, jerseyNumber, bx, by))
  }, [ballPosition, endCarrierQueued, enqueueCarrierOp, startCarrierSegment])

  // Append path points to the carrier's segment (throttled 200ms batching).
  // Points are buffered even while the new segment is still being created
  // (no segment id yet) and sent as soon as it exists.
  const appendCarrierPathPoint = useCallback((x: number, y: number) => {
    if (!activeCarrierIdRef.current) return
    carrierPathBufferRef.current.push({ x, y })

    if (!carrierFlushTimerRef.current) {
      carrierFlushTimerRef.current = setTimeout(() => {
        const seg = activeSegmentRef.current
        const points = carrierPathBufferRef.current
        if (seg && points.length > 0) {
          api.playerMovement.appendPathPoints(seg.id, points).catch(err => {
            console.error('Failed to append carrier path points:', err)
          })
          carrierPathBufferRef.current = []
        }
        carrierFlushTimerRef.current = null
      }, 200)
    }
  }, [])

  // Auto-end carrier on terminal events (scores, turnovers, wides)
  const onCarrierTerminalEvent = useCallback((eventType: string) => {
    if (!activeCarrierIdRef.current && !activeSegmentRef.current) return

    const terminalMap: Record<string, string> = {
      GOAL_SCORED: 'score',
      POINT_SCORED: 'score',
      FREE_KICK: 'score',
      FORTY_FIVE: 'score',
      PENALTY: 'score',
      WIDE: 'wide',
      SHORT: 'wide',
      SAVED: 'wide',
      TURNOVER_WON: 'turnover',
      TURNOVER_LOST: 'turnover',
      KICKOUT_WON: 'kickout',
      KICKOUT_LOST: 'kickout',
    }

    const endReason = terminalMap[eventType]
    if (endReason) {
      endCarrierQueued(ballPosition?.x ?? null, ballPosition?.y ?? null, endReason)
    }
  }, [endCarrierQueued, ballPosition])

  // Auto-end carrier on possession swap
  const onCarrierPossessionSwap = useCallback(() => {
    if (!activeCarrierIdRef.current && !activeSegmentRef.current) return
    endCarrierQueued(ballPosition?.x ?? null, ballPosition?.y ?? null, 'turnover')
  }, [endCarrierQueued, ballPosition])
  carrierTerminalRef.current = onCarrierTerminalEvent
  carrierPossessionSwapRef.current = onCarrierPossessionSwap

  // Drag-end: append the full downsampled waypoint path (collected by
  // TaggingPitch during the drag) to the active carrier segment in one
  // batch — the same call pattern as MatchRecording.tsx's handleDragPath,
  // reusing appendCarrierPathPoint's existing 200ms-throttled buffer/flush.
  // A tap-only reposition (no drag) does NOT append a carrier path point,
  // matching MatchRecording's own established onBallMove/onDragPath split —
  // a carrier's path comes from continuous drags, not discrete placements.
  const handleTaggingDragPath = useCallback((waypoints: Array<{ x: number; y: number }>) => {
    for (const wp of waypoints) {
      appendCarrierPathPoint(wp.x, wp.y)
    }

    // Queue the same waypoints as 0-duration possession path points (the
    // drag-path counterpart to handleTaggingBallCommit's single point). Goes
    // into the shared batched buffer — NOT the old /bulk endpoint, which
    // rewrites the previous event's duration from wall-clock time and would
    // overwrite the video-time durations. Skipped during dead-ball states
    // (e.g. repositioning a free), like live recording's handleDragPath.
    if (session?.match_id && possLiveRef.current) {
      const matchTime = calcMatchTime(currentTimeMs)
      const team = possession === 'team_a' ? 'own' : 'opponent'
      for (const wp of waypoints) {
        possBufferRef.current.push({
          team, pitch_x: wp.x, pitch_y: wp.y,
          minute: Math.min(matchTime.minute, 120), duration_seconds: 0,
        })
      }
      if (possBufferRef.current.length >= 100) void sendPossessionBuffer()
    }
  }, [appendCarrierPathPoint, session?.match_id, calcMatchTime, currentTimeMs, possession, sendPossessionBuffer])

  // Clean up carrier segment on unmount
  useEffect(() => {
    return () => {
      if (carrierFlushTimerRef.current) clearTimeout(carrierFlushTimerRef.current)
    }
  }, [])

  // Handle snapshot save — POST to API
  // (must be before early returns to satisfy Rules of Hooks)
  const handleSnapshotSave = useCallback(async (
    positions: Array<{ playerId?: string | null; jerseyNumber: number | null; playerName?: string | null; team: 'own' | 'opponent'; x: number; y: number }>,
    label: string,
  ) => {
    if (!session?.match_id) return
    const matchTime = calcMatchTime(currentTimeMs)
    try {
      await api.playerMovement.createSnapshot({
        match_id: session.match_id,
        half: matchTime.half,
        minute: matchTime.minute,
        label,
        positions: positions.map((p) => ({
          player_id: p.playerId ?? undefined,
          jersey_number: p.jerseyNumber,
          x: p.x,
          y: p.y,
          team: p.team,
          player_name: p.playerName ?? undefined,
        })),
        source: 'video',
        video_timestamp_ms: currentTimeMs,
      })
      setSnapshotCount((c) => c + 1)
    } catch (err) {
      console.error('Failed to save formation snapshot:', err)
    }
  }, [session?.match_id, currentTimeMs, calcMatchTime])

  // ── Loading / error states ────────────────────────────────────────────

  if (sessionLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-emerald-400" size={32} />
      </div>
    )
  }

  if (!session) {
    return (
      <div className="text-center py-20">
        <p className="text-white/50">Video session not found.</p>
        <button onClick={() => navigate(-1)} className="text-emerald-400 mt-2 text-sm">Go back</button>
      </div>
    )
  }

  const playerList = (players || []).map((p: any) => ({
    id: p.id, name: p.name, jersey_number: p.jersey_number,
    position: p.position || '', date_of_birth: p.date_of_birth || null,
    status: p.status || 'active', active: p.active ?? true,
  })) as Player[]

  const hasAiEvents = events.some(e => e.source === 'gemini_auto' || e.source === 'keyframe_auto')
  const needsHalftime = session.half === null
    && session.halftime_timestamp_ms == null
    && !halftimeSkipped

  // Guided setup-flow step — a single-half upload (session.half set) skips
  // the half-time/2nd-half-throw-in steps entirely (there's no 2nd half in
  // this video). Direction is only known once matchData has loaded.
  const isSingleHalfUpload = session.half !== null
  const needsSecondHalfMark = !isSingleHalfUpload && session.second_half_start_ms == null && !secondHalfSkipped
  const needsFullTimeMark = session.full_time_ms == null && !fullTimeSkipped
  const needsDirection = matchData?.attacking_right_first_half == null
  const setupStep: SetupStep =
    session.first_half_start_ms == null ? 'first_half'
    : needsHalftime ? 'half_time'
    : needsSecondHalfMark ? 'second_half'
    : needsFullTimeMark ? 'full_time'
    : needsDirection ? 'direction'
    : !throwInWinnerChosen ? 'throw_in_winner'
    : 'ready'
  const setupSaving = setHalftime.isPending || setFullTime.isPending || setAttackDirection.isPending || startTracking.isPending
  const setupError = setFullTime.error ? 'Failed to save full-time marker'
    : setAttackDirection.error ? 'Failed to save attack direction'
    : setHalftime.error ? 'Failed to save half-time marker'
    : null
  const canAutoAnalyze = stableVideoUrl.current && !isAutoAnalyzing
    && !hasAiEvents
    && ['uploaded', 'draft_ready', 'error'].includes(session.status)
    && !needsHalftime

  const aiEventCount = events.filter(e => e.source === 'gemini_auto' || e.source === 'keyframe_auto').length
  const lowConfidenceCount = events.filter(e =>
    (e.source === 'keyframe_auto') && e.event_confidence === 'LOW'
  ).length
  const canImproveAnalysis = hasAiEvents && !isAutoAnalyzing
    && session.status === 'draft_ready' && lowConfidenceCount > 0
  const showAiBanner = hasAiEvents && !isAutoAnalyzing
    && session.status === 'draft_ready' && !aiDismissed

  // Suppress unused variable warnings for hidden features
  void handleAutoAnalyzeClick; void canAutoAnalyze

  const handleMarkHalftime = (ms: number) => {
    setHalftime.mutate({ sessionId: sessionId!, halftimeMs: ms })
  }
  const handleSkipHalftime = () => setHalftimeSkipped(true)

  const opponentName = matchData?.opponent || 'Opposition'

  // ── Shared sub-components ─────────────────────────────────────────────

  /** Scoreboard widget — used in both normal and fullscreen headers */
  const scoreboard = (compact = false) => (
    <div className="flex items-center rounded-2xl border border-white/[0.12] overflow-hidden backdrop-blur-xl shadow-lg shadow-black/20"
      style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 50%, rgba(255,255,255,0.06) 100%)' }}
    >
      {/* Team A */}
      <div className={`flex items-center ${compact ? 'gap-1.5 px-2.5 py-1.5' : 'gap-2.5 px-5 py-2.5'} transition-all ${
        possession === 'team_a'
          ? 'bg-gradient-to-r from-emerald-500/20 to-emerald-500/5'
          : ''
      }`}>
        <div className={`${compact ? 'w-2 h-2' : 'w-3 h-3'} rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 flex-shrink-0`} />
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-semibold text-white/60 uppercase tracking-wide whitespace-nowrap`}>{clubName}</span>
        <span className={`${compact ? 'text-lg' : 'text-2xl'} font-black text-white tabular-nums ${compact ? 'min-w-[40px]' : 'min-w-[52px]'} text-center drop-shadow-sm`}>
          {currentScore.team_a_goals}-{String(currentScore.team_a_points).padStart(2, '0')}
        </span>
        <span className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-white/25 font-semibold tabular-nums`}>({teamATotal})</span>
      </div>
      <div className={`${compact ? 'px-1' : 'px-2'} text-[10px] text-white/20 font-bold`}>v</div>
      {/* Team B */}
      <div className={`flex items-center ${compact ? 'gap-1.5 px-2.5 py-1.5' : 'gap-2.5 px-5 py-2.5'} transition-all ${
        possession === 'team_b'
          ? 'bg-gradient-to-l from-orange-500/20 to-orange-500/5'
          : ''
      }`}>
        <span className={`${compact ? 'text-[9px]' : 'text-[11px]'} text-white/25 font-semibold tabular-nums`}>({teamBTotal})</span>
        <span className={`${compact ? 'text-lg' : 'text-2xl'} font-black text-white tabular-nums ${compact ? 'min-w-[40px]' : 'min-w-[52px]'} text-center drop-shadow-sm`}>
          {currentScore.team_b_goals}-{String(currentScore.team_b_points).padStart(2, '0')}
        </span>
        <span className={`${compact ? 'text-[10px]' : 'text-xs'} font-semibold text-white/60 uppercase tracking-wide whitespace-nowrap`}>{opponentName}</span>
        <div className={`${compact ? 'w-2 h-2' : 'w-3 h-3'} rounded-full bg-orange-500 shadow-sm shadow-orange-500/50 flex-shrink-0`} />
      </div>
    </div>
  )

  /** Elapsed match-time clock — the furthest point tracking has reached,
   *  not raw video position (a video can have an hour of pre-match content
   *  before throw-in). Live while playing, held steady while paused. */
  const trackingClock = mode === 'tracking' ? calcMatchTime(highWaterMarkMs) : null

  /** "35 (+2:00)" once a half runs past its normal duration — matches live
   *  recording's injury-time clock format. */
  const formatTrackingClock = (clock: { minute: number; second: number; half: number }): string => {
    const hdm = matchData?.half_duration_mins ?? 30
    const normalMinute = clock.half === 2 ? hdm * 2 : hdm
    if (clock.minute <= normalMinute) {
      return `${clock.minute}:${String(clock.second).padStart(2, '0')}`
    }
    const injuryTotalSec = (clock.minute - normalMinute) * 60 + clock.second
    const injuryMin = Math.floor(injuryTotalSec / 60)
    const injurySec = injuryTotalSec % 60
    return `${normalMinute} (+${injuryMin}:${String(injurySec).padStart(2, '0')})`
  }

  /** Get the appropriate end button text based on current phase and time */
  const getEndButtonText = (): string => {
    if (!trackingClock) return 'End'
    const hdm = matchData?.half_duration_mins ?? 30
    const fullTime = hdm * 2

    if (trackingClock.half === 1) {
      return trackingClock.minute >= hdm ? 'Half Time' : 'End Half'
    }
    if (trackingClock.half === 2) {
      return trackingClock.minute >= fullTime ? 'Full Time' : 'End Match'
    }
    return 'End'
  }

  /** Match clock + End Half + Undo — centre of the header. */
  const clockControls = (compact = false) => trackingClock ? (
    <div className="flex items-center gap-1.5 bg-emerald-500/10 rounded-lg px-2 py-1">
      <div className="flex flex-col">
        <span className={`${compact ? 'text-[8px]' : 'text-[9px]'} text-white/40 font-semibold uppercase tracking-wide`}>
          Match Clock
        </span>
        <span className={`font-mono font-bold text-emerald-400 tabular-nums ${compact ? 'text-xs' : 'text-sm'} leading-tight`}>
          {formatTrackingClock(trackingClock)}
        </span>
      </div>
      <button
        onClick={handleRequestEndTracking}
        className={`${compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'} rounded-md ${
          (trackingClock.half === 1 && trackingClock.minute >= (matchData?.half_duration_mins ?? 30)) ||
          (trackingClock.half === 2 && trackingClock.minute >= (matchData?.half_duration_mins ?? 30) * 2)
            ? 'bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 border border-amber-500/40'
            : 'bg-red-500/20 hover:bg-red-500/30 text-red-300 hover:text-red-200'
        } font-medium transition-colors whitespace-nowrap`}
      >
        {getEndButtonText()}
      </button>
      {(events && events.length > 0) && (
        <button
          onClick={() => setShowUndoModal(true)}
          className={`${compact ? 'px-2 py-1 text-[10px]' : 'px-2.5 py-1.5 text-xs'} rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 font-medium transition-colors whitespace-nowrap flex items-center gap-1`}
        >
          <Undo2 size={compact ? 10 : 12} />
          Undo
        </button>
      )}
    </div>
  ) : null

  /** View tools — right-aligned, icon + label (label hidden on narrow screens). */
  const viewToolsBar = () => {
    const tools: Array<{ key: string; icon: React.ReactNode; label: string; onClick: () => void }> = [
      { key: 'stats', icon: <BarChart3 size={15} />, label: 'Stats', onClick: () => statsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      { key: 'charts', icon: <PieChart size={15} />, label: 'Charts', onClick: () => chartsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) },
      {
        key: 'lineup', icon: <Users size={15} />,
        label: (!matchLineup || matchLineup.length === 0) ? 'Select Lineup' : 'Lineup',
        onClick: () => { if (!matchLineup || matchLineup.length === 0) setIsLineupModalOpen(true); else setShowViewLineup(true) },
      },
      { key: 'weather', icon: <CloudSun size={15} />, label: 'Weather', onClick: () => setShowWeatherPicker(true) },
      { key: 'event', icon: <Plus size={15} />, label: 'Event', onClick: () => setShowManualEvent(true) },
    ]
    return (
      <div className="flex items-center gap-0.5 bg-white/5 rounded-lg px-1.5 py-1">
        {tools.map(t => (
          <button
            key={t.key}
            onClick={t.onClick}
            title={t.label}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md hover:bg-white/10 text-white/70 hover:text-white text-xs font-medium transition-colors whitespace-nowrap"
          >
            {t.icon}
            <span className="hidden lg:inline">{t.label}</span>
          </button>
        ))}
      </div>
    )
  }

  /** "More" menu — the less-frequent / higher-stakes actions: Finish & Generate Report,
   *  Tactical Report, Reset (kept away from the everyday buttons). */
  const taggingFinished = session?.status === 'completed'
  const moreMenu = (
    <div className="relative flex items-center gap-2">
      {events.length > 0 && (
        <button
          onClick={() => handleSyncClick()}
          disabled={syncPreview.isPending}
          title={taggingFinished
            ? 'Tagging finished — this match counts in season stats. Edits still save straight to the match.'
            : 'Events save to the match as you tag. This match stays out of season stats until you finish tagging.'}
          className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
            taggingFinished
              ? 'bg-emerald-500/10 border-emerald-400/25 text-emerald-300 hover:bg-emerald-500/20'
              : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'
          }`}
        >
          {taggingFinished ? <CheckCircle2 size={13} /> : <span className="w-1.5 h-1.5 rounded-full bg-sky-300 animate-pulse" />}
          {taggingFinished ? 'Finished' : 'Tagging in progress · Finish'}
        </button>
      )}
      <button
        onClick={() => setShowMoreMenu(v => !v)}
        title="More"
        className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors"
      >
        <MoreHorizontal size={18} />
      </button>
      {showMoreMenu && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setShowMoreMenu(false)} />
          <div
            className="absolute right-0 top-full mt-2 z-[70] w-60 rounded-xl p-1.5"
            style={{
              background: 'linear-gradient(135deg, rgba(10,26,32,0.92), rgba(8,20,26,0.86))',
              border: '1px solid rgba(255,255,255,0.14)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1)',
            }}
          >
            <button
              onClick={() => { setShowMoreMenu(false); handleSyncClick() }}
              disabled={syncPreview.isPending || events.length === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-white hover:bg-emerald-500/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              {syncPreview.isPending ? <Loader2 size={15} className="animate-spin text-emerald-300" /> : <Download size={15} className="text-emerald-300" />}
              <span className="flex flex-col">
                <span className="font-semibold">Finish &amp; Generate Report</span>
                <span className="text-[11px] text-white/45">Add to season stats + AI match report</span>
              </span>
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); handleEnrich() }}
              disabled={isEnriching || events.length === 0}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-white hover:bg-violet-500/15 disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
            >
              {isEnriching ? <Loader2 size={15} className="animate-spin text-violet-300" /> : <FileText size={15} className="text-violet-300" />}
              <span className="flex flex-col">
                <span className="font-semibold">Tactical Report</span>
                <span className="text-[11px] text-white/45">AI write-up of tagged events</span>
              </span>
            </button>
            <div className="my-1 h-px bg-white/10" />
            <button
              onClick={async () => {
                setShowMoreMenu(false)
                if (!sessionId) return
                const hasEvents = events.length > 0
                const ok = await confirmDialog({
                  title: 'Re-mark throw-in / clock?',
                  message: hasEvents
                    ? 'You have tagged events. Their minutes were set from the current throw-in mark and will NOT change. Reset the match first if you want them recalculated.'
                    : 'Mark the first-half throw-in again, or set the match clock if your footage starts after the throw-in.',
                  confirmText: 'Re-mark',
                })
                if (!ok) return
                await videoSessionsAPI.clearFirstHalfMark(sessionId)
                await refetchSession()
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-white hover:bg-white/10 transition-colors"
            >
              <Target size={15} className="text-sky-300" />
              <span className="flex flex-col">
                <span className="font-semibold">Re-mark Throw-In / Clock</span>
                <span className="text-[11px] text-white/45">Change the start mark or match clock</span>
              </span>
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); setShowResetConfirm(true) }}
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-sm text-red-300 hover:bg-red-500/15 transition-colors"
            >
              <RotateCcw size={15} />
              <span className="font-semibold">Reset Match…</span>
            </button>
          </div>
        </>
      )}
    </div>
  )
  // The opposition Pass icon is a single-tap quick-logger, meant to work at
  // any paused moment (unlike TaggingPitch's own `disabled` prop below,
  // which also gates on `!isPlaying` for ball drag/tap-to-place and would
  // otherwise silently make it unresponsive whenever the video is paused —
  // exactly when a coach is most likely to be tapping it for precision).
  // Still blocked during setup or while another overlay/picker is open.
  // High Ball is different — see highBallBlocked below, it DOES need
  // `!isPlaying` since its destination tap depends on that same
  // tap-to-place mechanic being active.
  const quickBallIconsBlocked = mode !== 'tracking' || overlayState !== 'none'
  // High Ball depends on the pitch's own tap-to-place mechanic (unlike Pass,
  // which logs immediately) — that's gated by TaggingPitch's own `disabled`
  // prop, which DOES include `!isPlaying`, so this must too or arming it
  // while paused would leave the destination tap silently unable to fire.
  const highBallBlocked = mode !== 'tracking' || !isPlaying || overlayState !== 'none'
  const taggingPitchOrientation: 'horizontal' | 'vertical' = 'horizontal'

  // Derived state for CategorizedActionButtons
  const cabPossession = possession === 'team_a' ? PossessionTeam.OWN : PossessionTeam.OPPONENT
  const pendingFoulTeam: 'own' | 'opponent' | null =
    pendingFreeKick === 'opp_free' ? 'own' : pendingFreeKick === 'our_free' ? 'opponent' : null

  // Plain computations, NOT hooks — this code runs after the early
  // loading/not-found returns, so a hook here breaks the Rules of Hooks
  // (React error #310) when the page transitions from loading to loaded.
  const cabAttackingTeam = pendingFreeKick
    ? (pendingFreeKick === 'our_free' ? PossessionTeam.OWN : PossessionTeam.OPPONENT)
    : cabPossession
  const cabAttackingRight = teamAttackingRightThisHalf ?? true
  const cabAttackingGoalX = cabAttackingTeam === PossessionTeam.OWN
    ? (cabAttackingRight ? 100 : 0)
    : (cabAttackingRight ? 0 : 100)
  const isIn2PointZone = (() => {
    if (!ballPosition) return false
    const dx = (ballPosition.x - cabAttackingGoalX) / 29.0
    const dy = (ballPosition.y - 50) / 46.0
    return (dx * dx + dy * dy) > 1
  })()
  const isInPenaltyArea = !!ballPosition && Math.abs(cabAttackingGoalX - ballPosition.x) <= 10.5

  /** Video player panel — left half of the 50/50 split */
  const videoPanel = (
    <div data-tour="video-player" className="relative flex-1 min-w-0 min-h-0 group/video">
      <VideoPlayer
        ref={playerRef}
        src={stableVideoUrl.current}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlayStateChange={setIsPlaying}
        halftimeMs={session.halftime_timestamp_ms ?? undefined}
        firstHalfStartMs={session.first_half_start_ms ?? undefined}
        secondHalfStartMs={session.second_half_start_ms ?? undefined}
        fullTimeMs={session.full_time_ms ?? undefined}
        maxSeekMs={mode === 'tracking' ? highWaterMarkMs : undefined}
        initialTimeMs={
          mode === 'tracking'
            ? Math.max(currentTimeMs, session.tracking_progress_ms ?? session.first_half_start_ms ?? 0)
            : currentTimeMs
        }
        fillHeight={isFullscreen}
        // Setup steps that mark a moment in the video (throw-in, half-time, 2nd half,
        // full-time) MUST be scrubbable; only the pure-choice steps lock the player.
        disabled={mode === 'setup' && !['first_half', 'half_time', 'second_half', 'full_time'].includes(setupStep)}
      />

      {mode === 'setup' && (
        <SetupFlowModal
          step={setupStep}
          currentTimeMs={currentTimeMs}
          homeTeamName={clubName}
          opponentName={opponentName}
          isSaving={setupSaving}
          error={setupError}
          onMarkFirstHalf={handleMarkFirstHalf}
          onMarkHalftime={() => handleMarkHalftime(currentTimeMs)}
          onSkipHalftime={handleSkipHalftime}
          onMarkSecondHalf={handleMarkSecondHalf}
          onSkipSecondHalf={handleSkipSecondHalf}
          onMarkFullTime={handleMarkFullTime}
          onSkipFullTime={handleSkipFullTime}
          onSetDirection={handleSetDirection}
          onSelectThrowInWinner={handleSelectThrowInWinner}
          onStartTracking={handleStartTracking}
        />
      )}

      {(deadBall || assistPromptEventId || showManualEvent || showViewLineup || showWeatherPicker) && (
        <div className="absolute top-3 inset-x-3 z-40 pointer-events-none">
          <style>{`
            @keyframes _vtChevR { 0%{transform:translateX(-4px);opacity:.25} 50%{opacity:1} 100%{transform:translateX(6px);opacity:.25} }
            @keyframes _vtChevD { 0%{transform:translateY(-4px);opacity:.25} 50%{opacity:1} 100%{transform:translateY(6px);opacity:.25} }
            @keyframes _vtStream { 0%{background-position:0% 0} 100%{background-position:200% 0} }
          `}</style>
          {/* Glass banner — dark translucent card, emerald accent, animated
              chevrons pointing at where the input is needed. Same visual
              language as the on-pitch prompt cards (no solid orange). */}
          <div
            className="relative overflow-hidden rounded-2xl px-4 py-2.5"
            style={{
              background: 'linear-gradient(135deg, rgba(10,26,32,0.78), rgba(8,20,26,0.62))',
              border: '1px solid rgba(0,230,118,0.38)',
              backdropFilter: 'blur(16px)',
              WebkitBackdropFilter: 'blur(16px)',
              boxShadow: '0 8px 28px rgba(0,0,0,0.5), 0 0 18px rgba(0,230,118,0.18), inset 0 1px 0 rgba(255,255,255,0.12)',
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60 animate-ping" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                </span>
                <span className="text-sm font-semibold text-white truncate">
                  {assistPromptEventId ? 'Select assist player (or skip)'
                    : overlayState === 'player' ? 'Select player'
                    : overlayState === 'pitch' ? (pendingOverlay?.action.pitchPrompt === 'forty_five' ? 'Tap the 45m line on the pitch graphic' : 'Tap where the kickout landed')
                    : pendingFoulSubtype ? 'Select foul type on the pitch graphic'
                    : pendingTurnoverReason ? 'How was possession lost? Select on the pitch graphic'
                    : pendingErrorSubtype ? 'Select error type on the pitch graphic'
                    : pendingFreeKick && !isAdjustingFree ? 'Select free outcome on the pitch graphic'
                    : isAdjustingFree ? 'Drag the ball to the free\'s real spot'
                    : awaitingKickout ? 'Select kickout outcome on the pitch graphic'
                    : (pendingBlockRecovery || pendingSidelineDecision || pending45) ? 'Select outcome below'
                    : showManualEvent ? 'Add manual event or substitution'
                    : showViewLineup ? 'Viewing lineup'
                    : showWeatherPicker ? 'Set weather conditions'
                    : 'Input required'}
                </span>
              </div>
              {/* Direction cue — points to the pitch (right) or the controls (down) */}
              {pitchInputNeeded ? (
                <ChevronsRight size={22} className="text-emerald-300 flex-shrink-0" style={{ animation: '_vtChevR 1.1s ease-in-out infinite' }} />
              ) : (pendingBlockRecovery || pendingSidelineDecision || pending45) ? (
                <ChevronsDown size={22} className="text-emerald-300 flex-shrink-0" style={{ animation: '_vtChevD 1.1s ease-in-out infinite' }} />
              ) : null}
            </div>
            {/* Animated stream along the bottom edge, leading toward the pitch */}
            <div
              className="absolute bottom-0 left-0 right-0 h-[2px]"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(0,230,118,0.9), rgba(0,176,255,0.9), transparent)',
                backgroundSize: '50% 100%',
                backgroundRepeat: 'repeat-x',
                animation: '_vtStream 1.6s linear infinite',
              }}
            />
          </div>
        </div>
      )}

      {mode === 'tracking' && !isPlaying && !deadBall && currentTimeMs >= highWaterMarkMs && (
        <div className="absolute top-3 right-3 z-30 pointer-events-none">
          <button
            onClick={() => playerRef.current?.play()}
            className="pointer-events-auto flex items-center gap-2 px-4 py-2.5 rounded-2xl text-sm font-bold transition-all hover:scale-105 active:scale-95 animate-pulse hover:animate-none"
            style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
          >
            <Play size={16} fill="#0a1a10" />
            Resume Tracking
          </button>
        </div>
      )}

      {mode === 'tracking' && currentTimeMs < highWaterMarkMs - 1000 && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
          <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-xl border border-amber-500/40 rounded-xl px-4 py-2.5 shadow-2xl shadow-amber-500/10">
            <div className="flex items-center gap-2 text-amber-300">
              <AlertTriangle size={16} className="shrink-0" />
              <span className="text-sm font-semibold">
                Reviewing past footage — tracking will resume at {formatTrackingClock(calcMatchTime(highWaterMarkMs))}
              </span>
            </div>
          </div>
        </div>
      )}

      {overlayState === 'none' && (
        <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 opacity-70 sm:opacity-0 sm:group-hover/video:opacity-100 transition-all">
          <button
            onClick={() => setIsFullscreen(prev => !prev)}
            className="p-2 bg-black/50 hover:bg-black/80 text-white/70 hover:text-white rounded-lg transition-colors"
            title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
          >
            <Maximize size={18} />
          </button>
        </div>
      )}
    </div>
  )

  /** "Dungloe inside the 21m line" — drawn on the pitch's top sideline, same
   *  pill and styling as live recording's svgOverlay (it used to sit in its
   *  own full-width container above the video, wasting a row of screen). */
  const statusText = ballPosition
    ? getStatusLabel(
        ballPosition,
        possession,
        clubName,
        opponentName,
        activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.playerName : null,
      )
    : ''
  const pitchStatusOverlay = mode === 'tracking' && ballPosition ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <div
        data-tour="possession-indicator"
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 20px', borderRadius: 14,
          background: 'rgba(0,0,0,0.75)',
          border: pendingLongKick
            ? '2px solid rgba(217,119,6,0.6)'
            : `2px solid ${possession === 'team_a' ? 'rgba(16,185,129,0.5)' : 'rgba(249,115,22,0.4)'}`,
        }}
      >
        <div style={{
          width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
          background: pendingLongKick ? '#d97706' : (possession === 'team_a' ? '#34d399' : '#fb923c'),
        }} />
        <span style={{
          fontSize: 30, fontWeight: 700, whiteSpace: 'nowrap',
          color: pendingLongKick ? '#fbbf24' : (possession === 'team_a' ? '#6ee7b7' : '#fdba74'),
        }}>
          {pendingLongKick ? `${pendingLongKick.kind === 'high_ball' ? 'High Ball' : 'Long Kick Pass'} — tap pitch for landing spot` : statusText}
        </span>
      </div>
    </div>
  ) : undefined

  /** Ball-carrier tracking pitch panel — right half of the 50/50 split */
  const pitchPanel = (
    <div className="relative flex-1 min-w-0 min-h-0">
      <TaggingPitch
        key="pitch-horizontal"
        orientation="horizontal"
        containerClassName="relative w-full h-full bg-gradient-to-br from-green-900/40 to-green-800/40 overflow-hidden"
        ballPosition={taggingBallPosition}
        onBallMove={handleTaggingBallCommit}
        onDragUpdate={handleTaggingBallMove}
        onDragPath={handleTaggingDragPath}
        trail={ballTrail}
        carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
        // Ball moves/taps normally need the video playing; the on-pitch tap
        // steps (kickout landing, 45 line) and free-position adjust happen
        // while it's paused, so they must be tappable then.
        disabled={
          mode !== 'tracking' ||
          (!(overlayState === 'pitch' || isAdjustingFree) && (!isPlaying || overlayState !== 'none'))
        }
        highlight45LineX={highlight45LineX}
        svgOverlay={pitchStatusOverlay}
        ballAnchoredOverlay={
          (ballSvgX, ballSvgY, ballPctX, ballPctY) => (
            <>
              {possession === 'team_a' && jerseyStripPlayers.length > 0 && (
                <BallCarrierPicker
                  players={jerseyStripPlayers}
                  activeCarrierId={activeCarrierId}
                  onSelect={handleCarrierSelect}
                  attackingRight={teamAttackingRightThisHalf ?? true}
                  teamPrimaryColor={club?.primary_colour || '#10B981'}
                  teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
                  ballSvgX={ballSvgX}
                  ballSvgY={ballSvgY}
                  ballPctX={ballPctX}
                  ballPctY={ballPctY}
                  recentCarrierIds={recentCarrierIds}
                  onOpenChange={setIsCarrierRadialOpen}
                  orientation={taggingPitchOrientation}
                />
              )}
              {possession === 'team_b' && (
                <BallQuickActionIcon
                  ballSvgX={ballSvgX}
                  ballSvgY={ballSvgY}
                  angleDeg={-45}
                  label="P"
                  title="Log Pass (Opposition)"
                  color="#0891b2"
                  onTap={handleQuickPass}
                  count={oppPassCount}
                  disabled={quickBallIconsBlocked}
                  orientation={taggingPitchOrientation}
                />
              )}
              <BallQuickActionIcon
                ballSvgX={ballSvgX}
                ballSvgY={ballSvgY}
                angleDeg={-135}
                label="HB"
                title="Log High Ball"
                color="#d97706"
                orientation={taggingPitchOrientation}
                onTap={() => handleToggleLongKickArm('high_ball')}
                armed={pendingLongKick?.kind === 'high_ball'}
                disabled={highBallBlocked || isCarrierRadialOpen}
              />
              <BallQuickActionIcon
                ballSvgX={ballSvgX}
                ballSvgY={ballSvgY}
                angleDeg={-90}
                label="LK"
                title="Log Long Kick Pass"
                color="#0d9488"
                orientation={taggingPitchOrientation}
                onTap={() => handleToggleLongKickArm('long_kick_pass')}
                armed={pendingLongKick?.kind === 'long_kick_pass'}
                disabled={highBallBlocked || isCarrierRadialOpen}
              />
            </>
          )
        }
        pitchOverlay={
          possession === 'team_a' && jerseyStripPlayers.length > 0
            ? (ballPctX, ballPctY) => (
              <VideoPitchReceiverDots
                players={jerseyStripPlayers}
                activeCarrierId={activeCarrierId}
                onSelect={handleCarrierSelect}
                attackingRight={teamAttackingRightThisHalf ?? true}
                teamPrimaryColor={club?.primary_colour || '#10B981'}
                teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
                ballPctX={ballPctX}
                ballPctY={ballPctY}
                disabled={isCarrierRadialOpen}
                recentCarrierIds={recentCarrierIds}
                orientation={taggingPitchOrientation}
              />
            )
            : undefined
        }
      />
      {teamAttackingRightThisHalf != null && overlayState !== 'pitch' && (
        <div className="absolute bottom-2 right-2 z-20">
          <AttackDirectionBadge
            attackingRight={teamAttackingRightThisHalf}
            teamName={clubName}
            orientation="horizontal"
          />
        </div>
      )}

      {/* Pitch toolbar — Snap (formation snapshot) + Tag (tactical moment) on
          the pitch's own sideline, same place live recording keeps them. */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5">
        <button
          onClick={() => { playerRef.current?.pause(); setIsSnapshotOpen(true) }}
          title="Take formation snapshot"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-white border border-purple-400/30 hover:border-purple-400/50 transition-all"
          style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.45) 0%, rgba(147,51,234,0.3) 100%)', backdropFilter: 'blur(8px)' }}
        >
          <Camera size={14} />
          {snapshotCount > 0 ? snapshotCount : 'Snap'}
        </button>
        <TacticalTagButton onTag={handleTacticalTag} tagCount={tacticalTagCount} />
      </div>

      {/* Possession-frozen indicator — shown while the footage plays through a
          dead ball (free being taken, kickout/45 restart, a prompt open), so
          it's obvious no possession time is being counted. */}
      {mode === 'tracking' && deadBall && isPlaying && (
        <div
          className="absolute bottom-2 left-2 z-20 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-cyan-100 whitespace-nowrap pointer-events-none"
          style={{
            background: 'rgba(8,20,26,0.7)',
            border: '1px solid rgba(0,176,255,0.4)',
            backdropFilter: 'blur(10px)',
            WebkitBackdropFilter: 'blur(10px)',
          }}
        >
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-cyan-300" />
          Dead ball — possession paused
        </div>
      )}

      {/* Pulsing glass border around the pitch while input is needed here —
          the banner over the video points at it. Non-interactive. */}
      {pitchInputNeeded && (
        <>
          <style>{`
            @keyframes _vtPitchPulse {
              0%,100% { box-shadow: inset 0 0 0 2px rgba(0,230,118,0.35), inset 0 0 22px rgba(0,230,118,0.12), 0 0 0 rgba(0,230,118,0); }
              50%     { box-shadow: inset 0 0 0 3px rgba(0,230,118,0.9), inset 0 0 38px rgba(0,176,255,0.28), 0 0 22px rgba(0,230,118,0.45); }
            }
          `}</style>
          <div
            className="absolute inset-0 z-40 pointer-events-none"
            style={{ animation: '_vtPitchPulse 1.4s ease-in-out infinite' }}
          />
        </>
      )}

      {/* ── On-pitch prompts — same overlays live recording shows over its
          pitch, so free outcome / kickout outcome / foul type etc. never make
          the coach look away from the pitch. ── */}

      {/* Kickout outcome (after a score/wide/45/penalty) + free outcome */}
      <PitchActionOverlay
        awaitingKickout={mode === 'tracking' && awaitingKickout && overlayState === 'none' && !kickoutMinimised && !pendingFoulSubtype && !pendingTurnoverReason && !pendingErrorSubtype}
        pendingFreeKick={mode === 'tracking' && !!pendingFreeKick && !isAdjustingFree && overlayState === 'none' && !pendingFoulSubtype && !pendingTurnoverReason && !pendingErrorSubtype}
        pendingFoul={pendingFoulTeam}
        kickoutTab={kickoutTab}
        isIn2PointZone={isIn2PointZone}
        onAction={handleQuickAction}
        onCancelFree={handleCancelFree}
        onCancelKickout={handleCancelPitchStep}
        onAdjustFreePosition={() => setIsAdjustingFree(true)}
        onMinimize={() => setKickoutMinimised(true)}
      />

      {/* Minimised kickout pill — tap to bring the outcome overlay back */}
      {kickoutMinimised && awaitingKickout && overlayState === 'none' && (
        <button
          onClick={() => setKickoutMinimised(false)}
          className="absolute bottom-2 left-2 z-20 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/20 border-2 border-amber-400/40 text-amber-200 hover:bg-amber-500/30 text-[11px] font-semibold transition-all"
          title="Resume the kickout prompt"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span>Kickout pending</span>
        </button>
      )}

      {/* Free-position adjust (overlay hidden so the ball is draggable) */}
      {!!pendingFreeKick && isAdjustingFree && (
        <AdjustFreeBanner onDone={() => setIsAdjustingFree(false)} reason={broughtForwardReason} onReason={setBroughtForwardReason} />
      )}

      {/* (The kickout-landing and 45-line tap instructions deliberately do NOT
          draw anything over the pitch — they cover the area being tapped.
          The banner over the video + the button-bar panel (with Cancel and
          the "aimed for" chips) carry the instruction instead.) */}

      {/* Foul type — Our Foul, after the player is picked */}
      {pendingFoulSubtype && (
        <SubtypePrompt
          title="What type of foul?"
          playerName={(players || []).find((p: any) => p.id === pendingFoulSubtype.data.player_id)?.name}
          options={FOUL_SUBTYPES}
          tactical={tacticalFoul}
          onTacticalChange={setTacticalFoul}
          onSelect={handleFoulSubtypeSelect}
        />
      )}

      {/* "How was possession lost?" — T/O Lost */}
      {pendingTurnoverReason && (
        <TurnoverReasonPrompt
          playerName={pendingTurnoverReason.playerName}
          onSelect={handleTurnoverReasonSelect}
          onSkip={handleTurnoverReasonSkip}
        />
      )}

      {/* Unforced error type */}
      {pendingErrorSubtype && (
        <SubtypePrompt
          title="What type of error?"
          playerName={pendingErrorSubtype.playerName}
          options={UNFORCED_ERROR_SUBTYPES}
          onSelect={handleErrorSubtypeSelect}
        />
      )}
    </div>
  )

  /** CategorizedActionButtons — same component as live recording */
  const controlsBar = (
    <div data-tour="video-quick-actions" className="max-w-4xl mx-auto w-full">
      <CategorizedActionButtons
        onActionSelect={handleQuickAction}
        onFoulClick={handleFoulClick}
        on45Click={handle45Click}
        onDiscipline={handleDiscipline}
        // Only the player-pick step locks the buttons; the pitch-tap steps
        // swap the bar for a panel with a live Cancel button (as in live).
        disabled={isAutoAnalyzing || overlayState === 'player' || mode === 'setup' || !!pendingFoulSubtype || !!pendingTurnoverReason || !!pendingErrorSubtype}
        activeCategory={activeTab}
        onCategoryChange={handleCategoryChange}
        currentPossession={cabPossession}
        isIn2PointZone={isIn2PointZone}
        isInPenaltyArea={isInPenaltyArea}
        // Free outcome lives on the pitch (PitchActionOverlay), like live
        pendingFreeKick={false}
        pendingFoul={pendingFoulTeam}
        pendingBlockRecovery={pendingBlockRecovery}
        onBlockRecovery={handleBlockRecovery}
        onBlockResultSideline={handleBlockResultSideline}
        onBlockResultFortyFive={handleBlockResultFortyFive}
        pendingSidelineDecision={pendingSidelineDecision}
        onSidelineDecision={handleSidelineDecision}
        pending45={pending45}
        pendingKickoutPosition={overlayState === 'pitch' && (pendingOverlay?.action.pitchPrompt === 'kickout' || pendingOverlay?.action.pitchPrompt === 'kickout_sideline')}
        kickoutPositionExtra={
          // Optional "aimed for" — our own kickouts only
          pendingOverlay && (pendingOverlay.action.eventType.startsWith('OWN_KICKOUT') || (pendingOverlay.action.pitchPrompt === 'kickout_sideline' && pendingOverlay.eventData.team === 'team_a'))
            ? (
              <AimedForChips
                players={jerseyStripPlayers
                  .filter(p => p.isOnField)
                  .sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99))
                  .map(p => ({ playerId: p.playerId, jerseyNumber: p.jerseyNumber }))}
                selectedId={kickoutAimedForId}
                onToggle={(id: string) => setKickoutAimedForId(prev => (prev === id ? undefined : id))}
              />
            )
            : undefined
        }
        pendingFortyFivePosition={overlayState === 'pitch' && pendingOverlay?.action.pitchPrompt === 'forty_five'}
        awaitingKickout={awaitingKickout && !kickoutMinimised && overlayState === 'none'}
        onCancelFree={handleCancelFree}
        onCancel45={handleCancel45}
        onCancelKickout={handleCancelPitchStep}
        onCancelFortyFivePosition={handleCancelPitchStep}
      />
    </div>
  )


  /** Stats-so-far panel + full-time/end-tracking confirm dialog — shared
   *  JSX so both the fullscreen and normal-mode returns below stay in sync
   *  without duplicating the markup. */
  /** Player picker for a newly-tagged event (scores/turnovers/kickouts/
   *  cards) — matches live recording exactly: player circles positioned on
   *  the pitch by formation, ranked by proximity to the ball, with the
   *  tracked ball carrier highlighted gold as a "last carrier" suggestion
   *  (same suggestedPlayerId hint MatchRecording.tsx's PitchPlayerSelector
   *  gets from BallCarrierPicker). Falls back to the plain jersey-number
   *  grid only when no lineup exists yet, same condition live recording
   *  uses (`lineupLoaded && matchLineup.length > 0`). */
  const newEventPlayerPicker = matchLineup && matchLineup.length > 0 ? (
    <PitchPlayerSelector
      isOpen={overlayState === 'player'}
      onClose={handlePlayerSkip}
      onSelectPlayer={handlePlayerSelect}
      eventType={pendingOverlay?.action.playerModalEventType || 'point'}
      team="own"
      players={playerList.filter(p => matchLineup.some(ml => ml.player_id === p.id && ml.is_on_field))}
      matchLineup={matchLineup}
      teamPrimaryColor={club?.primary_colour || '#10B981'}
      teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
      attackingRight={teamAttackingRightThisHalf ?? true}
      ballPosition={ballPosition}
      suggestedPlayerId={activeCarrierId}
    />
  ) : (
    <PlayerSelectionModal
      isOpen={overlayState === 'player'}
      onClose={handlePlayerSkip}
      onSelectPlayer={handlePlayerSelect}
      eventType={pendingOverlay?.action.playerModalEventType || 'point'}
      team="own"
      players={playerList}
    />
  )

  const trackingOverlays = (
    <>
      {showExtraStats && (
        <ExtendedStatsModal
          events={chartEvents}
          opponent={opponentName}
          teamName={clubName}
          halfDurationMins={matchData?.half_duration_mins || 30}
          onClose={() => setShowExtraStats(false)}
        />
      )}
      {showViewLineup && matchLineup && matchLineup.length > 0 && (
        <PitchPlayerSelector
          isOpen={showViewLineup}
          onClose={() => setShowViewLineup(false)}
          onSelectPlayer={() => {}}
          eventType="point"
          team="own"
          players={playerList}
          matchLineup={matchLineup}
          teamPrimaryColor={club?.primary_colour || '#10B981'}
          teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
          attackingRight={teamAttackingRightThisHalf ?? true}
          readOnly={true}
        />
      )}
      {isLineupModalOpen && (
        <StartingLineupModal
          isOpen={isLineupModalOpen}
          onClose={() => setIsLineupModalOpen(false)}
          onConfirm={handleLineupConfirm}
          players={playerList}
          lastMatchLineup={lastMatchLineup}
          savedLineup={savedLineup}
          matchId={session.match_id}
        />
      )}
      {showWeatherPicker && (
        <WeatherPickerPopover
          isOpen={showWeatherPicker}
          onClose={() => setShowWeatherPicker(false)}
          onSave={handleWeatherSave}
          currentConditions={
            weatherOverride
              ? weatherOverride.conditions
              : (matchData?.weather_conditions ?? (matchData?.weather_condition ? [matchData.weather_condition] : []))
          }
          currentTemperature={weatherOverride ? weatherOverride.temp : (matchData?.temperature_celsius ?? null)}
          currentNotes={weatherOverride ? weatherOverride.notes : (matchData?.notes ?? null)}
        />
      )}
      {showManualEvent && (
        <VideoManualEventModal
          isOpen={showManualEvent}
          onClose={() => setShowManualEvent(false)}
          onSubmit={handleManualEventSubmit}
          players={playerList}
          matchLineup={matchLineup || []}
          onFieldPlayerIds={onFieldPlayerIds}
          opponentName={opponentName}
          clubName={clubName}
          currentMinute={calcMatchTime(currentTimeMs).minute}
          currentHalf={calcMatchTime(currentTimeMs).half as 1 | 2}
        />
      )}
      {assistPromptEventId && matchLineup && matchLineup.length > 0 && (
        <PitchPlayerSelector
          isOpen={!!assistPromptEventId}
          onClose={() => setAssistPromptEventId(null)}
          onSelectPlayer={(player) => {
            if (sessionId && assistPromptEventId) {
              updateEvent.mutate({ eventId: assistPromptEventId, sessionId, data: { assist_player_id: player.id } })
            }
            setAssistPromptEventId(null)
          }}
          eventType="assist"
          team="own"
          players={playerList}
          matchLineup={matchLineup}
          teamPrimaryColor={club?.primary_colour || '#10B981'}
          teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
          attackingRight={teamAttackingRightThisHalf ?? true}
          ballPosition={ballPosition}
        />
      )}
      {/* Pressure prompt — small non-blocking pill, same intent as the
          assist prompt above but no player picker needed (just yes/no).
          Feeds expected_points_service.py's pressure multiplier; closing
          without choosing leaves under_pressure at None (the correct
          "not recorded" default). */}
      {pendingPressure && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[200] animate-fade-in">
          <div
            className="flex items-center gap-2 rounded-2xl px-3 py-2"
            style={{
              background: 'rgba(15,23,42,0.92)',
              border: '1px solid rgba(217,119,6,0.35)',
              backdropFilter: 'blur(14px)',
              WebkitBackdropFilter: 'blur(14px)',
              boxShadow: '0 6px 24px rgba(0,0,0,0.45)',
            }}
          >
            <span className="text-amber-300 text-xs font-bold flex-shrink-0">Under pressure? (optional)</span>
            <button
              onClick={() => {
                if (sessionId) {
                  updateEvent.mutate({
                    eventId: pendingPressure.eventId,
                    sessionId,
                    data: { scoring_context: { ...pendingPressure.scoringContext, under_pressure: true } },
                  })
                }
                setPendingPressure(null)
              }}
              className="flex-shrink-0 px-3 py-1 rounded-lg text-[11px] font-bold bg-amber-500/20 text-amber-300 hover:bg-amber-500/35 hover:text-white transition-all"
            >
              Yes
            </button>
            <button
              onClick={() => {
                if (sessionId) {
                  updateEvent.mutate({
                    eventId: pendingPressure.eventId,
                    sessionId,
                    data: { scoring_context: { ...pendingPressure.scoringContext, under_pressure: false } },
                  })
                }
                setPendingPressure(null)
              }}
              className="flex-shrink-0 px-3 py-1 rounded-lg text-[11px] font-bold bg-white/10 text-white/70 hover:bg-white/20 hover:text-white transition-all"
            >
              No
            </button>
            <button
              onClick={() => setPendingPressure(null)}
              className="flex-shrink-0 text-white/40 hover:text-white text-xs px-1.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4" onClick={() => { if (!resetSession.isPending) setShowResetConfirm(false) }}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-slate-900 border border-white/10 rounded-xl p-5 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-2">{resetSession.isPending ? 'Resetting match…' : 'Reset Match?'}</h3>
            <p className="text-xs text-white/60 mb-4">
              {resetSession.isPending
                ? 'Clearing tagged events, possession and ball tracking. This can take a few seconds — please wait.'
                : <>This deletes every tagged event and clears tracking progress so you can re-track from scratch.
                    Your throw-in, half-time, full-time and attack-direction marks are kept.</>}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!sessionId) return
                  // Server-side reset clears events/progress; every in-flight
                  // client prompt must go too, or e.g. an open kickout/free
                  // overlay lingers into the throw-in setup flow.
                  playerRef.current?.pause()
                  wasPlayingRef.current = false
                  setAwaitingKickout(false); setKickoutTab(null); setKickoutMinimised(false); setKickoutAimedForId(undefined)
                  setPendingFreeKick(null); setIsAdjustingFree(false); setPending45(false); setHighlight45LineX(null)
                  setPendingFoulSubtype(null); setTacticalFoul(false); setPendingTurnoverReason(null); setPendingErrorSubtype(null)
                  setOverlayState('none'); setPendingOverlay(null); setPendingLongKick(null)
                  setPendingBlockRecovery(false); setPendingSidelineDecision(false)
                  setPendingOppScorer(null); setPendingPressure(null); setAssistPromptEventId(null)
                  setBlackCardTimers([]); setActiveTab('scoring'); setPossession('team_a')
                  setBallPosition({ x: 50, y: 50 }); setBallTrail([])
                  setActiveCarrierId(null); setRecentCarrierIds([])
                  possAccumMsRef.current = { team_a: 0, team_b: 0 }
                  lastPossTickMsRef.current = null
                  positionSamples.current = []
                  possBufferRef.current = []
                  carrierPathBufferRef.current = []
                  activeSegmentRef.current = null
                  setThrowInWinnerChosen(false)
                  resetSession.mutate({ sessionId }, {
                    onSuccess: () => setShowResetConfirm(false),
                    onError: (err: any) => {
                      setShowResetConfirm(false)
                      setAlertModal({ title: 'Reset failed', message: err?.message || 'Could not reset the match. Please try again.', variant: 'danger' })
                    },
                  })
                }}
                disabled={resetSession.isPending}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-all disabled:opacity-70 disabled:cursor-wait"
              >
                {resetSession.isPending && <Loader2 size={15} className="animate-spin" />}
                {resetSession.isPending ? 'Resetting…' : 'Reset Match'}
              </button>
              <button
                onClick={() => setShowResetConfirm(false)}
                disabled={resetSession.isPending}
                className="px-4 py-2.5 rounded-lg bg-white/10 text-white/60 hover:text-white text-sm transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingOppScorer && (
        <div className="fixed inset-0 z-[140]">
          <OppositionScorerStrip
            players={matchData?.opposition_roster || []}
            onSelect={handleOppScorerSelect}
            onSkip={handleOppScorerSkip}
            eventType={pendingOppScorer.mode === 'turnover_forced' ? 'turnover_won' : 'point'}
            mode={pendingOppScorer.mode}
          />
        </div>
      )}
      {showFullTimeConfirm && (
        <div className="fixed inset-0 z-[140] flex items-center justify-center p-4" onClick={() => setShowFullTimeConfirm(false)}>
          <div className="absolute inset-0 bg-black/60" />
          <div className="relative bg-slate-900 border border-white/10 rounded-xl p-5 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-white mb-2">
              {session.full_time_ms != null && currentTimeMs >= session.full_time_ms ? 'Full-Time Reached' : 'End Tracking?'}
            </h3>
            <p className="text-xs text-white/60 mb-4">
              Finish tracking and switch to review mode? You'll be able to scrub freely and correct events, but
              continuous ball tracking will stop.
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleConfirmFinishTracking}
                disabled={completeTracking.isPending}
                className="flex-1 px-4 py-2.5 rounded-lg text-sm font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all disabled:opacity-40"
              >
                {completeTracking.isPending ? 'Finishing…' : 'Finish & Review'}
              </button>
              <button
                onClick={() => setShowFullTimeConfirm(false)}
                className="px-4 py-2.5 rounded-lg bg-white/10 text-white/60 hover:text-white text-sm transition-colors"
              >
                Keep Going
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )

  // ── Fullscreen mode ──────────────────────────────────────────────────
  // Note: this branch and the normal-mode return below both reference the
  // same `videoArea`/`sidebar`/`actionButtons` values, so setup-flow UI,
  // the attack-direction badge, and tracking controls embedded inside them
  // work identically in both layouts. The <video> element itself DOES
  // remount when this branch toggles (React can't diff across differently
  // shaped trees) — VideoPlayer restores scrub position on remount via
  // `initialTimeMs`, see below, rather than avoiding the remount itself.

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
        {/* Compact top bar */}
        <div className="flex items-center justify-between px-2 py-1.5 bg-slate-900/90 border-b border-white/10 flex-shrink-0 gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
            <button
              onClick={() => setIsFullscreen(false)}
              className="p-1 text-white/50 hover:text-white transition-colors flex-shrink-0"
              title="Exit fullscreen (Esc)"
            >
              <X size={16} />
            </button>
            <span className="text-xs font-semibold text-white truncate max-w-[140px]">{session.title}</span>
          </div>

          {scoreboard(true)}
          {clockControls(true)}
          {moreMenu}
        </div>

        {/* 50/50 video + pitch */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {videoPanel}
          {pitchPanel}
        </div>

        {/* CategorizedActionButtons */}
        <div className="flex-shrink-0 px-2 py-1.5 bg-slate-900/80 border-t border-white/5">
          {controlsBar}
        </div>

        {blackCardTimers.length > 0 && (
          <div className="absolute top-14 right-4 z-30">
            <BlackCardTimer entries={blackCardTimers} onRemove={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))} />
          </div>
        )}

        {newEventPlayerPicker}

        <ConfirmationModal
          isOpen={!!alertModal}
          onClose={() => {
            const callback = alertModal?.onClose
            setAlertModal(null)
            callback?.()
          }}
          title={alertModal?.title || ''}
          message={alertModal?.message || ''}
          variant={alertModal?.variant || 'danger'}
        />

        <FormationSnapshotMode
          isOpen={isSnapshotOpen}
          onClose={() => setIsSnapshotOpen(false)}
          onSave={handleSnapshotSave}
          ownPlayers={snapshotOwnPlayers}
        />

        {showTacticalView && playerRef.current?.getVideoElement() && (
          <VideoTacticalView
            videoElement={playerRef.current.getVideoElement()!}
            matchId={session.match_id}
            videoSessionId={sessionId}
            currentTimeMs={currentTimeMs}
            roster={matchLineup?.map(e => ({ jersey_number: e.match_jersey_number ?? e.player_jersey_number ?? 0, name: e.player_name || `#${e.match_jersey_number ?? '?'}`, position: e.position_id || undefined })) ?? []}
            teamColors={matchData ? { own: matchData.team_strip_colour || '#00AA00', opponent: matchData.opponent_strip_colour || '#FF6600' } : undefined}
            onClose={() => setShowTacticalView(false)}
          />
        )}

        {trackingOverlays}
      </div>
    )
  }

  // ── Normal mode ──────────────────────────────────────────────────────

  return (
    <div className="max-w-[1600px] mx-auto space-y-3">
      {/* ── Header ───────────────────────────────────────────────────────
          Title/event-count and the scoreboard were dropped from here to
          keep the video area in focus on laptop-height screens — the
          scoreboard now lives inline in the status bar below instead. */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-2 xl:grid xl:grid-cols-[1fr_auto_1fr]">
        {/* Left: back + scoreline */}
        <div className="flex items-center gap-2 justify-self-start min-w-0">
          <button onClick={() => navigate(-1)} className="p-2 text-white/50 hover:text-white transition-colors flex-shrink-0">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-shrink-0" data-tour="video-scoreboard">{scoreboard(true)}</div>
        </div>
        {/* Centre: match clock */}
        <div className="justify-self-center">{clockControls()}</div>
        {/* Right: view tools + More */}
        <div className="flex items-center gap-2 justify-self-end">
          {viewToolsBar()}
          {moreMenu}
        </div>
      </div>
      {/* Auto-analyze processing banner */}
      {isAutoAnalyzing && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-purple-400" />
            <span className="text-sm text-purple-300">
              {analysisProgress ? (
                analysisProgress.stage === 'initializing' ? 'Preparing video for AI analysis...' :
                analysisProgress.stage === 'uploading_to_gemini' ? 'Uploading video to Gemini...' :
                analysisProgress.stage === 'processing_video' ? 'Gemini is processing video...' :
                analysisProgress.stage === 'analyzing' ? (
                  `Analysing half ${analysisProgress.completedBatches || 0} of ${analysisProgress.totalBatches || '?'}` +
                  (analysisProgress.eventsSoFar ? ` — ${analysisProgress.eventsSoFar} events detected` : '')
                ) :
                'AI is analysing your video...'
              ) : (
                'AI is analysing your video... This may take a few minutes.'
              )}
            </span>
          </div>
          {/* Progress bar for batch analysis */}
          {analysisProgress?.stage === 'analyzing' && analysisProgress.totalBatches && (
            <div className="w-full bg-white/5 rounded-full h-1.5">
              <div
                className="bg-purple-500 h-1.5 rounded-full transition-all duration-300"
                style={{ width: `${Math.round(((analysisProgress.completedBatches || 0) / analysisProgress.totalBatches) * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* AI results banner */}
      {showAiBanner && (
        <div className="flex items-center justify-between gap-3 bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-purple-400 flex-shrink-0" />
            <span className="text-sm text-purple-200">
              AI has tagged <strong className="text-white">{aiEventCount}</strong> key events.
              {lowConfidenceCount > 0 && (
                <span className="text-orange-300 ml-1">
                  {lowConfidenceCount} low confidence.
                </span>
              )}
              {' '}Use the quick actions to add more detail.
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {canImproveAnalysis && (
              <button
                onClick={handleImproveAnalysis}
                className="px-3 py-1.5 bg-orange-500/80 hover:bg-orange-500 text-white rounded-lg text-xs font-medium transition-all"
              >
                Improve Analysis
              </button>
            )}
            <button
              onClick={() => setAiDismissed(true)}
              className="p-1 text-purple-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* ── 50/50 Video + Pitch ─────────────────────────────────────── */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <div className="flex items-stretch">
          {videoPanel}
          {pitchPanel}
        </div>
        {blackCardTimers.length > 0 && (
          <div className="absolute top-2 right-4 z-30">
            <BlackCardTimer entries={blackCardTimers} onRemove={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))} />
          </div>
        )}
      </div>

      {/* ── CategorizedActionButtons (centered below 50/50 split) ──── */}
      {controlsBar}

      {/* ── Ball Carrier Strip ─────────────────────────────────────────── */}
      {/* ── Event Timeline ──────────────────────────────────────────────── */}
      <div data-tour="event-timeline">
        <EventTimeline
          events={events}
          videoDurationMs={videoDurationMs}
          currentTimeMs={currentTimeMs}
          onSeek={handleSeek}
          firstHalfStartMs={session.first_half_start_ms}
          secondHalfStartMs={session.second_half_start_ms}
          halftimeMs={session.halftime_timestamp_ms}
          fullTimeMs={session.full_time_ms}
        />
      </div>

      {/* ── Event Log (collapsible) ─────────────────────────────────────── */}
      <div data-tour="video-event-log" className="glass-card p-0">
        <VideoEventLog
          events={events}
          onSeek={handleSeek}
          onDelete={handleDeleteEvent}
          onVerify={handleVerifyEvent}
          onToggleTwoPointer={handleToggleTwoPointer}
          onEditTeam={handleEditEventTeam}
          onEditPlayer={handleEditEventPlayer}
          collapsed={!eventLogExpanded}
          onToggle={() => setEventLogExpanded(v => !v)}
          onVerifyAll={hasAiEvents ? handleVerifyAll : undefined}
        />
      </div>

      {/* ── Match Statistics — scroll target for the "Stats" button ────── */}
      <div ref={statsRef}>
        <MatchStatsPanel
          matchId={session.match_id}
          events={chartEvents}
          clubName={clubName}
          opponentName={opponentName}
          hasEvents={events.length > 0}
          onOpenExtraStats={() => setShowExtraStats(true)}
        />
      </div>

      {/* ── Insight Charts — scroll target for the "Charts" button ─────── */}
      <div ref={chartsRef} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChartZoomModal title="Possession & Territory">
            <PossessionTerritoryChart
              stats={undefined}
              events={chartEvents}
              matchId={session.match_id}
              opponent={opponentName}
              pollInterval={20000}
              attackingRightFirstHalf={matchData?.attacking_right_first_half}
              halfDurationMins={matchData?.half_duration_mins || 30}
            />
          </ChartZoomModal>
          <div className="[&>div]:h-full [&_.glass-card]:h-full">
            <ChartZoomModal title="Attacking Thirds">
              <AttackingThirdsChart
                matchId={session.match_id}
                opponent={opponentName}
                events={chartEvents}
                pollInterval={20000}
                attackingRightFirstHalf={matchData?.attacking_right_first_half}
                halfDurationMins={matchData?.half_duration_mins || 30}
              />
            </ChartZoomModal>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ChartZoomModal title="Scoring Timeline">
            <ScoringTimeline events={chartEvents} opponent={opponentName} teamName={clubName} />
          </ChartZoomModal>
          <ChartZoomModal title="Shot Outcomes">
            <ShotOutcomeChart events={chartEvents} opponent={opponentName} />
          </ChartZoomModal>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
          <ChartZoomModal title="Kickout Zones">
            <MatchKickoutZones events={chartEvents} attackingRightFirstHalf={matchData?.attacking_right_first_half} teamName={clubName} opponentName={opponentName} />
          </ChartZoomModal>
          <ChartZoomModal title="Kickout Outcomes">
            <MatchKickoutOutcomes events={chartEvents} teamName={clubName} opponentName={opponentName} />
          </ChartZoomModal>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
          <ChartZoomModal title="Scoring Zone Map">
            <ScoringZoneMap events={chartEvents} teamName={clubName || 'Us'} opponent={opponentName} />
          </ChartZoomModal>
          <ChartZoomModal title="Possession Battle Map">
            <TurnoverMap events={chartEvents} teamName={clubName || 'Us'} />
          </ChartZoomModal>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 [&>div]:h-full [&_.glass-card]:h-full">
          <ChartZoomModal title="Shooting Efficiency">
            <ShootingEfficiencyHeatmap shots={shotLocations} />
          </ChartZoomModal>
          <ChartZoomModal title="Kickout Sequence">
            <KickoutSequence events={chartEvents} teamName={clubName} opponentName={opponentName} />
          </ChartZoomModal>
        </div>
        <p className="text-xs text-white/30 text-center px-4">
          Paths Taken, Score Origins, Scoreable Frees, Attack Efficiency and Season Benchmark need this match's
          events saved to the match first — they're not shown here yet.
        </p>
      </div>

      {/* ── Event Map — exact same filterable map as live recording ─────── */}
      <div className="space-y-3">
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-white flex items-center space-x-2">
              <Target size={16} />
              <span>Event Map</span>
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {(['all', 1, 2] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setEventMapHalfFilter(h)}
                  className={`px-2.5 py-1 rounded-lg font-medium text-xs transition-all ${
                    eventMapHalfFilter === h ? 'bg-white/25 text-white' : 'bg-white/8 text-white/40 hover:bg-white/15'
                  }`}
                >
                  {h === 'all' ? 'All' : h === 1 ? '1st' : '2nd'}
                </button>
              ))}
              <span className="text-white/20 text-xs">·</span>
              <button
                onClick={() => setEventMapTeamFilter('all')}
                className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                  eventMapTeamFilter === 'all' ? 'bg-cyan-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setEventMapTeamFilter('own')}
                className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                  eventMapTeamFilter === 'own' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {clubName}
              </button>
              <button
                onClick={() => setEventMapTeamFilter('opponent')}
                className={`px-3 py-1 rounded-lg font-medium text-xs transition-all ${
                  eventMapTeamFilter === 'opponent' ? 'bg-orange-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {opponentName}
              </button>
            </div>
          </div>
          <div className="mb-1 text-xs text-white/40 text-center">
            {filteredMapEvents.length} event{filteredMapEvents.length !== 1 ? 's' : ''} shown
          </div>
          <GAAPitch readonly={true} events={filteredMapEvents} showZones={true} />
        </div>
        <EventFilterToggles activeFilters={eventMapFilters} onToggle={setEventMapFilters} />
        <EventMapLegend />
      </div>

      {/* Enrichment Report */}
      {enrichmentReport && (
        <div className="glass-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <FileText size={18} className="text-purple-400" />
            <h3 className="text-lg font-semibold text-white">Tactical Report</h3>
          </div>
          <div className="prose prose-invert prose-sm max-w-none">
            <pre className="whitespace-pre-wrap text-sm text-white/80 bg-white/5 rounded-lg p-4">
              {enrichmentReport}
            </pre>
          </div>
        </div>
      )}

      {/* Player picker (step 3 of the tap flow) — pitch-formation circles
          when a lineup exists, jersey-grid fallback otherwise */}
      {newEventPlayerPicker}

      {/* Edit-player modal — separate instance/state (editingPlayerEventId)
          from the new-event picker above, so editing an existing event's
          player/team never interferes with an in-flight new-event tap. */}
      <PlayerSelectionModal
        isOpen={!!editingPlayerEventId}
        onClose={handleEditPlayerSkip}
        onSelectPlayer={handleEditPlayerSelect}
        eventType="point"
        team="own"
        players={playerList}
      />

      {/* Team-swap confirm — parity with live recording's editChoice card */}
      {editTeamChoice && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center p-4" onClick={() => setEditTeamChoice(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-slate-900 border border-white/10 rounded-xl p-4 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">Edit This Event</span>
              <button onClick={() => setEditTeamChoice(null)} className="p-1 text-white/40 hover:text-white transition-colors">
                <X size={16} />
              </button>
            </div>
            <p className="text-xs text-white/50 mb-3">
              Currently {editTeamChoice.currentTeam === 'team_a' ? clubName : matchData?.opponent || 'Opponent'}
            </p>
            <button
              onClick={handleConfirmEventTeamSwap}
              className="w-full py-2.5 rounded-lg text-sm font-semibold bg-blue-500/20 border border-blue-400/40 text-blue-200 hover:bg-blue-500/30 transition-all"
            >
              Actually {editTeamChoice.currentTeam === 'team_a' ? (matchData?.opponent || 'Opponent') : clubName}'s
            </button>
          </div>
        </div>
      )}

      {/* Sync Preview Modal */}
      <SyncPreviewModal
        isOpen={showSyncModal}
        onClose={handleCloseSyncModal}
        preview={syncPreviewData}
        isConfirming={syncConfirm.isPending}
        onConfirm={handleSyncConfirm}
        syncStatus={syncStatusData}
        onViewResult={handleViewResult}
      />

      {/* Formation Snapshot Overlay */}
      <FormationSnapshotMode
        isOpen={isSnapshotOpen}
        onClose={() => setIsSnapshotOpen(false)}
        onSave={handleSnapshotSave}
        ownPlayers={snapshotOwnPlayers}
      />

      {/* Prereq Check Modal */}
      {prereqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/70" onClick={() => setPrereqModal(null)} />
          <div className="relative bg-slate-900 border border-white/10 rounded-2xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-500/20 rounded-full">
                <AlertTriangle size={20} className="text-amber-400" />
              </div>
              <h3 className="text-lg font-semibold text-white">Missing Setup</h3>
            </div>

            <p className="text-sm text-white/60 mb-4">
              AI analysis works best with a complete match setup. The following haven't been configured:
            </p>

            <div className="space-y-3 mb-6">
              {prereqModal.missing.lineup && (
                <div className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3">
                  <Users size={18} className="text-orange-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white">Starting Lineup</p>
                    <p className="text-xs text-white/40">Jersey numbers help identify players in the video</p>
                  </div>
                </div>
              )}
              {prereqModal.missing.colours && (
                <div className="flex items-center gap-3 bg-white/5 rounded-lg px-4 py-3">
                  <Palette size={18} className="text-blue-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white">Strip Colours</p>
                    <p className="text-xs text-white/40">Team colours help distinguish sides in the video</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => {
                  setPrereqModal(null)
                  navigate(`/results/${session?.match_id}`)
                }}
                className="flex-1 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Set Up First
              </button>
              <button
                onClick={() => startAutoAnalyze()}
                className="flex-1 px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white/70 text-sm font-medium rounded-lg transition-colors"
              >
                Continue Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Alert/error modal */}
      <ConfirmationModal
        isOpen={!!alertModal}
        onClose={() => {
          const callback = alertModal?.onClose
          setAlertModal(null)
          callback?.()
        }}
        title={alertModal?.title || ''}
        message={alertModal?.message || ''}
        variant={alertModal?.variant || 'danger'}
      />

      {/* Tactical View Overlay */}
      {showTacticalView && playerRef.current?.getVideoElement() && (
        <VideoTacticalView
          videoElement={playerRef.current.getVideoElement()!}
          matchId={session.match_id}
          videoSessionId={sessionId}
          currentTimeMs={currentTimeMs}
          roster={matchLineup?.map(e => ({ jersey_number: e.match_jersey_number ?? e.player_jersey_number ?? 0, name: e.player_name || `#${e.match_jersey_number ?? '?'}`, position: e.position_id || undefined })) ?? []}
          teamColors={matchData ? { own: matchData.team_strip_colour || '#00AA00', opponent: matchData.opponent_strip_colour || '#FF6600' } : undefined}
          onClose={() => setShowTacticalView(false)}
        />
      )}

      {trackingOverlays}

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

      {/* Undo to Point Modal */}
      {showUndoModal && (
        <UndoToPointModal
          isOpen={showUndoModal}
          onClose={() => setShowUndoModal(false)}
          onConfirm={handleUndoToPoint}
          currentTimeMs={highWaterMarkMs}
          events={events || []}
          segments={[]}
          minUndoTimeMs={session?.first_half_start_ms ?? 0}
        />
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
