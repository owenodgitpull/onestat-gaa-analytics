/**
 * "Fix carrier" on the GPS replay: the one thing left to adjust by hand now that the GPS dots are right.
 *
 * The ball carrier comes from the carries tagged during the match, and a tap lands a little after the catch. Pause on the
 * moment a player gets the ball and tap him: that carry starts there on the replay (saved at once as sync.tag_lag._pins,
 * carry id -> video ms). Display only: the tagged carries and every GPS figure are unchanged. The old "Edit sync" panel
 * (player-dot sliders, whole-match tag shift, Save) was removed 2026-11-23: the dots are accurate.
 */
import { Loader2, Check, AlertCircle, X } from 'lucide-react'

export interface BallChoice { id: string; label: string; says: string; ours: boolean; pinned: boolean; shot: boolean }
type PinState = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string } | null

export default function GpsCarrierFixer({ tagNote, onJumpToTag, ballChoices, pinState, onPin, onUnpin, pinCount, onClose }: {
  tagNote?: string | null; onJumpToTag?: () => void
  ballChoices: BallChoice[]; pinState: PinState
  onPin: (id: string, label: string) => void; onUnpin: (id: string, label: string) => void; pinCount: number
  onClose: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3 md:p-4 space-y-3" role="region" aria-label="Fix carrier">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">Fix carrier</div>
        <button type="button" onClick={onClose} aria-label="Close fix carrier" className="p-2 -m-1 rounded-lg hover:bg-white/10"><X size={16} className="text-white/60" /></button>
      </div>
      <div className="text-xs text-white/55">
        The carrier comes from the carries you tagged during the match, so it can be a moment early or late. Pause the video the moment a player gets the ball, then tap him.
        For a score or a wide, pause as the ball is kicked and tap the Point / Wide button. Saved straight away; only the replay changes.
      </div>
      {tagNote && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/70">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white border border-slate-900 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{tagNote}</span>
          {onJumpToTag && (
            <button type="button" onClick={onJumpToTag} className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white">Go to next carry</button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {ballChoices.map(c => (
          <div key={c.id} className="flex items-stretch">
            <button type="button" onClick={() => onPin(c.id, c.says)} disabled={pinState?.kind === 'saving'}
              className={`flex items-center gap-1.5 h-10 px-3 text-sm text-white disabled:opacity-50 ${c.pinned ? 'rounded-l-lg' : 'rounded-lg'} ${c.shot ? 'bg-white/5 border border-dashed border-white/25 hover:bg-white/15' : 'bg-white/10 hover:bg-white/20'}`}
              aria-label={`${c.says}: now`}>
              <span className={`inline-block w-2.5 h-2.5 shrink-0 ${c.shot ? 'rotate-45' : 'rounded-full'}`} style={{ background: c.ours ? '#10b981' : '#f97316' }} aria-hidden="true" />
              {c.label}
              {c.pinned && <Check size={13} className="text-emerald-300" aria-label="fixed by hand" />}
            </button>
            {c.pinned && (
              <button type="button" onClick={() => onUnpin(c.id, c.says)} disabled={pinState?.kind === 'saving'} title="Remove your fix"
                className="h-10 px-2 rounded-r-lg bg-white/5 hover:bg-white/15 border-l border-white/10 disabled:opacity-50" aria-label={`Remove your fix: ${c.says}`}>
                <X size={13} className="text-white/60" />
              </button>
            )}
          </div>
        ))}
        {!ballChoices.length && <div className="text-xs text-white/50">No tagged carries near this moment.</div>}
      </div>
      <div role="status" className={`flex items-start gap-2 text-xs ${pinState?.kind === 'error' ? 'text-red-300' : pinState?.kind === 'saved' ? 'text-emerald-300' : 'text-white/55'}`}>
        {pinState?.kind === 'saving' ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : pinState?.kind === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : pinState?.kind === 'saved' ? <Check size={13} className="mt-0.5 shrink-0" /> : null}
        <span>{pinState?.text ?? (pinCount ? `${pinCount} carr${pinCount === 1 ? 'y' : 'ies'} fixed by hand in this match.` : 'Every carry is timed automatically. Fix only the ones that look wrong.')}</span>
      </div>
    </div>
  )
}
