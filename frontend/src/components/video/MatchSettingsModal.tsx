/**
 * Match settings for a tagged match: half length, which way we attack in the first half, and the periods the match
 * clock was stopped (injury, water break). Saving stoppages re-stamps every event's minute on the server.
 */
import { useState } from 'react'
import { X, Trash2, Loader2 } from 'lucide-react'

export interface Stoppage { start_ms: number; end_ms: number; note?: string }

interface Props {
  isOpen: boolean
  onClose: () => void
  halfMins: number
  attackingRightFirstHalf: boolean | null
  stoppages: Stoppage[]
  currentTimeMs: number
  onSetHalfMins: (m: number) => Promise<void>
  onSetDirection: (right: boolean) => Promise<void>
  onSaveStoppages: (s: Stoppage[]) => Promise<void>
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h ? h + ':' + String(m).padStart(2, '0') : m}:${String(s % 60).padStart(2, '0')}`
}

/** "h:mm:ss", "mm:ss" or plain seconds -> ms */
function parseClock(v: string): number | null {
  const parts = v.trim().split(':').map(x => parseInt(x, 10))
  if (!parts.length || parts.some(isNaN)) return null
  return parts.reduce((a, n) => a * 60 + n, 0) * 1000
}

export default function MatchSettingsModal(p: Props) {
  const [half, setHalf] = useState(String(p.halfMins))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!p.isOpen) return null

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await fn() } catch (e: any) { setError(e?.message || 'Did not save') } finally { setBusy(false) }
  }
  const add = () => {
    const a = parseClock(from), b = parseClock(to)
    if (a == null || b == null || b <= a) { setError('Enter a start and an end (video time, e.g. 28:55 and 32:04)'); return }
    run(async () => { await p.onSaveStoppages([...p.stoppages, { start_ms: a, end_ms: b }].sort((x, y) => x.start_ms - y.start_ms)); setFrom(''); setTo('') })
  }
  const input = 'bg-slate-800 text-white text-sm rounded-lg border border-white/15 px-2 py-1.5'

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-center p-4 bg-black/70 backdrop-blur-sm overflow-y-auto" onClick={p.onClose}>
      <div className="w-full max-w-md my-8 glass-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h2 className="text-lg font-bold text-white">Match settings</h2>
          <button onClick={p.onClose} className="text-white/60 hover:text-white p-1" aria-label="Close"><X size={18} /></button>
        </div>
        {error && <p className="text-xs text-red-300 mb-2">{error}</p>}

        <p className="text-[11px] font-semibold text-white/50 mb-1">Half length (minutes)</p>
        <div className="flex gap-2">
          <input className={`${input} w-20`} inputMode="numeric" value={half} onChange={e => setHalf(e.target.value)} />
          <button disabled={busy || parseInt(half, 10) === p.halfMins || !parseInt(half, 10)}
            onClick={() => run(() => p.onSetHalfMins(parseInt(half, 10)))}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">Save</button>
        </div>

        <p className="text-[11px] font-semibold text-white/50 mb-1 mt-4">First half we attack</p>
        <div className="flex gap-2">
          {[{ r: false, l: '← Right to left' }, { r: true, l: 'Left to right →' }].map(o => (
            <button key={String(o.r)} disabled={busy} onClick={() => run(() => p.onSetDirection(o.r))}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${p.attackingRightFirstHalf === o.r ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/70'}`}>
              {o.l}
            </button>
          ))}
        </div>

        <p className="text-[11px] font-semibold text-white/50 mb-1 mt-4">Clock stopped (injury, water break)</p>
        <ul className="space-y-1.5 mb-2">
          {p.stoppages.length === 0 && <li className="text-xs text-white/40">None.</li>}
          {p.stoppages.map((s, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-sm text-white">
              <span>{fmt(s.start_ms)} → {fmt(s.end_ms)} <span className="text-white/40 text-xs">({Math.round((s.end_ms - s.start_ms) / 1000)} s)</span></span>
              <button disabled={busy} onClick={() => run(() => p.onSaveStoppages(p.stoppages.filter((_, j) => j !== i)))}
                className="p-1 text-white/40 hover:text-red-300"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-2 flex-wrap">
          <input className={`${input} w-24`} placeholder="from" value={from} onChange={e => setFrom(e.target.value)} />
          <button type="button" onClick={() => setFrom(fmt(p.currentTimeMs))} className="text-[11px] text-emerald-300 underline">now</button>
          <input className={`${input} w-24`} placeholder="to" value={to} onChange={e => setTo(e.target.value)} />
          <button type="button" onClick={() => setTo(fmt(p.currentTimeMs))} className="text-[11px] text-emerald-300 underline">now</button>
          <button disabled={busy} onClick={add} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-sm font-bold disabled:opacity-40">
            {busy ? <Loader2 size={14} className="animate-spin" /> : 'Add'}
          </button>
        </div>
        <p className="text-[11px] text-white/35 mt-2">Times are video times. Adding or removing one re-stamps every event's match minute.</p>
        <div className="flex justify-end mt-4">
          <button onClick={p.onClose} className="px-4 py-2 rounded-xl bg-white/10 text-white/80 text-sm font-semibold">Done</button>
        </div>
      </div>
    </div>
  )
}
