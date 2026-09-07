import type { LucideIcon } from 'lucide-react'
import type { LeaderboardEntry, LeaderboardContext } from '../../services/playerPortalApi'

interface LeaderboardCategoryViewProps {
  board: LeaderboardContext | undefined
  ranking: LeaderboardEntry[]
  isLoading: boolean
  myPlayerId: string | null | undefined
  categoryKey: string
  icon: LucideIcon
  color: string
  emptyMessage: string
  /** Shown under the ranking when the list is short for a data-quality reason
   * (e.g. Clinical's 10-shot minimum) — omit for categories with no such caveat. */
  qualificationNote?: string
}

const MEDAL_GRADIENTS = [
  'linear-gradient(135deg, #fbbf24, #f59e0b)', // Gold
  'linear-gradient(135deg, #d1d5db, #9ca3af)', // Silver
  'linear-gradient(135deg, #d97706, #b45309)', // Bronze
]

/**
 * Podium + full-ranking view for one leaderboard category. Extracted from
 * LeaderboardPage.tsx so the same "Attendance Ladder" presentation (podium,
 * medal colors, rank-change badges) can be pinned to a single category
 * (iron_man) inside the Training section without pulling in the category
 * tab-switcher chrome that page also has.
 */
export default function LeaderboardCategoryView({
  board, ranking, isLoading, myPlayerId, categoryKey, icon: Icon, color, emptyMessage, qualificationNote,
}: LeaderboardCategoryViewProps) {
  const prevRanks: Record<string, number | null> = (() => {
    try {
      return JSON.parse(localStorage.getItem('leaderboard_ranks') || '{}')
    } catch {
      return {}
    }
  })()

  if (isLoading) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-40 rounded-2xl bg-white/5" />
        {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-14 rounded-xl bg-white/5" />)}
      </div>
    )
  }

  if (ranking.length === 0) {
    return (
      <div className="text-center py-12">
        <Icon size={40} className="mx-auto mb-3" style={{ color: `${color}40` }} />
        <p className="text-white/50 text-sm font-medium mb-1">No data yet</p>
        <p className="text-white/30 text-xs max-w-[260px] mx-auto">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <>
      {/* Podium — Top 3 */}
      {board && board.top_3.length >= 3 && (
        <div className="flex items-end justify-center gap-3 pt-4 pb-2">
          <PodiumCard entry={board.top_3[1]} medal={1} unit={board.unit} color={color} />
          <PodiumCard entry={board.top_3[0]} medal={0} unit={board.unit} color={color} featured />
          <PodiumCard entry={board.top_3[2]} medal={2} unit={board.unit} color={color} />
        </div>
      )}

      {/* Full Ranking */}
      <div className="space-y-1.5">
        {ranking.map((entry) => {
          const isMe = entry.player_id === myPlayerId
          const prevRank = prevRanks[categoryKey]
          const rankChange = isMe && prevRank && board?.my_rank
            ? prevRank - board.my_rank
            : 0

          return (
            <div
              key={entry.player_id}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-3 transition-all ${
                isMe ? 'ring-1 ring-emerald-500/40 shadow-lg shadow-emerald-500/10' : ''
              }`}
              style={{
                background: isMe
                  ? 'linear-gradient(135deg, rgba(0,230,118,0.15), rgba(0,176,255,0.08))'
                  : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
                border: isMe ? undefined : '1px solid rgba(255,255,255,0.06)',
              }}
            >
              {/* Rank */}
              <div className={`w-8 text-center font-bold ${entry.rank <= 3 ? 'text-amber-400' : isMe ? 'text-emerald-400' : 'text-white/40'}`}>
                {entry.rank <= 3 ? (
                  <span className="text-lg">{['🥇', '🥈', '🥉'][entry.rank - 1]}</span>
                ) : (
                  entry.rank
                )}
              </div>

              {/* Name */}
              <div className="flex-1 min-w-0">
                <div className={`text-sm font-medium truncate ${isMe ? 'text-white' : 'text-white/80'}`}>
                  {entry.player_name}
                  {isMe && <span className="text-emerald-400 ml-1 text-xs">(You)</span>}
                </div>
                {entry.detail && (
                  <div className="text-[11px] text-white/40 truncate">{entry.detail}</div>
                )}
              </div>

              {/* Value */}
              <div className="text-right">
                <div className={`text-sm font-bold ${isMe ? 'text-emerald-400' : 'text-white'}`}>
                  {typeof entry.value === 'number' ? (
                    Number.isInteger(entry.value) ? entry.value : entry.value.toFixed(1)
                  ) : entry.value}
                </div>
                <div className="text-[10px] text-white/30">{board?.unit}</div>
              </div>

              {/* Rank change */}
              {isMe && rankChange !== 0 && (
                <div className={`text-xs font-bold ${rankChange > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {rankChange > 0 ? `+${rankChange}` : rankChange}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {qualificationNote && ranking.length > 0 && ranking.length < 5 && (
        <p className="text-[11px] text-white/25 text-center mt-2">{qualificationNote}</p>
      )}
    </>
  )
}

function PodiumCard({
  entry, medal, unit, color, featured,
}: {
  entry: LeaderboardEntry
  medal: number
  unit: string
  color: string
  featured?: boolean
}) {
  const heights = ['h-28', 'h-24', 'h-20']
  return (
    <div className={`flex flex-col items-center ${featured ? 'w-28' : 'w-24'}`}>
      {/* Avatar */}
      <div
        className={`${featured ? 'w-14 h-14' : 'w-11 h-11'} rounded-full flex items-center justify-center mb-2 shadow-lg`}
        style={{ background: MEDAL_GRADIENTS[medal] }}
      >
        <span className={`font-bold text-white ${featured ? 'text-lg' : 'text-sm'}`}>
          {entry.player_name.split(' ').map(n => n[0]).join('').slice(0, 2)}
        </span>
      </div>
      <div className={`text-xs font-medium text-white/80 text-center truncate w-full ${featured ? 'mb-1' : ''}`}>
        {entry.player_name.split(' ')[0]}
      </div>
      <div className="text-sm font-bold text-white">
        {typeof entry.value === 'number' && !Number.isInteger(entry.value) ? entry.value.toFixed(1) : entry.value}
      </div>
      <div className="text-[10px] text-white/40">{unit}</div>
      {/* Podium bar */}
      <div
        className={`w-full ${heights[medal]} rounded-t-lg mt-2`}
        style={{
          background: `linear-gradient(180deg, ${color}30, ${color}10)`,
          borderTop: `2px solid ${color}60`,
        }}
      />
    </div>
  )
}
