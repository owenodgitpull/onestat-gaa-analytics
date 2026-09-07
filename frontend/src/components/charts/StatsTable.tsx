import type { MatchStats } from '../../types'

// Matches live match glassmorphic styling — shared between the post-match
// report and the live recording page (see MatchRecording.tsx), so the
// coach sees the exact same table both during and after the game.
function abbreviateTeamName(name: string, maxLen = 12): string {
  if (name.length <= maxLen) return name
  // Try dropping common suffixes first
  const short = name.replace(/\s+(GAA|CLG|GFC|AFC)$/i, '')
  if (short.length <= maxLen) return short
  // Split into words, abbreviate all but the first
  const words = short.split(/\s+/)
  if (words.length >= 2) {
    return words[0] + ' ' + words.slice(1).map(w => w[0].toUpperCase()).join('')
  }
  return name.slice(0, maxLen)
}

export default function StatsTable({ stats, opponent, teamName = 'Us' }: { stats: MatchStats; opponent: string; teamName?: string }) {
  const totalTeamKickouts = stats.team_kickouts_won + stats.team_kickouts_lost
  const totalOpponentKickouts = stats.opponent_kickouts_won + stats.opponent_kickouts_lost
  const teamKickoutRetention = totalTeamKickouts > 0
    ? ((stats.team_kickouts_won / totalTeamKickouts) * 100).toFixed(1)
    : '0.0'
  const opponentKickoutRetention = totalOpponentKickouts > 0
    ? ((stats.opponent_kickouts_won / totalOpponentKickouts) * 100).toFixed(1)
    : '0.0'
  const teamConversion = stats.team_total_shots > 0
    ? ((stats.team_scores / stats.team_total_shots) * 100).toFixed(1)
    : '0.0'
  const opponentConversion = stats.opponent_total_shots > 0
    ? ((stats.opponent_scores / stats.opponent_total_shots) * 100).toFixed(1)
    : '0.0'
  const teamPos = Math.round(stats.team_possession_percentage)
  const opponentPos = stats.team_possession_percentage === 0 && stats.opponent_possession_percentage === 0
    ? 0
    : 100 - teamPos

  const rows = [
    { label: 'Possession', left: `${teamPos}%`, right: `${opponentPos}%`, leftVal: teamPos, rightVal: opponentPos },
    { label: 'Poss. Count', left: stats.team_possession_count ?? 0, right: stats.opponent_possession_count ?? 0, leftVal: stats.team_possession_count ?? 0, rightVal: stats.opponent_possession_count ?? 0 },
    { label: 'Poss. → Shots', left: `${stats.team_poss_converted_to_shots_pct ?? 0}%`, right: `${stats.opponent_poss_converted_to_shots_pct ?? 0}%`, leftVal: stats.team_poss_converted_to_shots_pct ?? 0, rightVal: stats.opponent_poss_converted_to_shots_pct ?? 0 },
    { label: 'Shots', left: stats.team_total_shots, right: stats.opponent_total_shots, leftVal: stats.team_total_shots, rightVal: stats.opponent_total_shots },
    { label: 'Scores', left: stats.team_scores, right: stats.opponent_scores, leftVal: stats.team_scores, rightVal: stats.opponent_scores },
    { label: 'Goal Chances', left: stats.team_goal_chances ?? 0, right: stats.opponent_goal_chances ?? 0, leftVal: stats.team_goal_chances ?? 0, rightVal: stats.opponent_goal_chances ?? 0 },
    { label: 'Wides', left: stats.team_wides, right: stats.opponent_wides, leftVal: stats.opponent_wides, rightVal: stats.team_wides },
    { label: 'Dropped Short', left: stats.team_dropped_short ?? 0, right: stats.opponent_dropped_short ?? 0, leftVal: stats.opponent_dropped_short ?? 0, rightVal: stats.team_dropped_short ?? 0 },
    { label: 'Accuracy', left: `${Math.round(stats.team_accuracy)}%`, right: `${Math.round(stats.opponent_accuracy)}%`, leftVal: stats.team_accuracy, rightVal: stats.opponent_accuracy },
    { label: 'Conversion', left: `${teamConversion}%`, right: `${opponentConversion}%`, leftVal: Number(teamConversion), rightVal: Number(opponentConversion) },
    { label: 'Turnovers Won', left: stats.team_turnovers_won, right: stats.opponent_turnovers_won, leftVal: stats.team_turnovers_won, rightVal: stats.opponent_turnovers_won },
    ...(stats.team_ball_recovery_avg_min != null || stats.opponent_ball_recovery_avg_min != null ? [{
      label: 'Ball Recovery',
      left: stats.team_ball_recovery_avg_min != null ? `${stats.team_ball_recovery_avg_min}m` : '–',
      right: stats.opponent_ball_recovery_avg_min != null ? `${stats.opponent_ball_recovery_avg_min}m` : '–',
      leftVal: stats.opponent_ball_recovery_avg_min ?? 0,
      rightVal: stats.team_ball_recovery_avg_min ?? 0,
    }] : []),
    { label: 'Unforced Errors', left: stats.team_unforced_errors ?? 0, right: stats.opponent_unforced_errors ?? 0, leftVal: stats.opponent_unforced_errors ?? 0, rightVal: stats.team_unforced_errors ?? 0 },
    { label: 'Kickouts Won', left: `${stats.team_kickouts_won}/${totalTeamKickouts}`, right: `${stats.opponent_kickouts_won}/${totalOpponentKickouts}`, leftVal: stats.team_kickouts_won, rightVal: stats.opponent_kickouts_won },
    { label: 'Kickout Ret. %', left: `${teamKickoutRetention}%`, right: `${opponentKickoutRetention}%`, leftVal: parseFloat(teamKickoutRetention), rightVal: parseFloat(opponentKickoutRetention) },
    { label: 'Fouls', left: stats.team_fouls, right: stats.opponent_fouls, leftVal: stats.opponent_fouls, rightVal: stats.team_fouls },
    { label: 'Yellow Cards', left: stats.team_yellow_cards, right: stats.opponent_yellow_cards, leftVal: stats.opponent_yellow_cards, rightVal: stats.team_yellow_cards },
    { label: 'Black Cards', left: stats.team_black_cards ?? 0, right: stats.opponent_black_cards ?? 0, leftVal: stats.opponent_black_cards ?? 0, rightVal: stats.team_black_cards ?? 0 },
    { label: 'Red Cards', left: stats.team_red_cards, right: stats.opponent_red_cards, leftVal: stats.opponent_red_cards, rightVal: stats.team_red_cards },
  ]

  return (
    <div className="rounded-xl border border-white/[0.08] overflow-hidden" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 0 2px 8px rgba(0,0,0,0.3)' }}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-white/[0.06] border-b border-white/[0.08]">
        <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider truncate" title={teamName}>{abbreviateTeamName(teamName)}</div>
        <div className="min-w-[80px]" />
        <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider truncate" title={opponent}>{abbreviateTeamName(opponent)}</div>
      </div>
      {rows.map((row, idx) => {
        const leftWins = row.leftVal > row.rightVal
        const rightWins = row.rightVal > row.leftVal
        return (
          <div key={row.label} className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 transition-colors hover:bg-white/[0.05] ${idx % 2 === 0 ? 'bg-white/[0.02]' : ''} ${idx > 0 ? 'border-t border-white/[0.05]' : ''}`}>
            <div className={`text-center text-base font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>
              {row.left}
            </div>
            <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[80px]">
              {row.label}
            </div>
            <div className={`text-center text-base font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>
              {row.right}
            </div>
          </div>
        )
      })}
    </div>
  )
}
