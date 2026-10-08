/**
 * UndoToPointModal — Lets user scrub back to a point in the video and delete
 * all events/carrier segments after that timestamp, then resume tracking.
 */

import { useState, useMemo, useEffect } from 'react'
import { X, AlertTriangle, Undo2, Clock } from 'lucide-react'
import type { VideoEvent } from '@/services/videoApi'
import type { BallCarrierSegment } from '@/services/api'

// Simple time formatter: milliseconds -> MM:SS
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

interface UndoToPointModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (timestampMs: number) => Promise<void>
  currentTimeMs: number
  events: VideoEvent[]
  segments: BallCarrierSegment[]
  minUndoTimeMs: number // Earliest point they can undo to (e.g., throw-in time)
}

export default function UndoToPointModal({
  isOpen,
  onClose,
  onConfirm,
  currentTimeMs,
  events,
  segments,
  minUndoTimeMs,
}: UndoToPointModalProps) {
  const [selectedTimeMs, setSelectedTimeMs] = useState(currentTimeMs)
  const [isConfirming, setIsConfirming] = useState(false)

  // Reset selected time when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedTimeMs(currentTimeMs)
    }
  }, [isOpen, currentTimeMs])

  // Calculate what will be deleted at the selected point
  const deletionPreview = useMemo(() => {
    // Events are compared in VIDEO time — the slider is a video time. (This used the match-clock
    // minute, which never lines up with video time, so nothing ever showed as deletable.)
    const eventsToDelete = events.filter(e => (e.video_timestamp_ms ?? -1) > selectedTimeMs)

    const segmentsToDelete = segments.filter(s => {
      const segmentStartMs = (s.minute || 0) * 60 * 1000
      return segmentStartMs > selectedTimeMs
    })

    // Group events by type for display
    const eventTypes: Record<string, number> = {}
    eventsToDelete.forEach(e => {
      const type = e.event_type
      eventTypes[type] = (eventTypes[type] || 0) + 1
    })

    return {
      events: eventsToDelete,
      segments: segmentsToDelete,
      eventTypes,
      totalEvents: eventsToDelete.length,
      totalSegments: segmentsToDelete.length,
    }
  }, [selectedTimeMs, events, segments])

  const handleConfirm = async () => {
    setIsConfirming(true)
    try {
      await onConfirm(selectedTimeMs)
      onClose()
    } catch (error) {
      console.error('Failed to undo to point:', error)
    } finally {
      setIsConfirming(false)
    }
  }

  if (!isOpen) return null

  // Possession and ball tracking after the point are cleared too, so any rollback with footage after it is valid
  const canUndo = selectedTimeMs >= minUndoTimeMs && selectedTimeMs < currentTimeMs - 500

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-slate-900 border border-white/10 rounded-2xl shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-slate-900/95 backdrop-blur-sm border-b border-white/10 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10">
                <Undo2 size={24} className="text-amber-400" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Undo to Point</h2>
                <p className="text-sm text-white/60">Scrub back and delete events after a timestamp</p>
              </div>
            </div>
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              <X size={20} className="text-white/60" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          {/* Timeline Scrubber */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-white/80 flex items-center gap-2">
                <Clock size={16} className="text-emerald-400" />
                Select Rollback Point
              </label>
              <span className="text-lg font-bold text-emerald-400">
                {formatTime(selectedTimeMs)}
              </span>
            </div>

            <input
              type="range"
              min={minUndoTimeMs}
              max={currentTimeMs}
              value={selectedTimeMs}
              onChange={(e) => setSelectedTimeMs(Number(e.target.value))}
              disabled={isConfirming}
              className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-500 [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-emerald-500 [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:cursor-pointer"
            />

            <div className="flex items-center justify-between text-xs text-white/40">
              <span>{formatTime(minUndoTimeMs)}</span>
              <span>Current: {formatTime(currentTimeMs)}</span>
            </div>
          </div>

          {/* Deletion Preview */}
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <h3 className="font-semibold text-white">What will be deleted:</h3>

                {deletionPreview.totalEvents === 0 && deletionPreview.totalSegments === 0 ? (
                  <>
                    <p className="text-sm text-white/60">No tagged events after this point.</p>
                    <p className="text-sm text-white/60">Possession and ball tracking after it will be cleared.</p>
                    <p className="text-sm text-amber-300 pt-2 border-t border-amber-500/20">
                      Video will resume tracking from {formatTime(selectedTimeMs)}
                    </p>
                  </>
                ) : (
                  <>
                    {deletionPreview.totalEvents > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm text-white/80 font-medium">
                          {deletionPreview.totalEvents} event{deletionPreview.totalEvents !== 1 ? 's' : ''}:
                        </p>
                        <ul className="text-sm text-white/60 space-y-0.5 ml-4">
                          {Object.entries(deletionPreview.eventTypes).map(([type, count]) => (
                            <li key={type}>
                              {count} {type.toLowerCase().replace(/_/g, ' ')}
                              {count !== 1 ? 's' : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {deletionPreview.totalSegments > 0 && (
                      <div className="space-y-1">
                        <p className="text-sm text-white/80 font-medium">
                          Ball carrying from {formatTime(selectedTimeMs)} onwards will be deleted
                        </p>
                        <p className="text-xs text-white/50">
                          ({deletionPreview.totalSegments} segment{deletionPreview.totalSegments !== 1 ? 's' : ''})
                        </p>
                      </div>
                    )}

                    <p className="text-sm text-white/60">Possession and ball tracking after this point will be cleared too.</p>
                    <p className="text-sm text-amber-300 pt-2 border-t border-amber-500/20">
                      Video will resume tracking from {formatTime(selectedTimeMs)}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Timeline Visualization (optional enhancement - can add later) */}
          {/* TODO: Could add a visual timeline showing event markers here */}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-slate-900/95 backdrop-blur-sm border-t border-white/10 p-6">
          <div className="flex items-center justify-end gap-3">
            <button
              onClick={onClose}
              disabled={isConfirming}
              className="px-4 py-2 rounded-lg font-medium text-white/70 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!canUndo || isConfirming}
              className="px-6 py-2 rounded-lg font-semibold bg-amber-600 hover:bg-amber-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {isConfirming ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Undo2 size={16} />
                  Confirm Undo
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
