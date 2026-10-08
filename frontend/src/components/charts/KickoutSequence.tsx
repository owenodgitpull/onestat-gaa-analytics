import { useState, useMemo } from 'react'
import { Zap } from 'lucide-react'
import { isFirstHalf } from '../../utils/attackDirection'

interface Props {
  events: any[]
  teamName?: string
  opponentName?: string
  /** Length of a half in minutes (30 club / 35 inter-county) — used when an event has no stored half */
  halfDurationMins?: number | null
}

type Mode = 'own' | 'opp'

function getHalf(e: { minute: number | null; half: number | null }, halfDurationMins?: number | null): number {
  return isFirstHalf(e.half, e.minute, halfDurationMins) ? 1 : 2
}

interface KickoutDot {
  won: boolean
  minute: number | null
  half: number
}

function classifyEvents(events: any[], mode: Mode, halfDurationMins?: number | null): KickoutDot[] {
  const dots: KickoutDot[] = []
  for (const e of events) {
    const t = e.event_type
    const team = e.team || (e.is_home_team ? 'own' : 'opponent')
    const minute = e.minute ?? null
    const half = getHalf({ minute, half: e.half ?? null }, halfDurationMins)

    if (mode === 'own') {
      if (
        t === 'own_kickout_won' || t === 'own_kickout_won_break' ||
        (t === 'kickout_won' && team === 'own') ||
        (t === 'breaking_ball_won' && team === 'own')
      ) {
        dots.push({ won: true, minute, half })
      } else if (
        t === 'own_kickout_opposition_won' || t === 'own_kickout_opposition_won_break' || t === 'own_kickout_sideline' ||
        (t === 'kickout_lost' && team === 'own') ||
        (t === 'breaking_ball_lost' && team === 'own')
      ) {
        dots.push({ won: false, minute, half })
      }
    } else {
      if (t === 'opp_kickout_opposition_won' || t === 'opp_kickout_opposition_won_break') {
        dots.push({ won: true, minute, half })
      } else if (t === 'opp_kickout_won' || t === 'opp_kickout_won_break' || t === 'opp_kickout_sideline') {
        dots.push({ won: false, minute, half })
      }
    }
  }
  return dots.sort((a, b) => (a.minute ?? 0) - (b.minute ?? 0))
}

function HalfSection({ label, dots }: { label: string; dots: KickoutDot[] }) {
  const won = dots.filter(d => d.won).length
  const total = dots.length
  const pct = total > 0 ? Math.round((won / total) * 100) : 0

  return (
    <div className="mb-3">
      <p className="text-xs text-white/40 font-medium mb-1.5">{label}</p>
      {dots.length === 0 ? (
        <p className="text-xs text-white/25 italic">No kickouts</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {dots.map((d, i) => (
              <div
                key={i}
                title={d.minute != null ? `${d.minute}'` : ''}
                className="w-5 h-5 rounded-full flex-shrink-0"
                style={{ background: d.won ? '#10b981' : '#ef4444' }}
              />
            ))}
          </div>
          <p className="text-xs text-white/40">
            {won}/{total} <span className="text-white/60 font-medium">({pct}%)</span>
          </p>
        </>
      )}
    </div>
  )
}

export default function KickoutSequence({ events, teamName = 'Our', opponentName = 'Opp', halfDurationMins }: Props) {
  const [mode, setMode] = useState<Mode>('own')

  const allDots = useMemo(() => classifyEvents(events, mode, halfDurationMins), [events, mode, halfDurationMins])
  const h1Dots = useMemo(() => allDots.filter(d => d.half === 1), [allDots])
  const h2Dots = useMemo(() => allDots.filter(d => d.half === 2), [allDots])

  const totalWon = allDots.filter(d => d.won).length
  const totalAll = allDots.length
  const overallPct = totalAll > 0 ? Math.round((totalWon / totalAll) * 100) : 0

  const hasAnyKickouts = useMemo(() => {
    return events.some(e => {
      const t = e.event_type
      return (
        t === 'own_kickout_won' || t === 'own_kickout_won_break' ||
        t === 'own_kickout_opposition_won' || t === 'own_kickout_opposition_won_break' ||
        t === 'own_kickout_sideline' || t === 'opp_kickout_won' || t === 'opp_kickout_won_break' ||
        t === 'opp_kickout_opposition_won' || t === 'opp_kickout_opposition_won_break' ||
        t === 'opp_kickout_sideline' || t === 'kickout_won' || t === 'kickout_lost' ||
        t === 'breaking_ball_won' || t === 'breaking_ball_lost'
      )
    })
  }, [events])

  if (!hasAnyKickouts) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No kickout data recorded
      </div>
    )
  }

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-bold flex items-center gap-2 text-white">
          <Zap size={18} />
          Kickout Sequence
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['own', 'opp'] as Mode[]).map(m => (
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

      <HalfSection label="1st Half" dots={h1Dots} />
      <HalfSection label="2nd Half" dots={h2Dots} />

      {totalAll > 0 && (
        <div className="mt-auto pt-2 flex flex-wrap items-center gap-2">
          <span className="px-3 py-1 rounded-full bg-white/10 text-xs text-white/70">
            Retention: <span className="text-white font-semibold">{totalWon}/{totalAll} ({overallPct}%)</span>
          </span>
          <span className="flex items-center gap-1 text-xs text-white/40">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#10b981' }} /> Won
          </span>
          <span className="flex items-center gap-1 text-xs text-white/40">
            <span className="w-3 h-3 rounded-full inline-block" style={{ background: '#ef4444' }} /> Lost
          </span>
        </div>
      )}
    </div>
  )
}
