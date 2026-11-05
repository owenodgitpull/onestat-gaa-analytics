/**
 * "Needs attention" - blanks and oddities in this session's tagging (a score with no scorer, a kickout with no
 * player, a duplicated step...). Each row: Seek to the moment in the video, Fix to open the right editor.
 */
import { useEffect, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { videoMovesAPI, type HealthIssue } from '../../services/videoMovesApi'
import { useModalA11y } from '../ui/useModalA11y'

interface Props {
  isOpen: boolean
  sessionId: string
  onClose: () => void
  onSeek: (ms: number) => void
  onFixEvent: (eventId: string) => void
  onFixMove: (eventId: string) => void
}

// Last result per session: the window opens on it at once and re-checks quietly behind it
const healthCache = new Map<string, HealthIssue[]>()

/** Start the check before the window opens (call on hover / focus of the Needs attention button). */
export function prefetchHealth(sessionId: string) {
  if (!sessionId) return
  videoMovesAPI.health(sessionId).then(r => healthCache.set(sessionId, r.issues)).catch(() => {})
}

const MOVE_KINDS = new Set(['score_no_carry', 'score_carrier_mismatch', 'duplicate_step', 'kickout_no_player'])

export default function NeedsAttentionModal({ isOpen, sessionId, onClose, onSeek, onFixEvent, onFixMove }: Props) {
  const [issues, setIssues] = useState<HealthIssue[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setIssues(healthCache.get(sessionId) ?? null)
    setError(null)
    setRefreshing(true)
    let live = true
    videoMovesAPI.health(sessionId)
      .then(r => { healthCache.set(sessionId, r.issues); if (live) setIssues(r.issues) })
      .catch(e => { if (live) setError(e?.message || 'Could not run the check') })
      .finally(() => { if (live) setRefreshing(false) })
    return () => { live = false }
  }, [isOpen, sessionId])

  const dlgRef = useModalA11y<HTMLDivElement>(onClose, isOpen)
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div ref={dlgRef} role="dialog" aria-modal="true" aria-label="Needs attention" className="w-full max-w-xl my-8 glass-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-2">
          <h2 className="text-lg font-bold text-white">Needs attention</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white p-1" aria-label="Close"><X size={18} /></button>
        </div>
        {!issues && !error && <div className="flex items-center gap-2 text-sm text-white/60 py-6"><Loader2 size={16} className="animate-spin" /> Checking…</div>}
        {issues && refreshing && <div className="flex items-center gap-1.5 text-[11px] text-white/60 mb-2"><Loader2 size={11} className="animate-spin" /> Re-checking…</div>}
        {error && <p className="text-xs text-red-300">{error}</p>}
        {issues && issues.length === 0 && <p className="text-sm text-emerald-300 py-4">Nothing to fix — all clear.</p>}
        <ul className="space-y-2">
          {(issues || []).map((it, i) => (
            <li key={`${it.kind}-${it.event_id}-${it.segment_id}-${i}`} className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-white">{it.message}</p>
                <p className="text-[11px] text-white/60">
                  {it.match_minute != null ? `${it.match_minute}:${String(it.match_second ?? 0).padStart(2, '0')}` : ''}
                  {it.team ? ` · ${it.team === 'team_a' ? 'ours' : 'opposition'}` : ''}
                </p>
              </div>
              {it.video_timestamp_ms != null && (
                <button onClick={() => onSeek(Math.max(0, it.video_timestamp_ms! - 6000))}
                  className="px-2 py-1 rounded-lg bg-white/10 text-white/80 text-xs font-semibold">Seek</button>
              )}
              {it.event_id && (
                <button onClick={() => { onClose(); (MOVE_KINDS.has(it.kind) ? onFixMove : onFixEvent)(it.event_id!) }}
                  className="px-2 py-1 rounded-lg bg-emerald-600/80 hover:bg-emerald-500 text-white text-xs font-bold">Fix</button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
