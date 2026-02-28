/**
 * VideoTagging — Main video analysis tagging page.
 *
 * Three-tap flow: tap event → tap pitch zone → tap player number → done.
 * Video auto-pauses on event tap and auto-resumes after completion.
 * Pitch and player overlays render ON TOP of the video player.
 * Scoreboard in header with GAA format (1-03) and total.
 *
 * Layout:
 * ┌──────────────────────────────────────────────────┐
 * │  ← Back | Title | Scoreboard | [Auto] [Sync]    │
 * ├──────────────────────────────────┬───────────────┤
 * │                                  │  Quick Action  │
 * │   Video Player                   │  Sidebar       │
 * │   (pitch overlay / player grid)  │  (tabs+buttons)│
 * ├──────────────────────────────────┴───────────────┤
 * │  Event Timeline                                   │
 * ├──────────────────────────────────────────────────┤
 * │  ▾ Event Log (collapsible)                        │
 * └──────────────────────────────────────────────────┘
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Download, Loader2, Sparkles, X, AlertTriangle, Users, Palette } from 'lucide-react'
import VideoPlayer, { type VideoPlayerHandle } from '../components/video/VideoPlayer'
import EventTimeline from '../components/video/EventTimeline'
import VideoQuickActions, { type Category, type OverlayPendingEvent } from '../components/video/VideoQuickActions'
import VideoEventLog from '../components/video/VideoEventLog'
import PitchOverlay from '../components/video/PitchOverlay'
import PlayerSelectionModal from '../components/PlayerSelectionModal'
import SyncPreviewModal from '../components/video/SyncPreviewModal'
import ConfirmationModal from '../components/ConfirmationModal'
import HalftimeMarker from '../components/video/HalftimeMarker'
import { type PitchZone, TWO_POINTER_ZONES } from '../components/video/PitchZoneSelector'
import { useClubName } from '../contexts/ClubContext'
import { useVideoSession, useSetHalftime } from '../hooks/useVideoSessions'
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
import type { VideoEventCreateData, VideoSyncPreview, VideoSyncStatus } from '../services/videoApi'
import { api } from '../services/api'
import { useQuery } from '@tanstack/react-query'
import type { Player } from '../types'

type OverlayState = 'none' | 'pitch' | 'player'

export default function VideoTagging() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const playerRef = useRef<VideoPlayerHandle>(null)
  const clubName = useClubName()

  // Core state
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [selectedZone, setSelectedZone] = useState<PitchZone | null>(null)
  const [, setIsPlaying] = useState(false)
  const [possession, setPossession] = useState<'team_a' | 'team_b'>('team_a')
  const [activeTab, setActiveTab] = useState<Category>('scoring')

  // Three-tap overlay flow
  const [overlayState, setOverlayState] = useState<OverlayState>('none')
  const [pendingOverlay, setPendingOverlay] = useState<OverlayPendingEvent | null>(null)
  const wasPlayingRef = useRef(false)

  // Event log collapse
  const [eventLogExpanded, setEventLogExpanded] = useState(false)

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
  const { data: eventsData, refetch: refetchEvents } = useVideoEvents(sessionId || null)
  const events = eventsData?.events || []

  const { data: players } = useQuery({
    queryKey: ['players'],
    queryFn: () => api.players.getAll(),
  })

  const { data: matchData } = useQuery({
    queryKey: ['match', session?.match_id],
    queryFn: () => api.matches.getById(session!.match_id),
    enabled: !!session?.match_id,
  })

  // Mutations
  const createEvent = useCreateVideoEvent()
  const updateEvent = useUpdateVideoEvent()
  const deleteEvent = useDeleteVideoEvent()
  const verifyEvent = useVerifyVideoEvent()
  const syncPreview = useSyncPreview()
  const syncConfirm = useSyncConfirm()

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

  // Escape key cancels overlay
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && overlayState !== 'none') {
        cancelOverlay()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [overlayState])

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

  const handleTimeUpdate = useCallback((ms: number) => setCurrentTimeMs(ms), [])
  const handleDurationChange = useCallback((ms: number) => setVideoDurationMs(ms), [])
  const handleSeek = useCallback((ms: number) => playerRef.current?.seekTo(ms), [])

  /** Create the event, apply auto-flip/auto-switch, resume video.
   *  Stored in a ref so overlay handlers always call the latest version. */
  const finalizeEventRef = useRef<(pending: OverlayPendingEvent, data: VideoEventCreateData) => void>(() => {})
  finalizeEventRef.current = (pending: OverlayPendingEvent, data: VideoEventCreateData) => {
    if (!sessionId) return

    createEvent.mutate({ sessionId, data })

    // Auto-flip possession (action.autoFlipTo is the source of truth)
    const action = pending.action
    if (action.autoFlipTo) {
      setPossession(action.autoFlipTo === 'us' ? 'team_a' : 'team_b')
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

  /** Start the three-tap overlay flow: pause video → show pitch or player overlay */
  const handleEventTap = useCallback((pending: OverlayPendingEvent) => {
    wasPlayingRef.current = playerRef.current?.isPlaying() || false
    playerRef.current?.pause()

    setPendingOverlay(pending)

    if (pending.action.needsPitch) {
      setOverlayState('pitch')
    } else if (pending.action.needsPlayer) {
      setOverlayState('player')
    } else {
      setOverlayState('none')
    }
  }, [])

  /** Pitch zone tapped → update event data and advance to player select or complete */
  const handlePitchZoneTap = useCallback((zone: PitchZone) => {
    setSelectedZone(zone)

    setPendingOverlay(prev => {
      if (!prev) return prev

      const isTwoPointer = TWO_POINTER_ZONES.includes(zone)
      const updatedData = { ...prev.eventData, pitch_zone: zone }
      if (updatedData.scoring_context && updatedData.event_type === 'POINT_SCORED') {
        updatedData.scoring_context = { ...updatedData.scoring_context, is_two_pointer: isTwoPointer }
      }

      const updatedPending = { ...prev, eventData: updatedData }

      if (prev.action.needsPlayer) {
        // Advance to player selection (state update batched with setPendingOverlay)
        setTimeout(() => setOverlayState('player'), 0)
      } else {
        // No player needed — finalize directly
        setTimeout(() => finalizeEventRef.current(updatedPending, updatedData), 0)
      }

      return updatedPending
    })
  }, [])

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
    setAiDismissed(true)
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
        onError: (message) => {
          setIsAutoAnalyzing(false)
          setAnalysisProgress(null)
          sseAbortRef.current = null
          setAlertModal({ title: 'Analysis Failed', message, variant: 'danger' })
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
  const canAutoAnalyze = session.download_url && !isAutoAnalyzing
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

  const handleMarkHalftime = (ms: number) => {
    setHalftime.mutate({ sessionId: sessionId!, halftimeMs: ms })
  }
  const handleSkipHalftime = () => setHalftimeSkipped(true)

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
        <div className="flex items-center bg-slate-800/80 rounded-xl border border-white/10 overflow-hidden">
          {/* Team A */}
          <div className={`flex items-center gap-2 px-4 py-2 ${
            possession === 'team_a' ? 'bg-emerald-500/10' : ''
          }`}>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-xs font-semibold text-white/70">{clubName}</span>
            <span className="text-xl font-extrabold text-white tabular-nums min-w-[48px] text-center">
              {currentScore.team_a_goals}-{String(currentScore.team_a_points).padStart(2, '0')}
            </span>
            <span className="text-[11px] text-white/30 font-medium">({teamATotal})</span>
          </div>
          <div className="px-2 text-[10px] text-white/30 font-bold">v</div>
          {/* Team B */}
          <div className={`flex items-center gap-2 px-4 py-2 ${
            possession === 'team_b' ? 'bg-white/5' : ''
          }`}>
            <span className="text-[11px] text-white/30 font-medium">({teamBTotal})</span>
            <span className="text-xl font-extrabold text-white tabular-nums min-w-[48px] text-center">
              {currentScore.team_b_goals}-{String(currentScore.team_b_points).padStart(2, '0')}
            </span>
            <span className="text-xs font-semibold text-white/70">{matchData?.opponent || 'Opposition'}</span>
            <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
          </div>
        </div>

        {/* Right: action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleAutoAnalyzeClick}
            disabled={!canAutoAnalyze}
            className="flex items-center gap-1.5 px-3 py-2 bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-all"
            title={needsHalftime ? 'Mark half-time first' : undefined}
          >
            {isAutoAnalyzing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {isAutoAnalyzing ? 'AI Analysing...' : 'Auto-Analyse'}
          </button>
          <button
            onClick={handleEnrich}
            disabled={isEnriching || events.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600/80 hover:bg-violet-600 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-all"
          >
            {isEnriching ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            Report
          </button>
          <button
            onClick={handleSyncClick}
            disabled={syncPreview.isPending || events.length === 0}
            className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-all"
          >
            {syncPreview.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Sync
          </button>
        </div>
      </div>

      {/* Auto-analyze processing banner */}
      {isAutoAnalyzing && (
        <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg px-4 py-3 space-y-2">
          <div className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin text-purple-400" />
            <span className="text-sm text-purple-300">
              {analysisProgress ? (
                analysisProgress.stage === 'initializing' ? 'Connecting to AI...' :
                analysisProgress.stage === 'downloading' ? 'Downloading video...' :
                analysisProgress.stage === 'extracting' ? (
                  analysisProgress.totalFrames
                    ? `Extracting frames... ${analysisProgress.totalFrames} frames found`
                    : 'Extracting key frames...'
                ) :
                analysisProgress.stage === 'filtering' ? (
                  analysisProgress.survivingFrames
                    ? `Filtering... ${analysisProgress.survivingFrames} key frames from ${analysisProgress.totalFrames}`
                    : 'Filtering static frames...'
                ) :
                analysisProgress.stage === 'analyzing' ? (
                  `Analysing batch ${analysisProgress.completedBatches || 0} of ${analysisProgress.totalBatches || '?'}` +
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

      {/* Halftime marker */}
      <HalftimeMarker
        session={session}
        currentTimeMs={currentTimeMs}
        videoDurationMs={videoDurationMs}
        onMark={handleMarkHalftime}
        onSkip={handleSkipHalftime}
        isSaving={setHalftime.isPending}
        error={setHalftime.error ? (setHalftime.error as Error).message || 'Failed to save half-time marker' : null}
      />

      {/* ── Video Player + Quick Actions sidebar ───────────────────────── */}
      <div className="relative bg-black rounded-lg overflow-hidden">
        <div className="flex">
          {/* Video area — overlays render inside here */}
          <div className="flex-1 relative">
            <VideoPlayer
              ref={playerRef}
              src={session.download_url}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onPlayStateChange={setIsPlaying}
              halftimeMs={session.halftime_timestamp_ms ?? undefined}
            />

            {/* Pitch zone overlay (step 2 of three-tap) */}
            {overlayState === 'pitch' && pendingOverlay && (
              <PitchOverlay
                eventLabel={pendingOverlay.action.label}
                onZoneSelect={handlePitchZoneTap}
                onCancel={cancelOverlay}
              />
            )}

            {/* (Player modal rendered outside video area below) */}
          </div>

          {/* Quick Actions sidebar */}
          <VideoQuickActions
            possession={possession}
            onPossessionChange={setPossession}
            selectedZone={selectedZone}
            currentTimestampMs={currentTimeMs}
            half={session.half || 1}
            onEventTap={handleEventTap}
            onCreateEvent={handleDirectCreate}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            disabled={isAutoAnalyzing || overlayState !== 'none'}
            teamName={clubName}
          />
        </div>
      </div>

      {/* ── Event Timeline ──────────────────────────────────────────────── */}
      <EventTimeline
        events={events}
        videoDurationMs={videoDurationMs}
        currentTimeMs={currentTimeMs}
        onSeek={handleSeek}
      />

      {/* ── Event Log (collapsible) ─────────────────────────────────────── */}
      <div className="glass-card p-0">
        <VideoEventLog
          events={events}
          onSeek={handleSeek}
          onDelete={handleDeleteEvent}
          onVerify={handleVerifyEvent}
          onEditZone={handleEditZone}
          collapsed={!eventLogExpanded}
          onToggle={() => setEventLogExpanded(v => !v)}
          onVerifyAll={hasAiEvents ? handleVerifyAll : undefined}
        />
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

      {/* Player Selection Modal (step 3 of three-tap flow) */}
      <PlayerSelectionModal
        isOpen={overlayState === 'player'}
        onClose={handlePlayerSkip}
        onSelectPlayer={handlePlayerSelect}
        eventType={pendingOverlay?.action.playerModalEventType || 'point'}
        team={possession === 'team_a' ? 'own' : 'opponent'}
        players={playerList}
      />

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
    </div>
  )
}
