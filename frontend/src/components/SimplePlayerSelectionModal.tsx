import { useState, useMemo } from 'react'
import { X, Search, User, Trophy, Hash } from 'lucide-react'
import type { Player } from '../types'

/**
 * Simple Scoring's own player-selection modal — a fork of PlayerSelectionModal
 * (never edited directly, matching this session's existing precedent for
 * touch-pitch UI, e.g. TaggingPitch forking GAAPitch) rather than a shared
 * component, since MatchRecording.tsx's version is well-tested and must not
 * change. Only real difference: the player-card layout. On a phone-width
 * grid, PlayerSelectionModal's single-line `truncate` name clipped almost
 * every player to 4-5 characters ("Aaro…") — this splits the name onto two
 * lines (first name / surname) at a smaller size so it fits in full, and
 * always shows the jersey number (falls back to a neutral badge, not a
 * generic silhouette icon, when one genuinely isn't set).
 */

interface PlayerSelectionModalProps {
  isOpen: boolean
  onClose: () => void
  onSelectPlayer: (player: Player) => void
  eventType: string
  team: 'own' | 'opponent'
  players: Player[]
  teamName?: string
  attackingRight?: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  suggestedPlayerId?: string | null
}

const POSITION_LINE: Record<string, number> = {
  goalkeeper: 0, defender: 1, midfielder: 2, forward: 3,
}

type EventLabelEntry = { title: string; icon: typeof User | typeof Trophy; color: string }

const EVENT_LABELS: Record<string, EventLabelEntry> = {
  goal: { title: 'Who Scored?', icon: Trophy, color: 'text-emerald-400' },
  point: { title: 'Who Scored?', icon: Trophy, color: 'text-blue-400' },
  assist: { title: 'Who Assisted?', icon: User, color: 'text-cyan-400' },
  turnover: { title: 'Who Won?', icon: User, color: 'text-amber-400' },
  kickout: { title: 'Who Won?', icon: User, color: 'text-emerald-400' },
  wide: { title: 'Who Took?', icon: User, color: 'text-red-400' },
  saved: { title: 'Who Shot (Saved)?', icon: User, color: 'text-blue-400' },
  turnover_won: { title: 'Who Won Turnover?', icon: User, color: 'text-emerald-400' },
  turnover_lost: { title: 'Who Lost Possession?', icon: User, color: 'text-red-400' },
  our_unforced_error: { title: 'Who Made Unforced Error?', icon: User, color: 'text-red-400' },
  opp_unforced_error: { title: 'Who Made Unforced Error?', icon: User, color: 'text-red-400' },
  foul_committed: { title: 'Who Committed Foul?', icon: User, color: 'text-red-400' },
  own_kickout_won: { title: 'Who Won Our Kickout?', icon: User, color: 'text-emerald-400' },
  own_kickout_opposition_won: { title: 'Opposition Won (No Player)', icon: User, color: 'text-red-400' },
  opp_kickout_won: { title: 'Who Won Opposition Kickout?', icon: User, color: 'text-emerald-400' },
  opp_kickout_opposition_won: { title: 'Opposition Won (No Player)', icon: User, color: 'text-red-400' },
  own_kickout_won_break: { title: 'Who Won Break (Our Kickout)?', icon: User, color: 'text-emerald-400' },
  own_kickout_opposition_won_break: { title: 'Opposition Won Break (No Player)', icon: User, color: 'text-red-400' },
  opp_kickout_won_break: { title: 'Who Won Break (Opp Kickout)?', icon: User, color: 'text-emerald-400' },
  opp_kickout_opposition_won_break: { title: 'Opposition Won Break (No Player)', icon: User, color: 'text-red-400' },
}

/** "Cianan McDaid" -> ["Cianan", "McDaid"]. Split on the FIRST space only,
 *  so a multi-word surname ("De Brún") stays together on the second line. */
function splitName(fullName: string): [string, string] {
  const idx = fullName.indexOf(' ')
  if (idx === -1) return [fullName, '']
  return [fullName.slice(0, idx), fullName.slice(idx + 1)]
}

