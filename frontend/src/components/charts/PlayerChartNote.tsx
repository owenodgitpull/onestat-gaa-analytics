import { Info, TrendingUp, TrendingDown, Minus } from 'lucide-react'

/**
 * Plain-English note under a player graph: what it shows, and (for graphs over matches) how he is going. The
 * "how he's going" line is worked out from his own numbers, never from other players or outside figures, and costs no AI call.
 */
export interface GoingInput { values: number[]; label: string; unit?: string; decimals?: number; better?: 'up' | 'down' }

export function goingLine(g?: GoingInput): { text: string; tone: 'good' | 'bad' | 'steady' } | null {
  if (!g) return null
  const v = g.values.filter(x => Number.isFinite(x))
  if (v.length < 4) return null                       // 3 recent + at least 1 earlier match, or there is nothing to compare
  const recent = v.slice(-3), earlier = v.slice(0, -3)
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
  const r = avg(recent), e = avg(earlier)
  if (!e) return null
  const pct = Math.round(((r - e) / Math.abs(e)) * 100)
  const d = g.decimals ?? 0
  const u = g.unit ? ` ${g.unit}` : ''
  const nums = `${r.toFixed(d)}${u} over his last 3, ${e.toFixed(d)}${u} over his ${earlier.length} before`
  if (Math.abs(pct) < 5) return { text: `Steady: ${g.label} ${nums}.`, tone: 'steady' }
  const up = pct > 0
  const good = g.better ? (up === (g.better === 'up')) : null
  return { text: `${up ? 'Up' : 'Down'} ${Math.abs(pct)}% on ${g.label}: ${nums}.`, tone: good === null ? 'steady' : good ? 'good' : 'bad' }
}

export default function PlayerChartNote({ what, going }: { what: string; going?: GoingInput }) {
  const gl = goingLine(going)
  const Icon = !gl || gl.tone === 'steady' ? Minus : gl.tone === 'good' ? TrendingUp : TrendingDown
  const tone = !gl ? '' : gl.tone === 'good' ? 'text-emerald-300' : gl.tone === 'bad' ? 'text-amber-300' : 'text-white/70'
  return (
    <div className="mt-3 pt-3 border-t border-white/10 space-y-1.5 text-xs">
      <p className="flex items-start gap-2 text-white/55 leading-relaxed"><Info size={14} className="shrink-0 mt-0.5 text-white/40" aria-hidden="true" /><span><span className="text-white/70 font-medium">What this is:</span> {what}</span></p>
      {gl && <p className={`flex items-start gap-2 leading-relaxed ${tone}`}><Icon size={14} className="shrink-0 mt-0.5" aria-hidden="true" /><span><span className="font-medium">How he's going:</span> {gl.text}</span></p>}
    </div>
  )
}
