import { useMemo } from 'react'
import { BarChart3, MoveHorizontal } from 'lucide-react'
import type { KPISparklineGridData, KPISparklineRow } from '@/services/api'

interface Props {
  data: KPISparklineGridData
}

const CATEGORY_ORDER = ['POSSESSION', 'SHOOTING', 'KICKOUTS', 'DEFENCE', 'SCORING', 'TERRITORY']

const TREND_STYLES: Record<string, { arrow: string; color: string }> = {
  up: { arrow: '\u2191', color: '#10b981' },
  down: { arrow: '\u2193', color: '#ef4444' },
  stable: { arrow: '\u2192', color: '#6b7280' },
}

function Sparkline({ values, trend, width = 120, height = 32 }: {
  values: number[]
  trend: string
  width?: number
  height?: number
}) {
  if (values.length < 2) return null

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const padding = 2

  const points = values.map((v, i) => {
    const x = padding + (i / (values.length - 1)) * (width - padding * 2)
    const y = height - padding - ((v - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  const strokeColor = TREND_STYLES[trend]?.color || '#6b7280'

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={points}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on last point */}
      {values.length > 0 && (() => {
        const lastX = padding + ((values.length - 1) / (values.length - 1)) * (width - padding * 2)
        const lastY = height - padding - ((values[values.length - 1] - min) / range) * (height - padding * 2)
        return <circle cx={lastX} cy={lastY} r="2.5" fill={strokeColor} />
      })()}
    </svg>
  )
}

function formatValue(val: number, isPercent: boolean): string {
  if (isPercent) return `${val.toFixed(1)}%`
  if (Number.isInteger(val)) return val.toString()
  return val.toFixed(1)
}

export default function KPISparklineGrid({ data }: Props) {
  const grouped = useMemo(() => {
    const groups: Record<string, KPISparklineRow[]> = {}
    for (const row of data.rows) {
      if (!groups[row.category]) groups[row.category] = []
      groups[row.category].push(row)
    }
    return groups
  }, [data.rows])

  const sortedCategories = CATEGORY_ORDER.filter(c => grouped[c])

  if (data.rows.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40">
        No KPI data available
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <BarChart3 size={20} />
          KPI Dashboard
        </h3>
        <span className="text-xs text-white/40">{data.rows.length} metrics</span>
      </div>

      <div className="flex md:hidden items-center gap-1.5 text-[11px] text-white/40 mb-2">
        <MoveHorizontal size={12} />
        Swipe to see more
      </div>

      <div className="flex-1 overflow-x-auto min-h-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10">
              <th className="text-left text-white/50 font-medium py-2 pr-4 text-xs">KPI</th>
              <th className="text-right text-white/50 font-medium py-2 px-3 text-xs whitespace-nowrap">Season Avg</th>
              <th className="text-right text-white/50 font-medium py-2 px-3 text-xs whitespace-nowrap">Last Match</th>
              <th className="text-center text-white/50 font-medium py-2 px-2 text-xs">Trend</th>
              <th className="text-center text-white/50 font-medium py-2 px-2 text-xs">Sparkline</th>
              <th className="text-right text-white/50 font-medium py-2 pl-3 text-xs whitespace-nowrap">Min–Max</th>
            </tr>
          </thead>
          <tbody>
            {sortedCategories.map(category => (
              <GroupRows key={category} category={category} rows={grouped[category]} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GroupRows({ category, rows }: { category: string; rows: KPISparklineRow[] }) {
  return (
    <>
      {/* Category header row */}
      <tr>
        <td colSpan={6} className="pt-3 pb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-white/30">
            {category}
          </span>
        </td>
      </tr>
      {rows.map(row => {
        const isPercent = row.name.includes('%')
        const trendStyle = TREND_STYLES[row.trend] || TREND_STYLES.stable
        const values = row.values.map(v => v.value)

        return (
          <tr key={row.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
            <td className="py-2 pr-4 text-white/80 text-xs font-medium whitespace-nowrap">{row.name}</td>
            <td className="py-2 px-3 text-right text-white/60 text-xs tabular-nums">
              {formatValue(row.season_avg, isPercent)}
            </td>
            <td className="py-2 px-3 text-right text-white font-medium text-xs tabular-nums">
              {formatValue(row.last_match, isPercent)}
            </td>
            <td className="py-2 px-2 text-center">
              <span
                className="text-sm font-bold"
                style={{ color: trendStyle.color }}
              >
                {trendStyle.arrow}
              </span>
            </td>
            <td className="py-2 px-2">
              <Sparkline values={values} trend={row.trend} />
            </td>
            <td className="py-2 pl-3 text-right text-white/40 text-[11px] tabular-nums whitespace-nowrap">
              {formatValue(row.min, isPercent)}–{formatValue(row.max, isPercent)}
            </td>
          </tr>
        )
      })}
    </>
  )
}
