import { useEffect, useMemo, useState } from 'react'
import { Bot, Lightbulb } from 'lucide-react'

const KEY = 'analyst-wait-seconds'

/** How long answers have taken to START on this device (median of the last 10), so the estimate gets honest with use. */
export function recordWait(seconds: number) {
  try {
    const all: number[] = JSON.parse(localStorage.getItem(KEY) || '[]')
    localStorage.setItem(KEY, JSON.stringify([...all, Math.round(seconds * 10) / 10].slice(-10)))
  } catch { /* private mode: no estimate history, the default is used */ }
}
function expectedWait(): number {
  try {
    const all: number[] = JSON.parse(localStorage.getItem(KEY) || '[]').filter((n: number) => n > 0)
    if (all.length >= 3) { const s = [...all].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
  } catch { /* fall through */ }
  return 15
}

/**
 * Shown while the analyst works, before the answer starts to appear: a progress bar against the usual wait, what it is
 * doing right now (the real tool it is calling), and one true fact about the team at a time. The bar is an estimate that
 * slows as it nears the end and never claims to be finished before the answer starts.
 */
export default function AnalystWait({ startedAt, doing, facts }: { startedAt: number; doing: string | null; facts: string[] }) {
  const est = useMemo(() => expectedWait(), [])
  const [now, setNow] = useState(Date.now())
  const [i, setI] = useState(() => (facts.length ? Math.floor(Math.random() * facts.length) : 0))
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (facts.length < 2) return
    const t = setInterval(() => setI(v => (v + 1) % facts.length), 7000)
    return () => clearInterval(t)
  }, [facts.length])

  const elapsed = Math.max(0, (now - startedAt) / 1000)
  const pct = Math.min(94, 94 * (1 - Math.exp(-2.2 * elapsed / est)))      // ~80% at the usual wait, then creeps
  const remaining = Math.max(0, Math.round(est - elapsed))
  const timeText = elapsed < est ? `about ${Math.max(remaining, 1)} s to go` : 'taking a little longer than usual'

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
        {facts.length > 0 && (
          <div key={i} className="mt-3 flex items-start gap-2 text-xs text-white/65 leading-relaxed animate-fade-in">
            <Lightbulb size={14} className="text-amber-300 shrink-0 mt-0.5" aria-hidden="true" />
            <span><span className="text-white/45">Did you know? </span>{facts[i % facts.length]}</span>
          </div>
        )}
      </div>
    </div>
  )
}
