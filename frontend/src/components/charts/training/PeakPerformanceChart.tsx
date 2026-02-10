import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { PeakPerformancePoint } from '@/services/api'

interface Props {
  data: PeakPerformancePoint[]
}

export default function PeakPerformanceChart({ data }: Props) {
  const formatted = data.map(d => ({
    ...d,
    label: new Date(d.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">{label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span style={{ color: entry.color }}>
              {entry.name}: {entry.name === 'Avg Distance' ? `${Math.round(entry.value).toLocaleString()}m` : `${entry.value.toFixed(2)} m/s`}
            </span>
          </div>
        ))}
      </div>
    )
  }

  if (data.length < 2) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-4">Peak Performance Trend</h3>
        <div className="flex-1 flex items-center justify-center text-white/40">
          Need at least 2 sessions to show trend
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-white mb-1">Peak Performance Trend</h3>
      <p className="text-xs text-white/40 mb-4">Volume (bars) + Speed (line) per session</p>

      <div className="flex-1 min-h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={formatted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            />
            <YAxis
              yAxisId="distance"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickFormatter={(v) => `${(v / 1000).toFixed(1)}k`}
            />
            <YAxis
              yAxisId="speed"
              orientation="right"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickFormatter={(v) => `${v} m/s`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}
            />
            <Bar
              yAxisId="distance"
              dataKey="avg_distance"
              name="Avg Distance"
              fill="#6366f1"
              radius={[4, 4, 0, 0]}
              barSize={24}
            />
            <Line
              yAxisId="speed"
              dataKey="avg_max_speed"
              name="Avg Max Speed"
              stroke="#fbbf24"
              strokeWidth={2}
              dot={{ fill: '#fbbf24', r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-white/40 mt-3 italic">
        Rising speed + steady volume = getting sharper
      </p>
    </div>
  )
}
