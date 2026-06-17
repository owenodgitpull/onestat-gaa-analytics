import { BarChart3 } from 'lucide-react'
import { BarChart, Bar, ResponsiveContainer, Cell, Tooltip } from 'recharts'
import type { SeasonBenchmarkData } from '../../services/api'

interface Props {
  data: SeasonBenchmarkData
  teamName?: string
}

interface StatRowProps {
  label: string
  current: number
  avg: number
  higherIsBetter: boolean
  isPercent?: boolean
}

function StatRow({ label, current, avg, higherIsBetter, isPercent }: StatRowProps) {
  const delta = current - avg
  const better = higherIsBetter ? delta > 0 : delta < 0
  const worse = higherIsBetter ? delta < 0 : delta > 0
  const fmt = (v: number) => isPercent ? `${v.toFixed(1)}%` : v.toFixed(1)
  const deltaStr = delta > 0 ? `+${fmt(delta)}` : fmt(delta)

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1.5 border-t border-white/[0.06] first:border-0">
      <span className="text-xs text-white/60">{label}</span>
      <span className="text-sm font-bold text-white tabular-nums">{fmt(current)}</span>
      <span className={`text-xs font-semibold tabular-nums w-14 text-right ${better ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-white/40'}`}>
        {deltaStr}
      </span>
    </div>
  )
}

export default function SeasonBenchmarkCard({ data, teamName: _teamName = 'Us' }: Props) {
  if (data.match_count < 2) {
    return (
      <div className="glass-card p-4 flex flex-col gap-3 h-full">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">vs Season Average ({data.match_count} matches)</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          Need at least 2 matches to benchmark
        </div>
      </div>
    )
  }

  const stats: StatRowProps[] = [
    { label: 'Scores', current: data.current.scores, avg: data.season_avg.scores, higherIsBetter: true },
    { label: 'Conceded', current: data.current.conceded, avg: data.season_avg.conceded, higherIsBetter: false },
    { label: 'Shots', current: data.current.shots, avg: data.season_avg.shots, higherIsBetter: true },
    { label: 'Wides', current: data.current.wides, avg: data.season_avg.wides, higherIsBetter: false },
    { label: 'Turnovers Won', current: data.current.turnovers_won, avg: data.season_avg.turnovers_won, higherIsBetter: true },
    { label: 'Kickout Ret. %', current: data.current.kickout_retention_pct, avg: data.season_avg.kickout_retention_pct, higherIsBetter: true, isPercent: true },
  ]

  const trendMatches = data.trend.slice(-4)
  const hasSparkline = trendMatches.length >= 2

  return (
    <div className="glass-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">vs Season Average</h3>
        </div>
        <span className="text-[11px] text-white/40">{data.match_count} matches</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-1">
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Stat</span>
        <span className="text-[10px] text-white/30 uppercase tracking-wider">This Match</span>
        <span className="text-[10px] text-white/30 uppercase tracking-wider w-14 text-right">vs Avg</span>
      </div>

      <div className="flex-1">
        {stats.map(s => (
          <StatRow key={s.label} {...s} />
        ))}
      </div>

      {hasSparkline && (
        <div className="pt-2 border-t border-white/10">
          <div className="text-[11px] text-white/40 mb-1.5">Last {trendMatches.length} matches — scores</div>
          <div className="flex items-end gap-1.5">
            <div className="flex-1">
              <ResponsiveContainer width="100%" height={48}>
                <BarChart data={trendMatches} barCategoryGap="20%">
                  <Tooltip
                    contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '4px 8px' }}
                    itemStyle={{ color: '#fff', fontSize: 11 }}
                    labelFormatter={(_, payload) => payload?.[0]?.payload?.opponent ?? ''}
                    formatter={(val: number) => [val, 'Scores']}
                  />
                  <Bar dataKey="scores" radius={[2, 2, 0, 0]}>
                    {trendMatches.map((_, i) => (
                      <Cell key={i} fill={i === trendMatches.length - 1 ? '#10b981' : '#334155'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="flex justify-between text-[10px] text-white/30 mt-0.5">
            {trendMatches.map(m => (
              <span key={m.match_id} className="truncate max-w-[25%]">{m.opponent.split(' ')[0]}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
