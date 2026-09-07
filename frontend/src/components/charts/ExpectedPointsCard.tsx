import { useQuery } from '@tanstack/react-query'
import { TrendingUp, Info } from 'lucide-react'
import { matchesAPI } from '@/services/api'

interface Props {
  matchId: string
  teamName?: string
  opponentName?: string
}

// Below this many logged shots (system-wide, per shot group) the model is
// still mostly leaning on its coarse fallback rate rather than real data —
// worth saying so rather than presenting the numbers as fully settled.
const LOW_SAMPLE_THRESHOLD = 40

function UnderOverBadge({ value }: { value: number }) {
  const positive = value > 0.05
  const negative = value < -0.05
  const color = positive ? 'text-emerald-400' : negative ? 'text-red-400' : 'text-white/50'
  const sign = value > 0 ? '+' : ''
  return <span className={`font-semibold ${color}`}>{sign}{value.toFixed(1)}</span>
}

export default function ExpectedPointsCard({ matchId, teamName = 'Us', opponentName = 'Opponent' }: Props) {
  const { data, isLoading } = useQuery({
    queryKey: ['expected-points', matchId],
    queryFn: () => matchesAPI.getExpectedPoints(matchId),
    enabled: !!matchId,
  })

  if (isLoading) {
    return (
      <div className="glass-card p-4 animate-pulse">
        <div className="h-5 w-40 bg-white/10 rounded mb-3" />
        <div className="h-24 bg-white/5 rounded" />
      </div>
    )
  }

  if (!data || (data.team_expected_points === 0 && data.opponent_expected_points === 0)) {
    return (
      <div className="glass-card p-4 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-2">
          <TrendingUp size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Expected Points</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No shot location data for this match yet
        </div>
      </div>
    )
  }

  const totalSample = Object.values(data.model_sample_size || {}).reduce((a, b) => a + b, 0)
  const lowSample = totalSample < LOW_SAMPLE_THRESHOLD

  const marginLeader = data.expected_result_margin > 0 ? teamName
    : data.expected_result_margin < 0 ? opponentName : null

  return (
    <div className="glass-card p-4 h-full flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white">Expected Points</h3>
      </div>

      {/* Team comparison */}
      <div className="grid grid-cols-2 gap-2">
        {[
          { label: teamName, actual: data.team_actual_points, xp: data.team_expected_points, underOver: data.team_under_over },
          { label: opponentName, actual: data.opponent_actual_points, xp: data.opponent_expected_points, underOver: data.opponent_under_over },
        ].map(t => (
          <div key={t.label} className="rounded-lg bg-white/5 border border-white/10 p-3">
            <div className="text-[11px] text-white/50 truncate mb-1">{t.label}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black text-white">{t.actual}</span>
              <span className="text-xs text-white/40">actual</span>
            </div>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-sm font-semibold text-white/70">{t.xp.toFixed(1)}</span>
              <span className="text-xs text-white/40">expected</span>
            </div>
            <div className="text-xs mt-1"><UnderOverBadge value={t.underOver} /> <span className="text-white/40">vs xP</span></div>
          </div>
        ))}
      </div>

      {marginLeader && (
        <div className="text-xs text-white/60 text-center">
          Expected Result: <span className="text-white font-medium">{marginLeader} +{Math.abs(data.expected_result_margin).toFixed(1)}</span>
          <span className="text-white/40"> · Actual: {data.actual_result_margin > 0 ? teamName : data.actual_result_margin < 0 ? opponentName : 'Draw'}
            {data.actual_result_margin !== 0 ? ` +${Math.abs(data.actual_result_margin)}` : ''}
          </span>
        </div>
      )}

      {/* Player breakdown */}
      {data.players.length > 0 && (
        <div className="mt-1 overflow-x-auto">
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
              {data.players.map(p => (
                <tr key={p.player_id ?? p.player_name} className="border-b border-white/5 last:border-0">
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
      )}

      {lowSample && (
        <div className="flex items-start gap-1.5 text-[11px] text-white/40 mt-1">
          <Info size={12} className="flex-shrink-0 mt-0.5" />
          <span>Model still learning ({totalSample} shots logged so far) — these numbers will sharpen as more matches are coded.</span>
        </div>
      )}
    </div>
  )
}
