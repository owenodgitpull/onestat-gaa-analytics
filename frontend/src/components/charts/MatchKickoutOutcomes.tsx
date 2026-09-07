/**
 * Single-match kickout outcomes chart.
 * Shows won clean / won break / lost clean / lost break for own and opponent kickouts.
 */
import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Target } from 'lucide-react'

interface Props {
  events: any[]
  teamName?: string
  opponentName?: string
}

type KickoutMode = 'own' | 'opponent'

interface Outcomes {
  wonClean: number
  wonBreak: number
  lostClean: number
  lostBreak: number
}

const COLORS = {
  wonClean: '#10b981',  // emerald
  wonBreak: '#f59e0b',  // amber
  lostClean: '#ef4444', // red
  lostBreak: '#f97316', // orange
}

// Classifies a single kickout event into one of the four outcome buckets for the
// given mode, or null if it's not a kickout event for that mode at all. Shared by
// countOutcomes (the bar chart totals) and TopWinnersSection (the per-player
// breakdown) so the two can never drift apart — they previously used separate,
// inconsistent event-type lists, which meant the winners list under-counted the
// total shown in the win-rate header.
function classifyKickoutEvent(e: any, mode: KickoutMode): keyof Outcomes | null {
  const t = e.event_type
  const team = e.team || (e.is_home_team ? 'own' : 'opponent')

  if (mode === 'own') {
    // Our kickouts — "won" means we retained, "lost" means they got it
    if (t === 'own_kickout_won') return 'wonClean'
    if (t === 'own_kickout_won_break') return 'wonBreak'
    if (t === 'own_kickout_opposition_won') return 'lostClean'
    if (t === 'own_kickout_opposition_won_break') return 'lostBreak'
    if (t === 'own_kickout_sideline') return 'lostClean'
    // Legacy types for own team
    if (t === 'kickout_won' && team === 'own') return 'wonClean'
    if (t === 'breaking_ball_won' && team === 'own') return 'wonBreak'
    if (t === 'kickout_lost' && team === 'own') return 'lostClean'
    if (t === 'breaking_ball_lost' && team === 'own') return 'lostBreak'
  } else {
    // Opponent kickouts — "won" means we won their kickout, "lost" means they retained
    if (t === 'opp_kickout_opposition_won') return 'wonClean'
    if (t === 'opp_kickout_opposition_won_break') return 'wonBreak'
    if (t === 'opp_kickout_won') return 'lostClean'
    if (t === 'opp_kickout_won_break') return 'lostBreak'
    if (t === 'opp_kickout_sideline') return 'lostClean'
    // Legacy types for opponent
    if (t === 'kickout_won' && team === 'opponent') return 'lostClean'
    if (t === 'breaking_ball_won' && team === 'opponent') return 'lostBreak'
    if (t === 'kickout_lost' && team === 'opponent') return 'wonClean'
    if (t === 'breaking_ball_lost' && team === 'opponent') return 'wonBreak'
  }
  return null
}

// Whether THIS event is an OUR-PLAYER win worth naming in "Top Winners" —
// deliberately separate from classifyKickoutEvent's wonClean/wonBreak
// buckets above. Those buckets are framed from the KICKING team's
// perspective (so in 'opponent' mode, "won" means the opposition retained
// their own restart — always player=null, since opponent identities aren't
// tracked). That made "Top Winners" structurally empty for the single most
// notable stat in that mode: which of OUR players contested and won the
// OPPOSITION's kickout. This checks the opposite direction on purpose.
function isOwnPlayerWin(e: any, mode: KickoutMode): boolean {
  const t = e.event_type
  const team = e.team || (e.is_home_team ? 'own' : 'opponent')
  if (mode === 'own') {
    return t === 'own_kickout_won' || t === 'own_kickout_won_break' ||
      (t === 'kickout_won' && team === 'own') || (t === 'breaking_ball_won' && team === 'own')
  }
  return t === 'opp_kickout_won' || t === 'opp_kickout_won_break'
}

