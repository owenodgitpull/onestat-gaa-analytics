import { useState } from 'react'
import { X, ArrowLeftRight } from 'lucide-react'
import { useClub } from '@/contexts/ClubContext'

interface LineupEntry {
  player_id: string
  position_id: string
  is_on_field: boolean
  match_jersey_number?: number | null
  player_jersey_number?: number | null
  player_name?: string
}

interface PositionSwapModalProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the two players whose positions should be swapped. Closes straight away; the caller applies it. */
  onConfirm: (playerAId: string, playerBId: string) => void
  matchLineup: LineupEntry[]
  /** e.g. "40'" - shown so the coach can see when the move will be recorded */
  timeLabel: string
}

/** The lineup after two players swap positions (used for the instant, optimistic update). */
export function swapLineupPositions<T extends { player_id: string; position_id: string }>(lineup: T[], a: string, b: string): T[] {
  const pa = lineup.find(l => l.player_id === a)?.position_id
  const pb = lineup.find(l => l.player_id === b)?.position_id
  if (!pa || !pb) return lineup
  return lineup.map(l => (l.player_id === a ? { ...l, position_id: pb } : l.player_id === b ? { ...l, position_id: pa } : l))
}

// Back-to-front order so the list reads like the pitch
const ORDER = [
  'gk', 'fb-left', 'fb-center', 'fb-right', 'hb-left', 'hb-center', 'hb-right',
  'mf-left', 'mf-right', 'hf-left', 'hf-center', 'hf-right', 'ff-left', 'ff-center', 'ff-right',
]
export const POSITION_NAME: Record<string, string> = {
  'gk': 'Goalkeeper',
  'fb-left': 'Left corner back', 'fb-center': 'Full back', 'fb-right': 'Right corner back',
  'hb-left': 'Left half back', 'hb-center': 'Centre half back', 'hb-right': 'Right half back',
  'mf-left': 'Left midfield', 'mf-right': 'Right midfield',
  'hf-left': 'Left half forward', 'hf-center': 'Centre half forward', 'hf-right': 'Right half forward',
  'ff-left': 'Left corner forward', 'ff-center': 'Full forward', 'ff-right': 'Right corner forward',
}

/** Two players on the field swap positions (e.g. a midfielder and a half forward). Records WHEN, so the agents
 *  know who played where at which minute. */
export default function PositionSwapModal({ isOpen, onClose, onConfirm, matchLineup, timeLabel }: PositionSwapModalProps) {
  const [first, setFirst] = useState<string | null>(null)
  const [second, setSecond] = useState<string | null>(null)
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  if (!isOpen) return null

  const onField = matchLineup
    .filter(l => l.is_on_field)
    .sort((a, b) => ORDER.indexOf(a.position_id) - ORDER.indexOf(b.position_id))

  const reset = () => { setFirst(null); setSecond(null) }
  const close = () => { reset(); onClose() }

  const pick = (id: string) => {
    if (id === first) { setFirst(second); setSecond(null); return }
    if (id === second) { setSecond(null); return }
    if (!first) setFirst(id)
    else if (!second) setSecond(id)
    else setSecond(id)
  }

  const nameOf = (id: string | null) => onField.find(l => l.player_id === id)?.player_name ?? ''
  const posOf = (id: string | null) => POSITION_NAME[onField.find(l => l.player_id === id)?.position_id ?? ''] ?? ''

  const confirm = () => {
    if (!first || !second) return
    const a = first
    const b = second
    reset()
    onClose()
    onConfirm(a, b)
  }

  return (
    <div className="fixed inset-0 z-[210] flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full bg-sky-500/20">
              <ArrowLeftRight className="text-sky-300" size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Swap positions</h2>
              <p className="text-white/40 text-xs">Recorded at {timeLabel}</p>
            </div>
          </div>
          <button onClick={close} className="text-white/60 hover:text-white transition-colors"><X size={20} /></button>
        </div>

        <p className="text-xs text-white/50 mb-3">Tap the two players who are changing positions.</p>

        <div className="space-y-1 max-h-72 overflow-y-auto pr-1 mb-4">
          {onField.map(entry => {
            const selected = entry.player_id === first || entry.player_id === second
            const jersey = entry.match_jersey_number ?? entry.player_jersey_number
            return (
              <button
                key={entry.player_id}
                onClick={() => pick(entry.player_id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                  selected
                    ? 'bg-sky-500/20 border-sky-400/50 text-sky-100'
                    : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 active:scale-[0.98]'
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                  style={{ backgroundColor: jerseyBg, color: jerseyText }}
                >
                  {jersey ?? '#'}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-sm font-semibold truncate">{entry.player_name ?? 'Unknown'}</p>
                  <p className="text-[10px] text-white/40">{POSITION_NAME[entry.position_id] ?? entry.position_id}</p>
                </div>
                {selected && <span className="text-sky-300 text-[10px] font-bold flex-shrink-0">{entry.player_id === first ? '1st' : '2nd'}</span>}
              </button>
            )
          })}
        </div>

        {first && second && (
          <p className="text-xs text-white/70 mb-3 text-center">
            {nameOf(first)} <span className="text-white/40">({posOf(first)})</span> {'⇄'} {nameOf(second)} <span className="text-white/40">({posOf(second)})</span>
          </p>
        )}

        <button
          onClick={confirm}
          disabled={!first || !second}
          className="w-full bg-gradient-to-r from-sky-600 to-sky-700 hover:from-sky-700 hover:to-sky-800 text-white px-6 py-3 rounded-xl font-semibold transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          Swap positions
        </button>
      </div>
    </div>
  )
}
