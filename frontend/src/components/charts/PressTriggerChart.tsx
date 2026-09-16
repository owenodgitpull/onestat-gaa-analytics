import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'
import { Siren } from 'lucide-react'
import type { PressTriggerData } from '@/services/api'

interface Props {
  data: PressTriggerData
}

type MetricKey = 'win_back_rate' | 'avg_passes_allowed'

// Opposite "better" direction per metric — win-back rate wants to be HIGH
// (we got the ball back), passes allowed wants to be LOW (we shut the
// press down fast) — so each metric's bar coloring is evaluated on its own
// terms rather than forcing one shared "higher/lower is better" rule.
const METRICS: { key: MetricKey; label: string; shortLabel: string; unit: string; decimals: number; higherIsBetter: boolean }[] = [
  { key: 'win_back_rate', label: 'Win-Back Rate', shortLabel: 'Win-Back %', unit: '%', decimals: 0, higherIsBetter: true },
  { key: 'avg_passes_allowed', label: 'Passes Allowed', shortLabel: 'Passes', unit: 'passes', decimals: 1, higherIsBetter: false },
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

function barColor(val: number | null, avg: number | null, higherIsBetter: boolean): string {
  if (val == null || avg == null || avg === 0) return 'rgba(255,255,255,0.15)'
  const ratio = val / avg
  const better = higherIsBetter ? ratio >= 1.08 : ratio <= 0.92
  const worse = higherIsBetter ? ratio <= 0.92 : ratio >= 1.08
  if (better) return '#10b981'  // emerald
  if (worse) return '#f59e0b'   // amber
  return '#06b6d4'              // cyan — at avg
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[170px]">
      <p className="text-white font-semibold text-sm mb-1">{d.opponent}</p>
      <p className="text-white/50 text-xs mb-2">{d.date} · {d.press_count} press{d.press_count === 1 ? '' : 'es'}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4 text-xs">
          <span className="text-white/50">Win-Back Rate</span>
          <span className="text-emerald-300 font-medium">{d.win_back_rate.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between gap-4 text-xs">
          <span className="text-white/50">Passes Allowed</span>
          <span className="text-white font-medium">{d.avg_passes_allowed.toFixed(1)}</span>
        </div>
        <div className="flex justify-between gap-4 text-xs">
          <span className="text-white/50">Avg Duration</span>
          <span className="text-white/70 font-medium">{d.avg_duration_min.toFixed(1)} min</span>
        </div>
      </div>
    </div>
  )
}

export default function PressTriggerChart({ data }: Props) {
  const [metric, setMetric] = useState<MetricKey>('win_back_rate')

  const metricCfg = METRICS.find(m => m.key === metric)!
  const avgVal = data.season_avg[metric]

  const chartData = data.per_match.map(m => ({ ...m, label: abbrev(m.opponent) }))

  const vals = chartData.map(d => d[metric] as number)
  const yMax = metric === 'win_back_rate' ? 100 : (vals.length ? Math.ceil(Math.max(...vals) * 1.18) : 10)
  const yMin = 0

  if (data.per_match.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No Press Trigger data yet — toggle it on during live recording when pressing the opposition kickout/build-up
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/15">
            <Siren size={16} className="text-orange-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Press Trigger</h3>
            <p className="text-xs text-white/40">Effectiveness · per match</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Season Avg</p>
          <p className="text-xl font-bold text-cyan-300 leading-none">
            {fmt(avgVal, metricCfg.decimals)}{metric === 'win_back_rate' ? '%' : ''}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">{metricCfg.unit}</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Total Presses</p>
          <p className="text-xl font-bold text-white leading-none">
            {data.season_avg.press_count}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">this season</p>
        </div>
      </div>

      <div className="flex gap-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
              metric === m.key
                ? 'bg-orange-500/25 text-orange-300 border border-orange-500/40'
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
                  value: `avg ${fmt(avgVal, metricCfg.decimals)}${metric === 'win_back_rate' ? '%' : ''}`,
                  position: 'insideTopRight',
                  fill: 'rgba(255,255,255,0.35)',
                  fontSize: 10,
                }}
              />
            )}
            <Bar dataKey={metric} radius={[4, 4, 0, 0]} maxBarSize={40}
              label={{
                position: 'top',
                formatter: (v: number) => `${fmt(v, metricCfg.decimals)}${metric === 'win_back_rate' ? '%' : ''}`,
                fill: 'rgba(255,255,255,0.55)',
                fontSize: 10,
              }}
            >
              {chartData.map((entry, i) => (
                <Cell key={i} fill={barColor(entry[metric] as number, avgVal, metricCfg.higherIsBetter)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="flex items-center justify-center gap-4 text-[10px] text-white/35">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Better than avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> At avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Worse than avg
        </span>
      </div>
    </div>
  )
}
