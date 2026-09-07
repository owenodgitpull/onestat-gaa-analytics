import { Scale } from 'lucide-react'

interface PositionalBenchmarkStats {
  matches_played: number
  scoring_per_match: number
  turnovers_won_per_match: number
  turnovers_lost_per_match: number
  blocks_per_match: number
  assists_per_match: number
  shooting_accuracy_pct: number | null
}

interface PlayerPositionalBenchmarkData {
  player_id: string
  position: string | null
  peer_count: number
  player_stats?: PositionalBenchmarkStats | null
  position_avg?: PositionalBenchmarkStats | null
  message?: string | null
}

interface Props {
  data: PlayerPositionalBenchmarkData | null | undefined
}

interface Row {
  label: string
  player: number
  avg: number
  higherIsBetter: boolean
  isPercent?: boolean
}

function StatRow({ label, player, avg, higherIsBetter, isPercent }: Row) {
  const delta = player - avg
  const better = higherIsBetter ? delta > 0 : delta < 0
  const worse = higherIsBetter ? delta < 0 : delta > 0
  const fmt = (v: number) => isPercent ? `${v.toFixed(1)}%` : v.toFixed(2)
  const deltaStr = delta > 0 ? `+${fmt(delta)}` : fmt(delta)

  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 py-1.5 border-t border-white/[0.06] first:border-0">
      <span className="text-xs text-white/60">{label}</span>
      <span className="text-sm font-bold text-white tabular-nums">{fmt(player)}</span>
      <span className={`text-xs font-semibold tabular-nums w-16 text-right ${better ? 'text-emerald-400' : worse ? 'text-red-400' : 'text-white/40'}`}>
        {deltaStr}
      </span>
    </div>
  )
}

const POSITION_LABELS: Record<string, string> = {
  goalkeeper: 'Goalkeepers',
  defender: 'Defenders',
  midfielder: 'Midfielders',
  forward: 'Forwards',
}

export default function PlayerPositionalBenchmark({ data }: Props) {
  if (!data || !data.player_stats || !data.position_avg) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm text-center">
        {data?.message || 'Not enough data to benchmark this player against their position yet'}
      </div>
    )
  }

  const { player_stats: p, position_avg: avg, position, peer_count } = data
  const positionLabel = position ? (POSITION_LABELS[position] || position) : 'peers'

  const rows: Row[] = [
    { label: 'Score / Match', player: p.scoring_per_match, avg: avg.scoring_per_match, higherIsBetter: true },
    { label: 'Turnovers Won / Match', player: p.turnovers_won_per_match, avg: avg.turnovers_won_per_match, higherIsBetter: true },
    { label: 'Turnovers Lost / Match', player: p.turnovers_lost_per_match, avg: avg.turnovers_lost_per_match, higherIsBetter: false },
    { label: 'Blocks / Match', player: p.blocks_per_match, avg: avg.blocks_per_match, higherIsBetter: true },
    { label: 'Assists / Match', player: p.assists_per_match, avg: avg.assists_per_match, higherIsBetter: true },
  ]
  if (p.shooting_accuracy_pct != null && avg.shooting_accuracy_pct != null) {
    rows.push({ label: 'Shooting Accuracy', player: p.shooting_accuracy_pct, avg: avg.shooting_accuracy_pct, higherIsBetter: true, isPercent: true })
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/15">
            <Scale size={16} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white leading-tight">Positional Benchmark</h3>
            <p className="text-xs text-white/40">vs avg {positionLabel.toLowerCase()}</p>
          </div>
        </div>
        <span className="text-[11px] text-white/40">{peer_count} peer{peer_count !== 1 ? 's' : ''}</span>
      </div>

      <div className="grid grid-cols-[1fr_auto_auto] gap-3 pb-1 pt-2">
        <span className="text-[10px] text-white/30 uppercase tracking-wider">Stat</span>
        <span className="text-[10px] text-white/30 uppercase tracking-wider">This Player</span>
        <span className="text-[10px] text-white/30 uppercase tracking-wider w-16 text-right">vs {positionLabel}</span>
      </div>

      <div className="flex-1">
        {rows.map(r => <StatRow key={r.label} {...r} />)}
      </div>
    </div>
  )
}
