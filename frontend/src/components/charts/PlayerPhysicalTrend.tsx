import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, Cell, ResponsiveContainer,
} from 'recharts'
import { Zap, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import type { MatchGPSData } from '@/services/api'

interface Props {
  matchGpsHistory: MatchGPSData[]
}

type MetricKey = 'total_distance_m' | 'high_speed_running_m' | 'sprint_count'

const METRICS: { key: MetricKey; label: string; shortLabel: string; unit: string; decimals: number }[] = [
  { key: 'total_distance_m',      label: 'Distance',           shortLabel: 'Distance', unit: 'm',     decimals: 0 },
  { key: 'high_speed_running_m',  label: 'High Speed Running', shortLabel: 'HSR',      unit: 'm',     decimals: 0 },
  { key: 'sprint_count',          label: 'Sprints',            shortLabel: 'Sprints',  unit: 'count', decimals: 0 },
]

function abbrev(name: string): string {
  const words = (name || '').trim().split(/\s+/).filter(Boolean)
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

function barColor(val: number | null, avg: number | null): string {
  if (val == null || avg == null) return 'rgba(255,255,255,0.15)'
  const ratio = val / avg
  if (ratio >= 1.08) return '#10b981'
  if (ratio >= 0.93) return '#06b6d4'
  return '#f59e0b'
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl min-w-[160px]">
      <p className="text-white font-semibold text-sm mb-1">{d.opponent}</p>
      <p className="text-white/50 text-xs mb-2">{d.dateLabel}</p>
      <div className="space-y-1">
        {d.total_distance_m != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Distance</span>
            <span className="text-white font-medium">{Math.round(d.total_distance_m)} m</span>
          </div>
        )}
        {d.high_speed_running_m != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">HSR</span>
            <span className="text-white font-medium">{Math.round(d.high_speed_running_m)} m</span>
          </div>
        )}
        {d.sprint_count != null && (
          <div className="flex justify-between gap-4 text-xs">
            <span className="text-white/50">Sprints</span>
            <span className="text-white font-medium">{d.sprint_count}</span>
          </div>
        )}
        {d.playing_minutes != null && (
          <div className="flex justify-between gap-4 text-xs pt-1 border-t border-white/10">
            <span className="text-white/50">Minutes</span>
            <span className="text-white/70">{d.playing_minutes}'</span>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlayerPhysicalTrend({ matchGpsHistory }: Props) {
  const [metric, setMetric] = useState<MetricKey>('total_distance_m')
  const metricCfg = METRICS.find(m => m.key === metric)!

  // Backend returns most-recent-first; chart reads chronologically (oldest → newest).
  const chronological = useMemo(
    () => matchGpsHistory.slice().reverse(),
    [matchGpsHistory]
  )

  const chartData = useMemo(
    () => chronological
      .filter(m => m[metric] != null)
      .map(m => ({
        ...m,
        label: abbrev(m.opponent || ''),
        dateLabel: m.match_date ? new Date(m.match_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '',
      })),
    [chronological, metric]
  )

  const vals = chartData.map(d => d[metric] as number)
  const avgVal = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  const yMax = vals.length ? Math.ceil(Math.max(...vals) * 1.18) : 10
  const yMin = vals.length ? Math.floor(Math.min(...vals) * 0.85) : 0

  // Trend: last 3 vs season avg — same convention as SeasonHMLDChart.
  const last3 = vals.slice(-3)
  const last3Avg = last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : null
  const trendPct = avgVal && last3Avg != null && avgVal !== 0
    ? ((last3Avg - avgVal) / avgVal) * 100
    : null

  const peakVal = vals.length ? Math.max(...vals) : null
  const peakMatch = peakVal != null ? chartData.find(d => (d[metric] as number) === peakVal) : null

  const TrendIcon = trendPct == null ? Minus : trendPct > 0 ? TrendingUp : TrendingDown
  const trendColor = trendPct == null ? 'text-white/40' : trendPct > 0 ? 'text-emerald-400' : 'text-amber-400'

  if (chartData.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No match GPS data recorded yet
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/15">
            <Zap size={16} className="text-cyan-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Season Physical Trend</h3>
            <p className="text-xs text-white/40">Match GPS · per game</p>
          </div>
        </div>
        {trendPct != null && (
          <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
            <TrendIcon size={14} />
            <span>{trendPct > 0 ? '+' : ''}{trendPct.toFixed(1)}%</span>
            <span className="text-white/30 font-normal ml-0.5">last 3</span>
          </div>
        )}
      </div>

      {/* Headline stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Season Avg</p>
          <p className="text-xl font-bold text-cyan-300 leading-none">{fmt(avgVal, metricCfg.decimals)}</p>
          <p className="text-[10px] text-white/30 mt-0.5">{metricCfg.unit}</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Peak</p>
          <p className="text-xl font-bold text-emerald-400 leading-none">{fmt(peakVal, metricCfg.decimals)}</p>
          <p className="text-[10px] text-white/30 mt-0.5 truncate">{peakMatch ? peakMatch.label : metricCfg.unit}</p>
        </div>
        <div className="bg-white/5 rounded-xl px-3 py-2.5 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-wide mb-0.5">Matches</p>
          <p className="text-xl font-bold text-white leading-none">{chartData.length}</p>
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

      {/* Bar chart — a fixed height, not flex-1/min-h-0, is deliberate: recharts'
          ResponsiveContainer with height="100%" needs its immediate parent to
          resolve to a real pixel height. If that parent is itself sized by a
          flex-fill with no definite ancestor height above it (true here — this
          card sits in a grid whose row height comes from its own content), the
          two chase each other with nothing to anchor to and the container grows
          without bound. Confirmed live 2026-09-08: this chart's container grew
          vertically forever on the player performance tab. */}
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 18, right: 4, left: -18, bottom: 0 }} barCategoryGap="28%">
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
            <Bar
              dataKey={metric}
              radius={[4, 4, 0, 0]}
              maxBarSize={40}
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