function countOutcomes(events: any[], mode: KickoutMode): Outcomes {
  const o: Outcomes = { wonClean: 0, wonBreak: 0, lostClean: 0, lostBreak: 0 }
  for (const e of events) {
    const bucket = classifyKickoutEvent(e, mode)
    if (bucket) o[bucket]++
  }
  return o
}

const SCORE_VALUE: Record<string, number> = {
  goal: 3, penalty_goal: 3,
  point: 1, point_free: 1, forty_five: 1,
  two_point: 2, two_point_free: 2,
}
const SCORE_TYPES = new Set(Object.keys(SCORE_VALUE))
const POSSESSION_BREAK_TYPES = new Set([
  'turnover_won', 'turnover_lost', 'unforced_error',
  'wide', 'wide_free', 'short', 'saved', 'forty_five_missed',
])

function eventTeam(e: any): 'own' | 'opponent' {
  return e.team || (e.is_home_team ? 'own' : 'opponent')
}

interface PtsPerKickout {
  avgWon: number; avgLost: number; netPerKO: number
  wonCount: number; lostCount: number
}

// Chains each kickout forward to whatever happens next in that possession —
// mirrors the "Avg Pts Per KO Won/Lost" table from the reference report.
// A kickout is credited with the next score IF that score comes before any
// new kickout, turnover, or missed shot interrupts the sequence; otherwise
// nothing is attributed to it (the possession moved on without a direct
// score either way).
function computePtsPerKickout(events: any[], mode: KickoutMode): PtsPerKickout {
  // Sort by minute, keeping original relative order for same-minute events —
  // event_type/minute alone can't be trusted to already be chronological
  // (offline sync can append events out of order).
  const sorted = events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.minute ?? 0) - (b.e.minute ?? 0) || a.i - b.i)
    .map(x => x.e)

  const wonPts: number[] = []
  const lostPts: number[] = []

  for (let idx = 0; idx < sorted.length; idx++) {
    const bucket = classifyKickoutEvent(sorted[idx], mode)
    if (!bucket) continue

    const won = bucket === 'wonClean' || bucket === 'wonBreak'
    // For mode='own': winning our kickout means WE have the ball; losing it
    // means the opposition does. For mode='opponent': winning THEIR kickout
    // means WE have the ball; them retaining it means they do.
    const creditedTeam: 'own' | 'opponent' = won ? 'own' : 'opponent'

    let resultPts = 0
    for (let j = idx + 1; j < sorted.length; j++) {
      const next = sorted[j]
      if (classifyKickoutEvent(next, 'own') || classifyKickoutEvent(next, 'opponent')) break
      if (SCORE_TYPES.has(next.event_type)) {
        if (eventTeam(next) === creditedTeam) resultPts = SCORE_VALUE[next.event_type]
        break
      }
      if (POSSESSION_BREAK_TYPES.has(next.event_type)) break
    }

    if (won) wonPts.push(resultPts)
    else lostPts.push(resultPts)
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const totalKO = wonPts.length + lostPts.length
  const netPerKO = totalKO > 0
    ? (wonPts.reduce((a, b) => a + b, 0) - lostPts.reduce((a, b) => a + b, 0)) / totalKO
    : 0

  return { avgWon: avg(wonPts), avgLost: avg(lostPts), netPerKO, wonCount: wonPts.length, lostCount: lostPts.length }
}

