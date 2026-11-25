import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Lightbulb } from 'lucide-react'

const RUNS_KEY = 'analyst-wait-runs-v2'
const SEEN_KEY = 'analyst-facts-seen'

export type WaitStep = { name: string; at: number }   // a tool the analyst started, and when (epoch ms)
type Run = { total: number; starts: number[]; names: string[] }

function readRuns(): Run[] {
  try {
    const all = JSON.parse(localStorage.getItem(RUNS_KEY) || '[]')
    return Array.isArray(all) ? all.filter((r: Run) => r && r.total > 0 && Array.isArray(r.starts)) : []
  } catch { return [] }
}

/** Remember one finished wait: seconds until the answer began, and when each tool started along the way. Kept on this device. */
export function recordRun(totalSeconds: number, steps: WaitStep[], startedAt: number) {
  try {
    const run: Run = { total: Math.round(totalSeconds * 10) / 10, starts: steps.map(s => Math.round((s.at - startedAt) / 100) / 10), names: steps.map(s => s.name) }
    localStorage.setItem(RUNS_KEY, JSON.stringify([...readRuns(), run].slice(-40)))
  } catch { /* private mode: no history, the defaults are used */ }
}

const pick = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]

/**
 * Seconds still to go, as a low / middle / high guess. It looks at past waits that had reached the same point (the same
 * number of tools started, and the same tool where there is enough history) and asks how much longer those took from there.
 */
export function estimateRemaining(runs: Run[], steps: WaitStep[], now: number, startedAt: number): { lo: number; mid: number; hi: number } {
  const k = steps.length
  const stageStart = k === 0 ? 0 : (steps[k - 1].at - startedAt) / 1000
  const into = Math.max(0, (now - startedAt) / 1000 - stageStart)       // seconds spent at this stage so far
  let pool = runs.filter(r => (k === 0 ? true : r.starts.length >= k))
  if (k > 0) {
    const same = pool.filter(r => r.names[k - 1] === steps[k - 1].name)
    if (same.length >= 3) pool = same
  }
  const rem = pool.map(r => r.total - (k === 0 ? 0 : r.starts[k - 1])).filter(x => x > 0).sort((a, b) => a - b)
  if (rem.length < 3) {
    // not enough history yet: a plain guess that shrinks as tools start
    const base = k === 0 ? 14 : 9
    return { lo: Math.max(1, base * 0.6 - into), mid: Math.max(1, base - into), hi: Math.max(2, base * 1.6 - into) }
  }
  return { lo: Math.max(1, pick(rem, 0.25) - into), mid: Math.max(1, pick(rem, 0.5) - into), hi: Math.max(2, pick(rem, 0.75) - into) }
}

// ── facts that never repeat until all have been seen ──
function readSeen(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')) } catch { return new Set() }
}
function markSeen(fact: string, all: string[]) {
  try {
    const seen = readSeen(); seen.add(fact)
    const left = all.filter(f => !seen.has(f))
    localStorage.setItem(SEEN_KEY, JSON.stringify(left.length ? [...seen].filter(f => all.includes(f)) : []))   // everything seen: start the round again
  } catch { /* ignore */ }
}
const shuffle = <T,>(a: T[]) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]] } return b }

/**
 * Shown while the analyst works, before the answer starts to appear: a progress bar, what it is doing right now (the real tool),
 * a range for the wait that is re-estimated each time a tool starts, and one true fact about the team at a time, unseen ones first.
 */
export default function AnalystWait({ startedAt, doing, steps, facts }: { startedAt: number; doing: string | null; steps: WaitStep[]; facts: string[] }) {
  const runs = useMemo(() => readRuns(), [])
  const [now, setNow] = useState(Date.now())
  const order = useMemo(() => {
    const seen = readSeen()
    return [...shuffle(facts.filter(f => !seen.has(f))), ...shuffle(facts.filter(f => seen.has(f)))]
  }, [facts])
  const [i, setI] = useState(0)
  const shown = useRef('')
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (order.length < 2) return
    const t = setInterval(() => setI(v => (v + 1) % order.length), 7000)
    return () => clearInterval(t)
  }, [order.length])
  const fact = order.length ? order[i % order.length] : ''
  useEffect(() => { if (fact && shown.current !== fact) { shown.current = fact; markSeen(fact, facts) } }, [fact, facts])

  const elapsed = Math.max(0, (now - startedAt) / 1000)
  const est = estimateRemaining(runs, steps, now, startedAt)
  // The estimate is redone each time a tool starts and can go UP, which pulled the bar back. The bar only ever moves forward:
  // it holds its highest point until the new estimate catches up (reset for each new question).
  const peak = useRef({ at: startedAt, v: 0 })
  if (peak.current.at !== startedAt) peak.current = { at: startedAt, v: 0 }
  peak.current.v = Math.max(peak.current.v, Math.min(94, 94 * elapsed / (elapsed + est.mid)))
  const pct = peak.current.v
  const past = est.hi <= 2 && elapsed > 8
  const a = Math.round(est.lo), b = Math.round(est.hi)
  const timeText = past ? 'taking a little longer than usual' : a >= b ? `about ${b} s to go` : `about ${a}–${b} s to go`

  return (
    <div className="flex gap-3 justify-start" role="status" aria-live="polite">
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center shrink-0">
        <Bot size={14} className="text-white" />
      </div>
      <div className="glass-card p-3.5 rounded-2xl rounded-bl-sm w-full max-w-md">
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="text-white/85">{doing ? `Looking up ${doing}` : 'Reading your question'}</span>
          <span className="text-xs text-white/45 tabular-nums whitespace-nowrap">{timeText}</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
          <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
        </div>
        {fact && (
          <div key={fact} className="mt-3 flex items-start gap-2 text-xs text-white/65 leading-relaxed animate-fade-in">
            <Lightbulb size={14} className="text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <span><span className="text-white/45">Did you know? </span>{fact}</span>
          </div>
        )}
      </div>
    </div>
  )
}
