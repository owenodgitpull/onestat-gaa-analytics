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
import { X, RefreshCw, Lightbulb, Pin, PinOff } from 'lucide-react'
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
  '#6366f1', // indigo (primary brand)
  '#10b981', // emerald (positive/success)
  '#f59e0b', // amber (Dungloe gold)
  '#8b5cf6', // violet (glass depth)
  '#06b6d4', // cyan (cool secondary)
]

export default function DynamicChart({ chart, onDismiss, onPin, onUnpin, isPinned, canPin, isLoading }: DynamicChartProps) {
  const [isHovered, setIsHovered] = useState(false)

  const { type, title, insight, data, config } = chart
  const colors = config.colors || DEFAULT_COLORS
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
        return (
          <ResponsiveContainer width="100%" height={200}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
              <XAxis
                dataKey="x"
                type="number"
                stroke="rgba(255,255,255,0.5)"
                tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
              />
              <YAxis
                dataKey="y"
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
          point: '#6366f1',
          point_free: '#818cf8',
          two_point: '#8b5cf6',
          two_point_free: '#a78bfa',
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
                const color = OUTCOME_COLORS[item.outcome] || colors[idx % colors.length] || '#6366f1'
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
                  const color = OUTCOME_COLORS[item.outcome] || colors[idx % colors.length] || '#6366f1'
                  const outcomeLabel = OUTCOME_LABELS[item.outcome] || item.outcome?.replace(/_/g, ' ')
                  const touches = item.points?.length || 0
                  return (
                    <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-white/5 border border-white/10">
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
                        </div>
                        <div className="text-white/50 text-xs">
                          vs {item.opponent || '?'} · {item.minute}' · {touches} touch{touches !== 1 ? 'es' : ''} in buildup
                          {item.started_by && item.started_by !== item.player && (
                            <> · Started by <span className="text-white/70">{item.started_by}</span> ({item.started_with?.replace(/_/g, ' ')})</>
                          )}
                          {item.started_by && item.started_by === item.player && item.started_with && item.started_with !== item.outcome && (
                            <> · Started with {item.started_with?.replace(/_/g, ' ')}</>
                          )}
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
    <div
      className="glass-card p-4 relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header with title and action buttons */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="flex items-center gap-1">
          {/* Pin / Unpin button */}
          {isPinned && onUnpin ? (
            <button
              onClick={() => onUnpin(chart.id)}
              className={`p-1.5 rounded-lg transition-all duration-200 ${
                isHovered
                  ? 'opacity-100 bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30'
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
                    ? 'opacity-100 bg-white/10 hover:bg-indigo-500/30 text-white/70 hover:text-indigo-400'
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
        {renderChart()}
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
  )
}