export default function MatchKickoutOutcomes({ events, teamName = 'Our', opponentName = 'Opp' }: Props) {
  const [mode, setMode] = useState<KickoutMode>('own')

  const outcomes = useMemo(() => countOutcomes(events, mode), [events, mode])
  const total = outcomes.wonClean + outcomes.wonBreak + outcomes.lostClean + outcomes.lostBreak
  const totalWon = outcomes.wonClean + outcomes.wonBreak
  const winRate = total > 0 ? Math.round((totalWon / total) * 100) : 0
  const ptsPerKO = useMemo(() => computePtsPerKickout(events, mode), [events, mode])

  if (total === 0 && countOutcomes(events, mode === 'own' ? 'opponent' : 'own').wonClean +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').wonBreak +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').lostClean +
    countOutcomes(events, mode === 'own' ? 'opponent' : 'own').lostBreak === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No kickout events recorded
      </div>
    )
  }

  const chartData = [
    { name: 'Won Clean', value: outcomes.wonClean, color: COLORS.wonClean },
    { name: 'Won Break', value: outcomes.wonBreak, color: COLORS.wonBreak },
    { name: 'Lost Clean', value: outcomes.lostClean, color: COLORS.lostClean },
    { name: 'Lost Break', value: outcomes.lostBreak, color: COLORS.lostBreak },
  ]

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-white">
          <Target size={18} />
          Kickout Outcomes
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['own', 'opponent'] as KickoutMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
              }`}
            >
              {m === 'own' ? `${teamName} K/O` : `${opponentName} K/O`}
            </button>
          ))}
        </div>
      </div>

      {/* Win rate header */}
      <div className="flex items-center gap-3 mb-3">
        <div className={`text-2xl font-bold ${winRate >= 60 ? 'text-emerald-400' : winRate >= 45 ? 'text-amber-400' : 'text-red-400'}`}>
          {winRate}%
        </div>
        <div className="text-xs text-white/50">
          retention ({totalWon}/{total})
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex-1 min-h-0" style={{ minHeight: 180 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <XAxis type="number" allowDecimals={false} tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
              labelStyle={{ color: 'white', fontWeight: 600 }}
              itemStyle={{ color: 'rgba(255,255,255,0.8)' }}
              formatter={(value: number) => [value, 'Count']}
            />
            <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28}>
              {chartData.map((entry, i) => (
                <Cell key={i} fill={entry.color} fillOpacity={0.8} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Summary pills */}
      <div className="flex flex-wrap gap-2 mt-2">
        {chartData.map(d => (
          <span key={d.name} className="px-2 py-1 rounded-full bg-white/10 text-xs text-white/70 flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} />
            {d.name}: <span className="text-white font-medium">{d.value}</span>
          </span>
        ))}
      </div>

      {/* Points per kickout — does winning/losing this kickout actually
          translate into scores, not just possession */}
      {(ptsPerKO.wonCount > 0 || ptsPerKO.lostCount > 0) && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <p className="text-xs text-white/40 font-medium mb-1.5">Scoring Value of Kickouts</p>
          <div className="flex flex-wrap gap-2">
            <span className="px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-xs text-white/70">
              Avg Points Scored per Kickout Won: <span className="text-emerald-400 font-semibold">{ptsPerKO.avgWon.toFixed(2)}</span>
            </span>
            <span className="px-2.5 py-1 rounded-full bg-red-500/10 border border-red-500/20 text-xs text-white/70">
              Avg Points Conceded per Kickout Lost: <span className="text-red-400 font-semibold">{ptsPerKO.avgLost.toFixed(2)}</span>
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
              Net Points per Kickout Taken: <span className={`font-semibold ${ptsPerKO.netPerKO >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {ptsPerKO.netPerKO >= 0 ? '+' : ''}{ptsPerKO.netPerKO.toFixed(2)}
              </span>
            </span>
          </div>
        </div>
      )}

      <TopWinnersSection events={events} mode={mode} />
    </div>
  )
}

function TopWinnersSection({ events, mode }: { events: any[]; mode: KickoutMode }) {
  const topWinners = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of events) {
      if (!isOwnPlayerWin(e, mode)) continue
      const name = e.player_name || 'Unknown'
      counts[name] = (counts[name] || 0) + 1
    }

    return Object.entries(counts)
      .filter(([name]) => name !== 'Unknown')
      .sort((a, b) => b[1] - a[1])
  }, [events, mode])

  if (topWinners.length === 0) return null

  return (
    <div className="mt-3 pt-3 border-t border-white/10">
      <p className="text-xs text-white/40 font-medium mb-1.5">Top Winners</p>
      {topWinners.slice(0, 5).map(([name, count], i) => (
        <div key={name} className="flex items-center justify-between py-0.5">
          <span className="text-xs text-white/70">{i + 1}. {name}</span>
          <span className="text-xs font-semibold text-emerald-400">{count}</span>
        </div>
      ))}
    </div>
  )
}
