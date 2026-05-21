import { useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'
import { Activity, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { SeasonHMLDData } from '@/services/api'

interface Props {
  data: SeasonHMLDData
}

type MetricKey = 'hmld_density' | 'total_hml_m' | 'hsr_m' | 'sprint_m'

const METRICS: { key: MetricKey; label: string; shortLabel: string; unit: string; decimals: number }[] = [
  { key: 'hmld_density', label: 'HMLD Density',  shortLabel: 'HMLD',   unit: 'm/min', decimals: 1 },
  { key: 'total_hml_m',  label: 'Total HML',     shortLabel: 'HML',    unit: 'm',     decimals: 0 },
  { key: 'hsr_m',        label: 'High Speed Run', shortLabel: 'HSR',    unit: 'm',     decimals: 0 },
  { key: 'sprint_m',     label: 'Sprint Dist',   shortLabel: 'Sprint', unit: 'm',     decimals: 0 },
]

function abbrev(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 7)
  // "Naomh Conaill" → "N.Cona"  |  "St Eunan's" → "St.Euna"
  const first = words[0].length <= 3 ? words[0] : words[0][0]
  const rest = words[words.length - 1].slice(0, 5)
  return `${first}.${rest}`
}

function fmt(val: number | null, decimals: number): string {
  if (val == null) return '-'
  return val.toFixed(decimals)
}

function barColor(val: number | null, avg: number | null): string {
  if (val == null || avg == null) return 'rgba(255,255,255,0.15)'
  const ratio = val / avg
  if (ratio >= 1.08) return '#10b981'  // emerald — well above avg
  if (ratio >= 0.93) return '#06b6d4'  // cyan — at avg
  return '#f59e0b'                      // amber — below avg
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-1">{d.opponent}</p>
      <p className="text-white/50 text-xs mb-2">{d.date}</p>
      <div className="space-y-1">
        {d.hmld_density != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">HMLD</span>
            <span className="text-cyan-300 font-medium">{d.hmld_density.toFixed(1)} m/min</span>
          </div>
        )}
        {d.total_hml_m != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Total HML</span>
            <span className="text-white font-medium">{Math.round(d.total_hml_m)} m</span>
          </div>
        )}
        {d.hsr_m != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">HSR</span>
            <span className="text-white font-medium">{Math.round(d.hsr_m)} m</span>
          </div>
        )}
        {d.sprint_m != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Sprint</span>
            <span className="text-white font-medium">{Math.round(d.sprint_m)} m</span>
          </div>
        )}
        <div className="flex justify-between gap-4 text-xs pt-1 border-t border-white/10">
          <span className="text-white/50">Trackers</span>
          <span className="text-white/70">{d.player_count} players</span>
        </div>
        {d.is_estimate && (
          <p className="text-xs text-amber-400 mt-1">* estimated from HSR</p>
        )}
      </div>
    </div>
  )
}

export default function SeasonHMLDChart({ data }: Props) {
  const [metric, setMetric] = useState<MetricKey>('hmld_density')

  const metricCfg = METRICS.find(m => m.key === metric)!
  const avgVal = data.season_avg[metric]

  const chartData = data.per_match
    .filter(m => m[metric] != null)
    .map(m => ({ ...m, label: abbrev(m.opponent) }))

  // Y-axis domain: give 15% breathing room above the max
  const vals = chartData.map(d => d[metric] as number)
  const yMax = vals.length ? Math.ceil(Math.max(...vals) * 1.18) : 10
  const yMin = vals.length ? Math.floor(Math.min(...vals) * 0.85) : 0

  const { trend_pct, peak_match } = data

  const TrendIcon = trend_pct == null
    ? Minus
    : trend_pct > 0 ? TrendingUp : TrendingDown
  const trendColor = trend_pct == null
    ? 'text-white/40'
    : trend_pct > 0 ? 'text-emerald-400' : 'text-amber-400'

  if (data.per_match.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No GPS data recorded yet — upload STATSports files after matches
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/15">
            <Activity size={16} className="text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Season Intensity</h3>
            <p className="text-xs text-white/40">Team avg GPS · per match</p>
          </div>
        </div>
        {trend_pct != null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
            <TrendIcon size={14} />
            <span>{trend_pct > 0 ? '+' : ''}{trend_pct.toFixed(1)}%</span>
            <span className="text-white/30 font-normal ml-0.5">last 3</span>
          </div>
        )}
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Season Avg</p>
          <p className="text-xl font-bold text-cyan-300 leading-none">
            {fmt(avgVal, metricCfg.decimals)}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">{metricCfg.unit}</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Peak</p>
          <p className="text-xl font-bold text-emerald-400 leading-none">
            {peak_match ? peak_match.hmld_density.toFixed(1) : '-'}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5 truncate">
            {peak_match ? abbrev(peak_match.opponent) : 'm/min'}
          </p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Matches</p>
          <p className="text-xl font-bold text-white leading-none">
            {data.per_match.filter(m => m[metric] != null).length}
          </p>
          <p className="text-[10px] text-white/30 mt-0.5">with GPS</p>
        </div>
      </div>

      {/* Metric switcher */}
      <div className="flex gap-1">
        {METRICS.map(m => (
          <button
            key={m.key}
            onClick={() => setMetric(m.key)}
            className={`flex-1 py-1 text-[10px] font-semibold rounded-md transition-all ${
              metric === m.key
                ? 'bg-cyan-500/25 text-cyan-300 border border-cyan-500/40'
                : 'bg-white/5 text-white/40 hover:text-white/60 hover:bg-white/8'
            }`}
          >
            {m.shortLabel}
          </button>
        ))}
      </div>

      {/* Bar chart */}
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

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-white/35">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Above avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" /> At avg
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Below avg
        </span>
      </div>
    </div>
  )
}
