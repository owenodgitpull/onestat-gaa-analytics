import { useState } from 'react'
import { X, Search, User, Trophy } from 'lucide-react'
import type { Player } from '../types'

interface PlayerSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectPlayer: (player: Player) => void
  eventType: string  // Accept any event type string
  team: 'own' | 'opponent'
  players: Player[]
}

// Mock players - TODO: Replace with API call
const OPPONENT_PLAYERS: Player[] = [
  { id: 'opp-1', name: 'Opposition Player 1', jersey_number: 1, position: 'GOALKEEPER', date_of_birth: null, status: 'active', active: true },
  { id: 'opp-2', name: 'Opposition Player 2', jersey_number: 2, position: 'DEFENDER', date_of_birth: null, status: 'active', active: true },
  { id: 'opp-3', name: 'Opposition Player 3', jersey_number: 3, position: 'DEFENDER', date_of_birth: null, status: 'active', active: true },
  { id: 'opp-4', name: 'Opposition Player 4', jersey_number: 4, position: 'MIDFIELDER', date_of_birth: null, status: 'active', active: true },
  { id: 'opp-5', name: 'Opposition Player 5', jersey_number: 5, position: 'FORWARD', date_of_birth: null, status: 'active', active: true },
]

// Type for event label entries
type EventLabelEntry = { title: string; icon: typeof User | typeof Trophy; color: string }

const EVENT_LABELS: Record<string, EventLabelEntry> = {
  goal: { title: 'Who Scored?', icon: Trophy, color: 'text-emerald-400' },
  point: { title: 'Who Scored?', icon: Trophy, color: 'text-blue-400' },
  assist: { title: 'Who Assisted?', icon: User, color: 'text-cyan-400' },
  turnover: { title: 'Who Won?', icon: User, color: 'text-amber-400' },
  kickout: { title: 'Who Won?', icon: User, color: 'text-emerald-400' },
  wide: { title: 'Who Took?', icon: User, color: 'text-red-400' },
  saved: { title: 'Who Shot (Saved)?', icon: User, color: 'text-blue-400' },
  // Turnovers
  turnover_won: { title: 'Who Won Turnover?', icon: User, color: 'text-emerald-400' },
  turnover_lost: { title: 'Who Lost Possession?', icon: User, color: 'text-red-400' },
  // Unforced errors
  our_unforced_error: { title: 'Who Made Unforced Error?', icon: User, color: 'text-red-400' },
  opp_unforced_error: { title: 'Who Made Unforced Error?', icon: User, color: 'text-red-400' },
  // Foul
  foul_committed: { title: 'Who Committed Foul?', icon: User, color: 'text-red-400' },
  // New explicit kickout labels
  own_kickout_won: { title: 'Who Won Our Kickout?', icon: User, color: 'text-emerald-400' },
  own_kickout_opposition_won: { title: 'Opposition Won (No Player)', icon: User, color: 'text-red-400' },
  opp_kickout_won: { title: 'Who Won Opposition Kickout?', icon: User, color: 'text-emerald-400' },
  opp_kickout_opposition_won: { title: 'Opposition Won (No Player)', icon: User, color: 'text-red-400' },
  own_kickout_won_break: { title: 'Who Won Break (Our Kickout)?', icon: User, color: 'text-emerald-400' },
  own_kickout_opposition_won_break: { title: 'Opposition Won Break (No Player)', icon: User, color: 'text-red-400' },
  opp_kickout_won_break: { title: 'Who Won Break (Opp Kickout)?', icon: User, color: 'text-emerald-400' },
  opp_kickout_opposition_won_break: { title: 'Opposition Won Break (No Player)', icon: User, color: 'text-red-400' },
}

export default function PlayerSelectionModal({
  isOpen,
  onClose,
  onSelectPlayer,
  eventType,
  team,
  players: providedPlayers
}: PlayerSelectionModalProps) {
  const [search, setSearch] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)

  if (!isOpen) return null

  const eventInfo = EVENT_LABELS[eventType] || { 
    title: 'Select Player', 
    icon: User, 
    color: 'text-white' 
  }
  const Icon = eventInfo.icon

  // Ensure players is an array
  const playerList = team === 'own' ? (Array.isArray(providedPlayers) ? providedPlayers : []) : OPPONENT_PLAYERS
  
  // Show message if no players available
  if (!playerList || playerList.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <div className="relative w-full max-w-md glass-card p-8 text-center">
          <User size={48} className="mx-auto text-white/20 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">No Players Found</h2>
          <p className="text-white/60 mb-6">
            Please add players to the database before recording match events.
          </p>
          <button onClick={onClose} className="btn-glass w-full">
            Close
          </button>
        </div>
      </div>
    )
  }
  
  const filteredPlayers = playerList.filter((player) =>
    player.name.toLowerCase().includes(search.toLowerCase()) ||
    (player.jersey_number?.toString() || '').includes(search)
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
                {eventType} • {team === 'own' ? 'Us' : 'Opponent'}
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
                      ? 'border-emerald-500 bg-emerald-500/20 scale-95'
                      : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/40 hover:scale-105'
                  }
                `}
              >
                <div className="flex items-center space-x-3">
                  {/* Jersey Number */}
                  <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center">
                    <span className="text-xl font-bold">{player.jersey_number || '?'}</span>
                  </div>
                  {/* Player Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-white truncate">{player.name}</h3>
                    {player.position && (
                      <p className="text-xs text-white/60 capitalize">{player.position.toLowerCase().replace('_', ' ')}</p>
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
            Skip
          </button>
        </div>
      </div>
    </div>
  )
}

