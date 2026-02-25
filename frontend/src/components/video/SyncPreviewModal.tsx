/**
 * SyncPreviewModal — Review what the video-to-match sync will do before confirming.
 *
 * Shows new / replaced / skipped event counts and details,
 * then lets the user confirm to trigger the merge + AI re-analysis.
 */

import { X, Plus, RefreshCw, SkipForward, FileText, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react'
import type { VideoSyncPreview, VideoSyncStatus, SyncPreviewEvent } from '../../services/videoApi'

interface SyncPreviewModalProps {
  isOpen: boolean
  onClose: () => void
  preview: VideoSyncPreview | null
  isConfirming: boolean
  onConfirm: () => void
  /** After confirm, pass sync status from polling */
  syncStatus: VideoSyncStatus | null
  /** Navigate to match result page when done */
  onViewResult: () => void
}

function EventRow({ event, icon: Icon, color }: { event: SyncPreviewEvent; icon: any; color: string }) {
  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded bg-white/5 text-sm">
      <Icon size={14} className={color} />
      <span className="text-white/80 font-medium">{event.event_type.replace(/_/g, ' ')}</span>
      <span className="text-white/40">
        {event.team === 'team_a' ? 'Own' : 'Opp'} &bull; {event.minute}'
      </span>
      {event.pitch_zone && (
        <span className="text-white/30 text-xs">{event.pitch_zone}</span>
      )}
    </div>
  )
}

export default function SyncPreviewModal({
  isOpen,
  onClose,
  preview,
  isConfirming,
  onConfirm,
  syncStatus,
  onViewResult,
}: SyncPreviewModalProps) {
  if (!isOpen) return null

  const isProcessing = syncStatus && ['processing', 'syncing', 'analyzing'].includes(syncStatus.status)
  const isComplete = syncStatus?.status === 'completed' && syncStatus.ai_report_ready
  const isError = syncStatus?.status === 'error'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1d23] border border-white/10 rounded-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">
            {isComplete ? 'Sync Complete' : isProcessing ? 'Syncing...' : 'Sync to Match'}
          </h2>
          {!isProcessing && (
            <button onClick={onClose} className="p-1 text-white/40 hover:text-white transition-colors">
              <X size={18} />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Phase 1: Preview */}
          {preview && !syncStatus && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-emerald-400">{preview.new_events.length}</div>
                  <div className="text-xs text-emerald-300/70 mt-1">New events</div>
                </div>
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-amber-400">{preview.replaced_events.length}</div>
                  <div className="text-xs text-amber-300/70 mt-1">Enriched</div>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-white/50">{preview.skipped_events.length}</div>
                  <div className="text-xs text-white/30 mt-1">Already exist</div>
                </div>
              </div>

              {preview.manual_only_count > 0 && (
                <p className="text-sm text-white/50">
                  {preview.manual_only_count} manually-recorded event{preview.manual_only_count !== 1 ? 's' : ''} will be kept unchanged.
                </p>
              )}

              {/* New events list */}
              {preview.new_events.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-2">
                    New Events ({preview.new_events.length})
                  </h3>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {preview.new_events.map((e) => (
                      <EventRow key={e.video_event_id} event={e} icon={Plus} color="text-emerald-400" />
                    ))}
                  </div>
                </div>
              )}

              {/* Replaced events list */}
              {preview.replaced_events.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-amber-400 uppercase tracking-wider mb-2">
                    Enriched with Zone Data ({preview.replaced_events.length})
                  </h3>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {preview.replaced_events.map((e) => (
                      <EventRow key={e.video_event_id} event={e} icon={RefreshCw} color="text-amber-400" />
                    ))}
                  </div>
                </div>
              )}

              {/* Skipped */}
              {preview.skipped_events.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">
                    Skipped — Already Exist ({preview.skipped_events.length})
                  </h3>
                  <div className="space-y-1 max-h-24 overflow-y-auto">
                    {preview.skipped_events.map((e) => (
                      <EventRow key={e.video_event_id} event={e} icon={SkipForward} color="text-white/30" />
                    ))}
                  </div>
                </div>
              )}

              {/* What happens next */}
              <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1">
                  <FileText size={14} className="text-purple-400" />
                  <span className="text-sm font-medium text-purple-300">After sync</span>
                </div>
                <p className="text-xs text-purple-200/60">
                  The full AI match report will be regenerated with all events (manual + video).
                  This takes 15-30 seconds.
                </p>
              </div>
            </>
          )}

          {/* Phase 2: Processing */}
          {isProcessing && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <Loader2 size={36} className="animate-spin text-emerald-400" />
              <div className="text-center">
                <p className="text-white font-medium">
                  {syncStatus?.status === 'analyzing' ? 'Generating AI Report...' : 'Syncing events...'}
                </p>
                <p className="text-sm text-white/40 mt-1">
                  {syncStatus?.status === 'analyzing'
                    ? 'The AI is analyzing all match events to create a comprehensive report.'
                    : 'Merging video events into match analytics...'}
                </p>
              </div>
            </div>
          )}

          {/* Phase 3: Complete */}
          {isComplete && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <CheckCircle2 size={40} className="text-emerald-400" />
              <div className="text-center">
                <p className="text-white font-medium">Sync Complete</p>
                <p className="text-sm text-white/50 mt-1">
                  {syncStatus.synced_count} events synced. AI report is ready.
                </p>
              </div>
            </div>
          )}

          {/* Error */}
          {isError && (
            <div className="flex flex-col items-center py-8 space-y-4">
              <AlertTriangle size={40} className="text-red-400" />
              <div className="text-center">
                <p className="text-white font-medium">Sync Failed</p>
                <p className="text-sm text-red-300/70 mt-1">
                  {syncStatus?.error_message || 'An unexpected error occurred.'}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10 flex justify-end gap-3">
          {/* Preview phase: Cancel + Confirm */}
          {preview && !syncStatus && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirm}
                disabled={isConfirming || (preview.new_events.length === 0 && preview.replaced_events.length === 0)}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-lg text-sm font-medium transition-all"
              >
                {isConfirming ? <Loader2 size={14} className="animate-spin" /> : null}
                Confirm Sync
              </button>
            </>
          )}

          {/* Complete: View Result */}
          {isComplete && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
              >
                Close
              </button>
              <button
                onClick={onViewResult}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-all"
              >
                <FileText size={14} />
                View Match Result
              </button>
            </>
          )}

          {/* Error: Close */}
          {isError && (
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
