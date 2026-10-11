import { useMemo } from 'react'

/** The minimum a chart event needs for the scores list (matches videoEventsToChartEvents output). */
interface ScoreSource {
  event_type: string
  team?: string | null
  minute?: number | null
  half?: number | null
  player_name?: string | null
}

const SCORE_LABEL: Record<string, { label: string; pts: number }> = {
  goal: { label: 'goal', pts: 3 },
  penalty_goal: { label: 'penalty goal', pts: 3 },
  point: { label: 'point', pts: 1 },
  point_free: { label: 'free', pts: 1 },
  forty_five: { label: '45', pts: 1 },
  two_point: { label: '2-pointer', pts: 2 },
  two_point_free: { label: '2-pointer free', pts: 2 },
}

interface ScoreItem {
  key: string
  minute: number
  half: number
  who: string
  label: string
  pts: number
  own: boolean
}

function surname(name?: string | null): string {
  const n = (name || '').trim()
  if (!n) return ''
  const parts = n.split(/\s+/)
  return parts[parts.length - 1]
}

/** Score events in match order. Sorted by half then minute so first-half added time stays in the first half. */
export function buildScoreItems(events: ScoreSource[], opponentName: string): ScoreItem[] {
  const items: ScoreItem[] = []
  events.forEach((e, i) => {
    const def = SCORE_LABEL[e.event_type]
    if (!def) return
    const own = (e.team || 'own') === 'own'
    items.push({
      key: `${i}-${e.event_type}-${e.minute}`,
      minute: e.minute ?? 0,
      half: e.half ?? 1,
      who: own ? surname(e.player_name) : (surname(e.player_name) || opponentName),
      label: def.label,
      pts: def.pts,
      own,
    })
  })
  return items.sort((a, b) => a.half - b.half || a.minute - b.minute)
}

function tally(items: ScoreItem[]): string {
  const goals = items.filter(i => i.pts === 3).length
  const pts = items.reduce((s, i) => s + (i.pts === 3 ? 0 : i.pts), 0)
  return `${goals}-${String(pts).padStart(2, '0')}`
}

function Chips({ items, tone }: { items: ScoreItem[]; tone: 'own' | 'opp' }) {
  if (items.length === 0) return <p className="text-[11px] text-white/25 italic">No scores yet</p>
  const colour = tone === 'own'
    ? 'bg-emerald-500/10 border-emerald-400/20 text-emerald-100'
    : 'bg-orange-500/10 border-orange-400/20 text-orange-100'
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map(i => (
        <span key={i.key} className={`inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md border text-[11px] whitespace-nowrap ${colour}`}>
          <span className="font-bold tabular-nums">{i.minute}'</span>
          {i.who && <span className="font-medium">{i.who}</span>}
          <span className="text-white/50">{i.label}</span>
        </span>
      ))}
    </div>
  )
}

interface ScoresListProps {
  events: ScoreSource[]
  teamName: string
  opponentName: string
  /** 'own' / 'opponent' renders one team's scores (the side columns); 'both' renders the stacked pair. */
  show: 'own' | 'opponent' | 'both'
  className?: string
}

/** Who scored and when, as a wrapped list - the same information the live recording scoreboard gives. */
export default function ScoresList({ events, teamName, opponentName, show, className = '' }: ScoresListProps) {
  const items = useMemo(() => buildScoreItems(events, opponentName), [events, opponentName])
  const own = items.filter(i => i.own)
  const opp = items.filter(i => !i.own)

  const block = (title: string, list: ScoreItem[], tone: 'own' | 'opp') => (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-white/40 truncate">{title}</span>
        <span className="text-xs font-bold text-white/80 tabular-nums">{tally(list)}</span>
      </div>
      <Chips items={list} tone={tone} />
    </div>
  )

  return (
    <div className={className}>
      {(show === 'own' || show === 'both') && block(teamName, own, 'own')}
      {show === 'both' && <div className="h-2" />}
      {(show === 'opponent' || show === 'both') && block(opponentName, opp, 'opp')}
    </div>
  )
}
