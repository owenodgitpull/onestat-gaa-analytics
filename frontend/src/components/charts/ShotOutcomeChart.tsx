import { useState, useMemo } from 'react'
import { PieChart as PieChartIcon } from 'lucide-react'
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts'
import { useClubName } from '@/contexts/ClubContext'

interface ShotOutcomeChartProps {
  events: any[]
  opponent: string
  insight?: string
  insightLoading?: boolean
}

export default function ShotOutcomeChart({ events, opponent, insight, insightLoading = false }: ShotOutcomeChartProps) {
  const clubName = useClubName()
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')

  const outcomeData = useMemo(() => {
    const outcomes = { Goals: 0, Points: 0, Wides: 0, Shorts: 0, Saved: 0, 'Hit Post': 0 }

    events.forEach((e: any) => {
      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== selectedTeam) return

      switch (e.event_type) {
        case 'goal': outcomes.Goals++; break
        case 'point':
        case 'point_free': outcomes.Points++; break
        case 'two_point':
        case 'two_point_free': outcomes.Points++; break
        case 'wide':
        case 'wide_free': outcomes.Wides++; break
        case 'short': outcomes.Shorts++; break
        case 'saved': outcomes.Saved++; break
        case 'hit_post': outcomes['Hit Post']++; break
      }
    })

    const colors = {
      Goals: '#10b981', Points: '#06b6d4', Wides: '#f59e0b', Shorts: '#ef4444', Saved: '#14b8a6', 'Hit Post': '#8b5cf6'
    }

    return Object.entries(outcomes)
      .filter(([_, value]) => value > 0)
      .map(([name, value]) => ({ name, value, fill: colors[name as keyof typeof colors] }))
  }, [events, selectedTeam])

  const totalShots = outcomeData.reduce((sum, d) => sum + d.value, 0)

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <PieChartIcon size={20} />
        Shot Outcomes
      </h3>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setSelectedTeam('own')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedTeam === 'own' ? 'bg-orange-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          {clubName}
        </button>
        <button
          onClick={() => setSelectedTeam('opponent')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            selectedTeam === 'opponent' ? 'bg-orange-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          {opponent}
        </button>
      </div>

      {totalShots > 0 ? (
        <>
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={outcomeData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} paddingAngle={2} dataKey="value">
                  {outcomeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip
                  trigger="click"
                  contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {outcomeData.map((item) => (
              <div key={item.name} className="flex items-center gap-1 text-xs">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }}></span>
                <span className="text-white/60">{item.name}: {item.value}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="h-[160px] flex items-center justify-center text-white/40 text-sm">
          No shot data available
        </div>
      )}

      {insight ? (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/15 to-amber-600/15 border border-orange-500/30">
          <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
        </div>
      ) : insightLoading ? (
        <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 animate-pulse">
          <div className="h-3 bg-white/10 rounded w-3/4 mb-1.5" />
          <div className="h-3 bg-white/10 rounded w-1/2" />
        </div>
      ) : null}
    </div>
  )
}
