/**
 * DynamicChart Component
 *
 * Renders AI-generated chart specifications using Recharts.
 * Supports multiple chart types: line, bar, pie, scatter, area.
 */

import { useState } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  ScatterChart,
  Scatter,
  AreaChart,
  Area,
  ComposedChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { X, RefreshCw, Lightbulb, Pin, PinOff, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import ChartZoomModal from '@/components/ChartZoomModal'
import type { AIChartSpec } from '@/services/api'

interface DynamicChartProps {
  chart: AIChartSpec
  onDismiss?: (chartId: string) => void
  onPin?: (chart: AIChartSpec) => void
  onUnpin?: (chartId: string) => void
  isPinned?: boolean
  canPin?: boolean
  isLoading?: boolean
}

// Default colors for charts — 5-color palette, no red
const DEFAULT_COLORS = [
  '#10b981', // emerald (primary brand)
  '#06b6d4', // cyan (secondary brand)
  '#f59e0b', // amber (accent gold)
  '#14b8a6', // teal (depth)
  '#22d3ee', // cyan-light (cool secondary)
]

// Remap old brand colours from cached AI charts to new palette
const LEGACY_COLOR_MAP: Record<string, string> = {
  '#6366f1': '#10b981', // indigo → emerald
  '#8b5cf6': '#06b6d4', // violet → cyan
  '#4f46e5': '#059669', // indigo-dark → emerald-dark
  '#818cf8': '#34d399', // indigo-light → emerald-light
  '#a78bfa': '#22d3ee', // violet-light → cyan-light
  '#a855f7': '#06b6d4', // purple → cyan
}
const remapColors = (colors: string[]) =>
  colors.map(c => LEGACY_COLOR_MAP[c.toLowerCase()] || c)

export default function DynamicChart({ chart, onDismiss, onPin, onUnpin, isPinned, canPin, isLoading }: DynamicChartProps) {
  const [isHovered, setIsHovered] = useState(false)

  const { type, title, insight, data, config } = chart
  const colors = remapColors(config.colors || DEFAULT_COLORS)
  const dataKeys = config.dataKeys || ['value']
  const xKey = config.xKey || 'name'

  // Custom tooltip style
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
          {label && <p className="text-white font-medium mb-1">{label}</p>}
          {payload.map((entry: any, index: number) => {
            // For pie charts, use payload name (the slice label) as the heading
            const displayName = entry.payload?.name || entry.name || ''
            const displayValue = typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value
            return (
              <p key={index} style={{ color: entry.color }} className="text-sm">
                {displayName}: {displayValue}
              </p>
            )
          })}
        </div>
      )
    }
    return null
  }

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={xKey}
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
              {dataKeys.map((key, index) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  strokeWidth={2}
                  dot={{ fill: colors[index % colors.length], strokeWidth: 2 }}
                  activeDot={{ r: 6 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )

      case 'bar':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={xKey}
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
              {dataKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[index % colors.length]}
                  radius={[4, 4, 0, 0]}
                  stackId={config.stacked ? 'stack' : undefined}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )

      case 'pie':
        return (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKeys[0]}
                nameKey={xKey}
                cx="50%"
                cy="45%"
                outerRadius={65}
                innerRadius={35}
                paddingAngle={2}
              >
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={colors[index % colors.length]}
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
            </PieChart>
          </ResponsiveContainer>
        )

      case 'scatter':
        // xKey/dataKeys already resolve to 'name'/['value'] fallbacks if the
        // AI omits config — but a scatter chart's own generic fallback name
        // ('name') isn't a numeric axis field, so fall back to the literal
        // 'x'/'y' names only when config truly didn't specify anything,
        // rather than the generic non-numeric defaults used by other types.
        const scatterXKey = config.xKey || 'x'
        const scatterYKey = (config.dataKeys && config.dataKeys[0]) || 'y'
        return (
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={scatterXKey}
                type="number"
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                dataKey={scatterYKey}
                type="number"
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              <Scatter
                data={data}
                fill={colors[0]}
              >
                {data.map((entry: any, index: number) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.color || colors[index % colors.length]}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )

      case 'area':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={xKey}
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
              {dataKeys.map((key, index) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.3}
                  stackId={config.stacked ? 'stack' : undefined}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )

      case 'composed':
        return (
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={xKey}
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
              {dataKeys.map((key, index) =>
                index === 0 ? (
                  <Bar
                    key={key}
                    dataKey={key}
                    fill={colors[index % colors.length]}
                    radius={[4, 4, 0, 0]}
                  />
                ) : (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={colors[index % colors.length]}
                    strokeWidth={2}
                    dot={{ fill: colors[index % colors.length], strokeWidth: 2 }}
                  />
                )
              )}
            </ComposedChart>
          </ResponsiveContainer>
        )

      case 'pitch': {
        // Pitch visualization — numbered paths on pitch + legend below
        const PITCH_X_OFFSET = 183
        const PITCH_Y_OFFSET = 123
        const PITCH_W = 1960
        const PITCH_H = 1167

        const OUTCOME_COLORS: Record<string, string> = {
          goal: '#10b981',
          point: '#10b981',
          point_free: '#34d399',
          two_point: '#06b6d4',
          two_point_free: '#22d3ee',
          wide: '#f59e0b',
          wide_free: '#fbbf24',
          forty_five: '#06b6d4',
        }

        const OUTCOME_LABELS: Record<string, string> = {
          goal: 'Goal', point: 'Point', point_free: 'Point (free)',
          two_point: '2-Pointer', two_point_free: '2-Pointer (free)',
          wide: 'Wide', wide_free: 'Wide (free)', forty_five: '45m free',
          short: 'Short', saved: 'Saved',
        }

        const toSvg = (px: number, py: number) => ({
          x: (px / 100) * PITCH_W + PITCH_X_OFFSET,
          y: (py / 100) * PITCH_H + PITCH_Y_OFFSET,
        })

        // Zone + description helpers for natural language path labels
        const getZone = (normX: number, y: number): string => {
          let lateral = ''
          if (y < 30) lateral = ' on the left'
          else if (y > 70) lateral = ' on the right'
          if (normX <= 4) return `our square`
          if (normX <= 10) return `our 13m line${lateral}`
          if (normX <= 15) return `our 21m line${lateral}`
          if (normX <= 33) return `our 45m line${lateral}`
          if (normX <= 50) return `midfield${lateral}`
          if (normX <= 68) return `the opposition 45m line${lateral}`
          if (normX <= 86) return `outside the arc${lateral}`
          if (normX <= 91) return `inside the arc${lateral}`
          if (normX <= 97) return `the 13m line${lateral}`
          return `the square`
        }
        const normalizeX = (rawX: number, minute: number, attackingRightFirstHalf: boolean): number => {
          const hdm: number = (data?.[0] as any)?.half_duration_mins ?? 30
          const isFirstHalf = minute <= hdm
          const attackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
          return attackingRight ? rawX : 100 - rawX
        }
        const prettyAction = (raw: string): string => {
          const map: Record<string, string> = {
            turnover_won: 'a turnover won', kickout_won: 'a kickout won',
            own_kickout_won: 'an own kickout won', opp_kickout_won: 'an opposition kickout won',
            own_kickout_won_break: 'a breaking ball from own kickout',
            opp_kickout_won_break: 'a breaking ball from opposition kickout',
            interception: 'an interception', block: 'a block',
            free_won: 'a free won', foul_won: 'a foul won', breaking_ball_won: 'a breaking ball won',
            mark: 'a mark', hand_pass: 'a hand pass', kick_pass: 'a kick pass',
            goal: 'a goal', point: 'a point', two_point: 'a two-pointer',
            point_free: 'a pointed free', wide: 'a wide', wide_free: 'a wide free',
            forty_five: 'a 45', saved: 'a saved shot', short: 'a short shot',
          }
          return map[raw] || raw.replace(/_/g, ' ')
        }
        const describePathNL = (points: {x:number;y:number}[], startedWith?: string, minute?: number, attackingRight?: boolean): string => {
          if (!points || points.length === 0) return ''
          const atkRight = attackingRight ?? true
          const min = minute ?? 15
          const zones = points.map(p => getZone(normalizeX(p.x, min, atkRight), p.y))
          const unique = zones.filter((z, i) => i === 0 || z !== zones[i - 1])
          if (points.length === 1) return `Shot taken from ${unique[0]}`
          const action = startedWith ? prettyAction(startedWith) : 'play'
          if (unique.length === 1) return `Started with ${action} in ${unique[0]}`
          if (unique.length === 2) return `Started with ${action} at ${unique[0]}, finished from ${unique[1]}`
          const middle = unique.slice(1, -1)
          const end = unique[unique.length - 1]
          return `Started with ${action} at ${unique[0]}, worked through ${middle.join(', ')} and finished from ${end}`
        }

        return (
          <div>
            {/* Pitch SVG — clean with numbered markers only */}
            <svg viewBox="0 0 2332 1446" className="w-full h-auto rounded-lg overflow-hidden">
              <rect width="2332" height="1446" fill="#2d5016" />
              <image
                href="/pitch-svg.svg"
                width="2332"
                height="1446"
                preserveAspectRatio="xMidYMid meet"
              />
              <rect width="2332" height="1446" fill="rgba(0,0,0,0.3)" />

              {data.map((item: any, idx: number) => {
                const points: { x: number; y: number }[] = item.points || []
                if (points.length === 0) return null

                const svgPoints = points.map((p: { x: number; y: number }) => toSvg(p.x, p.y))
                const color = OUTCOME_COLORS[item.outcome] || colors[idx % colors.length] || '#10b981'
                const num = idx + 1

                if (svgPoints.length === 1) {
                  return (
                    <g key={idx}>
                      <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={36} fill={color} stroke="white" strokeWidth={4} />
                      <text x={svgPoints[0].x} y={svgPoints[0].y + 14} textAnchor="middle" fill="white" fontSize={44} fontWeight="bold">{num}</text>
                    </g>
                  )
                }

                const pathD = svgPoints.map((p: { x: number; y: number }, i: number) =>
                  i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
                ).join(' ')
                const last = svgPoints[svgPoints.length - 1]

                return (
                  <g key={idx} opacity={0.9}>
                    {/* Glow */}
                    <path d={pathD} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} />
                    {/* Main path */}
                    <path d={pathD} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
                    {/* Intermediate dots */}
                    {svgPoints.slice(1, -1).map((p: { x: number; y: number }, di: number) => (
                      <circle key={di} cx={p.x} cy={p.y} r={14} fill={color} stroke="white" strokeWidth={2} opacity={0.7} />
                    ))}
                    {/* Start dot */}
                    <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={22} fill={color} stroke="white" strokeWidth={3} opacity={0.8} />
                    {/* End dot with number */}
                    <circle cx={last.x} cy={last.y} r={36} fill={color} stroke="white" strokeWidth={4} />
                    <text x={last.x} y={last.y + 14} textAnchor="middle" fill="white" fontSize={44} fontWeight="bold">{num}</text>
                  </g>
                )
              })}
            </svg>

            {/* Legend below pitch */}
            {data.length > 0 && (
              <div className="mt-3 space-y-2">
                {data.map((item: any, idx: number) => {
                  const color = OUTCOME_COLORS[item.outcome] || colors[idx % colors.length] || '#10b981'
                  const outcomeLabel = OUTCOME_LABELS[item.outcome] || item.outcome?.replace(/_/g, ' ')
                  const pathDesc = describePathNL(item.points || [], item.started_with, item.minute, item.attacking_right_first_half)
                  return (
                    <div key={idx} className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10">
                      {/* Number badge */}
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                        style={{ backgroundColor: color }}
                      >
                        {idx + 1}
                      </div>
                      {/* Details */}
                      <div className="flex-1 min-w-0">
                        <div className="text-white font-semibold text-sm">
                          {item.player || 'Unknown'} — <span style={{ color }}>{outcomeLabel}</span>
                          <span className="text-white/40 font-normal ml-1">{item.minute}'</span>
                        </div>
                        <div className="text-white/50 text-xs leading-relaxed mt-0.5">
                          {pathDesc}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      }

      case 'lineup': {
        // Starting XV rendered on the pitch — same background/coordinate
        // system as the 'pitch' case above, but fixed formation slots
        // instead of shot/movement points.
        const PITCH_X_OFFSET = 183
        const PITCH_Y_OFFSET = 123
        const PITCH_W = 1960
        const PITCH_H = 1167

        const FORMATION_POS: Record<string, { x: number; y: number; label: string }> = {
          'gk':        { x: 7,  y: 50, label: 'GK' },
          'fb-left':   { x: 20, y: 18, label: 'CB' },
          'fb-center': { x: 20, y: 50, label: 'FB' },
          'fb-right':  { x: 20, y: 82, label: 'CB' },
          'hb-left':   { x: 35, y: 18, label: 'HB' },
          'hb-center': { x: 35, y: 50, label: 'CHB' },
          'hb-right':  { x: 35, y: 82, label: 'HB' },
          'mf-left':   { x: 50, y: 35, label: 'MF' },
          'mf-right':  { x: 50, y: 65, label: 'MF' },
          'hf-left':   { x: 65, y: 18, label: 'HF' },
          'hf-center': { x: 65, y: 50, label: 'CHF' },
          'hf-right':  { x: 65, y: 82, label: 'HF' },
          'ff-left':   { x: 80, y: 18, label: 'CF' },
          'ff-center': { x: 80, y: 50, label: 'FF' },
          'ff-right':  { x: 80, y: 82, label: 'CF' },
        }

        const toSvg = (px: number, py: number) => ({
          x: (px / 100) * PITCH_W + PITCH_X_OFFSET,
          y: (py / 100) * PITCH_H + PITCH_Y_OFFSET,
        })

        const surname = (name: string) => {
          const parts = (name || '').trim().split(' ')
          return parts[parts.length - 1] || name || '?'
        }

        const starters = data.filter((d: any) => FORMATION_POS[d.position_id])
        const subs = data.filter((d: any) => !FORMATION_POS[d.position_id])
        const changeNotes = starters.filter((p: any) => p.is_change && p.note)

        return (
          <div>
            <svg viewBox="0 0 2332 1446" className="w-full h-auto rounded-lg overflow-hidden">
              <rect width="2332" height="1446" fill="#2d5016" />
              <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
              <rect width="2332" height="1446" fill="rgba(0,0,0,0.25)" />

              {starters.map((p: any, idx: number) => {
                const pos = FORMATION_POS[p.position_id]
                const svg = toSvg(pos.x, pos.y)
                const changed = !!p.is_change
                const fill = changed ? '#f59e0b' : '#10b981'
                return (
                  <g key={idx}>
                    <circle cx={svg.x} cy={svg.y} r={58} fill={fill} stroke="white" strokeWidth={5} opacity={0.95} />
                    <text x={svg.x} y={svg.y + 15} textAnchor="middle" fill="white" fontSize={46} fontWeight="bold">
                      {p.jersey_number ?? ''}
                    </text>
                    <text
                      x={svg.x} y={svg.y + 92} textAnchor="middle" fill="white" fontSize={38} fontWeight="600"
                      style={{ paintOrder: 'stroke', stroke: 'rgba(0,0,0,0.65)', strokeWidth: 6 } as React.CSSProperties}
                    >
                      {surname(p.player_name)}
                    </text>
                    {changed && (
                      <text x={svg.x} y={svg.y - 72} textAnchor="middle" fill="#fbbf24" fontSize={28} fontWeight="700">
                        CHANGE
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>

            {subs.length > 0 && (
              <div className="mt-3">
                <div className="text-xs font-semibold text-white/40 uppercase tracking-wider mb-2">Substitutes</div>
                <div className="flex flex-wrap gap-2">
                  {subs.map((p: any, idx: number) => (
                    <div key={idx} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white/80 text-sm">
                      {p.jersey_number ? `${p.jersey_number}. ` : ''}{p.player_name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {changeNotes.length > 0 && (
              <div className="mt-3 space-y-1.5">
                {changeNotes.map((p: any, idx: number) => (
                  <div key={idx} className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    <span className="font-semibold">{p.player_name}</span>
                    {FORMATION_POS[p.position_id] ? ` (${FORMATION_POS[p.position_id].label})` : ''}: {p.note}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      }

      default:
        // Fallback: render as bar chart for any unknown type
        return (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey={xKey}
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <Tooltip content={<CustomTooltip />} cursor={false} />
              {config.showLegend && <Legend />}
              {dataKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={colors[index % colors.length]}
                  radius={[4, 4, 0, 0]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )
    }
  }

  return (
    <ChartZoomModal title={title}>
    <div
      className="glass-card p-4 relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header with title, trend badge, and action buttons */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{title}</h3>
          {chart.trend === 'improving' && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-[10px] font-semibold flex-shrink-0">
              <TrendingUp size={10} /> Up
            </span>
          )}
          {chart.trend === 'declining' && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-semibold flex-shrink-0">
              <TrendingDown size={10} /> Down
            </span>
          )}
          {chart.trend === 'stable' && (
            <span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-white/10 text-white/50 text-[10px] font-semibold flex-shrink-0">
              <Minus size={10} /> Stable
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Pin / Unpin button */}
          {isPinned && onUnpin ? (
            <button
              onClick={() => onUnpin(chart.id)}
              className={`p-1.5 rounded-lg transition-all duration-200 ${
                isHovered
                  ? 'opacity-100 bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30'
                  : 'opacity-0'
              }`}
              title="Unpin chart"
            >
              <PinOff size={14} />
            </button>
          ) : onPin ? (
            <button
              onClick={() => onPin(chart)}
              disabled={!canPin}
              className={`p-1.5 rounded-lg transition-all duration-200 ${
                isHovered
                  ? canPin
                    ? 'opacity-100 bg-white/10 hover:bg-emerald-500/30 text-white/70 hover:text-emerald-400'
                    : 'opacity-100 bg-white/5 text-white/30 cursor-not-allowed'
                  : 'opacity-0'
              }`}
              title={canPin ? 'Pin chart to dashboard' : 'Max 4 pinned charts'}
            >
              <Pin size={14} />
            </button>
          ) : null}

          {/* Dismiss button */}
          {onDismiss && (
            <button
              onClick={() => onDismiss(chart.id)}
              className={`p-1.5 rounded-lg transition-all duration-200 ${
                isHovered
                  ? 'opacity-100 bg-white/10 hover:bg-red-500/30 text-white/70 hover:text-red-400'
                  : 'opacity-0'
              }`}
              title="Dismiss chart and generate a new one"
            >
              {isLoading ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : (
                <X size={14} />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className={`transition-opacity duration-200 ${isLoading ? 'opacity-50' : 'opacity-100'}`}>
        {!data || data.length === 0 ? (
          <div className="flex items-center justify-center h-[200px] text-white/30 text-sm">
            No data available for this chart
          </div>
        ) : renderChart()}
      </div>

      {/* Insight */}
      {insight && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="flex items-start gap-2">
            <Lightbulb size={14} className="text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
          </div>
        </div>
      )}
    </div>
    </ChartZoomModal>
  )
}
