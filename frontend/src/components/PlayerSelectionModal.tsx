import { useState } from 'react'
import { X, Search, User, Trophy } from 'lucide-react'

interface Player {
  id: number
  name: string
  jerseyNumber: number
  position?: string
}

interface PlayerSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectPlayer: (player: Player) => void
  eventType: 'goal' | 'point' | 'assist' | 'turnover' | 'kickout' | 'wide'
  team: 'dungloe' | 'opponent'
}

// Mock players - TODO: Replace with API call
const DUNGLOE_PLAYERS: Player[] = [
  { id: 1, name: 'Barry Curran', jerseyNumber: 8, position: 'Midfielder' },
  { id: 2, name: 'Oran Gallagher', jerseyNumber: 12, position: 'Forward' },
  { id: 3, name: 'Ryan Grannell', jerseyNumber: 14, position: 'Forward' },
  { id: 4, name: 'Shaun McGee', jerseyNumber: 11, position: 'Forward' },
  { id: 5, name: 'Paddy Bonner', jerseyNumber: 3, position: 'Defender' },
  { id: 6, name: 'Conor McBrearty', jerseyNumber: 10, position: 'Midfielder' },
  { id: 7, name: 'Danny McBrearty', jerseyNumber: 9, position: 'Forward' },
  { id: 8, name: 'Eoin McGee', jerseyNumber: 4, position: 'Defender' },
]

const EVENT_LABELS = {
  goal: { title: 'Who Scored?', icon: Trophy, color: 'text-emerald-400' },
  point: { title: 'Who Scored?', icon: Trophy, color: 'text-blue-400' },
  assist: { title: 'Who Assisted?', icon: User, color: 'text-purple-400' },
  turnover: { title: 'Who Won?', icon: User, color: 'text-amber-400' },
  kickout: { title: 'Who Won?', icon: User, color: 'text-indigo-400' },
  wide: { title: 'Who Took?', icon: User, color: 'text-red-400' },
}

export default function PlayerSelectionModal({
  isOpen,
  onClose,
  onSelectPlayer,
  eventType,
  team,
}: PlayerSelectionModalProps) {
  const [search, setSearch] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(null)

  if (!isOpen) return null

  const eventInfo = EVENT_LABELS[eventType]
  const Icon = eventInfo.icon

  const players = team === 'dungloe' ? DUNGLOE_PLAYERS : []
  const filteredPlayers = players.filter((player) =>
    player.name.toLowerCase().includes(search.toLowerCase()) ||
    player.jerseyNumber.toString().includes(search)
  )

  const handleSelect = (player: Player) => {
    setSelectedPlayerId(player.id)
    // Slight delay for visual feedback before closing
    setTimeout(() => {
      onSelectPlayer(player)
      setSearch('')
      setSelectedPlayerId(null)
    }, 200)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-2xl max-h-[80vh] glass-card overflow-hidden animate-scale-in">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10">
          <div className="flex items-center space-x-3">
            <div className={`p-2 rounded-lg bg-white/10 ${eventInfo.color}`}>
              <Icon size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">{eventInfo.title}</h2>
              <p className="text-sm text-white/60 capitalize">
                {eventType} • {team === 'dungloe' ? 'Dungloe' : 'Opponent'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white"
          >
            <X size={24} />
          </button>
        </div>

        {/* Search */}
        <div className="p-6 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
            <input
              type="text"
              placeholder="Search by name or number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-glass pl-12"
              autoFocus
            />
          </div>
        </div>

        {/* Player Grid */}
        <div className="p-6 overflow-y-auto max-h-[400px]">
          <div className="grid grid-cols-2 gap-3">
            {filteredPlayers.map((player) => (
              <button
                key={player.id}
                onClick={() => handleSelect(player)}
                className={`
                  p-4 rounded-xl border-2 transition-all duration-200 text-left
                  ${
                    selectedPlayerId === player.id
                      ? 'border-indigo-500 bg-indigo-500/20 scale-95'
                      : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/40 hover:scale-105'
                  }
                `}
              >
                <div className="flex items-center space-x-3">
                  {/* Jersey Number */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center">
                    <span className="text-xl font-bold">{player.jerseyNumber}</span>
                  </div>
                  {/* Player Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white truncate">{player.name}</h3>
                    {player.position && (
                      <p className="text-xs text-white/60">{player.position}</p>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>

          {filteredPlayers.length === 0 && (
            <div className="text-center py-12">
              <User size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/60">No players found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-white/10 bg-white/5">
          <button
            onClick={onClose}
            className="btn-glass w-full"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

