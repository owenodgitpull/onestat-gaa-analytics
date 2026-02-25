/**
 * VideoTagging — Main video analysis tagging page.
 *
 * Layout:
 * ┌──────────────────────────────────────────┐
 * │  Video Player                            │
 * ├──────────────────────────────────────────┤
 * │  Event Timeline                          │
 * ├────────────────┬─────────────────────────┤
 * │  Pitch Zone    │  Event Form + Log       │
 * │  Selector      │                         │
 * └────────────────┴─────────────────────────┘
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, Download, Loader2, Sparkles } from 'lucide-react'
import VideoPlayer, { type VideoPlayerHandle } from '../components/video/VideoPlayer'
import EventTimeline from '../components/video/EventTimeline'
import PitchZoneSelector, { type PitchZone } from '../components/video/PitchZoneSelector'
import VideoEventForm from '../components/video/VideoEventForm'
import VideoEventLog from '../components/video/VideoEventLog'
import SyncPreviewModal from '../components/video/SyncPreviewModal'
import { useVideoSession } from '../hooks/useVideoSessions'
import {
  useVideoEvents,
  useCreateVideoEvent,
  useDeleteVideoEvent,
  useVerifyVideoEvent,
  useSyncPreview,
  useSyncConfirm,
} from '../hooks/useVideoEvents'
import { videoSessionsAPI, videoEventsAPI } from '../services/videoApi'
import type { VideoEventCreateData, VideoSyncPreview, VideoSyncStatus } from '../services/videoApi'
import { api } from '../services/api'
import { useQuery } from '@tanstack/react-query'

export default function VideoTagging() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const playerRef = useRef<VideoPlayerHandle>(null)

  // State
  const [currentTimeMs, setCurrentTimeMs] = useState(0)
  const [videoDurationMs, setVideoDurationMs] = useState(0)
  const [selectedZone, setSelectedZone] = useState<PitchZone | null>(null)
  const [, setIsPlaying] = useState(false)
  const [enrichmentReport, setEnrichmentReport] = useState<string | null>(null)
  const [isEnriching, setIsEnriching] = useState(false)
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [syncPreviewData, setSyncPreviewData] = useState<VideoSyncPreview | null>(null)
  const [syncStatusData, setSyncStatusData] = useState<VideoSyncStatus | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Queries
  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useVideoSession(sessionId || null)
  const { data: eventsData } = useVideoEvents(sessionId || null)
  const events = eventsData?.events || []

  // Load players for the match
  const { data: players } = useQuery({
    queryKey: ['players'],
    queryFn: () => api.players.getAll(),
  })

  // Mutations
  const createEvent = useCreateVideoEvent()
  const deleteEvent = useDeleteVideoEvent()
  const verifyEvent = useVerifyVideoEvent()
  const syncPreview = useSyncPreview()
  const syncConfirm = useSyncConfirm()

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  const handleTimeUpdate = useCallback((ms: number) => {
    setCurrentTimeMs(ms)
  }, [])

  const handleDurationChange = useCallback((ms: number) => {
    setVideoDurationMs(ms)
  }, [])

  const handleSeek = useCallback((ms: number) => {
    playerRef.current?.seekTo(ms)
  }, [])

  const handleCreateEvent = useCallback((data: VideoEventCreateData) => {
    if (!sessionId) return
    createEvent.mutate({ sessionId, data })
  }, [sessionId, createEvent])

  const handleDeleteEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    deleteEvent.mutate({ eventId, sessionId })
  }, [sessionId, deleteEvent])

  const handleVerifyEvent = useCallback((eventId: string) => {
    if (!sessionId) return
    verifyEvent.mutate({ eventId, sessionId })
  }, [sessionId, verifyEvent])

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

  const handleSyncClick = async () => {
    if (!sessionId) return
    try {
      const preview = await syncPreview.mutateAsync(sessionId)
      setSyncPreviewData(preview)
      setSyncStatusData(null)
      setShowSyncModal(true)
    } catch (err: any) {
      alert(`Failed to preview sync: ${err.message}`)
    }
  }

  const handleSyncConfirm = async () => {
    if (!sessionId) return
    try {
      await syncConfirm.mutateAsync(sessionId)
      // Start polling for status
      pollRef.current = setInterval(async () => {
        try {
          const status = await videoEventsAPI.syncStatus(sessionId)
          setSyncStatusData(status)
          if (status.status === 'completed' || status.status === 'error') {
            if (pollRef.current) clearInterval(pollRef.current)
            pollRef.current = null
            refetchSession()
          }
        } catch {
          // Ignore poll errors
        }
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
    if (session?.match_id) {
      navigate(`/results/${session.match_id}`)
    }
  }

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
        <button onClick={() => navigate(-1)} className="text-emerald-400 mt-2 text-sm">
          Go back
        </button>
      </div>
    )
  }

  const playerList = (players || []).map((p: any) => ({
    id: p.id,
    name: p.name,
    jersey_number: p.jersey_number,
  }))

  return (
    <div className="max-w-[1600px] mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 text-white/50 hover:text-white transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-white">{session.title}</h1>
            <p className="text-sm text-white/50">
              Half {session.half || '?'} &bull; {events.length} events tagged
              {session.status === 'completed' && ' &bull; Completed'}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleEnrich}
            disabled={isEnriching || events.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600/80 hover:bg-purple-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-all"
          >
            {isEnriching ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate Report
          </button>
          <button
            onClick={handleSyncClick}
            disabled={syncPreview.isPending || events.length === 0}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-all"
          >
            {syncPreview.isPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Sync to Match
          </button>
        </div>
      </div>

      {/* Video Player */}
      <VideoPlayer
        ref={playerRef}
        src={session.download_url}
        onTimeUpdate={handleTimeUpdate}
        onDurationChange={handleDurationChange}
        onPlayStateChange={setIsPlaying}
      />

      {/* Event Timeline */}
      <EventTimeline
        events={events}
        videoDurationMs={videoDurationMs}
        currentTimeMs={currentTimeMs}
        onSeek={handleSeek}
      />

      {/* Main content: Pitch + Form/Log */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Pitch Zone Selector */}
        <div className="lg:col-span-3">
          <div className="glass-card p-4">
            <PitchZoneSelector
              selectedZone={selectedZone}
              onZoneSelect={setSelectedZone}
              highlightTwoPointer
            />
          </div>
        </div>

        {/* Middle: Event Form */}
        <div className="lg:col-span-4">
          <div className="glass-card p-4">
            <h3 className="text-sm font-semibold text-white/60 mb-3 uppercase tracking-wider">Tag Event</h3>
            <VideoEventForm
              onSubmit={handleCreateEvent}
              selectedZone={selectedZone}
              currentTimestampMs={currentTimeMs}
              half={session.half || 1}
              players={playerList}
              disabled={createEvent.isPending}
            />
          </div>
        </div>

        {/* Right: Event Log */}
        <div className="lg:col-span-5">
          <div className="glass-card p-0 h-[500px] flex flex-col">
            <div className="px-4 pt-3 pb-1">
              <h3 className="text-sm font-semibold text-white/60 uppercase tracking-wider">Event Log</h3>
            </div>
            <div className="flex-1 min-h-0">
              <VideoEventLog
                events={events}
                onSeek={handleSeek}
                onDelete={handleDeleteEvent}
                onVerify={handleVerifyEvent}
              />
            </div>
          </div>
        </div>
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
    </div>
  )
}
