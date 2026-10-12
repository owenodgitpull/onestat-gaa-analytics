/**
 * "Which opposition player?" as a sideline chip, not a modal: it sits on the pitch's sideline while the recorder
 * carries on tracking, and stays until a player is tapped or it is dismissed. Inter-county only (needs the opposition
 * lineup); the event it refers to is always already logged, so ignoring it costs nothing.
 */
import { useMemo } from 'react'
import { X } from 'lucide-react'
import type { OppositionSquad } from '@/hooks/useOppositionSquad'

const QUESTION: Record<string, string> = {
  foul_committed: 'Who fouled?',
  yellow_card: 'Who got the yellow card?', black_card: 'Who got the black card?', red_card: 'Who got the red card?',
  wide: 'Who took the shot?', saved: 'Who shot?',
  opp_unforced_error: 'Who made the error?',
  opp_kickout_won: 'Who won their kickout?', opp_kickout_won_break: 'Who won the break?',
  turnover: 'Who won the turnover?', turnover_lost: 'Who lost it?', turnover_won: 'Who won it?',
  interception: 'Who intercepted it?', block: 'Who blocked it?',
  goal: 'Who scored the goal?', point: 'Who scored?',
  assist: 'Who assisted?',
}

interface Props {
  squad: OppositionSquad
  eventType: string
  /** e.g. "1st half 4'" — which moment this is about, so a late tap is still unambiguous */
  when?: string
  teamName: string
  onSelect: (oppositionPlayerId: string, name: string) => void
  onDismiss: () => void
}

export default function OppositionWhoChip({ squad, eventType, when, teamName, onSelect, onDismiss }: Props) {
  const onField = useMemo(
    () => squad.players.filter(p => p.isOnField).sort((a, b) => (a.jerseyNumber ?? 99) - (b.jerseyNumber ?? 99)),
    [squad.players],
  )
  if (!squad.enabled || !onField.length) return null
  const surname = (n: string) => n.trim().split(' ').slice(-1)[0] || n
  return (
    <div
      className="absolute bottom-2 left-2 right-52 z-30 rounded-xl px-2.5 py-2 animate-fade-in"
      style={{ background: 'rgba(15,23,42,0.92)', border: `1px solid ${squad.primary}`, backdropFilter: 'blur(10px)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold text-white">
          {QUESTION[eventType] || 'Which player?'} <span className="text-white/50 font-medium">· {teamName}{when ? ` · ${when}` : ''}</span>
        </span>
        <button onClick={onDismiss} className="ml-auto text-white/40 hover:text-white p-0.5" aria-label="Dismiss">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {onField.map(p => (
          <button
            key={p.playerId}
            onClick={() => onSelect(p.playerId, p.playerName)}
            className="flex items-center gap-1 rounded-full pl-0.5 pr-2 py-0.5 text-[11px] font-semibold text-white bg-white/10 hover:bg-white/20 active:scale-95 transition"
            title={p.playerName}
          >
            <span
              className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{ background: squad.primary, color: squad.secondary, border: `1px solid ${squad.secondary}` }}
            >
              {p.jerseyNumber ?? '?'}
            </span>
            {surname(p.playerName)}
          </button>
        ))}
      </div>
    </div>
  )
}
