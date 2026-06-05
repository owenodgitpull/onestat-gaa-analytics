/**
 * Extended Stats Modal
 * Deep-dive match statistics not shown in the sidebar summary.
 * Works on both MatchResult and MatchRecording pages.
 */

import { useState, useMemo } from 'react'
import { X, ChevronRight, Users, Activity } from 'lucide-react'

// ── Types ─────────────────────────────────────────────────────────────────────

interface RawEvent {
  event_type: string
  // MatchResult events have team: 'own'|'opponent'
  team?: string
  // MatchRecording offline events have is_home_team
  is_home_team?: boolean
  player_name?: string | null
  player_id?: string | null
  minute?: number | null
  half?: number | null
  sub_type?: string | null
}

interface Props {
  events: any[]
  opponent: string
  teamName: string
  onClose: () => void
  halfDurationMins?: number
}

type HalfFilter = 'full' | '1st' | '2nd'

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOwn(e: RawEvent): boolean {
  if (e.team !== undefined) return e.team === 'own'
  return e.is_home_team === true
}

function pct(num: number, den: number): string {
  if (den === 0) return '—'
  return `${Math.round((num / den) * 100)}%`
}

function ratio(num: number, den: number): string {
  if (den === 0 && num === 0) return '—'
  return `${num}/${den}`
}

// Player totals by event type
function playerTotals(events: RawEvent[], ownOnly: boolean): Map<string, { name: string; count: number }> {
  const map = new Map<string, { name: string; count: number }>()
  for (const e of events) {
    if (ownOnly && !isOwn(e)) continue
    const key = e.player_id ?? e.player_name ?? ''
    if (!key) continue
    const label = e.player_name ?? 'Unknown'
    const existing = map.get(key)
    if (existing) existing.count++
    else map.set(key, { name: label, count: 1 })
  }
  return map
}

