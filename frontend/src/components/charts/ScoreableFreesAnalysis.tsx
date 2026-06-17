import { AlertTriangle } from 'lucide-react'
import type { ScoreableFreesData } from '../../services/api'

const toSvgX = (pct: number) => (pct / 100) * 1960 + 183
const toSvgY = (pct: number) => (pct / 100) * 1167 + 123
const VB_W = 2332, VB_H = 1446

interface Props {
  data: ScoreableFreesData
  teamName?: string
}

export default function ScoreableFreesAnalysis({ data, teamName: _teamName = 'Us' }: Props) {
  if (data.fouls_total === 0) {
    return (
      <div className="glass-card p-4 flex flex-col gap-3 h-full">
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className="text-amber-400" />
          <h3 className="text-sm font-bold text-white">Scoreable Frees</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No foul data recorded
        </div>
      </div>
    )
  }

  const highRange = data.fouls_in_scoring_range > 5
  const highConvert = data.conversion_rate_pct > 50

  return (
    <div className="glass-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center gap-2">
        <AlertTriangle size={16} className="text-amber-400" />
        <h3 className="text-sm font-bold text-white">Scoreable Frees</h3>
      </div>

      <div className="flex flex-wrap gap-2">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Fouls Conceded: <span className="text-white font-semibold">{data.fouls_total}</span>
        </span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${highRange ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white/70'}`}>
          In Scoring Range: <span className="font-bold">{data.fouls_in_scoring_range}</span>
        </span>
        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${highConvert ? 'bg-red-500/20 text-red-400' : 'bg-white/10 text-white/70'}`}>
          Converted: {data.opponent_conversions}/{data.fouls_in_scoring_range} ({data.conversion_rate_pct.toFixed(0)}%)
        </span>
      </div>

      {data.foul_locations.length > 0 && (
        <div className="relative">
          <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto rounded-lg" style={{ background: '#2d5016' }}>
            <image href="/pitch-svg.svg" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />
            {data.foul_locations.map((f, i) => {
              const cx = toSvgX(f.pitch_x)
              const cy = toSvgY(f.pitch_y)
              const fill = !f.in_range ? '#10b981' : f.converted ? '#ef4444' : '#f59e0b'
              return (
                <g key={i}>
                  <circle cx={cx} cy={cy} r={30} fill={fill} opacity={0.85} stroke="white" strokeWidth={4} />
                </g>
              )
            })}
          </svg>
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5 justify-center">
            {[
              { color: '#10b981', label: 'Out of range' },
              { color: '#f59e0b', label: 'In range (not converted)' },
              { color: '#ef4444', label: 'In range (converted)' },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1 text-[11px] text-white/50">
                <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
                {label}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-white/50 mt-auto">
        {data.fouls_in_scoring_range} of {data.fouls_total} fouls were in scoring range. Opponent converted {data.conversion_rate_pct.toFixed(0)}%.
      </p>
    </div>
  )
}
