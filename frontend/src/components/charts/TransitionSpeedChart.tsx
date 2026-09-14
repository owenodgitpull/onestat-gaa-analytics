import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'
import { Zap } from 'lucide-react'
import type { TransitionSpeedData } from '@/services/api'

interface Props {
  data: TransitionSpeedData
}

type MetricKey = 'ball_recovery_min' | 'turnover_to_shot_sec'

// Units deliberately differ (minutes vs. seconds) — ball recovery is a
// slower, multi-minute process (winning the ball back), turnover-to-shot is
// a fast few-second transition, so each metric formats/labels independently
// rather than forcing a shared unit onto the chart.
const METRICS: { key: MetricKey; label: string; shortLabel: string; unit: string; decimals: number }[] = [
  { key: 'ball_recovery_min', label: 'Ball Recovery Time', shortLabel: 'Recovery', unit: 'min', decimals: 1 },
  { key: 'turnover_to_shot_sec', label: 'Turnover-to-Shot Time', shortLabel: 'Transition', unit: 'sec', decimals: 1 },
]

function abbrev(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 7)
  const first = words[0].length <= 3 ? words[0] : words[0][0]
  const rest = words[words.length - 1].slice(0, 5)
  return `${first}.${rest}`
}

function fmt(val: number | null, decimals: number): string {
  if (val == null) return '-'
  return val.toFixed(decimals)
}

// Lower is better for both these metrics (faster recovery, faster
// transition) — so the color scale is inverted relative to SeasonHMLDChart's
// "higher is better" GPS-intensity coloring.
function barColor(val: number | null, avg: number | null): string {
  if (val == null || avg == null) return 'rgba(255,255,255,0.15)'
  const ratio = val / avg
  if (ratio <= 0.92) return '#10b981'  // emerald — faster than avg
  if (ratio <= 1.08) return '#06b6d4'  // cyan — at avg
  return '#f59e0b'                      // amber — slower than avg
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-1">{d.opponent}</p>
      <p className="text-white/50 text-xs mb-2">{d.date}</p>
      <div className="space-y-1">
        {d.ball_recovery_min != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Ball Recovery</span>
            <span className="text-cyan-300 font-medium">{d.ball_recovery_min.toFixed(1)} min</span>
          </div>
        )}
        {d.turnover_to_shot_sec != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Turnover-to-Shot</span>
            <span className="text-white font-medium">{d.turnover_to_shot_sec.toFixed(1)}s</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TransitionSpeedChart({ data }: Props) {
  const [metric, setMetric] = useState<MetricKey>('turnover_to_shot_sec')

  const metricCfg = METRICS.find(m => m.key === metric)!
  const avgVal = data.season_avg[metric]

  const chartData = data.per_match
    .filter(m => m[metric] != null)
    .map(m => ({ ...m, label: abbrev(m.opponent) }))

  const vals = chartData.map(d => d[metric] as number)
  const yMax = vals.length ? Math.ceil(Math.max(...vals) * 1.18) : 10
  const yMin = 0

  if (data.per_match.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No transition data yet — needs turnovers/kickouts and shots logged with timestamps
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-amber-500/15">
            <Zap size={16} className="text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Transition Speed</h3>
            <p className="text-xs text-white/40">Team avg · per match</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Season Avg</p>
          <p className="text-xl font-bold text-cyan-300 leading-none">
            {fmt(avgVal, metricCfg.decimals)}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">{metricCfg.unit}</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Matches</p>
          <p className="text-xl font-bold text-white leading-none">
            {data.per_match.filter(m => m[metric] != null).length}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">with data</p>
        </div>
      </div>

      <div className="flex gap-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
              metric === m.key
                ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                : 'bg-white/5 text-white/40 hover:text-white/60 hover:bg-white/8'
            }`}
          >
            {m.shortLabel}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0" style={{ minHeight: 160 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={chartData}
            margin={{ top: 18, right: 4, left: -18, bottom: 0 }}
            barCategoryGap="28%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: 'rgba(255,255,255,0.35)', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
            />
            <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
            {avgVal != null && (
              <ReferenceLine
                y={avgVal}
                stroke="rgba(255,255,255,0.35)"
                strokeDasharray="5 4"
                label={{
                  value: `avg ${fmt(avgVal, metricCfg.decimals)}`,
                  position: 'insideTopRight',
                  fill: 'rgba(255,255,255,0.35)',
                  fontSize: 10,
                }}
              />
            )}
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={40}
              label={{
                position: 'top',
                formatter: (v: number) => fmt(v, metricCfg.decimals),
                fill: 'rgba(255,255,255,0.55)',
                fontSize: 10,
              }}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={barColor(entry[metric] as number | null, avgVal)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-4 text-[10px] text-white/35">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Faster than avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> At avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Slower than avg
        </span>
      </div>
    </div>
  )
}
