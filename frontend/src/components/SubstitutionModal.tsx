import { useState } from 'react'
import { X, ArrowLeftRight } from 'lucide-react'
import { Player } from '@/types'
import { useClub } from '@/contexts/ClubContext'

interface MatchLineupEntry {
  player_id: string
  position_id: string
  is_on_field: boolean
  is_substitute: boolean
  match_jersey_number?: number | null
  player_jersey_number?: number | null
  player_name?: string
}

interface SubstitutionModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (playerOffId: string, playerOnId: string) => Promise<void>
  matchLineup: MatchLineupEntry[]
  players: Player[]
  minute: number
}

const POSITION_LABELS: Record<string, string> = {
  'gk': 'GK', 'fb-left': 'CB', 'fb-center': 'FB', 'fb-right': 'CB',
  'hb-left': 'HB', 'hb-center': 'CHB', 'hb-right': 'HB',
  'mf-left': 'MF', 'mf-right': 'MF',
  'hf-left': 'HF', 'hf-center': 'CHF', 'hf-right': 'HF',
  'ff-left': 'CF', 'ff-center': 'FF', 'ff-right': 'CF',
}

export default function SubstitutionModal({
  isOpen,
  onClose,
  onConfirm,
  matchLineup,
  players,
  minute,
}: SubstitutionModalProps) {
  const [playerOffId, setPlayerOffId] = useState<string | null>(null)
  const [playerOnId, setPlayerOnId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  if (!isOpen) return null

  const onField = matchLineup.filter(l => l.is_on_field)
  const onBench = matchLineup.filter(l => !l.is_on_field)

  const getPlayer = (id: string) => players.find(p => p.id === id)

  const handleClose = () => {
    setPlayerOffId(null)
    setPlayerOnId(null)
    onClose()
  }

  const handleConfirm = async () => {
    if (!playerOffId || !playerOnId || confirming) return
    setConfirming(true)
    try {
      await onConfirm(playerOffId, playerOnId)
      setPlayerOffId(null)
      setPlayerOnId(null)
      onClose()
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={handleClose} />

      <div className="relative w-full max-w-md glass-card p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full bg-emerald-500/20">
              <ArrowLeftRight className="text-emerald-400" size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Substitution</h2>
              <p className="text-white/40 text-xs">{minute}'</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-white/60 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="flex gap-2 mb-5">
          <div className={`flex-1 h-1 rounded-full transition-all duration-300 ${playerOffId ? 'bg-red-400' : 'bg-white/10'}`} />
          <div className={`flex-1 h-1 rounded-full transition-all duration-300 ${playerOnId ? 'bg-emerald-400' : 'bg-white/10'}`} />
        </div>

        {/* Coming Off */}
        <div className="mb-4">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
            style={{ color: playerOffId ? '#f87171' : 'rgba(255,255,255,0.4)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
            Coming Off {playerOffId ? '✓' : '— tap player'}
          </p>
          <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
            {onField.map(entry => {
              const player = getPlayer(entry.player_id)
              const name = player?.name ?? entry.player_name ?? 'Unknown'
              const jersey = entry.match_jersey_number ?? entry.player_jersey_number
              const posLabel = POSITION_LABELS[entry.position_id] ?? entry.position_id?.toUpperCase() ?? 'P'
              const isSelected = playerOffId === entry.player_id
              return (
                <button
                  key={entry.player_id}
                  onClick={() => setPlayerOffId(isSelected ? null : entry.player_id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-red-500/20 border-red-400/50 text-red-200'
                      : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 active:scale-[0.98]'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                    style={{ backgroundColor: jerseyBg, color: jerseyText }}
                  >
                    {jersey ?? posLabel}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className="text-sm font-semibold truncate">{name}</p>
                    <p className="text-[10px] text-white/40">{posLabel}</p>
                  </div>
                  {isSelected && <span className="text-red-400 text-[10px] font-bold flex-shrink-0">OFF ✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Coming On */}
        <div className="mb-5">
          <p className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5"
            style={{ color: playerOnId ? '#34d399' : 'rgba(255,255,255,0.4)' }}>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
            Coming On {playerOnId ? '✓' : '— tap player'}
          </p>
          <div className="space-y-1 max-h-44 overflow-y-auto pr-1">
            {onBench.length === 0 ? (
              <p className="text-white/30 text-xs italic px-3 py-2">No substitutes on the bench</p>
            ) : onBench.map(entry => {
              const player = getPlayer(entry.player_id)
              const name = player?.name ?? entry.player_name ?? 'Unknown'
              const jersey = entry.match_jersey_number ?? entry.player_jersey_number
              const isSelected = playerOnId === entry.player_id
              return (
                <button
                  key={entry.player_id}
                  onClick={() => setPlayerOnId(isSelected ? null : entry.player_id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl border transition-all ${
                    isSelected
                      ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-200'
                      : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-white/20 active:scale-[0.98]'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-[10px] flex-shrink-0 opacity-70"
                    style={{ backgroundColor: jerseyBg, color: jerseyText }}
                  >
                    {jersey ?? 'S'}
                  </div>
                  <p className="flex-1 text-left text-sm font-semibold truncate">{name}</p>
                  {isSelected && <span className="text-emerald-400 text-[10px] font-bold flex-shrink-0">ON ✓</span>}
                </button>
              )
            })}
          </div>
        </div>

        <button
          onClick={handleConfirm}
          disabled={!playerOffId || !playerOnId || confirming}
          className="w-full bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
        >
          {confirming ? 'Confirming…' : 'Confirm Substitution'}
        </button>
      </div>
    </div>
  )
}
