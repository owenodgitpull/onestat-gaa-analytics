import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import type { TurnoverSourcePlayer } from '@/services/api'

interface TurnoverLeaderboardProps {
  data: TurnoverSourcePlayer[]
}

export default function TurnoverLeaderboard({ data }: TurnoverLeaderboardProps) {
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
          <p className="text-white font-medium mb-1">{label}</p>
          {payload.map((entry: any, i: number) => (
            <p key={i} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {entry.value}
            </p>
          ))}
        </div>
      )
    }
    return null
  }

  if (data.length === 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Turnover Source Leaderboard</h3>
          <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">Pinned</span>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No defensive action data yet
        </div>
      </div>
    )
  }

  const chartData = data.map(p => ({
    name: p.player_name.split(' ').slice(-1)[0], // Last name for compact display
    fullName: p.player_name,
    Interceptions: p.interceptions,
    Blocks: p.blocks,
    'Turnovers Won': p.turnovers_won,
  }))

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Turnover Source Leaderboard</h3>
        <span className="text-xs bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">Pinned</span>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
          <XAxis
            type="number"
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 11 }}
          />
          <YAxis
            type="category"
            dataKey="name"
            stroke="rgba(255,255,255,0.5)"
            tick={{ fill: 'rgba(255,255,255,0.9)', fontSize: 12 }}
            width={80}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}
          />
          <Bar dataKey="Interceptions" stackId="stack" fill="#06b6d4" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Blocks" stackId="stack" fill="#6366f1" radius={[0, 0, 0, 0]} />
          <Bar dataKey="Turnovers Won" stackId="stack" fill="#10b981" radius={[0, 6, 6, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
