import { useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { ShieldAlert } from 'lucide-react'

interface DisciplineMatchPoint {
  match_id: string
  opponent: string
  match_date: string
  turnovers_won: number
  turnovers_lost: number
  unforced_errors: number
}

interface Props {
  data: { player_id: string; matches: DisciplineMatchPoint[] } | null | undefined
}

function abbrev(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 7)
  const first = words[0].length <= 3 ? words[0] : words[0][0]
  const rest = words[words.length - 1].slice(0, 5)
  return `${first}.${rest}`
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-1">{d.opponent}</p>
      <p className="text-white/50 text-xs mb-2">{label}</p>
      <div className="space-y-1 text-xs">
        <div className="flex justify-between gap-4">
          <span className="text-white/50">Turnovers Won</span>
          <span className="text-cyan-300 font-medium">{d.turnovers_won}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/50">Turnovers Lost</span>
          <span className="text-amber-300 font-medium">{d.turnovers_lost}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-white/50">Unforced Errors</span>
          <span className="text-amber-300 font-medium">{d.unforced_errors}</span>
        </div>
        <div className="flex justify-between gap-4 pt-1 border-t border-white/10">
          <span className="text-white/50">Net</span>
          <span className={`font-medium ${d.net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{d.net > 0 ? '+' : ''}{d.net}</span>
        </div>
      </div>
    </div>
  )
}

export default function PlayerDisciplineTrend({ data }: Props) {
  const chartData = useMemo(
    () => (data?.matches || []).map(m => ({
      ...m,
      label: abbrev(m.opponent),
      errors: m.turnovers_lost + m.unforced_errors,
      net: m.turnovers_won - m.turnovers_lost - m.unforced_errors,
    })),
    [data]
  )

  if (chartData.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm text-center">
        No turnover/error events tagged for this player yet
      </div>
    )
  }

  const totalWon = chartData.reduce((s, d) => s + d.turnovers_won, 0)
  const totalErrors = chartData.reduce((s, d) => s + d.errors, 0)
  const avgNet = chartData.reduce((s, d) => s + d.net, 0) / chartData.length

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-cyan-500/15">
          <ShieldAlert size={16} className="text-cyan-400" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white leading-tight">Ball Security</h3>
          <p className="text-xs text-white/40">Turnovers &amp; errors · per match</p>
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Won</p>
          <p className="text-xl font-bold text-cyan-300 leading-none">{totalWon}</p>
          <p className="text-[10px] text-white/30 mt-0.5">season</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Lost + Errors</p>
          <p className="text-xl font-bold text-amber-300 leading-none">{totalErrors}</p>
          <p className="text-[10px] text-white/30 mt-0.5">season</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className={`text-xl font-bold leading-none ${avgNet >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {avgNet > 0 ? '+' : ''}{avgNet.toFixed(1)}
          </p>
          <p className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">Avg Net</p>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
              allowDecimals={false}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="turnovers_won" name="Won" fill="#06b6d4" radius={[4, 4, 0, 0]} maxBarSize={30} />
            <Line type="monotone" dataKey="errors" name="Lost + Errors" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4, fill: '#f59e0b' }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
