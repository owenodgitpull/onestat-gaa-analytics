import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import type { SpeedZoneBucket } from '@/services/api'
import { parseLocalDate } from '@/utils/dateUtils'

interface Props {
  data: SpeedZoneBucket[]
}

export default function SpeedZoneChart({ data }: Props) {
  const formatted = data.map(d => ({
    ...d,
    label: parseLocalDate(d.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
  }))

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const item = data.find((_, i) => formatted[i]?.label === label)
    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">{label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span style={{ color: entry.color }}>
              {entry.name}: {entry.value.toFixed(1)}%
              {item && (
                <span className="text-white/40 ml-1">
                  ({Math.round(entry.dataKey === 'low_pct' ? item.low_m : entry.dataKey === 'hsr_pct' ? item.hsr_m : item.sprint_m)}m)
                </span>
              )}
            </span>
          </div>
        ))}
        {item && (
          <p className="text-white/40 text-xs mt-1">Total: {Math.round(item.total_m).toLocaleString()}m</p>
        )}
      </div>
    )
  }

  if (data.length < 1) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-4">Speed Zone Distribution</h3>
        <div className="flex-1 flex items-center justify-center text-white/40">
          No speed zone data available
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-white mb-1">Speed Zone Distribution</h3>
      <p className="text-xs text-white/40 mb-4">Low / HSR / Sprint proportions per session</p>

      <div className="flex-1 min-h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={formatted} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
              tickFormatter={(v) => `${v}%`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend
              wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}
            />
            <Bar
              dataKey="low_pct"
              name="Low Speed"
              stackId="zones"
              fill="#94a3b8"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="hsr_pct"
              name="HSR"
              stackId="zones"
              fill="#f59e0b"
              radius={[0, 0, 0, 0]}
            />
            <Bar
              dataKey="sprint_pct"
              name="Sprint"
              stackId="zones"
              fill="#ef4444"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
