/**
 * VideoTagging — Main video analysis tagging page.
 *
 * Event flow: tap event → tap player number (own-team events only) → done.
 * Position is always taken from the live ball position on the persistent
 * tracking pitch — there's no separate pitch-tap-to-confirm step (removed;
 * redundant once tracking moved from a small minimap to the big persistent
 * pitch, which already has the position by the time an event is tapped).
 * Video auto-pauses on event tap and auto-resumes after completion.
 * The continuous ball-carrier tracking pitch (TaggingPitch)
 * is a permanent panel beside or below the video (never overlaps it) —
 * user-toggleable Side/Below, remembered per-device via usePitchPanelLayout.
 * Scoreboard in header with GAA format (1-03) and total.
 * Fullscreen mode hides app header and maximises video area.
 *
 * Layout (normal, pitch panel mode = 'side'):
 * ┌──────────────────────────────────────────────────┐
 * │  ← Back | Title | Scoreboard | [Auto] [Sync]    │
 * ├──────────────────────────────┬─────────┬─────────┤
 * │                              │ Tagging │  Quick  │
 * │   Video Player               │ Pitch   │  Action │
 * │   (pitch confirm overlay)    │(vertical│  Sidebar│
 * │                              │ column) │(tabs+btn│
 * ├──────────────────────────────┴─────────┴─────────┤
 * │  Event Timeline                                   │
 * ├──────────────────────────────────────────────────┤
 * │  ▾ Event Log (collapsible)                        │
 * └──────────────────────────────────────────────────┘
 *
 * Layout (fullscreen, pitch panel mode = 'below'):
 * ┌──────────────────────────────────────────────────┐
 * │  [X] Title | Scoreboard | [Auto] [Report] [Sync] │
 * ├──────────────────────────────────┬───────────────┤
 * │   Video Player (flex-1)          │  Quick Action  │
 * │   TaggingPitch (horizontal strip)│  Sidebar       │
 * ├──────────────────────────────────┴───────────────┤
 * │  Possession status bar                            │
 * └──────────────────────────────────────────────────┘
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Download, Loader2, Sparkles, X, AlertTriangle, Users, Palette, Maximize, Camera, PanelRight, PanelBottom, Play } from 'lucide-react'
import VideoPlayer, { type VideoPlayerHandle } from '../components/video/VideoPlayer'
import VideoTacticalView from '../components/video/VideoTacticalView'
import EventTimeline from '../components/video/EventTimeline'
import VideoQuickActions, { type Category, type OverlayPendingEvent } from '../components/video/VideoQuickActions'
import VideoEventLog from '../components/video/VideoEventLog'
import TaggingPitch from '../components/video/TaggingPitch'
import PlayerSelectionModal from '../components/PlayerSelectionModal'
import PitchPlayerSelector from '../components/PitchPlayerSelector'
import SyncPreviewModal from '../components/video/SyncPreviewModal'
import ConfirmationModal from '../components/ConfirmationModal'
import SetupFlowModal, { type SetupStep } from '../components/video/SetupFlowModal'
import AttackDirectionBadge from '../components/video/AttackDirectionBadge'
import VideoStatsPanel from '../components/video/VideoStatsPanel'
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
import { type PitchZone, TWO_POINTER_ZONES, xyToZone } from '../components/video/PitchZoneSelector'
import BlackCardTimer, { type BlackCardEntry } from '../components/BlackCardTimer'
import VideoFormationSnapshot from '../components/video/VideoFormationSnapshot'
import JerseyNumberStrip, { type JerseyPlayer } from '../components/JerseyNumberStrip'
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
} from '../hooks/useVideoSessions'
import { usePitchPanelLayout } from '../hooks/usePitchPanelLayout'
import {
  useVideoEvents,
  useCreateVideoEvent,
  useUpdateVideoEvent,
  useDeleteVideoEvent,
  useVerifyVideoEvent,
  useSyncPreview,
  useSyncConfirm,
} from '../hooks/useVideoEvents'
import { videoSessionsAPI, videoEventsAPI } from '../services/videoApi'
import type { VideoEventCreateData, VideoSyncPreview, VideoSyncStatus, BallPositionSampleData } from '../services/videoApi'
import { api, type BallCarrierSegment } from '../services/api'
import { useQuery } from '@tanstack/react-query'
import { PossessionTeam } from '../types'
import type { Player, BallPosition } from '../types'

type OverlayState = 'none' | 'player'

/** Derive a human-readable status label from ball position and possession. */
function getStatusLabel(
  pos: { x: number; y: number },
  possession: 'team_a' | 'team_b',
  clubName: string,
  opponentName: string,
): string {
  const teamLabel = possession === 'team_a' ? clubName : opponentName
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
  const playerRef = useRef<VideoPlayerHandle>(null)
  const clubName = useClubName()
  const { club } = useClub()

  // Ball carrier tracking state
  const [activeCarrierId, setActiveCarrierId] = useState<string | null>(null)
  const [recentCarrierIds, setRecentCarrierIds] = useState<string[]>([])
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

  // Ball tracking pitch panel layout — Side (vertical pitch) or Below (horizontal pitch)
  const { mode: pitchPanelMode, toggleMode: togglePitchPanelMode } = usePitchPanelLayout()

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
    title: string; message: string; variant: 'danger' | 'warning' | 'info'
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

  // Stats/charts data — converts the session's own tagged (but not yet
  // synced to the match) events into the shape live recording's chart
  // components read, so the same charts can render live during tagging.
  // See utils/videoEventChartAdapter.ts for why this is needed and how.
  const chartEvents = useMemo(() => videoEventsToChartEvents(events), [events])
  const shotLocations = useMemo(
    () => computeShotLocations(chartEvents, matchData?.half_duration_mins, matchData?.attacking_right_first_half),
    [chartEvents, matchData?.half_duration_mins, matchData?.attacking_right_first_half]
  )

  const { data: matchLineup } = useQuery({
    queryKey: ['matchLineup', session?.match_id],
    queryFn: () => api.matchLineups.getLineup(session!.match_id),
    enabled: !!session?.match_id,
  })

  // Mutations
  const createEvent = useCreateVideoEvent()
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

  const handleMarkFirstHalf = useCallback(async () => {
    if (!sessionId) return
    await videoSessionsAPI.setHalfStarts(sessionId, currentTimeMs, undefined)
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

  const handleSelectThrowInWinner = useCallback((winner: 'team_a' | 'team_b') => {
    setPossession(winner)
    setThrowInWinnerChosen(true)
  }, [])

  const handleStartTracking = useCallback(async () => {
    if (!sessionId || !session) return
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
    playerRef.current?.seekTo(throwInMs)
  }, [sessionId, session, startTracking])

  const handleRequestEndTracking = useCallback(() => {
    playerRef.current?.pause()
    setShowFullTimeConfirm(true)
  }, [])

  const handleConfirmFinishTracking = useCallback(async () => {
    if (!sessionId) return
    await completeTracking.mutateAsync({ sessionId })
    setShowFullTimeConfirm(false)
  }, [sessionId, completeTracking])

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

    // Otherwise first half (relative to 1st half throw-in)
    const elapsed = Math.max(0, videoMs - h1Start)
    const totalSec = Math.floor(elapsed / 1000)
    return { minute: Math.floor(totalSec / 60), second: totalSec % 60, half: 1 }
  }, [session?.first_half_start_ms, session?.second_half_start_ms])

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

  // ── Ball position sampling (every 5s while playing AND tracking) ────
  useEffect(() => {
    if (!isPlaying || !ballPosition || mode !== 'tracking') return
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
  }, [isPlaying, ballPosition, possession, currentTimeMs])

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

  // Discrete possession-change point — fires on a tap or drag-END commit
  // only (bound to onBallMove, never onDragUpdate's live-drag callback, so
  // this doesn't fire dozens of times per drag). Mirrors MatchRecording.tsx's
  // handleBallMove writing a PossessionEvent on every commit. Video tagging
  // previously wrote none at all, so PossessionEvent-dependent season charts
  // (Territory Distribution, Possession Funnel) had zero data for any
  // video-tagged match.
  const handleTaggingBallCommit = useCallback((position: BallPosition) => {
    handleTaggingBallMove(position)
    if (!session?.match_id) return
    const matchTime = calcMatchTime(currentTimeMs)
    api.possession.create({
      match_id: session.match_id,
      x_coord: position.x,
      y_coord: position.y,
      is_home_team: possession === 'team_a',
      minute: matchTime.minute,
      half: matchTime.half,
    }).catch(err => console.error('Failed to record possession point (video tagging):', err))
  }, [handleTaggingBallMove, session?.match_id, calcMatchTime, currentTimeMs, possession])

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

  // Persistent attack-direction indicator — null until direction is known
  // (i.e. until the setup flow's direction step is complete).
  const teamAttackingRightThisHalf = useMemo<boolean | null>(() => {
    const attackingRightFirstHalf = matchData?.attacking_right_first_half
    if (attackingRightFirstHalf == null) return null
    const currentHalf = calcMatchTime(currentTimeMs).half
    return currentHalf === 2 ? !attackingRightFirstHalf : attackingRightFirstHalf
  }, [matchData?.attacking_right_first_half, calcMatchTime, currentTimeMs])

  const [highlight45LineX, setHighlight45LineX] = useState<number | null>(null)

  // TaggingPitch previously had no 45m-line snap/highlight at all. When the
  // 45m Free sub-panel opens, snap the persistent pitch's ball marker onto
  // the real line (same as MatchRecording.tsx does on 45 initiation — the
  // event's location is derived from wherever the ball marker sits, so this
  // keeps it accurate) and highlight the line so the user can drag-correct
  // along it before picking Scored/Missed.
  const handleFortyFivePanelToggle = useCallback((open: boolean) => {
    if (open) {
      const lineX = compute45LineX(possession === 'team_a')
      setHighlight45LineX(lineX)
      setBallPosition(prev => (prev ? { ...prev, x: lineX } : prev))
    } else {
      setHighlight45LineX(null)
    }
  }, [possession, compute45LineX])

  /** Create the event, apply auto-flip/auto-switch, resume video.
   *  Stored in a ref so overlay handlers always call the latest version. */
  const finalizeEventRef = useRef<(pending: OverlayPendingEvent, data: VideoEventCreateData) => void>(() => {})
  finalizeEventRef.current = (pending: OverlayPendingEvent, data: VideoEventCreateData) => {
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

    createEvent.mutate({ sessionId, data })

    // Auto-end carrier on terminal events (scores, turnovers, wides, etc.)
    onCarrierTerminalEvent(data.event_type)

    // Auto-flip possession (action.autoFlipTo is the source of truth)
    const action = pending.action
    if (action.autoFlipTo) {
      setPossession(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
      // End carrier on possession swap
      onCarrierPossessionSwap()
    }
    // Context-aware tab switch (score/wide → kickouts)
    if (action.autoSwitchTab) {
      setActiveTab(action.autoSwitchTab)
    }

    // Dismiss AI banner on first manual event
    setAiDismissed(true)

    // Clear overlay state
    setOverlayState('none')
    setPendingOverlay(null)

    // Resume video if it was playing
    if (wasPlayingRef.current) {
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
  const handleEventTap = useCallback((pending: OverlayPendingEvent) => {
    wasPlayingRef.current = playerRef.current?.isPlaying() || false
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

    if (pending.action.needsPlayer && possession === 'team_a') {
      setOverlayState('player')
    } else {
      // No player needed, or opponent event — finalize directly
      setOverlayState('none')
      setTimeout(() => finalizeEventRef.current(pending, pending.eventData), 0)
    }
  }, [ballPosition, possession])

  /** Player selected → finalize event */
  const handlePlayerSelect = useCallback((player: Player) => {
    setPendingOverlay(prev => {
      if (!prev) return prev
      const data = { ...prev.eventData, player_id: player.id }
      // Schedule finalize after this setState completes
      setTimeout(() => finalizeEventRef.current(prev, data), 0)
      return prev
    })
  }, [])

  /** Player skipped → finalize without player */
  const handlePlayerSkip = useCallback(() => {
    setPendingOverlay(prev => {
      if (!prev) return prev
      setTimeout(() => finalizeEventRef.current(prev, prev.eventData), 0)
      return prev
    })
  }, [])

  /** Cancel the overlay flow and resume video */
  const cancelOverlay = useCallback(() => {
    setOverlayState('none')
    setPendingOverlay(null)
    if (wasPlayingRef.current) {
      playerRef.current?.play()
    }
  }, [])

  /** Direct event creation (no overlay needed, e.g. KO Lost, cards) */
  const handleDirectCreate = useCallback((data: VideoEventCreateData) => {
    if (!sessionId) return
    createEvent.mutate({ sessionId, data })
    onCarrierTerminalEvent(data.event_type)
    setAiDismissed(true)

    // Start black card 10-min countdown
    if (data.event_type === 'BLACK_CARD') {
      setBlackCardTimers(prev => [...prev, {
        id: crypto.randomUUID(),
        playerLabel: data.jersey_number ? `#${data.jersey_number}` : `${data.match_minute}'`,
        startedAt: Date.now(),
      }])
    }
  }, [sessionId, createEvent])

  const handleDeleteEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    deleteEvent.mutate({ eventId, sessionId })
  }, [sessionId, deleteEvent])

  const handleVerifyEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    verifyEvent.mutate({ eventId, sessionId })
  }, [sessionId, verifyEvent])

  const handleEditZone = useCallback((eventId: string, zone: PitchZone) => {
    if (!sessionId) return
    const isTwoPointer = TWO_POINTER_ZONES.includes(zone)
    updateEvent.mutate({
      eventId,
      sessionId,
      data: {
        pitch_zone: zone,
        scoring_context: { is_two_pointer: isTwoPointer },
      },
    })
  }, [sessionId, updateEvent])

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

  // Build own players list for formation snapshot from lineup data
  // (must be before early returns to satisfy Rules of Hooks)
  const snapshotOwnPlayers = useMemo(() => {
    if (!matchLineup) return []
    const playerMap = new Map(players?.map(p => [p.id, p]) ?? [])
    return matchLineup.map((entry) => {
      const player = playerMap.get(entry.player_id)
      const jerseyNumber = entry.match_jersey_number ?? entry.player_jersey_number ?? player?.jersey_number ?? null
      return {
        playerId: entry.player_id,
        jerseyNumber,
        playerName: entry.player_name || player?.name || `#${jerseyNumber ?? '?'}`,
      }
    })
  }, [matchLineup, players])

  // ── Position label map for carrier strip ─────────────────────────────
  const POSITION_LABELS: Record<string, string> = {
    'gk': 'GK', 'fb-left': 'CB', 'fb-center': 'FB', 'fb-right': 'CB',
    'hb-left': 'HB', 'hb-center': 'CHB', 'hb-right': 'HB',
    'mf-left': 'MF', 'mf-right': 'MF',
    'hf-left': 'HF', 'hf-center': 'CHF', 'hf-right': 'HF',
    'ff-left': 'CF', 'ff-center': 'FF', 'ff-right': 'CF',
  }

  // Build jersey strip player list from lineup data
  const jerseyStripPlayers: JerseyPlayer[] = useMemo(() => {
    if (!matchLineup || matchLineup.length === 0) return []
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
  }, [matchLineup, players])

  // ── Ball carrier segment management (direct API, no offline layer) ───

  const endCarrierSegment = useCallback(async (
    endX?: number | null,
    endY?: number | null,
    endedBy?: string,
  ) => {
    const seg = activeSegmentRef.current
    if (!seg) return

    // Flush buffered path points
    if (carrierPathBufferRef.current.length > 0) {
      try {
        await api.playerMovement.appendPathPoints(seg.id, carrierPathBufferRef.current)
      } catch (err) {
        console.error('Failed to flush carrier path points:', err)
      }
      carrierPathBufferRef.current = []
    }
    if (carrierFlushTimerRef.current) {
      clearTimeout(carrierFlushTimerRef.current)
      carrierFlushTimerRef.current = null
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

    activeSegmentRef.current = null
    setActiveCarrierId(null)
  }, [])

  const startCarrierSegment = useCallback(async (
    playerId: string,
    jerseyNumber: number | null,
    startX: number | null,
    startY: number | null,
  ) => {
    if (!session?.match_id) return null

    // End current segment first
    if (activeSegmentRef.current) {
      await endCarrierSegment(startX, startY, 'pass')
    }

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
      setActiveCarrierId(playerId)
      carrierPathBufferRef.current = []
      return segment
    } catch (err) {
      console.error('Failed to start carrier segment:', err)
      return null
    }
  }, [session?.match_id, calcMatchTime, currentTimeMs, possession, endCarrierSegment])

  const handleCarrierSelect = useCallback(async (playerId: string, jerseyNumber: number | null) => {
    const bx = ballPosition?.x ?? null
    const by = ballPosition?.y ?? null

    if (activeCarrierId === playerId) {
      // Deselect — end segment
      await endCarrierSegment(bx, by, 'manual')
    } else {
      // Select new carrier
      await startCarrierSegment(playerId, jerseyNumber, bx, by)
      // Track recent carriers (most recent first, max 10)
      setRecentCarrierIds(prev => [playerId, ...prev.filter(id => id !== playerId)].slice(0, 10))
    }
  }, [activeCarrierId, ballPosition, startCarrierSegment, endCarrierSegment])

  // Append path points to active carrier segment (throttled 200ms batching)
  const appendCarrierPathPoint = useCallback((x: number, y: number) => {
    if (!activeSegmentRef.current) return
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
  const onCarrierTerminalEvent = useCallback(async (eventType: string) => {
    if (!activeSegmentRef.current) return

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
      const bx = ballPosition?.x ?? null
      const by = ballPosition?.y ?? null
      await endCarrierSegment(bx, by, endReason)
    }
  }, [endCarrierSegment, ballPosition])

  // Auto-end carrier on possession swap
  const onCarrierPossessionSwap = useCallback(async () => {
    if (!activeSegmentRef.current) return
    const bx = ballPosition?.x ?? null
    const by = ballPosition?.y ?? null
    await endCarrierSegment(bx, by, 'turnover')
  }, [endCarrierSegment, ballPosition])

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

    // Bulk-record the same waypoints as PossessionEvent rows — the drag-path
    // counterpart to handleTaggingBallCommit's single-point write, same call
    // pattern as MatchRecording.tsx's handleDragPath.
    if (session?.match_id) {
      const matchTime = calcMatchTime(currentTimeMs)
      api.possession.bulkCreate({
        match_id: session.match_id,
        team: possession === 'team_a' ? 'own' : 'opponent',
        minute: matchTime.minute,
        waypoints,
      }).catch(err => console.error('Failed to record possession drag path (video tagging):', err))
    }
  }, [appendCarrierPathPoint, session?.match_id, calcMatchTime, currentTimeMs, possession])

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

  /** Action buttons row — tracking controls (when active), Report, Snapshot, Sync */
  const actionButtons = (compact = false) => (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      {trackingClock && (
        <>
          <span className={`font-mono font-bold text-emerald-400 tabular-nums ${compact ? 'text-xs px-1.5' : 'text-sm px-2'}`}>
            {trackingClock.minute}:{String(trackingClock.second).padStart(2, '0')}
          </span>
          <button
            onClick={handleRequestEndTracking}
            className={`${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-300 hover:text-red-200 font-medium transition-colors whitespace-nowrap`}
          >
            End Tracking
          </button>
        </>
      )}
      {!isFullscreen && (
        <>
          <button
            onClick={() => statsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={`${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium transition-colors whitespace-nowrap`}
          >
            Stats
          </button>
          <button
            onClick={() => chartsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            className={`${compact ? 'px-2 py-1.5 text-[10px]' : 'px-3 py-2 text-xs'} rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium transition-colors whitespace-nowrap`}
          >
            Charts
          </button>
        </>
      )}
      <button
        onClick={handleEnrich}
        disabled={isEnriching || events.length === 0}
        className={`flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2.5'} rounded-xl ${compact ? 'text-[10px]' : 'text-xs'} font-semibold transition-all border border-violet-400/20 backdrop-blur-sm shadow-lg shadow-violet-500/10 hover:shadow-violet-500/25 hover:border-violet-400/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none text-white whitespace-nowrap`}
        style={{ background: 'linear-gradient(135deg, rgba(124,58,237,0.45) 0%, rgba(109,40,217,0.35) 50%, rgba(139,92,246,0.25) 100%)' }}
      >
        {isEnriching ? <Loader2 size={compact ? 12 : 14} className="animate-spin" /> : <FileText size={compact ? 12 : 14} />}
        Report
      </button>
      <button
        onClick={() => { playerRef.current?.pause(); setIsSnapshotOpen(true) }}
        className={`flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2.5'} rounded-xl ${compact ? 'text-[10px]' : 'text-xs'} font-semibold transition-all border border-purple-400/20 backdrop-blur-sm shadow-lg shadow-purple-500/10 hover:shadow-purple-500/25 hover:border-purple-400/30 hover:scale-[1.02] active:scale-[0.98] text-white whitespace-nowrap`}
        style={{ background: 'linear-gradient(135deg, rgba(168,85,247,0.45) 0%, rgba(147,51,234,0.35) 50%, rgba(192,132,252,0.25) 100%)' }}
        title="Take formation snapshot"
      >
        <Camera size={compact ? 12 : 14} />
        {snapshotCount > 0 ? `Snapshot (${snapshotCount})` : compact ? 'Snapshot' : 'Formation Snapshot'}
      </button>
      <button
        onClick={handleSyncClick}
        disabled={syncPreview.isPending || events.length === 0}
        className={`flex items-center gap-1.5 ${compact ? 'px-2.5 py-1.5' : 'px-4 py-2.5'} rounded-xl ${compact ? 'text-[10px]' : 'text-xs'} font-semibold transition-all border border-emerald-400/20 backdrop-blur-sm shadow-lg shadow-emerald-500/10 hover:shadow-emerald-500/25 hover:border-emerald-400/30 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100 disabled:shadow-none text-white whitespace-nowrap`}
        style={{ background: 'linear-gradient(135deg, rgba(16,185,129,0.45) 0%, rgba(5,150,105,0.35) 50%, rgba(52,211,153,0.25) 100%)' }}
      >
        {syncPreview.isPending ? <Loader2 size={compact ? 12 : 14} className="animate-spin" /> : <Download size={compact ? 12 : 14} />}
        {compact ? 'Save' : 'Save to Match'}
      </button>
    </div>
  )

  /** Video player + permanent TaggingPitch tracking panel, fullscreen/layout
   *  toggle buttons, and the pitch-location confirm overlay. */
  const videoArea = (
    <div
      data-tour="video-player"
      className={`relative flex-1 flex min-w-0 min-h-0 ${pitchPanelMode === 'side' ? 'flex-row' : 'flex-col'}`}
    >
      <div className="relative flex-1 min-w-0 min-h-0 group/video">
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
        />

        {/* Guided setup flow — replaces the old throw-in card + separate
            HalftimeMarker banner. Rendered inside videoArea (shared between
            fullscreen and normal layouts) so it works in both, unlike the
            old HalftimeMarker which was only wired into normal mode. */}
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

        {/* Resume-tracking cue — tracking mode is "started" server-side but
            play/pause is a separate signal (see mode gating throughout this
            file), so once the setup card is gone there'd otherwise be no
            obvious affordance telling the user how to actually resume
            recording, especially after leaving and coming back. Placed in
            the same corner the setup card used (mutually exclusive with it —
            one is 'setup' mode only, this is 'tracking' mode only) so it
            never competes with VideoPlayer's own centre play button. */}
        {mode === 'tracking' && !isPlaying && overlayState === 'none' && (
          <div className="absolute top-3 left-3 z-30 pointer-events-none">
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

        {/* Fullscreen + pitch-panel layout toggle — overlaid on video, top-left, visible on hover */}
        {overlayState === 'none' && (
          <div className="absolute top-2 left-2 z-20 flex items-center gap-1.5 opacity-70 sm:opacity-0 sm:group-hover/video:opacity-100 transition-all">
            <button
              onClick={() => setIsFullscreen(prev => !prev)}
              className="p-2 bg-black/50 hover:bg-black/80 text-white/70 hover:text-white rounded-lg transition-colors"
              title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F)'}
            >
              <Maximize size={18} />
            </button>
            <button
              onClick={togglePitchPanelMode}
              className="p-2 bg-black/50 hover:bg-black/80 text-white/70 hover:text-white rounded-lg transition-colors"
              title={pitchPanelMode === 'side' ? 'Move tracking pitch below video' : 'Move tracking pitch beside video'}
            >
              {pitchPanelMode === 'side' ? <PanelBottom size={18} /> : <PanelRight size={18} />}
            </button>
          </div>
        )}
      </div>

      {/* Ball-carrier tracking pitch — permanent panel, never overlays the
          video. 'side': vertical pitch column next to the video (landscape
          tablets, width to spare). 'below': horizontal pitch strip under
          the video (portrait tablets, height to spare). Replaces the old
          floating BallMinimap widget. Locked until tracking mode has
          actually started, and frozen again whenever paused — play/pause
          only controls video playback, never conflated with tracking. */}
      <TaggingPitch
        orientation={pitchPanelMode === 'side' ? 'vertical' : 'horizontal'}
        containerClassName={
          pitchPanelMode === 'side'
            ? 'relative h-full w-[300px] md:w-[340px] flex-shrink-0 bg-gradient-to-br from-green-900/40 to-green-800/40 overflow-hidden'
            : 'relative w-full flex-shrink-0 bg-gradient-to-br from-green-900/40 to-green-800/40 overflow-hidden aspect-[1960/1167]'
        }
        ballPosition={taggingBallPosition}
        onBallMove={handleTaggingBallCommit}
        onDragUpdate={handleTaggingBallMove}
        onDragPath={handleTaggingDragPath}
        trail={ballTrail}
        carrierJerseyNumber={activeCarrierId ? jerseyStripPlayers.find(p => p.playerId === activeCarrierId)?.jerseyNumber ?? null : null}
        disabled={mode !== 'tracking' || !isPlaying || overlayState !== 'none'}
        highlight45LineX={highlight45LineX}
      />
      {teamAttackingRightThisHalf != null && (
        <div className={pitchPanelMode === 'side' ? 'absolute top-1/2 right-1.5 -translate-y-1/2 z-20' : 'absolute bottom-2 right-2 z-20'}>
          <AttackDirectionBadge
            attackingRight={teamAttackingRightThisHalf}
            teamName={clubName}
            orientation={pitchPanelMode === 'side' ? 'vertical' : 'horizontal'}
          />
        </div>
      )}
    </div>
  )

  /** Quick Actions sidebar */
  const sidebar = (
    <div data-tour="video-quick-actions">
    <VideoQuickActions
      possession={possession}
      onPossessionChange={setPossession}
      selectedZone={null}
      currentTimestampMs={currentTimeMs}
      half={session.half || 1}
      onEventTap={handleEventTap}
      onCreateEvent={handleDirectCreate}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      disabled={isAutoAnalyzing || overlayState !== 'none' || mode === 'setup'}
      teamName={clubName}
      ballPitchX={ballPosition?.x}
      ballPitchY={ballPosition?.y}
      calcMatchTime={calcMatchTime}
      onFortyFivePanelToggle={handleFortyFivePanelToggle}
    />
    </div>
  )

  /** Possession status bar */
  const statusBar = ballPosition ? (
    <div
      className={`flex items-center justify-between px-4 py-2 rounded-lg border transition-all ${
        possession === 'team_a'
          ? 'bg-gradient-to-r from-emerald-500/15 to-emerald-500/5 border-emerald-500/20'
          : 'bg-gradient-to-r from-orange-500/15 to-orange-500/5 border-orange-500/20'
      }`}
    >
      <span className="text-sm text-white/80 font-medium whitespace-nowrap truncate">
        {getStatusLabel(ballPosition, possession, clubName, opponentName)}
      </span>
      <button
        onClick={() => { onCarrierPossessionSwap(); setPossession(p => p === 'team_a' ? 'team_b' : 'team_a') }}
        className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold transition-all ${
          possession === 'team_a'
            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
            : 'bg-orange-500/20 text-orange-300 border border-orange-500/30'
        }`}
      >
        <span className="relative flex h-2 w-2">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
            possession === 'team_a' ? 'bg-emerald-400' : 'bg-orange-400'
          }`} />
          <span className={`relative inline-flex rounded-full h-2 w-2 ${
            possession === 'team_a' ? 'bg-emerald-500' : 'bg-orange-500'
          }`} />
        </span>
        {possession === 'team_a' ? clubName : opponentName}
      </button>
    </div>
  ) : null

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
      team={(pendingOverlay?.eventData.team ?? possession) === 'team_a' ? 'own' : 'opponent'}
      players={playerList}
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
      team={(pendingOverlay?.eventData.team ?? possession) === 'team_a' ? 'own' : 'opponent'}
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
          {actionButtons(true)}
        </div>

        {/* Status bar — right under the header, always visible without scrolling */}
        {statusBar && (
          <div className="flex-shrink-0 px-3 py-1.5 bg-slate-900/60 border-b border-white/5">
            {statusBar}
          </div>
        )}

        {/* Main area: video + sidebar */}
        <div className="flex-1 flex overflow-hidden min-h-0">
          {videoArea}
          {sidebar}
        </div>

        {/* Ball carrier strip — below video */}
        {jerseyStripPlayers.length > 0 && (
          <div className="flex-shrink-0 px-2 py-0.5 bg-slate-900/80 border-t border-white/5">
            <JerseyNumberStrip
              players={jerseyStripPlayers}
              activeCarrierId={activeCarrierId}
              currentPossession={possession === 'team_a' ? 'team_a' as any : 'team_b' as any}
              onCarrierSelect={handleCarrierSelect}
              teamPrimaryColor={club?.primary_colour || '#10B981'}
              teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
              currentHalf={calcMatchTime(currentTimeMs).half as 1 | 2}
              recentCarrierIds={recentCarrierIds}
            />
          </div>
        )}

        {/* Black card sin bin timers */}
        {blackCardTimers.length > 0 && (
          <div className="absolute top-14 right-[192px] z-30">
            <BlackCardTimer entries={blackCardTimers} onRemove={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))} />
          </div>
        )}

        {/* Player picker (step 3 of the tap flow) — pitch-formation circles
            when a lineup exists, jersey-grid fallback otherwise */}
        {newEventPlayerPicker}

        {/* Alert/error modal */}
        <ConfirmationModal
          isOpen={!!alertModal}
          onClose={() => setAlertModal(null)}
          title={alertModal?.title || ''}
          message={alertModal?.message || ''}
          variant={alertModal?.variant || 'danger'}
        />

        {/* Formation Snapshot Overlay */}
        <VideoFormationSnapshot
          isOpen={isSnapshotOpen}
          onClose={() => setIsSnapshotOpen(false)}
          onSave={handleSnapshotSave}
          ownPlayers={snapshotOwnPlayers}
          opponentName={opponentName}
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
      </div>
    )
  }

  // ── Normal mode ──────────────────────────────────────────────────────

  return (
    <div className="max-w-[1600px] mx-auto space-y-3">
      {/* ── Header with scoreboard ─────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        {/* Left: back + title */}
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-2 text-white/50 hover:text-white transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-bold text-white leading-tight">{session.title}</h1>
            <p className="text-xs text-white/40">
              {session.half ? `Half ${session.half}` : 'Full Match'} &bull; {events.length} events
              {session.status === 'completed' && ' \u2022 Completed'}
            </p>
          </div>
        </div>

        {/* Centre: scoreboard */}
        <div data-tour="video-scoreboard">{scoreboard()}</div>

        {/* Right: action buttons */}
        {actionButtons()}
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

      {/* ── Possession status bar — right under the header, always visible ── */}
      {statusBar}

      {/* ── Video Player + Quick Actions sidebar ───────────────────────── */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <div className="flex">
          {videoArea}
          {sidebar}
        </div>
        {/* Black card sin bin timers */}
        {blackCardTimers.length > 0 && (
          <div className="absolute top-2 right-[192px] z-30">
            <BlackCardTimer entries={blackCardTimers} onRemove={(id) => setBlackCardTimers(prev => prev.filter(t => t.id !== id))} />
          </div>
        )}
      </div>

      {/* ── Ball Carrier Strip ─────────────────────────────────────────── */}
      {jerseyStripPlayers.length > 0 && (
        <div className="bg-slate-900/60 rounded-lg border border-white/5 px-1 py-0.5">
          <JerseyNumberStrip
            players={jerseyStripPlayers}
            activeCarrierId={activeCarrierId}
            currentPossession={possession === 'team_a' ? 'team_a' as any : 'team_b' as any}
            onCarrierSelect={handleCarrierSelect}
            teamPrimaryColor={club?.primary_colour || '#10B981'}
            teamSecondaryColor={club?.secondary_colour || '#FFFFFF'}
            currentHalf={calcMatchTime(currentTimeMs).half as 1 | 2}
            recentCarrierIds={recentCarrierIds}
          />
        </div>
      )}

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
          onEditZone={handleEditZone}
          onEditTeam={handleEditEventTeam}
          onEditPlayer={handleEditEventPlayer}
          collapsed={!eventLogExpanded}
          onToggle={() => setEventLogExpanded(v => !v)}
          onVerifyAll={hasAiEvents ? handleVerifyAll : undefined}
        />
      </div>

      {/* ── Match Statistics — scroll target for the "Stats" button ────── */}
      <div ref={statsRef}>
        <VideoStatsPanel
          matchId={session.match_id}
          chartEvents={chartEvents}
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
          events to be saved via "Save to Match" first — they're not shown here yet.
        </p>
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
      <VideoFormationSnapshot
        isOpen={isSnapshotOpen}
        onClose={() => setIsSnapshotOpen(false)}
        onSave={handleSnapshotSave}
        ownPlayers={snapshotOwnPlayers}
        opponentName={opponentName}
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
        onClose={() => setAlertModal(null)}
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
