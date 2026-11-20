import { useRef, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { KickoutTrendMatch } from '@/services/api'

interface KickoutTrendProps {
  data: KickoutTrendMatch[]
}

/**
 * Kickout outcomes per match, for OUR kickouts or THEIRS (Owen 2026-11-20: it added both together, so nobody could
 * tell which it showed). Every count is from our side: on our kickouts "kept" = we kept the ball; on theirs "won" =
 * we won their kickout. A kickout over the sideline is lost by the team that kicked it.
 */

const SCROLL_THRESHOLD = 8 // switch to scrollable after this many matches
const MIN_BAR_WIDTH = 50 // px per bar when scrolling

type Side = 'own' | 'opp'
type Counts = { won_clean: number; won_break: number; lost_clean: number; lost_break: number; won_sideline: number; lost_sideline: number }

const LABELS: Record<Side, { clean: string; brk: string; lostClean: string; lostBrk: string; line: string; rate: string; title: string }> = {
  own: { clean: 'Kept clean', brk: 'Kept on the break', lostClean: 'Lost clean', lostBrk: 'Lost on the break', line: 'Over the sideline', rate: 'Kept', title: 'Our kickouts' },
  opp: { clean: 'Won clean', brk: 'Won on the break', lostClean: 'They kept clean', lostBrk: 'They kept on the break', line: 'Over their sideline', rate: 'We won', title: 'Their kickouts' },
}

function countsFor(m: KickoutTrendMatch, side: Side): Counts {
  const s = m.by_side?.[side]
  if (s) return s
  // older payloads without the split: show the combined counts (the cache refreshes on the next data change)
  return { won_clean: m.won_clean, won_break: m.won_break, lost_clean: m.lost_clean, lost_break: m.lost_break,
    won_sideline: side === 'opp' ? (m.won_sideline ?? 0) : 0, lost_sideline: side === 'own' ? (m.lost_sideline ?? 0) : 0 }
}

export default function KickoutTrend({ data }: KickoutTrendProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [side, setSide] = useState<Side>('own')
  const needsScroll = data.length > SCROLL_THRESHOLD
  const chartWidth = needsScroll ? data.length * MIN_BAR_WIDTH + 80 : undefined // 80 for Y-axis + padding
  const L = LABELS[side]

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const match = data.find((_, i) => `R${i + 1}` === label)
    const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0)
    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">{match ? `vs ${match.opponent}` : label} · {L.title.toLowerCase()}</p>
        {payload.filter((e: any) => e.value).map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-white/85">{entry.name}: {entry.value} ({total > 0 ? Math.round(entry.value / total * 100) : 0}%)</span>
          </div>
        ))}
        <p className="text-white/40 text-xs mt-1">{total} kickouts</p>
      </div>
    )
  }

  if (data.length < 1) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-4">Kickout Outcomes</h3>
        <div className="h-[200px] flex items-center justify-center text-white/40">No kickout data recorded yet</div>
      </div>
    )
  }

  const rows = data.map(m => countsFor(m, side))
  const sideline = (c: Counts) => side === 'own' ? c.lost_sideline : c.won_sideline
  const won = (c: Counts) => c.won_clean + c.won_break + (side === 'opp' ? c.won_sideline : 0)
  const all = (c: Counts) => c.won_clean + c.won_break + c.lost_clean + c.lost_break + sideline(c)

  const chartData = data.map((m, i) => {
    const c = rows[i]
    return {
      round: `R${i + 1}`, opponent: m.opponent,
      [L.clean]: c.won_clean, [L.brk]: c.won_break,
      ...(side === 'opp' ? { [L.line]: c.won_sideline } : {}),
      [L.lostClean]: c.lost_clean, [L.lostBrk]: c.lost_break,
      ...(side === 'own' ? { [L.line]: c.lost_sideline } : {}),
    }
  })
  const sum = (f: (c: Counts) => number) => rows.reduce((s, c) => s + f(c), 0)
  const totalAll = sum(all)
  const totalWon = sum(won)
  const wonPct = totalAll > 0 ? Math.round(totalWon / totalAll * 100) : 0

  // the summary compares the team with ITSELF: the last 3 matches against the matches before them (no fixed bands)
  const insight = (() => {
    if (!totalAll) return null
    const line1 = side === 'own'
      ? `We kept ${totalWon} of our ${totalAll} kickouts (${wonPct}%), ${sum(c => c.won_clean)} of them clean.`
      : `We won ${totalWon} of their ${totalAll} kickouts (${wonPct}%), ${sum(c => c.won_clean)} of them clean.`
    if (rows.length < 4) return { line1, line2: '' }
    const recent = rows.slice(-3), before = rows.slice(0, -3)
    const pct = (rs: Counts[]) => { const a = rs.reduce((s, c) => s + all(c), 0); return a ? Math.round(rs.reduce((s, c) => s + won(c), 0) / a * 100) : 0 }
    const r = pct(recent), b = pct(before), d = r - b
    const line2 = Math.abs(d) < 5 ? `About the same over the last 3 matches (${r}%) as before them (${b}%).`
      : `${d > 0 ? 'Up' : 'Down'} to ${r}% over the last 3 matches, from ${b}% before them.`
    return { line1, line2 }
  })()

  const bars = (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
      <XAxis dataKey="round" stroke="rgba(255,255,255,0.5)" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }} />
      <YAxis stroke="rgba(255,255,255,0.5)" tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
      <Tooltip content={<CustomTooltip />} trigger="click" />
      <Legend wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }} />
      <Bar dataKey={L.clean} stackId="1" fill="#10b981" />
      <Bar dataKey={L.brk} stackId="1" fill="#6ee7b7" />
      {side === 'opp' && <Bar dataKey={L.line} stackId="1" fill="#a7f3d0" />}
      <Bar dataKey={L.lostClean} stackId="1" fill="#ef4444" />
      <Bar dataKey={L.lostBrk} stackId="1" fill="#f97316" radius={side === 'opp' ? [4, 4, 0, 0] : undefined} />
      {side === 'own' && <Bar dataKey={L.line} stackId="1" fill="#fca5a5" radius={[4, 4, 0, 0]} />}
    </>
  )

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <h3 className="text-lg font-bold text-white">Kickout Outcomes</h3>
        <div className="flex rounded-lg bg-white/5 border border-white/10 p-0.5" role="tablist" aria-label="Whose kickouts">
          {(['own', 'opp'] as Side[]).map(s => (
            <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${side === s ? 'bg-white/15 text-white' : 'text-white/60 hover:text-white'}`}>
              {LABELS[s].title}
            </button>
          ))}
        </div>
      </div>

      {needsScroll ? (
        <div ref={scrollRef} className="overflow-x-auto no-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div style={{ width: chartWidth, height: 220 }}>
            <BarChart data={chartData} stackOffset="expand" width={chartWidth!} height={220}>{bars}</BarChart>
          </div>
          <p className="text-white/30 text-[10px] text-center mt-1">Swipe to see all matches →</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} stackOffset="expand">{bars}</BarChart>
        </ResponsiveContainer>
      )}

      <div className="flex gap-2 mt-3">
        {[
          { l: L.clean, v: sum(c => c.won_clean), cls: 'text-emerald-400' },
          { l: L.brk, v: sum(c => c.won_break), cls: 'text-emerald-300' },
          { l: side === 'own' ? 'Lost' : 'They kept', v: sum(c => c.lost_clean + c.lost_break), cls: 'text-red-400' },
          { l: L.line, v: sum(sideline), cls: 'text-white/80' },
          { l: L.rate, v: `${wonPct}%`, cls: 'text-white' },
        ].map(t => (
          <div key={t.l} className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center min-w-0">
            <div className="text-[11px] text-white/50 leading-tight">{t.l}</div>
            <div className={`text-lg font-bold tabular-nums ${t.cls}`}>{t.v}</div>
          </div>
        ))}
      </div>

      {insight && (
        <div className="mt-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl px-3 py-2">
          <p className="text-xs text-emerald-200/90 leading-relaxed">{insight.line1}{insight.line2 ? ` ${insight.line2}` : ''}</p>
        </div>
      )}
    </div>
  )
}
