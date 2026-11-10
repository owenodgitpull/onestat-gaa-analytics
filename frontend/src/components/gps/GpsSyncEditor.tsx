/**
 * "Edit sync" on the GPS replay: line the replay up with the video by eye, then save.
 *
 * Two independent adjustments, previewed live on the replay before anything is saved:
 *  - Player dots (per period): the GPS clock against the video. Saved as that period's manual offset
 *    (PATCH .../gps/timeseries/sync), the same value the sync-check nudge writes. Every GPS figure uses it.
 *  - Ball and tags (whole match): how far tagged things are drawn from your tap, on top of the measured tap delay.
 *    Saved as sync.tag_lag._manual.shift_ms; the analysis uses the same rule (backend gps_analysis/lag.py).
 * Tagged events are never changed.
 */
import { useState } from 'react'
import { Loader2, Check, AlertCircle, X, RotateCcw } from 'lucide-react'
import { api } from '../../services/api'
import type { GpsReplayContext } from '../../services/gpsAnalysisApi'

const PERIOD: Record<number, string> = { 1: '1st half', 2: '2nd half', 3: 'Extra time 1', 4: 'Extra time 2' }
const DOT_RANGE_MS = 10000
const TAG_RANGE_MS = 3000

function describe(ms: number, what: string) {
  if (Math.abs(ms) < 50) return `${what} as synced`
  return `${what} ${(Math.abs(ms) / 1000).toFixed(1)} s ${ms > 0 ? 'later' : 'earlier'}`
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
        <button type="button" className={btn} onClick={() => step(-1000)} aria-label={`${label}: 1 second earlier`}>−1s</button>
        <button type="button" className={btn} onClick={() => step(-100)} aria-label={`${label}: 0.1 second earlier`}>−0.1</button>
        <input type="range" min={-range} max={range} step={100} value={value} onChange={e => onChange(clamp(Number(e.target.value)))}
          className="flex-1 min-w-0 accent-emerald-400 h-10" aria-label={label}
          aria-valuetext={describe(value, describeAs)} />
        <button type="button" className={btn} onClick={() => step(100)} aria-label={`${label}: 0.1 second later`}>+0.1</button>
        <button type="button" className={btn} onClick={() => step(1000)} aria-label={`${label}: 1 second later`}>+1s</button>
      </div>
    </div>
  )
}

export default function GpsSyncEditor({ matchId, ctx, half, dotShifts, tagShift, savedTagShift, onDotShift, onTagShift, onReset, onSaved, onClose, tagNote, onJumpToTag }: {
  tagNote?: string | null; onJumpToTag?: () => void
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
    : { kind: 'idle' as const, text: 'Pause on a clear moment, such as a kickout strike, a score or a hand pass, and move the sliders until the dots and the ball match the video.' }

  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-white/5 p-3 md:p-4 space-y-4" role="region" aria-label="Edit sync">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">Edit sync</div>
        <button type="button" onClick={onClose} aria-label="Close edit sync" className="p-2 -m-1 rounded-lg hover:bg-white/10"><X size={16} className="text-white/60" /></button>
      </div>
      <ShiftRow label={`Player dots · ${PERIOD[half] || `period ${half}`}`} describeAs="dots"
        hint="If the dots move before the players on the video, move them later; if they trail, earlier. Set each half on its own."
        value={dot} range={DOT_RANGE_MS} onChange={v => { onDotShift(v); setState({ kind: 'idle' }) }} />
      <ShiftRow label="Ball and tags · whole match" describeAs="tags"
        hint="The ring, their ball and the event pop-ups are already drawn earlier than your tap by your measured tap delay. Fine-tune if the ball still arrives before or after the player."
        value={tagShift} range={TAG_RANGE_MS} onChange={v => { onTagShift(v); setState({ kind: 'idle' }) }} />
      {tagNote && (
        <div role="status" className="-mt-2 flex flex-wrap items-center gap-2 text-xs text-white/70">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-white border border-slate-900 shrink-0" aria-hidden="true" />
          <span className="min-w-0">{tagNote}</span>
          {onJumpToTag && (
            <button type="button" onClick={onJumpToTag} className="h-8 px-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-white">Go to next carry</button>
          )}
        </div>
      )}
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
