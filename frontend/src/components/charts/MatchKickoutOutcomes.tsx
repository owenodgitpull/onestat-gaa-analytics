/**
 * Single-match kickout outcomes chart.
 * Shows won clean / won break / lost clean / lost break for own and opponent kickouts.
 */
import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Target } from 'lucide-react'

interface Props {
  events: any[]
  teamName?: string
  opponentName?: string
}

type KickoutMode = 'own' | 'opponent'

interface Outcomes {
  wonClean: number
  wonBreak: number
  lostClean: number
  lostBreak: number
}

const COLORS = {
  wonClean: '#10b981',  // emerald
  wonBreak: '#f59e0b',  // amber
  lostClean: '#ef4444', // red
  lostBreak: '#f97316', // orange
}

function countOutcomes(events: any[], mode: KickoutMode): Outcomes {
  const o: Outcomes = { wonClean: 0, wonBreak: 0, lostClean: 0, lostBreak: 0 }

  for (const e of events) {
    const t = e.event_type
    const team = e.team || (e.is_home_team ? 'own' : 'opponent')

    if (mode === 'own') {
      // Our kickouts — "won" means we retained, "lost" means they got it
      if (t === 'own_kickout_won') o.wonClean++
      else if (t === 'own_kickout_won_break') o.wonBreak++
      else if (t === 'own_kickout_opposition_won') o.lostClean++
      else if (t === 'own_kickout_opposition_won_break') o.lostBreak++
      // Legacy types for own team
      else if (t === 'kickout_won' && team === 'own') o.wonClean++
      else if (t === 'breaking_ball_won' && team === 'own') o.wonBreak++
      else if (t === 'kickout_lost' && team === 'own') o.lostClean++
      else if (t === 'breaking_ball_lost' && team === 'own') o.lostBreak++
    } else {
      // Opponent kickouts — "won" means we won their kickout, "lost" means they retained
      if (t === 'opp_kickout_opposition_won') o.wonClean++
      else if (t === 'opp_kickout_opposition_won_break') o.wonBreak++
      else if (t === 'opp_kickout_won') o.lostClean++
      else if (t === 'opp_kickout_won_break') o.lostBreak++
      // Legacy types for opponent
      else if (t === 'kickout_won' && team === 'opponent') o.lostClean++
      else if (t === 'breaking_ball_won' && team === 'opponent') o.lostBreak++
      else if (t === 'kickout_lost' && team === 'opponent') o.wonClean++
      else if (t === 'breaking_ball_lost' && team === 'opponent') o.wonBreak++
    }
  }
  return o
}

export default function MatchKickoutOutcomes({ events, teamName = 'Our', opponentName = 'Opp' }: Props) {
  const [mode, setMode] = useState<KickoutMode>('own')

  const outcomes = useMemo(() => countOutcomes(events, mode), [events, mode])
  const total = outcomes.wonClean + outcomes.wonBreak + outcomes.lostClean + outcomes.lostBreak
  const totalWon = outcomes.wonClean + outcomes.wonBreak
  const winRate = total > 0 ? Math.round((totalWon / total) * 100) : 0

  if (total === 0 && countOutcomes(events, mode === 'own' ? 'opponent' : 'own').wonClean +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').wonBreak +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').lostClean +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').lostBreak === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No kickout events recorded
      </div>
    )
  }

  const chartData = [
    { name: 'Won Clean', value: outcomes.wonClean, color: COLORS.wonClean },
    { name: 'Won Break', value: outcomes.wonBreak, color: COLORS.wonBreak },
    { name: 'Lost Clean', value: outcomes.lostClean, color: COLORS.lostClean },
    { name: 'Lost Break', value: outcomes.lostBreak, color: COLORS.lostBreak },
  ]

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-white">
          <Target size={18} />
          Kickout Outcomes
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['own', 'opponent'] as KickoutMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
              }`}
            >
              {m === 'own' ? `${teamName} K/O` : `${opponentName} K/O`}
            </button>
          ))}
        </div>
      </div>

      {/* Win rate header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`text-2xl font-bold ${winRate >= 60 ? 'text-emerald-400' : winRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
          {winRate}%
        </div>
        <div className="text-xs text-white/50">
          retention ({totalWon}/{total})
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelStyle={{ color: 'white', fontWeight: 600 }}
              itemStyle={{ color: 'rgba(255,255,255,0.8)' }}
              formatter={(value: number) => [value, 'Count']}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 mt-2">
        {chartData.map(d => (
          <span key={d.name} className="px-2 py-1 rounded-full bg-white/10 text-xs text-white/70 flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            {d.name}: <span className="text-white font-medium">{d.value}</span>
          </span>
        ))}
      </div>
    </div>
  )
}
