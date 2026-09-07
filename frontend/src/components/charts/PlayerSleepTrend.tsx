import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'
import { Moon } from 'lucide-react'

interface SleepEntry {
  date: string
  hours_slept: number
  quality: number | null
}

interface Props {
  history: { entries: SleepEntry[]; avg_hours: number | null; avg_quality: number | null; nights_below_7hrs: number } | null | undefined
}

const QUALITY_LABELS = ['-', 'Poor', 'Below avg', 'Average', 'Good', 'Excellent']

function barColor(hours: number): string {
  if (hours >= 8) return '#10b981'   // emerald — recommended range
  if (hours >= 7) return '#06b6d4'   // cyan — acceptable
  return '#f59e0b'                    // amber — under target
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[140px]">
      <p className="text-white font-semibold text-sm mb-2">{label}</p>
      <div className="flex justify-between gap-4 text-xs">
        <span className="text-white/50">Hours</span>
        <span className="text-white font-medium">{d.hours_slept.toFixed(1)}h</span>
      </div>
      {d.quality != null && (
        <div className="flex justify-between gap-4 text-xs mt-1">
          <span className="text-white/50">Quality</span>
          <span className="text-white font-medium">{QUALITY_LABELS[d.quality] || d.quality}</span>
        </div>
      )}
    </div>
  )
}

export default function PlayerSleepTrend({ history }: Props) {
  const chartData = useMemo(
    () => (history?.entries || []).map(e => ({
      ...e,
      label: new Date(e.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    })),
    [history]
  )

  if (!history || chartData.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm text-center">
        No sleep data logged yet — players log this themselves via the player portal
      </div>
    )
  }

  const yMax = Math.max(9, Math.ceil(Math.max(...chartData.map(d => d.hours_slept)) * 1.1))

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-indigo-500/15">
          <Moon size={16} className="text-indigo-400" />
        </div>
        <div>
          <h3 className="text-base font-bold text-white leading-tight">Sleep &amp; Recovery</h3>
          <p className="text-xs text-white/40">Self-logged · last {chartData.length} night{chartData.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Avg Hours</p>
          <p className="text-xl font-bold text-indigo-300 leading-none">{history.avg_hours ?? '-'}</p>
          <p className="text-[10px] text-white/30 mt-0.5">per night</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Avg Quality</p>
          <p className="text-xl font-bold text-white leading-none">{history.avg_quality ?? '-'}</p>
          <p className="text-[10px] text-white/30 mt-0.5">/ 5</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className={`text-xl font-bold leading-none ${history.nights_below_7hrs > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
            {history.nights_below_7hrs}
          </p>
          <p className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">Nights &lt;7h</p>
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 4, left: -18, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 9 }}
              axisLine={false}
              tickLine={false}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, yMax]}
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            <ReferenceLine
              y={8}
              stroke="rgba(16,185,129,0.4)"
              strokeDasharray="5 4"
              label={{ value: '8h target', position: 'insideTopRight', fill: 'rgba(16,185,129,0.6)', fontSize: 10 }}
            />
            <Bar dataKey="hours_slept" radius={[3, 3, 0, 0]} maxBarSize={24}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={barColor(entry.hours_slept)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-white/35">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> 8h+</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> 7-8h</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Under 7h</span>
      </div>
    </div>
  )
}