function topPlayers(events: RawEvent[], ownOnly: boolean, limit = 3): { name: string; count: number }[] {
  return [...playerTotals(events, ownOnly).values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatRow({
  label,
  left,
  right,
  leftBetter,
}: {
  label: string
  left: string | number
  right: string | number
  leftBetter?: boolean // true = higher left is better, false = lower left is better, undefined = neutral
}) {
  const leftStr = String(left)
  const rightStr = String(right)
  const lNum = parseFloat(leftStr.replace('%', '').replace('/', ''))
  const rNum = parseFloat(rightStr.replace('%', '').replace('/', ''))
  const leftWins = leftBetter === true ? lNum > rNum : leftBetter === false ? lNum < rNum : false
  const rightWins = leftBetter === true ? rNum > lNum : leftBetter === false ? rNum < lNum : false

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2 px-3 border-t border-white/[0.05] hover:bg-white/[0.03] transition-colors">
      <div className={`text-center text-sm font-bold ${leftWins ? 'text-emerald-400' : 'text-white/80'}`}>{leftStr}</div>
      <div className="text-center text-[11px] font-semibold text-white/35 uppercase tracking-wider min-w-[140px]">{label}</div>
      <div className={`text-center text-sm font-bold ${rightWins ? 'text-emerald-400' : 'text-white/80'}`}>{rightStr}</div>
    </div>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="px-3 py-1.5 bg-white/[0.04] border-t border-white/[0.08]">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/30">{label}</p>
    </div>
  )
}

function PlayerLeaderRow({ label, entries }: { label: string; entries: { name: string; count: number }[] }) {
  if (entries.length === 0) return null
  return (
    <div className="py-3 px-1 border-t border-white/[0.05]">
      <p className="text-xs text-white/40 mb-2 font-semibold uppercase tracking-wide">{label}</p>
      <div className="space-y-1">
        {entries.map((e, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-sm text-white">{e.name}</span>
            <span className={`text-sm font-bold ${i === 0 ? 'text-emerald-400' : 'text-white/60'}`}>{e.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SubTypeBreakdown({ events }: { events: RawEvent[] }) {
  const counts: Record<string, number> = {}
  for (const e of events) {
    if (e.sub_type) counts[e.sub_type] = (counts[e.sub_type] ?? 0) + 1
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {entries.map(([k, v]) => (
        <span key={k} className="px-2 py-0.5 rounded-full bg-white/10 text-white/50 text-[10px]">
          {k.replace(/_/g, ' ')}: {v}
        </span>
      ))}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ExtendedStatsModal({ events, opponent, teamName, onClose, halfDurationMins = 30 }: Props) {
  const [half, setHalf] = useState<HalfFilter>('full')
  const [tab, setTab] = useState<'team' | 'players'>('team')

  const filtered = useMemo(() => {
    if (half === 'full') return events
    return events.filter(e => {
      const m = e.minute ?? 0
      if (half === '1st') return m <= halfDurationMins
      return m > halfDurationMins
    })
  }, [events, half, halfDurationMins])

  const own = filtered.filter(isOwn)
  const opp = filtered.filter(e => !isOwn(e))

  // ── Scoring from play (non-free events) ──────────────────────────────────
  const playScoreTypes = new Set(['goal', 'point', 'two_point'])
  const playMissTypes = new Set(['wide', 'saved', 'short', 'hit_post'])
  const freeScoreTypes = new Set(['point_free', 'two_point_free', 'forty_five', 'penalty_goal'])
  const freeMissTypes = new Set(['wide_free', 'forty_five_missed', 'penalty_miss'])

  const ownPlayScores = own.filter(e => playScoreTypes.has(e.event_type)).length
  const ownPlayMisses = own.filter(e => playMissTypes.has(e.event_type)).length
  const ownFreeScores = own.filter(e => freeScoreTypes.has(e.event_type)).length
  const ownFreeMisses = own.filter(e => freeMissTypes.has(e.event_type)).length

  const oppPlayScores = opp.filter(e => playScoreTypes.has(e.event_type)).length
  const oppPlayMisses = opp.filter(e => playMissTypes.has(e.event_type)).length
  const oppFreeScores = opp.filter(e => freeScoreTypes.has(e.event_type)).length
  const oppFreeMisses = opp.filter(e => freeMissTypes.has(e.event_type)).length

  // 45s
  const own45Scored = own.filter(e => e.event_type === 'forty_five').length
  const own45Missed = own.filter(e => e.event_type === 'forty_five_missed').length
  const opp45Scored = opp.filter(e => e.event_type === 'forty_five').length
  const opp45Missed = opp.filter(e => e.event_type === 'forty_five_missed').length

  // Penalties
  const ownPenGoal = own.filter(e => e.event_type === 'penalty_goal').length
  const ownPenMiss = own.filter(e => e.event_type === 'penalty_miss').length
  const oppPenGoal = opp.filter(e => e.event_type === 'penalty_goal').length
  const oppPenMiss = opp.filter(e => e.event_type === 'penalty_miss').length

  // ── Own kickout outcomes ─────────────────────────────────────────────────
  const ownKOWon = filtered.filter(e => e.event_type === 'own_kickout_won').length
  const ownKOWonBreak = filtered.filter(e => e.event_type === 'own_kickout_won_break').length
  const ownKOLost = filtered.filter(e => e.event_type === 'own_kickout_opposition_won').length
  const ownKOLostBreak = filtered.filter(e => e.event_type === 'own_kickout_opposition_won_break').length
  const ownKOSideline = filtered.filter(e => e.event_type === 'own_kickout_sideline').length
  const ownKOTotal = ownKOWon + ownKOWonBreak + ownKOLost + ownKOLostBreak + ownKOSideline

  // Opponent kickout outcomes (from our perspective)
  const oppKOWon = filtered.filter(e => e.event_type === 'opp_kickout_won').length
  const oppKOWonBreak = filtered.filter(e => e.event_type === 'opp_kickout_won_break').length
  const oppKOLost = filtered.filter(e => e.event_type === 'opp_kickout_opposition_won').length
  const oppKOLostBreak = filtered.filter(e => e.event_type === 'opp_kickout_opposition_won_break').length
  const oppKOSideline = filtered.filter(e => e.event_type === 'opp_kickout_sideline').length
  const oppKOTotal = oppKOWon + oppKOWonBreak + oppKOLost + oppKOLostBreak + oppKOSideline

  // ── Discipline ────────────────────────────────────────────────────────────
  const ownYellow = own.filter(e => e.event_type === 'yellow_card').length
  const ownBlack = own.filter(e => e.event_type === 'black_card').length
  const ownRed = own.filter(e => e.event_type === 'red_card').length
  const oppYellow = opp.filter(e => e.event_type === 'yellow_card').length
  const oppBlack = opp.filter(e => e.event_type === 'black_card').length
  const oppRed = opp.filter(e => e.event_type === 'red_card').length

  // ── Defensive actions ─────────────────────────────────────────────────────
  const ownBlocks = own.filter(e => e.event_type === 'block').length
  const ownIntercepts = own.filter(e => e.event_type === 'interception').length
  const oppBlocks = opp.filter(e => e.event_type === 'block').length
  const oppIntercepts = opp.filter(e => e.event_type === 'interception').length

  // ── Player leaders (own team only) ────────────────────────────────────────
  const ownUnforcedEvents = own.filter(e => e.event_type === 'unforced_error')
  const ownFoulEvents = own.filter(e => e.event_type === 'foul_committed')

  const topUnforced = topPlayers(ownUnforcedEvents, false)
  const topFouls = topPlayers(ownFoulEvents, false)
  const topTOLost = topPlayers(own.filter(e => e.event_type === 'turnover_lost'), false)
  const topTOWon = topPlayers(
    own.filter(e => ['turnover_won', 'tackle_won', 'interception'].includes(e.event_type)),
    false
  )
  const topFreesWon = topPlayers(own.filter(e => e.event_type === 'free_won'), false)
  const topBlocks = topPlayers(own.filter(e => e.event_type === 'block'), false)

  // Top scorer (goals=3, two_point=2, point=1 + free scores)
  const scorerMap = new Map<string, { name: string; score: number; breakdown: string }>()
  const scoreValues: Record<string, number> = { goal: 3, penalty_goal: 3, two_point: 2, two_point_free: 2, point: 1, point_free: 1, forty_five: 1 }
  for (const e of own) {
    const val = scoreValues[e.event_type]
    if (!val) continue
    const key = e.player_id ?? e.player_name ?? ''
    if (!key) continue
    const name = e.player_name ?? 'Unknown'
    const existing = scorerMap.get(key)
    if (existing) existing.score += val
    else scorerMap.set(key, { name, score: val, breakdown: '' })
  }
  const topScorers = [...scorerMap.values()].sort((a, b) => b.score - a.score).slice(0, 3)

  const abbr = (name: string) => name.length > 16 ? name.split(' ').map((w, i) => i === 0 ? w[0] + '.' : w).join(' ') : name

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.08] flex-shrink-0">
          <div className="flex items-center gap-2">
            <Activity size={18} className="text-emerald-400" />
            <h2 className="text-base font-bold text-white">Extended Stats</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={18} className="text-white/50" />
          </button>
        </div>

        {/* Half filter */}
        <div className="flex gap-1.5 px-5 py-3 border-b border-white/[0.08] flex-shrink-0">
          {(['full', '1st', '2nd'] as const).map(h => (
            <button
              key={h}
              onClick={() => setHalf(h)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                half === h ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/15'
              }`}
            >
              {h === 'full' ? 'Full Match' : h === '1st' ? '1st Half' : '2nd Half'}
            </button>
          ))}
          <div className="ml-auto flex gap-1">
            <button
              onClick={() => setTab('team')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${tab === 'team' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
            >
              Team
            </button>
            <button
              onClick={() => setTab('players')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${tab === 'players' ? 'bg-white/20 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
            >
              <span className="flex items-center gap-1"><Users size={11} /> Players</span>
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">

          {tab === 'team' && (
            <div className="rounded-xl border border-white/[0.08] m-3 overflow-visible">
              {/* Sticky column headers */}
              <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2.5 px-3 bg-[#131f1f] border-b border-white/[0.08] rounded-t-xl">
                <div className="text-center text-xs font-bold text-emerald-400 uppercase tracking-wider truncate">{abbr(teamName)}</div>
                <div className="min-w-[140px]" />
                <div className="text-center text-xs font-bold text-white/50 uppercase tracking-wider truncate">{abbr(opponent)}</div>
              </div>

              <SectionHeader label="Scoring from Play" />
              <StatRow label="Scores from Play" left={ownPlayScores} right={oppPlayScores} leftBetter={true} />
              <StatRow label="Play Efficiency" left={pct(ownPlayScores, ownPlayScores + ownPlayMisses)} right={pct(oppPlayScores, oppPlayScores + oppPlayMisses)} leftBetter={true} />

              <SectionHeader label="Scoring from Frees" />
              <StatRow label="Scores from Frees" left={ownFreeScores} right={oppFreeScores} leftBetter={true} />
              <StatRow label="Free Efficiency" left={pct(ownFreeScores, ownFreeScores + ownFreeMisses)} right={pct(oppFreeScores, oppFreeScores + oppFreeMisses)} leftBetter={true} />
              <StatRow label="45s (scored/taken)" left={ratio(own45Scored, own45Scored + own45Missed)} right={ratio(opp45Scored, opp45Scored + opp45Missed)} leftBetter={true} />
              {(ownPenGoal + ownPenMiss + oppPenGoal + oppPenMiss) > 0 && (
                <StatRow label="Penalties (scored/taken)" left={ratio(ownPenGoal, ownPenGoal + ownPenMiss)} right={ratio(oppPenGoal, oppPenGoal + oppPenMiss)} leftBetter={true} />
              )}

              {ownKOTotal + oppKOTotal > 0 && <>
                <SectionHeader label={`${abbr(teamName)} Kickouts`} />
                <StatRow label="Won Clean" left={ownKOWon} right={ownKOLost} leftBetter={true} />
                <StatRow label="Won Breaking Ball" left={ownKOWonBreak} right={ownKOLostBreak} leftBetter={true} />
                <StatRow label="Total Won/Taken" left={ratio(ownKOWon + ownKOWonBreak, ownKOTotal)} right={ratio(ownKOLost + ownKOLostBreak, ownKOTotal)} leftBetter={true} />
                <StatRow label="% Won" left={pct(ownKOWon + ownKOWonBreak, ownKOTotal)} right={pct(ownKOLost + ownKOLostBreak, ownKOTotal)} leftBetter={true} />
                {ownKOSideline > 0 && <StatRow label="Over Sideline" left={ownKOSideline} right="—" leftBetter={false} />}
              </>}

              {oppKOTotal > 0 && <>
                <SectionHeader label={`${abbr(opponent)} Kickouts`} />
                <StatRow label="Won Clean" left={oppKOWon} right={oppKOLost} leftBetter={true} />
                <StatRow label="Won (Break)" left={oppKOWonBreak} right={oppKOLostBreak} leftBetter={true} />
                <StatRow label="Won / Total" left={ratio(oppKOWon + oppKOWonBreak, oppKOTotal)} right={ratio(oppKOLost + oppKOLostBreak, oppKOTotal)} leftBetter={true} />
                <StatRow label="% Won" left={pct(oppKOWon + oppKOWonBreak, oppKOTotal)} right={pct(oppKOLost + oppKOLostBreak, oppKOTotal)} leftBetter={true} />
                {oppKOSideline > 0 && <StatRow label="Over Sideline" left="—" right={oppKOSideline} leftBetter={true} />}
              </>}

              <SectionHeader label="Defensive" />
              <StatRow label="Blocks" left={ownBlocks} right={oppBlocks} leftBetter={true} />
              <StatRow label="Interceptions" left={ownIntercepts} right={oppIntercepts} leftBetter={true} />

              {(ownYellow + ownBlack + ownRed + oppYellow + oppBlack + oppRed) > 0 && <>
                <SectionHeader label="Discipline" />
                {(ownYellow + oppYellow) > 0 && <StatRow label="Yellow Cards" left={ownYellow} right={oppYellow} leftBetter={false} />}
                {(ownBlack + oppBlack) > 0 && <StatRow label="Black Cards" left={ownBlack} right={oppBlack} leftBetter={false} />}
                {(ownRed + oppRed) > 0 && <StatRow label="Red Cards" left={ownRed} right={oppRed} leftBetter={false} />}
              </>}
            </div>
          )}

          {tab === 'players' && (
            <div className="px-4 py-2 space-y-1">
              {topScorers.length > 0 && (
                <PlayerLeaderRow label="Top Scorers (pts)" entries={topScorers.map(s => ({ name: s.name, count: s.score }))} />
              )}
              {topTOWon.length > 0 && (
                <PlayerLeaderRow label="Most Turnovers Won" entries={topTOWon} />
              )}
              {topFreesWon.length > 0 && (
                <PlayerLeaderRow label="Most Frees Won" entries={topFreesWon} />
              )}
              {topBlocks.length > 0 && (
                <PlayerLeaderRow label="Most Blocks" entries={topBlocks} />
              )}
              {topUnforced.length > 0 && (
                <div className="py-3 px-1 border-t border-white/[0.05]">
                  <p className="text-xs text-white/40 mb-2 font-semibold uppercase tracking-wide">Most Unforced Errors</p>
                  <div className="space-y-1">
                    {topUnforced.map((e, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-white">{e.name}</span>
                        <span className={`text-sm font-bold ${i === 0 ? 'text-amber-400' : 'text-white/60'}`}>{e.count}</span>
                      </div>
                    ))}
                  </div>
                  <SubTypeBreakdown events={ownUnforcedEvents} />
                </div>
              )}
              {topFouls.length > 0 && (
                <div className="py-3 px-1 border-t border-white/[0.05]">
                  <p className="text-xs text-white/40 mb-2 font-semibold uppercase tracking-wide">Most Fouls Committed</p>
                  <div className="space-y-1">
                    {topFouls.map((e, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-sm text-white">{e.name}</span>
                        <span className={`text-sm font-bold ${i === 0 ? 'text-amber-400' : 'text-white/60'}`}>{e.count}</span>
                      </div>
                    ))}
                  </div>
                  <SubTypeBreakdown events={ownFoulEvents} />
                </div>
              )}
              {topTOLost.length > 0 && (
                <PlayerLeaderRow label="Most Turnovers Lost" entries={topTOLost} />
              )}
              {(topScorers.length + topTOWon.length + topFreesWon.length + topBlocks.length + topUnforced.length + topFouls.length + topTOLost.length) === 0 && (
                <div className="text-center text-white/30 py-12 text-sm">No player data recorded yet</div>
              )}
            </div>
          )}
        </div>

        {/* Tap-to-close hint */}
        <div className="py-2 text-center text-[10px] text-white/20 border-t border-white/[0.05] flex-shrink-0">
          Tap outside to close <ChevronRight size={10} className="inline" />
        </div>
      </div>
    </div>
  )
}
