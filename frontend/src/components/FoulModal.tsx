import { AlertTriangle } from 'lucide-react'
import { Player, PossessionTeam } from '@/types'

interface FoulModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: (playerId: string) => void
  players: Player[]
  currentPossession: PossessionTeam
  opponentName: string
}

export default function FoulModal({
  isOpen,
  onClose,
  onConfirm,
  players,
  currentPossession,
  opponentName
}: FoulModalProps) {
  if (!isOpen) return null

  const isOppositionFoul = currentPossession === PossessionTeam.OPPONENT
  const title = isOppositionFoul ? 'Foul - Who Was Fouled?' : 'Foul - Who Committed It?'
  const subtitle = isOppositionFoul
    ? `${opponentName} committed a foul on which player?`
    : 'Which of our players committed the foul?'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl glass-card p-8 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center space-x-4 mb-6">
          <div className="p-3 rounded-full bg-amber-500/20">
            <AlertTriangle className="text-amber-400" size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">{title}</h2>
            <p className="text-white/70 mt-1">{subtitle}</p>
          </div>
        </div>

        {/* Player Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          {players.filter(p => p.active).map((player) => (
            <button
              key={player.id}
              onClick={() => {
                onConfirm(player.id)
                onClose()
              }}
              className="glass-card-hover p-4 text-left transition-all duration-200"
            >
              <div className="flex items-center space-x-3">
                {player.jersey_number && (
                  <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold">
                    {player.jersey_number}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-white font-semibold truncate">{player.name}</p>
                  <p className="text-white/60 text-sm capitalize">{player.position.replace(/_/g, ' ')}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Cancel Button */}
        <button
          onClick={onClose}
          className="w-full btn-glass"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
