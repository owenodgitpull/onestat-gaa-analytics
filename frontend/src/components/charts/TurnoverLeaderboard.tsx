import type { TurnoverSourcePlayer } from '@/services/api'

interface TurnoverLeaderboardProps {
  data: TurnoverSourcePlayer[]
}

export default function TurnoverLeaderboard({ data }: TurnoverLeaderboardProps) {
  if (data.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Turnover Kings</h3>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No defensive action data yet
        </div>
      </div>
    )
  }

  // Sort by total descending (should already be, but ensure)
  const sorted = [...data].sort((a, b) => (b.interceptions + b.blocks + b.turnovers_won) - (a.interceptions + a.blocks + a.turnovers_won))
  const topTotal = sorted[0] ? sorted[0].interceptions + sorted[0].blocks + sorted[0].turnovers_won : 1

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-white">Turnover Kings</h3>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[2rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-x-1 text-xs text-white/40 border-b border-white/10 pb-2 mb-1 px-1">
        <span className="text-center">#</span>
        <span>Player</span>
        <span className="text-center text-cyan-400/70">INT</span>
        <span className="text-center text-emerald-400/70">BLK</span>
        <span className="text-center text-emerald-400/70">T/O</span>
        <span className="text-center text-white/60">TOT</span>
      </div>

      {/* Table rows — scrollable when many players */}
      <div className="space-y-0.5 overflow-y-auto max-h-[360px] flex-1">
        {sorted.map((p, i) => {
          const total = p.interceptions + p.blocks + p.turnovers_won
          const barWidth = topTotal > 0 ? (total / topTotal) * 100 : 0
          const isTop3 = i < 3

          return (
            <div
              key={p.player_id}
              className="relative grid grid-cols-[2rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-x-1 items-center rounded-lg px-1 py-2 group hover:bg-white/5 transition-colors"
            >
              {/* Background bar */}
              <div
                className="absolute inset-y-0 left-0 rounded-lg opacity-[0.07]"
                style={{
                  width: `${barWidth}%`,
                  backgroundColor: i === 0 ? '#fbbf24' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7f32' : '#10b981',
                }}
              />

              {/* Rank */}
              <span className={`text-center text-sm font-bold relative ${
                i === 0 ? 'text-yellow-400' : i === 1 ? 'text-slate-300' : i === 2 ? 'text-amber-600' : 'text-white/30'
              }`}>
                {i + 1}
              </span>

              {/* Player name */}
              <span className={`relative truncate ${isTop3 ? 'text-white font-medium' : 'text-white/70'} text-sm`}>
                {p.player_name}
              </span>

              {/* Interceptions */}
              <span className={`text-center relative text-sm ${p.interceptions > 0 ? 'text-cyan-400 font-semibold' : 'text-white/20'}`}>
                {p.interceptions}
              </span>

              {/* Blocks */}
              <span className={`text-center relative text-sm ${p.blocks > 0 ? 'text-emerald-400 font-semibold' : 'text-white/20'}`}>
                {p.blocks}
              </span>

              {/* Turnovers Won */}
              <span className={`text-center relative text-sm ${p.turnovers_won > 0 ? 'text-emerald-400 font-semibold' : 'text-white/20'}`}>
                {p.turnovers_won}
              </span>

              {/* Total */}
              <span className={`text-center relative text-sm font-bold ${isTop3 ? 'text-white' : 'text-white/50'}`}>
                {total}
              </span>
            </div>
          )
        })}
      </div>

      {/* Summary footer */}
      <div className="grid grid-cols-[2rem_1fr_3.5rem_3.5rem_3.5rem_3.5rem] gap-x-1 text-xs text-white/40 border-t border-white/10 mt-2 pt-2 px-1">
        <span />
        <span className="font-medium">Team Total</span>
        <span className="text-center text-cyan-400/60 font-semibold">
          {data.reduce((s, p) => s + p.interceptions, 0)}
        </span>
        <span className="text-center text-emerald-400/60 font-semibold">
          {data.reduce((s, p) => s + p.blocks, 0)}
        </span>
        <span className="text-center text-emerald-400/60 font-semibold">
          {data.reduce((s, p) => s + p.turnovers_won, 0)}
        </span>
        <span className="text-center text-white/50 font-bold">
          {data.reduce((s, p) => s + p.interceptions + p.blocks + p.turnovers_won, 0)}
        </span>
      </div>
    </div>
  )
}
