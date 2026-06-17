import { useMemo, useState } from 'react'
import { Clock } from 'lucide-react'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, LineChart, Line, ReferenceLine } from 'recharts'

interface ScoringTimelineProps {
  events: any[]
  opponent: string
  teamName?: string
  insight?: string
  insightLoading?: boolean
}

const SCORING_TYPES = new Set(['goal', 'point', 'two_point', 'point_free', 'two_point_free'])

function scoreValue(eventType: string): number {
  if (eventType === 'goal') return 3
  if (eventType === 'two_point' || eventType === 'two_point_free') return 2
  return 1
}

export default function ScoringTimeline({ events, opponent, teamName = 'Own', insight, insightLoading = false }: ScoringTimelineProps) {
  const [mode, setMode] = useState<'bars' | 'line'>('bars')

  const timelineData = useMemo(() => {
    const intervals: Record<string, { own: number; opponent: number }> = {}

    for (let i = 0; i <= 70; i += 10) {
      const label = i === 70 ? '70+' : `${i}-${i + 9}`
      intervals[label] = { own: 0, opponent: 0 }
    }

    events.forEach((e: any) => {
      if (!SCORING_TYPES.has(e.event_type)) return

      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      const minute = e.minute || 0
      const intervalIdx = Math.min(Math.floor(minute / 10), 7)
      const label = intervalIdx === 7 ? '70+' : `${intervalIdx * 10}-${intervalIdx * 10 + 9}`
      intervals[label][team as 'own' | 'opponent'] += scoreValue(e.event_type)
    })

    return Object.entries(intervals).map(([name, data]) => ({
      name,
      [teamName]: data.own,
      [opponent]: data.opponent
    }))
  }, [events, opponent, teamName])

  const lineData = useMemo(() => {
    const scoringEvts = events
      .filter(e => SCORING_TYPES.has(e.event_type))
      .sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))

    let ownTotal = 0
    let oppTotal = 0
    const points: { minute: number; own: number; opp: number }[] = [{ minute: 0, own: 0, opp: 0 }]

    for (const e of scoringEvts) {
      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      const minute = e.minute ?? 0
      if (team === 'own') ownTotal += scoreValue(e.event_type)
      else oppTotal += scoreValue(e.event_type)
      points.push({ minute, own: ownTotal, opp: oppTotal })
    }

    const last = points[points.length - 1]
    if (last.minute < 80) points.push({ minute: 80, own: last.own, opp: last.opp })

    return points
  }, [events])

  return (
    <div className="glass-card p-4">
      <div className="flex items-center mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Clock size={20} />
          Scoring Timeline
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-white/10 ml-auto">
          {(['bars', 'line'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${mode === m ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'}`}>
              {m === 'bars' ? 'Bars' : 'Line'}
            </button>
          ))}
        </div>
      </div>

      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          {mode === 'bars' ? (
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
          ) : (
            <LineChart data={lineData}>
              <XAxis dataKey="minute" stroke="#9ca3af" fontSize={10} label={{ value: 'min', position: 'insideRight', offset: -4, fill: '#9ca3af', fontSize: 9 }} />
              <YAxis stroke="#9ca3af" fontSize={10} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#fff' }}
                formatter={(value: number, name: string) => [value, name === 'own' ? teamName : opponent]}
                labelFormatter={(label: number) => `${label}'`}
              />
              <ReferenceLine x={40} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4" />
              <Line type="stepAfter" dataKey="own" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} name={teamName} />
              <Line type="stepAfter" dataKey="opp" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} name={opponent} />
            </LineChart>
          )}
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
