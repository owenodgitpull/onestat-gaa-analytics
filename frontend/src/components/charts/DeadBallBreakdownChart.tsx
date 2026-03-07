import { useState, useMemo } from 'react'
import { useClubName } from '@/contexts/ClubContext'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts'
import { Target } from 'lucide-react'
import type { DeadBallBreakdownData } from '@/services/api'

interface Props {
  data: DeadBallBreakdownData
}

type ViewMode = 'bar' | 'donut'
type TeamMode = 'own' | 'opponent'

const COLORS = {
  from_play: '#10b981',
  frees: '#3b82f6',
  forty_fives: '#14b8a6',
  penalties: '#f59e0b',
}

export default function DeadBallBreakdownChart({ data }: Props) {
  const clubName = useClubName()
  const [view, setView] = useState<ViewMode>('bar')
  const [team, setTeam] = useState<TeamMode>('own')

  const totals = data.season_totals[team]

  const barData = useMemo(() => {
    const matchIds = Object.keys(data.per_match)
    return matchIds.map(mid => {
      const m = data.per_match[mid]
      const bd = team === 'own' ? m.own : m.opp
      if (!bd) return null
      const fp = bd.from_play.goals * 3 + bd.from_play.points + bd.from_play.two_ptrs * 2
      return {
        opponent: m.opponent,
        from_play: fp,
        frees: bd.frees.scored,
        forty_fives: bd.forty_fives.scored,
        penalties: bd.penalties.scored * 3,
      }
    }).filter(Boolean)
  }, [data, team])

  const donutData = useMemo(() => {
    if (!totals) return []
    const fp = totals.from_play.goals * 3 + totals.from_play.points + totals.from_play.two_ptrs * 2
    return [
      { name: 'From Play', value: fp, color: COLORS.from_play },
      { name: 'Frees', value: totals.frees.scored, color: COLORS.frees },
      { name: '45s', value: totals.forty_fives.scored, color: COLORS.forty_fives },
      { name: 'Penalties', value: totals.penalties.scored * 3, color: COLORS.penalties },
    ].filter(d => d.value > 0)
  }, [totals])

  // Metric pills
  const freeConversion = totals
    ? (totals.frees.scored + totals.frees.missed > 0
      ? Math.round(totals.frees.scored / (totals.frees.scored + totals.frees.missed) * 100)
      : 0)
    : 0
  const deadBallDep = 100 - data.from_play_pct
  const depColor = deadBallDep > 50 ? 'text-red-400' : deadBallDep > 35 ? 'text-amber-400' : 'text-emerald-400'

  if (!totals) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40">
        No scoring breakdown data
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Target size={20} />
          Dead Ball vs Play
        </h3>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['bar', 'donut'] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  view === v ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
                }`}
              >
                {v === 'bar' ? 'Bar' : 'Donut'}
              </button>
            ))}
          </div>
          {/* Team toggle */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['own', 'opponent'] as TeamMode[]).map(t => (
              <button
                key={t}
                onClick={() => setTeam(t)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  team === t ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
                }`}
              >
                {t === 'own' ? clubName : 'Opposition'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        {view === 'bar' ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
              <XAxis
                dataKey="opponent"
                stroke="rgba(255,255,255,0.3)"
                tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
                interval={0}
                angle={-30}
                textAnchor="end"
                height={50}
              />
              <YAxis stroke="rgba(255,255,255,0.3)" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: 12,
                }}
              />
              <Bar dataKey="from_play" stackId="a" fill={COLORS.from_play} name="From Play" radius={[0, 0, 0, 0]} />
              <Bar dataKey="frees" stackId="a" fill={COLORS.frees} name="Frees" />
              <Bar dataKey="forty_fives" stackId="a" fill={COLORS.forty_fives} name="45s" />
              <Bar dataKey="penalties" stackId="a" fill={COLORS.penalties} name="Penalties" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donutData}
                cx="50%"
                cy="50%"
                innerRadius="55%"
                outerRadius="80%"
                paddingAngle={2}
                dataKey="value"
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              >
                {donutData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid rgba(255,255,255,0.2)',
                  borderRadius: '8px',
                  color: '#fff',
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
        {Object.entries(COLORS).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1">
            <div className="w-2.5 h-2.5 rounded" style={{ background: color }} />
            <span className="text-white/50">
              {key === 'from_play' ? 'Play' : key === 'forty_fives' ? '45s' : key.charAt(0).toUpperCase() + key.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Metric pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          From Play: <span className="text-white font-medium">{data.from_play_pct}%</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Free Conversion: <span className="text-white font-medium">{freeConversion}%</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Dead Ball Dep: <span className={`font-medium ${depColor}`}>{deadBallDep.toFixed(0)}%</span>
        </span>
      </div>
    </div>
  )
}
