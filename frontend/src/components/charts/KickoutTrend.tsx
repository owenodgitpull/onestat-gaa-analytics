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

export default function KickoutTrend({ data }: KickoutTrendProps) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    // Find the original match data from the label
    const match = data.find((_, i) => `R${i + 1}` === label)
    const total = payload.reduce((sum: number, p: any) => sum + (p.value || 0), 0)

    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">
          {match ? `vs ${match.opponent}` : label}
        </p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span style={{ color: entry.color }}>
              {entry.name}: {entry.value} ({total > 0 ? Math.round(entry.value / total * 100) : 0}%)
            </span>
          </div>
        ))}
        <p className="text-white/40 text-xs mt-1">{total} total kickouts</p>
      </div>
    )
  }

  if (data.length < 1) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Kickout Outcomes</h3>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No kickout data recorded yet
        </div>
      </div>
    )
  }

  // Use raw counts for 100% stacked bar — Recharts stackOffset="expand" handles the %
  const chartData = data.map((m, i) => ({
    round: `R${i + 1}`,
    opponent: m.opponent,
    'Won Clean': m.won_clean,
    'Won Break': m.won_break,
    'Lost Clean': m.lost_clean,
    'Lost Break': m.lost_break,
  }))

  // Season totals for the summary row
  const totalWonClean = data.reduce((s, m) => s + m.won_clean, 0)
  const totalWonBreak = data.reduce((s, m) => s + m.won_break, 0)
  const totalLostClean = data.reduce((s, m) => s + m.lost_clean, 0)
  const totalLostBreak = data.reduce((s, m) => s + m.lost_break, 0)
  const totalAll = totalWonClean + totalWonBreak + totalLostClean + totalLostBreak
  const wonPct = totalAll > 0 ? Math.round((totalWonClean + totalWonBreak) / totalAll * 100) : 0

  // Compute 2-line data-derived insight
  const kickoutInsight = (() => {
    if (totalAll === 0) return null
    const totalWon = totalWonClean + totalWonBreak
    const cleanPct = totalWon > 0 ? Math.round(totalWonClean / totalWon * 100) : 0

    // Trend: compare first half of matches vs second half
    const mid = Math.ceil(data.length / 2)
    const early = data.slice(0, mid)
    const late = data.slice(mid)
    const earlyWon = early.reduce((s, m) => s + m.won_clean + m.won_break, 0)
    const earlyTotal = early.reduce((s, m) => s + m.won_clean + m.won_break + m.lost_clean + m.lost_break, 0)
    const lateWon = late.reduce((s, m) => s + m.won_clean + m.won_break, 0)
    const lateTotal = late.reduce((s, m) => s + m.won_clean + m.won_break + m.lost_clean + m.lost_break, 0)
    const earlyPct = earlyTotal > 0 ? Math.round(earlyWon / earlyTotal * 100) : 0
    const latePct = lateTotal > 0 ? Math.round(lateWon / lateTotal * 100) : 0

    let line1 = ''
    if (wonPct >= 65) line1 = `Winning ${wonPct}% of kickouts — ${cleanPct}% of those clean.`
    else if (wonPct >= 50) line1 = `Holding a ${wonPct}% kickout win rate — ${cleanPct}% won cleanly.`
    else line1 = `Losing ${100 - wonPct}% of kickouts — only ${cleanPct}% of wins are clean.`

    let line2 = ''
    if (data.length >= 3) {
      const diff = latePct - earlyPct
      if (diff > 8) line2 = `Retention improving — up ${diff}pts in recent matches.`
      else if (diff < -8) line2 = `Retention dropping — down ${Math.abs(diff)}pts recently, review restart strategy.`
      else if (wonPct < 50) line2 = `No improvement trend yet — kickout strategy needs attention.`
      else line2 = `Steady retention across the season.`
    } else {
      const breakPct = totalAll > 0 ? Math.round((totalWonBreak + totalLostBreak) / totalAll * 100) : 0
      if (wonPct < 50) line2 = breakPct > 40 ? `${breakPct}% contested — losing the battle at source.` : `Losing cleanly — opposition reading the kickout strategy.`
      else line2 = breakPct > 40 ? `${breakPct}% of kickouts contested — high-pressure restarts.` : `Most kickouts won cleanly — low contest rate.`
    }

    return { line1, line2 }
  })()

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Kickout Outcomes</h3>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} stackOffset="expand">
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" vertical={false} />
          <XAxis
            dataKey="round"
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          />
          <YAxis
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
          />
          <Tooltip content={<CustomTooltip />} trigger="click" />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}
          />
          <Bar dataKey="Won Clean" stackId="1" fill="#10b981" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Won Break" stackId="1" fill="#f59e0b" />
          <Bar dataKey="Lost Clean" stackId="1" fill="#ef4444" />
          <Bar dataKey="Lost Break" stackId="1" fill="#f97316" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>

      {/* Season summary */}
      <div className="flex gap-2 mt-3">
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Won Clean</div>
          <div className="text-lg font-bold text-emerald-400">{totalWonClean}</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Won Break</div>
          <div className="text-lg font-bold text-amber-400">{totalWonBreak}</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Lost Clean</div>
          <div className="text-lg font-bold text-red-400">{totalLostClean}</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Lost Break</div>
          <div className="text-lg font-bold text-orange-400">{totalLostBreak}</div>
        </div>
        <div className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-center">
          <div className="text-xs text-white/50">Win Rate</div>
          <div className="text-lg font-bold text-white">{wonPct}%</div>
        </div>
      </div>

      {/* Data-derived insight */}
      {kickoutInsight && (
        <div className="mt-3 bg-indigo-500/10 border border-indigo-500/20 rounded-xl px-3 py-2">
          <p className="text-xs text-indigo-200/90 leading-relaxed">
            {kickoutInsight.line1}
            {' '}
            {kickoutInsight.line2}
          </p>
        </div>
      )}
    </div>
  )
}
