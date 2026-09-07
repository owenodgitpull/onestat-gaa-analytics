import { TrendingUp } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { SeasonExpectedPointsData } from '@/services/api'

interface Props {
  data: SeasonExpectedPointsData
  teamName?: string
}

function UnderOverBadge({ value }: { value: number }) {
  const positive = value > 0.5
  const negative = value < -0.5
  const color = positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-white/50'
  const sign = value > 0 ? '+' : ''
  return <span className={`font-semibold ${color}`}>{sign}{value.toFixed(1)}</span>
}

export default function SeasonExpectedPoints({ data, teamName = 'Us' }: Props) {
  if (!data || data.per_match.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} className="text-emerald-400" />
          <h3 className="text-lg font-bold text-white">Expected Points — Season</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No shot location data across coded matches yet
        </div>
      </div>
    )
  }

  const chartData = data.per_match.map((m, i) => ({
    round: `R${i + 1}`,
    opponent: m.opponent,
    'Actual': m.team_actual_points,
    'Expected': m.team_expected_points,
  }))

  const teamUnderOver = data.season_team_actual_points - data.season_team_expected_points
  const oppUnderOver = data.season_opponent_actual_points - data.season_opponent_expected_points

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null
    const match = data.per_match.find((_, i) => `R${i + 1}` === label)
    return (
      <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
        <p className="text-white font-medium mb-1">{match ? `vs ${match.opponent}` : label}</p>
        {payload.map((entry: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
            <span style={{ color: entry.color }}>{entry.name}: {entry.value.toFixed ? entry.value.toFixed(1) : entry.value}</span>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <TrendingUp size={18} className="text-emerald-400" />
        <h3 className="text-lg font-bold text-white">Expected Points — Season</h3>
      </div>

      {/* Season totals */}
      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-lg bg-white/5 border border-white/10 p-3">
          <div className="text-[11px] text-white/50 mb-1">{teamName}</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-white">{data.season_team_actual_points}</span>
            <span className="text-xs text-white/40">actual</span>
          </div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-sm font-semibold text-white/70">{data.season_team_expected_points.toFixed(1)}</span>
            <span className="text-xs text-white/40">expected</span>
          </div>
          <div className="text-xs mt-1"><UnderOverBadge value={teamUnderOver} /> <span className="text-white/40">vs xP</span></div>
        </div>
        <div className="rounded-lg bg-white/5 border border-white/10 p-3">
          <div className="text-[11px] text-white/50 mb-1">Opposition</div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black text-white">{data.season_opponent_actual_points}</span>
            <span className="text-xs text-white/40">actual</span>
          </div>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span className="text-sm font-semibold text-white/70">{data.season_opponent_expected_points.toFixed(1)}</span>
            <span className="text-xs text-white/40">expected</span>
          </div>
          <div className="text-xs mt-1"><UnderOverBadge value={oppUnderOver} /> <span className="text-white/40">vs xP</span></div>
        </div>
      </div>

      {/* Trend line */}
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="round" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
            <Tooltip content={<CustomTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }} />
            <Line type="monotone" dataKey="Actual" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
            <Line type="monotone" dataKey="Expected" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Player leaderboard */}
      {data.players.length > 0 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-white/40 font-medium mb-1.5">Over/Under-Performers (5+ shots)</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-white/40 border-b border-white/10">
                  <th className="text-left font-medium py-1 pr-2">Player</th>
                  <th className="text-right font-medium py-1 px-1">Shots</th>
                  <th className="text-right font-medium py-1 px-1">Pts</th>
                  <th className="text-right font-medium py-1 px-1">xP</th>
                  <th className="text-right font-medium py-1 pl-1">+/-</th>
                </tr>
              </thead>
              <tbody>
                {data.players.slice(0, 8).map(p => (
                  <tr key={p.player_id} className="border-b border-white/5 last:border-0">
                    <td className="py-1 pr-2 text-white/80 truncate max-w-[110px]">{p.player_name}</td>
                    <td className="py-1 px-1 text-right text-white/60">{p.shots}</td>
                    <td className="py-1 px-1 text-right text-white/80">{p.total_pts}</td>
                    <td className="py-1 px-1 text-right text-white/60">{p.expected_points.toFixed(1)}</td>
                    <td className="py-1 pl-1 text-right"><UnderOverBadge value={p.under_over} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
