/**
 * HalftimeMarker — Prompts user to mark the half-time whistle position before auto-analysis.
 *
 * State A (needs marking): amber banner with "Mark Half-Time Here" + "Skip" buttons
 * State B (already marked): compact pill showing marked time with "Change" option
 * State C (single-half upload): renders nothing
 */

import { Clock, SkipForward, Loader2, Check } from 'lucide-react'
import type { VideoSession } from '../../services/videoApi'

interface HalftimeMarkerProps {
  session: VideoSession
  currentTimeMs: number
  videoDurationMs: number
  onMark: (timestampMs: number) => void
  onSkip: () => void
  isSaving?: boolean
  error?: string | null
}

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const min = Math.floor(totalSeconds / 60)
  const sec = totalSeconds % 60
  return `${min}:${String(sec).padStart(2, '0')}`
}

export default function HalftimeMarker({
  session,
  currentTimeMs,
  videoDurationMs,
  onMark,
  onSkip,
  isSaving = false,
  error = null,
}: HalftimeMarkerProps) {
  // Single-half upload — nothing to show
  if (session.half !== null) return null

  // Already marked
  if (session.halftime_timestamp_ms != null && !isSaving) {
    return (
      <div className="flex items-center gap-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-4 py-2">
        <Check size={14} className="text-emerald-400 shrink-0" />
        <span className="text-sm text-emerald-200">
          Half-time marked at <span className="font-mono font-semibold">{formatTime(session.halftime_timestamp_ms)}</span>
        </span>
        <button
          onClick={() => onMark(currentTimeMs)}
          disabled={isSaving}
          className="text-xs text-emerald-400 hover:text-emerald-300 underline underline-offset-2 ml-auto"
        >
          Change
        </button>
      </div>
    )
  }

  // Needs marking
  return (
    <div className="flex items-center gap-3 bg-amber-500/10 border border-amber-500/20 rounded-lg px-4 py-3">
      <Clock size={16} className="text-amber-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-amber-200">
          Scrub to the half-time whistle and tap <strong>Mark Half-Time</strong> so each half is analysed separately.
        </p>
        <p className="text-xs text-amber-200/60 mt-0.5 font-mono">
          Current position: {formatTime(currentTimeMs)}
          {videoDurationMs > 0 && ` / ${formatTime(videoDurationMs)}`}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className="flex gap-2">
          <button
            onClick={() => onMark(currentTimeMs)}
            disabled={currentTimeMs <= 0 || isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-lg text-xs font-medium transition-all"
          >
            {isSaving ? <Loader2 size={12} className="animate-spin" /> : <Clock size={12} />}
            {isSaving ? 'Saving...' : 'Mark Half-Time Here'}
          </button>
          <button
            onClick={onSkip}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white/50 hover:text-white/80 bg-white/5 hover:bg-white/10 rounded-lg text-xs transition-all"
          >
            <SkipForward size={12} />
            Skip
          </button>
        </div>
        {error && (
          <span className="text-xs text-red-400">{error}</span>
        )}
      </div>
    </div>
  )
}
