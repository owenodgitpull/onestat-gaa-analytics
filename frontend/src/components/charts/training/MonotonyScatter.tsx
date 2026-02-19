import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Label,
} from 'recharts'
import type { MonotonyPoint } from '@/services/api'

interface Props {
  data: MonotonyPoint[]
}

export default function MonotonyScatter({ data }: Props) {
  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload
    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">
          {new Date(d.session_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
        </p>
        <p className="text-sm text-emerald-400">DSL: {d.avg_dsl}</p>
        <p className="text-sm text-amber-400">Duration: {d.avg_duration_mins} mins</p>
      </div>
    )
  }

  if (data.length < 2) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-4">Monotony & Strain</h3>
        <div className="flex-1 flex items-center justify-center text-white/40">
          Need at least 2 sessions for scatter plot
        </div>
      </div>
    )
  }

  // Calculate midpoints for quadrant hints
  const dslValues = data.map(d => d.avg_dsl)
  const durValues = data.map(d => d.avg_duration_mins)
  const midDsl = (Math.min(...dslValues) + Math.max(...dslValues)) / 2
  const midDur = (Math.min(...durValues) + Math.max(...durValues)) / 2

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <h3 className="text-lg font-bold text-white mb-1">Monotony & Strain</h3>
      <p className="text-xs text-white/40 mb-4">DSL vs Duration per session</p>

      <div className="flex-1 min-h-[250px]">
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="avg_duration_mins"
              name="Duration"
              unit=" min"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            >
              <Label
                value="Duration (mins)"
                position="bottom"
                offset={-5}
                style={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              />
            </XAxis>
            <YAxis
              dataKey="avg_dsl"
              name="DSL"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.1)' }}
            >
              <Label
                value="Avg DSL"
                angle={-90}
                position="insideLeft"
                offset={10}
                style={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
              />
            </YAxis>
            <Tooltip content={<CustomTooltip />} />
            {/* Quadrant reference lines */}
            <ReferenceLine
              x={midDur}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="5 5"
            />
            <ReferenceLine
              y={midDsl}
              stroke="rgba(255,255,255,0.1)"
              strokeDasharray="5 5"
            />
            <Scatter
              data={data}
              fill="#34d399"
              stroke="#10b981"
              strokeWidth={1}
              r={6}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <div className="flex justify-between text-[10px] text-white/30 mt-2 px-2">
        <span>Intense Drills (high DSL, short)</span>
        <span>Tactical / Walkthroughs (low DSL, long)</span>
      </div>
    </div>
  )
}
