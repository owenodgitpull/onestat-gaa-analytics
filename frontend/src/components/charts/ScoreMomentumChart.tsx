import { useState, useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts'
import { TrendingUp } from 'lucide-react'
import type { ScoreTimelineData } from '@/services/api'

interface Props {
  data: ScoreTimelineData
}

type FilterType = 'all' | 'from_play' | 'dead_ball'

export default function ScoreMomentumChart({ data }: Props) {
  const matchIds = Object.keys(data.per_match)
  const [selectedMatch, setSelectedMatch] = useState(matchIds[matchIds.length - 1] || '')
  const [filter, setFilter] = useState<FilterType>('all')

  const matchData = data.per_match[selectedMatch]

  const chartData = useMemo(() => {
    if (!matchData) return []

    let events = matchData.events
    if (filter === 'from_play') {
      events = events.filter(e => e.is_from_play)
    } else if (filter === 'dead_ball') {
      events = events.filter(e => !e.is_from_play)
    }

    // Recalculate cumulative diff for filtered events
    let cumDiff = 0
    const points = [{ minute: 0, cumulative_diff: 0, event: null as typeof events[0] | null }]

    for (const e of events) {
      if (e.team === 'own') {
        cumDiff += e.value
      } else {
        cumDiff -= e.value
      }
      points.push({ minute: e.minute, cumulative_diff: cumDiff, event: e })
    }

    return points
  }, [matchData, filter])

  const { summary } = data

  if (matchIds.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40">
        No score timeline data available
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <TrendingUp size={20} />
          Score Momentum
        </h3>
        <div className="flex items-center gap-2">
          {/* Filter buttons */}
          <div className="flex rounded-lg overflow-hidden border border-white/10">
            {(['all', 'from_play', 'dead_ball'] as FilterType[]).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === f
                    ? 'bg-white/20 text-white'
                    : 'text-white/50 hover:text-white/70'
                }`}
              >
                {f === 'all' ? 'All' : f === 'from_play' ? 'Play' : 'Dead Ball'}
              </button>
            ))}
          </div>

          {/* Match selector */}
          <select
            value={selectedMatch}
            onChange={e => setSelectedMatch(e.target.value)}
            className="bg-white/10 border border-white/10 rounded-lg px-2 py-1 text-xs text-white"
          >
            {matchIds.map(id => (
              <option key={id} value={id} className="bg-slate-800">
                vs {data.per_match[id].opponent}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-white/40 text-xs mb-3">
        Running score difference by the minute — above the line is ahead, below is behind.
      </p>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
            <defs>
              <linearGradient id="scoreMomentumGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                <stop offset="50%" stopColor="#10b981" stopOpacity={0} />
                <stop offset="50%" stopColor="#ef4444" stopOpacity={0} />
                <stop offset="100%" stopColor="#ef4444" stopOpacity={0.4} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis
              dataKey="minute"
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
              label={{ value: 'Minute', position: 'insideBottom', offset: -2, fill: 'rgba(255,255,255,0.3)', fontSize: 10 }}
            />
            <YAxis
              stroke="rgba(255,255,255,0.3)"
              tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1e293b',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: 12,
              }}
              formatter={(value: number) => [
                value > 0 ? `+${value} ahead` : value < 0 ? `${value} behind` : 'Level',
                'Score Diff',
              ]}
              labelFormatter={v => `Minute ${v}`}
            />
            <ReferenceLine y={0} stroke="rgba(255,255,255,0.3)" strokeDasharray="4 4" />
            <ReferenceLine x={35} stroke="rgba(255,255,255,0.2)" strokeDasharray="6 3" label={{ value: 'HT', fill: 'rgba(255,255,255,0.4)', fontSize: 10 }} />
            <Area
              type="monotone"
              dataKey="cumulative_diff"
              stroke="#10b981"
              fill="url(#scoreMomentumGrad)"
              strokeWidth={2}
              dot={(props: any) => {
                const { cx, cy, payload } = props
                if (!payload.event) return <circle key={`dot-${props.index}`} cx={0} cy={0} r={0} />
                const isGoal = payload.event.value >= 3
                return (
                  <circle
                    key={`dot-${props.index}`}
                    cx={cx}
                    cy={cy}
                    r={isGoal ? 5 : 3}
                    fill={payload.event.team === 'own' ? '#10b981' : '#ef4444'}
                    stroke="white"
                    strokeWidth={1}
                  />
                )
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Metric pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Avg HT Lead: <span className="text-white font-medium">{summary.avg_ht_lead > 0 ? '+' : ''}{summary.avg_ht_lead} pts</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Longest Drought: <span className="text-white font-medium">{summary.longest_drought_mins} min</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Final 10 Scores: <span className="text-white font-medium">{summary.scores_final_10}</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Best Period: <span className="text-white font-medium">{summary.best_period}</span>
        </span>
      </div>
    </div>
  )
}
