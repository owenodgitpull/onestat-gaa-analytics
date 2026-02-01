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
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { X, RefreshCw, Lightbulb } from 'lucide-react'
import type { AIChartSpec } from '@/services/api'

interface DynamicChartProps {
  chart: AIChartSpec
  onDismiss?: (chartId: string) => void
  isLoading?: boolean
}

// Default colors for charts
const DEFAULT_COLORS = [
  '#10b981', // emerald
  '#6366f1', // indigo
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
]

export default function DynamicChart({ chart, onDismiss, isLoading }: DynamicChartProps) {
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
          <p className="text-white font-medium mb-1">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}
            </p>
          ))}
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
              <Tooltip content={<CustomTooltip />} />
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
              <Tooltip content={<CustomTooltip />} />
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
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                dataKey={dataKeys[0]}
                nameKey={xKey}
                cx="50%"
                cy="50%"
                outerRadius={70}
                innerRadius={40}
                paddingAngle={2}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
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
              <Tooltip content={<CustomTooltip />} />
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
              <Tooltip content={<CustomTooltip />} />
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
              <Tooltip content={<CustomTooltip />} />
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

      default:
        return (
          <div className="h-[200px] flex items-center justify-center text-white/50">
            Unsupported chart type: {type}
          </div>
        )
    }
  }

  return (
    <div
      className="glass-card p-4 relative group"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header with title and dismiss button */}
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
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