export default function SimplePlayerSelectionModal({
  isOpen,
  onClose,
  onSelectPlayer,
  eventType,
  team,
  players: providedPlayers,
  teamName,
  attackingRight = true,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  suggestedPlayerId = null,
}: PlayerSelectionModalProps) {
  const [search, setSearch] = useState('')
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)

  const playerList = Array.isArray(providedPlayers) ? providedPlayers : []

  const byJersey = useMemo(() => {
    const map = new Map<number, Player>()
    playerList.forEach(p => { if (p.jersey_number != null) map.set(p.jersey_number, p) })
    return map
  }, [playerList])

  const jerseyNumbers = useMemo(() => {
    const entries = Array.from(byJersey.entries())
    entries.sort((a, b) => {
      const lineA = POSITION_LINE[a[1].position?.toLowerCase() || ''] ?? 2
      const lineB = POSITION_LINE[b[1].position?.toLowerCase() || ''] ?? 2
      const lineCompare = attackingRight ? lineA - lineB : lineB - lineA
      if (lineCompare !== 0) return lineCompare
      return (a[0]) - (b[0])
    })
    return entries.map(([num]) => num)
  }, [byJersey, attackingRight])

  if (!isOpen) return null

  const eventInfo = EVENT_LABELS[eventType] || { title: 'Select Player', icon: User, color: 'text-white' }
  const Icon = eventInfo.icon

  if (!playerList || playerList.length === 0) {
    return (
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-md glass-card p-8 text-center">
          <User size={48} className="mx-auto text-white/20 mb-4" />
          <h2 className="text-xl font-bold text-white mb-2">No Players on Field</h2>
          <p className="text-white/60 mb-6">Please set your starting lineup before recording match events.</p>
          <button onClick={onClose} className="btn-glass w-full">Close</button>
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
    setTimeout(() => {
      onSelectPlayer(player)
      setSearch('')
      setSelectedPlayerId(null)
    }, 90)
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-2xl max-h-[85vh] glass-card overflow-hidden animate-scale-in flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className={`p-2 rounded-lg bg-white/10 ${eventInfo.color} flex-shrink-0`}>
              <Icon size={22} />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg sm:text-2xl font-bold text-white truncate">{eventInfo.title}</h2>
              <p className="text-xs sm:text-sm text-white/60 capitalize truncate">
                {eventType} • {team === 'own' ? (teamName || 'Own') : 'Opposition'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60 hover:text-white flex-shrink-0"
          >
            <X size={22} />
          </button>
        </div>

        {/* Jersey number quick-select */}
        {jerseyNumbers.length > 0 && (
          <div className="px-4 sm:px-6 pt-3 pb-3 border-b border-white/10 flex-shrink-0">
            <div className="flex items-center gap-2 mb-2.5">
              <Hash size={13} className="text-white/30" />
              <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Tap jersey number</span>
            </div>
            <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
              {jerseyNumbers.map(num => {
                const player = byJersey.get(num)
                const surname = player ? splitName(player.name)[1] || splitName(player.name)[0] : ''
                const isSuggested = !!suggestedPlayerId && player?.id === suggestedPlayerId
                return (
                  <button
                    key={num}
                    onClick={() => { if (player) handleSelect(player) }}
                    className={`relative flex flex-col items-center justify-center rounded-xl transition-all active:scale-90 ${
                      selectedPlayerId === player?.id
                        ? 'ring-2 ring-white/60 scale-105'
                        : isSuggested
                        ? 'ring-[3px] ring-amber-400 scale-105'
                        : 'hover:scale-105 hover:brightness-110'
                    }`}
                    style={{
                      minHeight: 56,
                      backgroundColor: teamPrimaryColor,
                      border: `2px solid ${teamSecondaryColor}`,
                      color: teamSecondaryColor,
                      boxShadow: isSuggested ? '0 0 14px rgba(251,191,36,0.7)' : undefined,
                    }}
                  >
                    {isSuggested && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[8px] font-bold text-black bg-amber-400 px-1.5 py-0.5 rounded-full whitespace-nowrap shadow">
                        Last carrier
                      </span>
                    )}
                    <span className="text-lg font-black">{num}</span>
                    <span className="text-[9px] truncate max-w-full px-1 leading-tight opacity-70">{surname}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="px-4 sm:px-6 py-3 border-b border-white/10 flex-shrink-0">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input
              type="text"
              placeholder="Search by name or number..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="input-glass pl-11"
            />
          </div>
        </div>

        {/* Player grid — 3 columns, number badge + two-line name (first / last) */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
            {filteredPlayers.map((player) => {
              const isSuggested = !!suggestedPlayerId && player.id === suggestedPlayerId
              const [firstName, lastName] = splitName(player.name)
              return (
                <button
                  key={player.id}
                  onClick={() => handleSelect(player)}
                  className={`
                    relative p-2.5 rounded-xl border-2 transition-all duration-200 text-left flex items-center gap-2.5
                    ${
                      selectedPlayerId === player.id
                        ? 'border-emerald-500 bg-emerald-500/20 scale-95'
                        : isSuggested
                        ? 'border-amber-400 bg-amber-400/10 hover:bg-amber-400/15 hover:scale-105'
                        : 'border-white/20 bg-white/5 hover:bg-white/10 hover:border-white/40 hover:scale-105'
                    }
                  `}
                  style={isSuggested ? { boxShadow: '0 0 14px rgba(251,191,36,0.35)' } : undefined}
                >
                  {isSuggested && (
                    <span className="absolute -top-2 left-2 text-[7px] font-bold text-black bg-amber-400 px-1.5 py-0.5 rounded-full whitespace-nowrap shadow">
                      Last carrier
                    </span>
                  )}
                  {/* Jersey number badge */}
                  <div
                    className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center font-black text-sm"
                    style={{ backgroundColor: teamPrimaryColor, color: teamSecondaryColor }}
                  >
                    {player.jersey_number ?? '?'}
                  </div>
                  {/* Name — first name top, surname bottom, small enough to
                      fit in full at 2-3 columns wide on a phone screen */}
                  <div className="min-w-0 leading-tight">
                    <p className="text-white font-semibold text-[12px] truncate">{firstName}</p>
                    {lastName && <p className="text-white/60 text-[11px] truncate">{lastName}</p>}
                  </div>
                </button>
              )
            })}
          </div>

          {filteredPlayers.length === 0 && (
            <div className="text-center py-12">
              <User size={48} className="mx-auto text-white/20 mb-4" />
              <p className="text-white/60">No players found</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-white/10 bg-white/5 flex-shrink-0">
          <button onClick={onClose} className="btn-glass w-full flex flex-col items-center gap-0.5">
            <span>Skip Player</span>
            <span className="text-[11px] text-white/40 font-normal">Event will still be logged — assign player later</span>
          </button>
        </div>
      </div>
    </div>
  )
}
