import { GitBranch } from 'lucide-react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { ScoreOriginsData } from '../../services/api'

interface Props {
  data: ScoreOriginsData
  teamName?: string
  opponentName?: string
}

const CATEGORIES = [
  { key: 'own_kickout', label: 'Own Kickout', color: '#06b6d4' },
  { key: 'opp_kickout', label: 'Opp Kickout', color: '#8b5cf6' },
  { key: 'turnover',    label: 'Turnover',    color: '#f59e0b' },
  { key: 'free',        label: 'Free',        color: '#3b82f6' },
  { key: 'open_play',   label: 'Open Play',   color: '#6b7280' },
] as const

type CatKey = typeof CATEGORIES[number]['key']

function buildSlices(side: ScoreOriginsData['own']) {
  return CATEGORIES
    .map(c => ({ name: c.label, value: side[c.key as CatKey], color: c.color }))
    .filter(s => s.value > 0)
}

const RADIAN = Math.PI / 180
function renderLabel({ cx, cy, midAngle, innerRadius, outerRadius, percent }: any) {
  if (percent < 0.07) return null
  const radius = innerRadius + (outerRadius - innerRadius) * 0.55
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={11} fontWeight={600}>
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export default function ScoreOrigins({ data, teamName = 'Us', opponentName = 'Opponent' }: Props) {
  const ownSlices = buildSlices(data.own)
  const oppSlices = buildSlices(data.opp)

  if (data.own.total === 0 && data.opp.total === 0) {
    return (
      <div className="glass-card p-4 flex flex-col gap-3 h-full">
        <div className="flex items-center gap-2">
          <GitBranch size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Score Origins</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No scoring data
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <GitBranch size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white">Score Origins</h3>
      </div>

      <div className="grid grid-cols-2 gap-1 flex-1 min-h-0">
        {[
          { label: teamName, slices: ownSlices, total: data.own.total },
          { label: opponentName, slices: oppSlices, total: data.opp.total },
        ].map(({ label, slices, total }) => (
          <div key={label} className="flex flex-col items-center">
            <div className="text-xs font-semibold text-white/60 mb-1 truncate max-w-full px-1">
              {label} <span className="text-white/40">({total})</span>
            </div>
            {total === 0 ? (
              <div className="flex-1 flex items-center justify-center text-white/30 text-xs">No scores</div>
            ) : (
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie
                    data={slices}
                    cx="50%"
                    cy="50%"
                    innerRadius={30}
                    outerRadius={60}
                    dataKey="value"
                    labelLine={false}
                    label={renderLabel}
                  >
                    {slices.map((s, i) => (
                      <Cell key={i} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                    itemStyle={{ color: '#fff' }}
                    formatter={(val: number) => [val, '']}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {CATEGORIES.map(c => (
          <span key={c.key} className="flex items-center gap-1 text-[11px] text-white/50">
            <span className="w-2 h-2 rounded-full inline-block flex-shrink-0" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}
