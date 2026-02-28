import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip } from 'recharts'

interface ScoringTimelineProps {
  events: any[]
  opponent: string
  teamName?: string
  insight?: string
}

export default function ScoringTimeline({ events, opponent, teamName = 'Own', insight }: ScoringTimelineProps) {
  const timelineData = useMemo(() => {
    const intervals: Record<string, { own: number; opponent: number }> = {}

    for (let i = 0; i <= 70; i += 10) {
      const label = i === 70 ? '70+' : `${i}-${i + 9}`
      intervals[label] = { own: 0, opponent: 0 }
    }

    const scoringEvents = ['goal', 'point', 'two_point', 'point_free', 'two_point_free']

    events.forEach((e: any) => {
      if (!scoringEvents.includes(e.event_type)) return

      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      const minute = e.minute || 0
      const intervalIdx = Math.min(Math.floor(minute / 10), 7)
      const label = intervalIdx === 7 ? '70+' : `${intervalIdx * 10}-${intervalIdx * 10 + 9}`

      let value = 1
      if (e.event_type === 'goal') value = 3
      else if (e.event_type === 'two_point' || e.event_type === 'two_point_free') value = 2

      intervals[label][team as 'own' | 'opponent'] += value
    })

    return Object.entries(intervals).map(([name, data]) => ({
      name,
      [teamName]: data.own,
      [opponent]: data.opponent
    }))
  }, [events, opponent])

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
        <Clock size={20} />
        Scoring Timeline
      </h3>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={timelineData} barGap={0}>
            <XAxis dataKey="name" stroke="#9ca3af" fontSize={10} />
            <YAxis stroke="#9ca3af" fontSize={10} />
            <Tooltip
              trigger="click"
              contentStyle={{
                backgroundColor: '#1e293b',
                border: 'none',
                borderRadius: '8px',
                color: '#fff'
              }}
            />
            <Bar dataKey={teamName} fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey={opponent} fill="#f97316" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="flex justify-center gap-6 mt-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-emerald-500"></span>
          <span className="text-white/60">{teamName}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded bg-orange-500"></span>
          <span className="text-white/60">{opponent}</span>
        </div>
      </div>

      {insight && (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/15 to-amber-600/15 border border-orange-500/30">
          <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
        </div>
      )}
    </div>
  )
}
