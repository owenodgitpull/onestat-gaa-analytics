import { useMemo } from 'react'

/** The minimum a chart event needs for the scorers list (matches videoEventsToChartEvents output). */
interface ScoreSource {
  event_type: string
  team?: string | null
  player_id?: string | null
  player_name?: string | null
}

// Same grouping the live recording scoreboard uses
const SCORE_KIND: Record<string, 'goal' | 'point' | 'two_point'> = {
  goal: 'goal', penalty_goal: 'goal',
  point: 'point', point_free: 'point', forty_five: 'point',
  two_point: 'two_point', two_point_free: 'two_point',
}

interface Scorer {
  key: string
  name: string
  goals: number
  pointsValue: number
  twoPointers: number
  totalValue: number
}

/** Per-player scoring for one team, best scorer first - "Connors 0-03 (+1x2pt)", as in live recording. */
export function buildScorers(events: ScoreSource[], team: 'own' | 'opponent'): Scorer[] {
  const by: Record<string, { name: string; goals: number; points: number; twoPointers: number }> = {}
  for (const e of events) {
    const kind = SCORE_KIND[e.event_type]
    if (!kind || (e.team || 'own') !== team) continue
    const name = (e.player_name || '').trim()
    const key = e.player_id ? String(e.player_id) : (name || 'unknown')
    const row = by[key] || (by[key] = { name, goals: 0, points: 0, twoPointers: 0 })
    if (!row.name && name) row.name = name
    if (kind === 'goal') row.goals++
    else if (kind === 'point') row.points++
    else row.twoPointers++
  }
  return Object.entries(by)
    .map(([key, r]) => {
      const pointsValue = r.points + r.twoPointers * 2
      return { key, name: r.name, goals: r.goals, pointsValue, twoPointers: r.twoPointers, totalValue: r.goals * 3 + pointsValue }
    })
    .sort((a, b) => b.totalValue - a.totalValue)
}

interface ScoresListProps {
  events: ScoreSource[]
  teamName: string
  opponentName: string
  /** 'own' / 'opponent' renders one team (the side columns); 'both' renders the stacked pair. */
  show: 'own' | 'opponent' | 'both'
  className?: string
}

function Block({ title, scorers, tone }: { title: string; scorers: Scorer[]; tone: 'own' | 'opp' }) {
  const goals = scorers.reduce((s, x) => s + x.goals, 0)
  const pts = scorers.reduce((s, x) => s + x.pointsValue, 0)
  const named = scorers.filter(s => s.name)
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40 truncate">{title}</span>
        <span className="text-xs font-bold text-white/80 tabular-nums">{goals}-{String(pts).padStart(2, '0')}</span>
      </div>
      {named.length === 0 ? (
        scorers.length === 0 ? <p className="text-[11px] text-white/25 italic">No scores yet</p> : null
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
          {named.map(s => (
            <span key={s.key} className="text-[12px] text-white/70 whitespace-nowrap">
              <span className={`font-medium ${tone === 'own' ? 'text-white' : 'text-orange-100'}`}>{s.name}</span>
              {' '}
              {s.goals}-{String(s.pointsValue).padStart(2, '0')}
              {s.twoPointers > 0 && <span className="text-cyan-400/80 text-[10px]"> (+{s.twoPointers}x2pt)</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/** Who has scored - per player, same as the live recording scoreboard (no individual minutes). */
export default function ScoresList({ events, teamName, opponentName, show, className = '' }: ScoresListProps) {
  const own = useMemo(() => buildScorers(events, 'own'), [events])
  const opp = useMemo(() => buildScorers(events, 'opponent'), [events])
  return (
    <div className={className}>
      {(show === 'own' || show === 'both') && <Block title={teamName} scorers={own} tone="own" />}
      {show === 'both' && <div className="h-2" />}
      {(show === 'opponent' || show === 'both') && <Block title={opponentName} scorers={opp} tone="opp" />}
    </div>
  )
}
