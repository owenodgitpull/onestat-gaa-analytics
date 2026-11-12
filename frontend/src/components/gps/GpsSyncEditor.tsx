/**
 * "Edit sync" on the GPS replay: line the replay up with the video by eye, then save.
 *
 * - Who just got the ball? (one carry at a time, saved at once): pause on the catch, tap the player; that carry starts
 *   there on the replay. Saved as sync.tag_lag._pins (carry id -> video ms). Display only: the analysis is unchanged.
 * - Player dots (per period): the replay already draws the pitch ahead of the video by the measured lead (the sync is
 *   fitted to the taps, so the GPS clock runs late by the usual tap delay). The slider fine-tunes on top; saved as that
 *   period's manual offset (PATCH .../gps/timeseries/sync), which every GPS figure uses.
 * - Shift every tag (whole match, folded away): sync.tag_lag._manual.shift_ms, as before (backend gps_analysis/lag.py).
 * Tagged events are never changed.
 */
import { useState } from 'react'
import { Loader2, Check, AlertCircle, X, RotateCcw, Hand } from 'lucide-react'
import { api } from '../../services/api'
import type { GpsReplayContext } from '../../services/gpsAnalysisApi'

const PERIOD: Record<number, string> = { 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2' }
const DOT_RANGE_MS = 10000
const TAG_RANGE_MS = 3000

/** ms here is "ahead" (positive = drawn ahead of where they were, i.e. earlier) */
function describe(ms: number, what: string) {
  if (Math.abs(ms) < 50) return `${what} as synced`
  return `${what} ${(Math.abs(ms) / 1000).toFixed(1)} s ${ms > 0 ? 'ahead' : 'behind'}`
}

function ShiftRow({ label, hint, value, range, onChange, describeAs }: {
  label: string; hint: string; value: number; range: number; onChange: (v: number) => void; describeAs: string
}) {
  const clamp = (v: number) => Math.max(-range, Math.min(range, Math.round(v / 100) * 100))
  const step = (d: number) => onChange(clamp(value + d))
  const btn = 'min-w-[44px] h-10 px-2 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/25 text-sm text-white tabular-nums'
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium text-white">{label}</div>
        <div className="text-xs text-white/70 tabular-nums" aria-live="polite">{describe(value, describeAs)}</div>
      </div>
      <div className="text-xs text-white/50 mt-0.5 mb-2">{hint}</div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} onClick={() => step(-1000)} aria-label={`${label}: 1 second behind`}>−1s</button>
        <button type="button" className={btn} onClick={() => step(-100)} aria-label={`${label}: 0.1 second behind`}>−0.1</button>
        <input type="range" min={-range} max={range} step={100} value={value} onChange={e => onChange(clamp(Number(e.target.value)))}
          className="flex-1 min-w-0 accent-emerald-400 h-10" aria-label={label}
          aria-valuetext={describe(value, describeAs)} />
        <button type="button" className={btn} onClick={() => step(100)} aria-label={`${label}: 0.1 second ahead`}>+0.1</button>
        <button type="button" className={btn} onClick={() => step(1000)} aria-label={`${label}: 1 second ahead`}>+1s</button>
      </div>
      <div className="flex justify-between text-[10px] text-white/40 mt-0.5 px-1" aria-hidden="true"><span>← behind</span><span>ahead →</span>
      </div>
    </div>
  )
}

export interface BallChoice { id: string; label: string; ours: boolean; pinned: boolean }
type PinState = { kind: 'idle' | 'saving' | 'saved' | 'error'; text: string } | null

