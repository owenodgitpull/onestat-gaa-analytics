/**
 * VideoSessionList — Lists video sessions for a match, with upload CTA.
 *
 * Accessible from MatchResult page via "Video Analysis" button.
 */

import { useEffect, useRef, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { Video, Plus, Trash2, Clock, CheckCircle, Loader2, AlertCircle } from 'lucide-react'
import { useVideoSessions, useDeleteVideoSession } from '../hooks/useVideoSessions'
import VideoUploadModal from '../components/VideoUploadModal'
import ConfirmationModal from '../components/ConfirmationModal'
import type { VideoSession } from '../services/videoApi'

function formatBytes(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function formatDuration(ms: number | null): string {
  if (!ms) return '-'
  const s = Math.floor(ms / 1000)
  const min = Math.floor(s / 60)
  const sec = s % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

const STATUS_BADGES: Record<string, { label: string; color: string; icon: any }> = {
  pending: { label: 'Pending', color: 'bg-white/10 text-white/50', icon: Clock },
  uploading: { label: 'Uploading', color: 'bg-amber-500/20 text-amber-300', icon: Loader2 },
  uploaded: { label: 'Ready', color: 'bg-blue-500/20 text-blue-300', icon: Video },
  processing: { label: 'Processing', color: 'bg-purple-500/20 text-purple-300', icon: Loader2 },
  draft_ready: { label: 'Draft Ready', color: 'bg-amber-500/20 text-amber-300', icon: AlertCircle },
  review_in_progress: { label: 'Under Review', color: 'bg-blue-500/20 text-blue-300', icon: Clock },
  completed: { label: 'Completed', color: 'bg-emerald-500/20 text-emerald-300', icon: CheckCircle },
  failed: { label: 'Failed', color: 'bg-red-500/20 text-red-300', icon: AlertCircle },
}

export default function VideoSessionList() {
  const { matchId } = useParams<{ matchId: string }>()
  const navigate = useNavigate()
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<VideoSession | null>(null)

  const { data, isLoading } = useVideoSessions(matchId || null)
  const deleteSession = useDeleteVideoSession()

  const sessions = data?.sessions || []

  // Landing here with nothing attached yet is almost always someone who just
  // clicked "Attach Video" specifically to upload -- go straight to the
  // upload prompt instead of making them click again on an empty list.
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!isLoading && sessions.length === 0 && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      setShowUpload(true)
    }
  }, [isLoading, sessions.length])

  const handleDeleteConfirm = () => {
    if (!matchId || !deleteTarget) return
    deleteSession.mutate({ sessionId: deleteTarget.id, matchId })
    setDeleteTarget(null)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            to={`/results/${matchId}`}
            className="p-2 text-white/50 hover:text-white transition-colors"
          >
            &larr;
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white">Video Analysis</h1>
            <p className="text-sm text-white/50">{sessions.length} video session{sessions.length !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white rounded-xl font-semibold transition-all shadow-lg"
        >
          <Plus size={18} />
          Upload Video
        </button>
      </div>

      {/* Session list */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <Loader2 className="animate-spin text-emerald-400" size={32} />
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-20 glass-card">
          <Video size={48} className="mx-auto mb-4 text-white/20" />
          <h3 className="text-lg font-semibold text-white/60 mb-2">No video sessions yet</h3>
          <p className="text-sm text-white/40 mb-6">Upload match video to start tagging events.</p>
          <button
            onClick={() => setShowUpload(true)}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-semibold transition-all"
          >
            Upload First Video
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map((session) => {
            const statusInfo = STATUS_BADGES[session.status] || STATUS_BADGES.pending
            const StatusIcon = statusInfo.icon

            return (
              <div
                key={session.id}
                className="glass-card p-4 hover:bg-white/[0.03] transition-colors cursor-pointer"
                onClick={() => navigate(`/video/${session.id}`)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-white/5 rounded-lg">
                      <Video size={24} className="text-white/40" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{session.title}</h3>
                      <div className="flex items-center gap-3 text-xs text-white/40 mt-1">
                        {session.half && <span>Half {session.half}</span>}
                        <span>{formatBytes(session.video_size_bytes)}</span>
                        <span>{formatDuration(session.video_duration_ms)}</span>
                        <span>{session.event_count || 0} events</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Status badge */}
                    <span className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
                      <StatusIcon size={12} className={session.status === 'uploading' || session.status === 'processing' ? 'animate-spin' : ''} />
                      {statusInfo.label}
                    </span>

                    {/* Delete */}
                    <button
                      onClick={(e) => { e.stopPropagation(); setDeleteTarget(session) }}
                      className="p-2 text-white/20 hover:text-red-400 transition-colors"
                      title="Delete session"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload modal */}
      {matchId && (
        <VideoUploadModal
          isOpen={showUpload}
          onClose={() => setShowUpload(false)}
          matchId={matchId}
        />
      )}

      {/* Delete confirmation modal */}
      <ConfirmationModal
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        title="Delete Video Session"
        message={`Delete "${deleteTarget?.title}"? This will permanently remove the video file and all tagged events.`}
        confirmText="Delete"
        cancelText="Keep"
        variant="danger"
      />
    </div>
  )
}
