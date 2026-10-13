import { TrendingUp } from 'lucide-react'
import type { AttackEfficiencyData } from '../../services/api'

interface Props {
  data: AttackEfficiencyData
  teamName?: string
  opponentName?: string
}

function EfficiencyRow({
  label,
  attacks,
  shots,
  withShot,
  playShots,
  deadBallShots,
  pct,
  color,
}: {
  label: string
  attacks: number
  shots: number
  withShot?: number
  playShots?: number
  deadBallShots?: number
  pct: number
  color: string
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-white truncate max-w-[50%]">{label}</span>
        <span className="text-white/50">
          {withShot != null ? `${withShot} of ${attacks} attacks ended in a shot (${playShots ?? shots} from play)` : `${attacks} attacks → ${shots} shots`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${Math.min(pct, 100)}%`, background: color }}
          />
        </div>
        <span className="text-xs font-bold text-white w-10 text-right">{pct.toFixed(0)}%</span>
      </div>
      {deadBallShots != null && (
        <div className="text-[11px] text-white/40">
          Frees &amp; 45s: {deadBallShots} shot{deadBallShots === 1 ? '' : 's'} (kept separate from open play)
        </div>
      )}
    </div>
  )
}

export default function AttackEfficiencyCard({ data, teamName = 'Us', opponentName = 'Opponent' }: Props) {
  if (data.own.attacks === 0 && data.opp.attacks === 0) {
    return (
      <div className="glass-card p-4 flex flex-col gap-3 h-full">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-emerald-400" />
          <h3 className="text-sm font-bold text-white">Attack Efficiency</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No possession data recorded
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-4 flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2">
        <TrendingUp size={16} className="text-emerald-400" />
        <h3 className="text-sm font-bold text-white">Attack Efficiency</h3>
      </div>

      <div className="space-y-4 flex-1">
        <EfficiencyRow
          label={teamName}
          attacks={data.own.attacks}
          shots={data.own.shots}
          withShot={data.own.attacks_with_shot}
          playShots={data.own.shots_from_play}
          deadBallShots={data.own.dead_ball_shots}
          pct={data.own.attack_to_shot_pct}
          color="#10b981"
        />
        <EfficiencyRow
          label={opponentName}
          attacks={data.opp.attacks}
          shots={data.opp.shots}
          withShot={data.opp.attacks_with_shot}
          playShots={data.opp.shots_from_play}
          deadBallShots={data.opp.dead_ball_shots}
          pct={data.opp.attack_to_shot_pct}
          color="#f97316"
        />
      </div>

      <div className="pt-2 border-t border-white/10">
        <div className="text-xs text-white/40">
          Open-play attacks only: the share that produced a shot from play. Frees and 45s are shown separately.
        </div>
        {data.estimated && (
          <div className="text-[11px] text-white/30 mt-1">* attacks estimated from shot data</div>
        )}
      </div>
    </div>
  )
}
