import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import type { WorkhorseRadarData } from '@/services/api'

interface WorkhorseRadarProps {
  data: WorkhorseRadarData
}

export default function WorkhorseRadar({ data }: WorkhorseRadarProps) {
  const { metrics, season_avg, last_game, last_game_opponent } = data

  if (metrics.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Workhorse Radar</h3>
        </div>
        <div className="h-[250px] flex items-center justify-center text-white/40">
          No GPS data available
        </div>
      </div>
    )
  }

  const chartData = metrics.map((metric, i) => ({
    metric,
    'Season Avg': season_avg[i],
    'Last Game': last_game[i],
  }))

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 border border-white/20 rounded-lg p-3 shadow-xl">
          <p className="text-white font-medium mb-1">{payload[0].payload.metric}</p>
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

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Workhorse Radar</h3>
        {last_game_opponent && (
          <span className="text-xs text-white/50">
            Last: vs {last_game_opponent}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <RadarChart data={chartData}>
          <PolarGrid stroke="rgba(255,255,255,0.15)" />
          <PolarAngleAxis
            dataKey="metric"
            tick={{ fill: 'rgba(255,255,255,0.7)', fontSize: 10 }}
          />
          <PolarRadiusAxis
            angle={90}
            domain={[0, 100]}
            tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 9 }}
          />
          <Tooltip content={<CustomTooltip />} trigger="click" />
          <Radar
            name="Season Avg"
            dataKey="Season Avg"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.3}
          />
          <Radar
            name="Last Game"
            dataKey="Last Game"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.5}
          />
          <Legend
            wrapperStyle={{ fontSize: 11, color: 'rgba(255,255,255,0.7)' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
