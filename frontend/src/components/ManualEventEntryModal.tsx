import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { Player, EventType, PossessionTeam } from '@/types'
import { useClubName } from '@/contexts/ClubContext'

interface MatchLineupEntry {
  id: string
  match_id: string
  player_id: string
  position_id: string
  is_substitute: boolean
  is_on_field: boolean
  player_name: string
  player_jersey_number: number | null
}

interface ManualEventEntryModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (data: {
    eventType: EventType
    playerId: string | null
    playerComingOn?: string | null
    minute: number
    half: number
    team: PossessionTeam
    pitchX?: number
    pitchY?: number
  }) => void
  players: Player[]
  opponentName: string
  matchLineup?: MatchLineupEntry[]
  currentMinute?: number
  currentHalf?: 1 | 2
  defaultEventType?: EventType
}

export default function ManualEventEntryModal({
  isOpen,
  onClose,
  onSubmit,
  players,
  opponentName,
  matchLineup = [],
  currentMinute = 1,
  currentHalf = 1,
  defaultEventType,
}: ManualEventEntryModalProps) {
  const clubName = useClubName()
  const [eventType, setEventType] = useState<EventType>(EventType.POINT)
  const [playerId, setPlayerId] = useState<string>('')
  const [playerComingOn, setPlayerComingOn] = useState<string>('')
  const [minute, setMinute] = useState<number>(currentMinute)
  const [half, setHalf] = useState<number>(currentHalf)
  const [team, setTeam] = useState<PossessionTeam>(PossessionTeam.OWN)

  // Sync defaults when modal opens
  useEffect(() => {
    if (isOpen) {
      // Convert absolute minute to per-half minute for display
      const perHalfMinute = currentHalf === 2 ? Math.max(1, currentMinute - 30) : Math.max(1, currentMinute)
      setMinute(perHalfMinute)
      setHalf(currentHalf)
      if (defaultEventType) setEventType(defaultEventType)
    }
  }, [isOpen, currentMinute, currentHalf, defaultEventType])

  if (!isOpen) return null

  // Get players on field (for coming off)
  const getPlayersOnField = () => {
    if (!matchLineup.length) return players.filter(p => p.active)
    const onFieldIds = matchLineup.filter(l => l.is_on_field).map(l => l.player_id)
    return players.filter(p => p.active && onFieldIds.includes(p.id))
  }

  // Get players on bench (for coming on)
  const getPlayersOnBench = () => {
    if (!matchLineup.length) return players.filter(p => p.active)
    const onBenchIds = matchLineup.filter(l => !l.is_on_field).map(l => l.player_id)
    return players.filter(p => p.active && onBenchIds.includes(p.id))
  }

  const handleSubmit = () => {
    // Compute absolute minute: user enters per-half minute, backend expects absolute (0-60+)
    const absoluteMinute = half === 2 ? minute + 30 : minute
    onSubmit({
      eventType,
      playerId: playerId || null,
      playerComingOn: eventType === EventType.SUBSTITUTION ? (playerComingOn || null) : null,
      minute: absoluteMinute,
      half,
      team,
    })
    onClose()
  }

  // Event types that require player selection
  const requiresPlayer = ![
    EventType.OPP_UNFORCED_ERROR,
    EventType.WIDE,
    EventType.SHORT,
    EventType.SAVED
  ].includes(eventType) || team === PossessionTeam.OWN

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-2xl glass-card p-8 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="p-3 rounded-full bg-blue-500/20">
              <Plus className="text-blue-400" size={28} />
            </div>
            <h2 className="text-2xl font-bold text-white">Manual Event Entry</h2>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={24} />
          </button>
        </div>

        <div className="space-y-6">
          {/* Team Selection */}
          <div>
            <label className="block text-white/80 font-semibold mb-2">Team</label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setTeam(PossessionTeam.OWN)}
                className={`p-4 rounded-xl font-semibold transition-all ${
                  team === PossessionTeam.OWN
                    ? 'bg-emerald-600 text-white'
                    : 'glass-card text-white/70 hover:text-white'
                }`}
              >
                {clubName}
              </button>
              <button
                onClick={() => setTeam(PossessionTeam.OPPONENT)}
                className={`p-4 rounded-xl font-semibold transition-all ${
                  team === PossessionTeam.OPPONENT
                    ? 'bg-red-600 text-white'
                    : 'glass-card text-white/70 hover:text-white'
                }`}
              >
                {opponentName}
              </button>
            </div>
          </div>

          {/* Event Type */}
          <div>
            <label className="block text-white/80 font-semibold mb-2">Event Type</label>
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value as EventType)}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              <optgroup label="Scoring" className="bg-slate-800 text-white">
                <option value={EventType.GOAL} className="bg-slate-800 text-white">Goal</option>
                <option value={EventType.POINT} className="bg-slate-800 text-white">Point</option>
                <option value={EventType.TWO_POINT} className="bg-slate-800 text-white">2-Pointer</option>
                <option value={EventType.POINT_FREE} className="bg-slate-800 text-white">Point (Free)</option>
                <option value={EventType.TWO_POINT_FREE} className="bg-slate-800 text-white">2-Pointer (Free)</option>
                <option value={EventType.WIDE} className="bg-slate-800 text-white">Wide</option>
                <option value={EventType.WIDE_FREE} className="bg-slate-800 text-white">Wide (Free)</option>
                <option value={EventType.SHORT} className="bg-slate-800 text-white">Short</option>
                <option value={EventType.SAVED} className="bg-slate-800 text-white">Saved</option>
              </optgroup>
              <optgroup label="Turnovers" className="bg-slate-800 text-white">
                <option value={EventType.TURNOVER_WON} className="bg-slate-800 text-white">Turnover Won</option>
                <option value={EventType.TURNOVER_LOST} className="bg-slate-800 text-white">Turnover Lost</option>
                <option value={EventType.OUR_UNFORCED_ERROR} className="bg-slate-800 text-white">Unforced Error</option>
              </optgroup>
              <optgroup label="Fouls" className="bg-slate-800 text-white">
                <option value={EventType.FOUL_WON} className="bg-slate-800 text-white">Foul Won</option>
                <option value={EventType.FOUL_COMMITTED} className="bg-slate-800 text-white">Foul Committed</option>
                <option value={EventType.FREE_WON} className="bg-slate-800 text-white">Free Won</option>
                <option value={EventType.FREE_CONCEDED} className="bg-slate-800 text-white">Free Conceded</option>
              </optgroup>
              <optgroup label="Cards" className="bg-slate-800 text-white">
                <option value={EventType.YELLOW_CARD} className="bg-slate-800 text-white">Yellow Card</option>
                <option value={EventType.RED_CARD} className="bg-slate-800 text-white">Red Card</option>
              </optgroup>
              <optgroup label="Defense" className="bg-slate-800 text-white">
                <option value={EventType.BLOCK} className="bg-slate-800 text-white">Block</option>
                <option value={EventType.INTERCEPTION} className="bg-slate-800 text-white">Interception</option>
              </optgroup>
              <optgroup label="Substitutions" className="bg-slate-800 text-white">
                <option value={EventType.SUBSTITUTION} className="bg-slate-800 text-white">Substitution</option>
              </optgroup>
            </select>
          </div>

          {/* Player Selection (conditional) */}
          {eventType === EventType.SUBSTITUTION && team === PossessionTeam.OWN ? (
            <>
              {/* Player Coming Off */}
              <div>
                <label className="block text-white/80 font-semibold mb-2">Player Coming Off (On Field)</label>
                <select
                  value={playerId}
                  onChange={(e) => setPlayerId(e.target.value)}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="" className="bg-slate-800 text-white">Select player...</option>
                  {getPlayersOnField().map((player) => (
                    <option key={player.id} value={player.id} className="bg-slate-800 text-white">
                      {player.jersey_number ? `#${player.jersey_number} ` : ''}{player.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Player Coming On */}
              <div>
                <label className="block text-white/80 font-semibold mb-2">Player Coming On (On Bench)</label>
                <select
                  value={playerComingOn}
                  onChange={(e) => setPlayerComingOn(e.target.value)}
                  disabled={!playerId}
                  className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="" className="bg-slate-800 text-white">Select player...</option>
                  {getPlayersOnBench().map((player) => (
                    <option key={player.id} value={player.id} className="bg-slate-800 text-white">
                      {player.jersey_number ? `#${player.jersey_number} ` : ''}{player.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : requiresPlayer && team === PossessionTeam.OWN ? (
            <div>
              <label className="block text-white/80 font-semibold mb-2">Player</label>
              <select
                value={playerId}
                onChange={(e) => setPlayerId(e.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="" className="bg-slate-800 text-white">Select player...</option>
                {players.filter(p => p.active).map((player) => (
                  <option key={player.id} value={player.id} className="bg-slate-800 text-white">
                    {player.jersey_number ? `#${player.jersey_number} ` : ''}{player.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-white/80 font-semibold mb-2">Minute (in half)</label>
              <input
                type="number"
                min="1"
                max="35"
                value={minute}
                onChange={(e) => setMinute(parseInt(e.target.value) || 1)}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
              <p className="text-xs text-white/40 mt-1">
                Match minute: {half === 2 ? minute + 30 : minute}'
              </p>
            </div>
            <div>
              <label className="block text-white/80 font-semibold mb-2">Half</label>
              <select
                value={half}
                onChange={(e) => setHalf(parseInt(e.target.value))}
                className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value={1} className="bg-slate-800 text-white">1st Half</option>
                <option value={2} className="bg-slate-800 text-white">2nd Half</option>
              </select>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-4 pt-4">
            <button onClick={onClose} className="flex-1 btn-glass">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95"
            >
              Add Event
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