export default function GpsSyncEditor({ matchId, ctx, half, dotShifts, tagShift, savedTagShift, onDotShift, onTagShift, onReset, onSaved, onClose, tagNote, onJumpToTag,
  leadMs, leadFrom, timingLoading, ballChoices, pinState, onPin, onUnpin, pinCount }: {
  tagNote?: string | null; onJumpToTag?: () => void
  leadMs: number; leadFrom?: string; timingLoading?: boolean
  ballChoices: BallChoice[]; pinState: PinState; onPin: (id: string, label: string) => void; onUnpin: (id: string, label: string) => void; pinCount: number
  matchId: string; ctx: GpsReplayContext; half: number
  dotShifts: Record<number, number>; tagShift: number; savedTagShift: number
  onDotShift: (ms: number) => void; onTagShift: (ms: number) => void; onReset: () => void; onSaved: () => void; onClose: () => void
}) {
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' })
  const dot = dotShifts[half] ?? 0
  const changedDots = Object.entries(dotShifts).filter(([, v]) => Math.abs(v) >= 50)
  const dirty = changedDots.length > 0 || tagShift !== savedTagShift

  const save = async () => {
    setState({ kind: 'saving', text: 'Saving the sync and recalculating this match’s GPS figures…' })
    try {
      const periods = changedDots.map(([h, v]) => {
        const p = (ctx.sync.periods || []).find((x: { half: number }) => x.half === Number(h))
        if (!p) throw new Error(`No sync for the ${PERIOD[Number(h)] || `period ${h}`}`)
        const rate = p.rate || 1
        // dots drawn v ms later = read the GPS v ms earlier: gps = video * rate + offset
        return { half: Number(h), offset_ms: Math.round(p.offset_ms - v * rate), rate }
      })
      await api.matchGpsTimeseries.overrideSync(matchId, periods, true, tagShift !== savedTagShift ? tagShift : undefined)
      onSaved()
      setState({ kind: 'saved', text: 'Saved. The replay and every GPS figure for this match now use this sync.' })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setState({ kind: 'error', text: /403|forbidden|permission/i.test(msg) ? 'Only a club admin can save the sync.' : `Could not save: ${msg}` })
    }
  }

  const status = state.kind !== 'idle' ? state
    : dirty ? { kind: 'idle' as const, text: 'Previewing on the replay. Nothing is saved until you press Save.' }
    : { kind: 'idle' as const, text: 'Slider changes preview on the replay; press Save to keep them.' }

  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3 md:p-4 space-y-4" role="region" aria-label="Edit sync">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">Edit sync</div>
        <button type="button" onClick={onClose} aria-label="Close edit sync" className="p-2 -m-1 rounded-lg hover:bg-white/10"><X size={16} className="text-white/60" /></button>
      </div>
      <div>
        <div className="text-sm font-medium text-white">Ball · who just got it?</div>
        <div className="text-xs text-white/50 mt-0.5 mb-2">Pause the video the moment a player gets the ball, then tap him. His carry starts there; the carries either side keep their order. Saved straight away.</div>
        {tagNote && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-white/70">
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
              <button type="button" onClick={() => onPin(c.id, c.label)} disabled={pinState?.kind === 'saving'}
                className={`flex items-center gap-1.5 h-10 px-3 text-sm text-white disabled:opacity-50 ${c.pinned ? 'rounded-l-lg' : 'rounded-lg'} bg-white/10 hover:bg-white/20 active:bg-white/25`}
                aria-label={`${c.label} gets the ball now`}>
                <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.ours ? '#10b981' : '#f97316' }} aria-hidden="true" />
                {c.label}
                {c.pinned && <Check size={13} className="text-emerald-300" aria-label="fixed by hand" />}
              </button>
              {c.pinned && (
                <button type="button" onClick={() => onUnpin(c.id, c.label)} disabled={pinState?.kind === 'saving'} title="Remove your fix"
                  className="h-10 px-2 rounded-r-lg bg-white/5 hover:bg-white/15 border-l border-white/10 disabled:opacity-50" aria-label={`Remove your fix for ${c.label}`}>
                  <X size={13} className="text-white/60" />
                </button>
              )}
            </div>
          ))}
          {!ballChoices.length && <div className="text-xs text-white/50">No tagged carries near this moment.</div>}
        </div>
        <div role="status" className={`mt-2 flex items-start gap-2 text-xs ${pinState?.kind === 'error' ? 'text-red-300' : pinState?.kind === 'saved' ? 'text-emerald-300' : 'text-white/55'}`}>
          {pinState?.kind === 'saving' ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : pinState?.kind === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : pinState?.kind === 'saved' ? <Check size={13} className="mt-0.5 shrink-0" /> : <Hand size={13} className="mt-0.5 shrink-0" />}
          <span>{pinState?.text ?? (pinCount ? `${pinCount} carr${pinCount === 1 ? 'y' : 'ies'} fixed by hand in this match.` : 'Every carry is timed automatically. Fix only the ones that look wrong.')}</span>
        </div>
      </div>
      <ShiftRow label={`Player dots · ${PERIOD[half] || `period ${half}`}`} describeAs="dots"
        hint={timingLoading ? 'Measuring how far the GPS runs behind the video…'
          : `Already drawn ${(Math.abs(leadMs) / 1000).toFixed(1)} s ${leadMs >= 0 ? 'ahead of' : 'behind'} the GPS sync in this half to match the video${leadFrom && leadFrom !== 'none' ? ` (measured from the ${leadFrom})` : ''}. If the dots still trail the players on the video, drag right; if they run ahead, drag left.`}
        value={-dot} range={DOT_RANGE_MS} onChange={v => { onDotShift(-v); setState({ kind: 'idle' }) }} />
      <details className="group">
        <summary className="cursor-pointer text-xs text-white/60 hover:text-white select-none">Shift every tag in the match{tagShift !== 0 ? ` (now ${(Math.abs(tagShift) / 1000).toFixed(1)} s)` : ''}</summary>
        <div className="mt-3">
          <ShiftRow label="Ball and tags · whole match" describeAs="tags"
            hint="Rarely needed: each carry is already timed from the GPS or your usual tap delay. Moves every tag at once."
            value={-tagShift} range={TAG_RANGE_MS} onChange={v => { onTagShift(-v); setState({ kind: 'idle' }) }} />
        </div>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={!dirty || state.kind === 'saving'}
          className="flex items-center gap-1.5 h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:hover:bg-emerald-600 text-sm font-medium text-white">
          {state.kind === 'saving' ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save sync
        </button>
        <button type="button" onClick={() => { onReset(); setState({ kind: 'idle' }) }} disabled={!dirty || state.kind === 'saving'}
          className="flex items-center gap-1.5 h-10 px-3 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-40 text-sm text-white">
          <RotateCcw size={14} /> Undo changes
        </button>
      </div>
      <div role="status" className={`flex items-start gap-2 text-xs ${status.kind === 'error' ? 'text-red-300' : status.kind === 'saved' ? 'text-emerald-300' : 'text-white/60'}`}>
        {status.kind === 'saving' ? <Loader2 size={13} className="animate-spin mt-0.5 shrink-0" /> : status.kind === 'error' ? <AlertCircle size={13} className="mt-0.5 shrink-0" /> : status.kind === 'saved' ? <Check size={13} className="mt-0.5 shrink-0" /> : null}
        <span>{status.text}</span>
      </div>
    </div>
  )
}
