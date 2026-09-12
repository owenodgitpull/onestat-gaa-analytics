import { useState, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import SearchablePlayerSelect from '../SearchablePlayerSelect'

interface RosterPlayer {
  id: string
  name: string
  jersey_number: number | null
}

interface LineupEntry {
  player_id: string
  player_name?: string
  match_jersey_number?: number | null
  player_jersey_number?: number | null
}

export interface ManualEventSubmitPayload {
  eventType: string
  team: 'team_a' | 'team_b'
  playerId: string | null
  subInPlayerId?: string | null
  scoringContext?: Record<string, unknown>
}

interface VideoManualEventModalProps {
  isOpen: boolean
  onClose: () => void
  onSubmit: (payload: ManualEventSubmitPayload) => void
  players: RosterPlayer[]
  matchLineup: LineupEntry[]
  onFieldPlayerIds: Set<string>
  opponentName: string
  clubName: string
  currentMinute: number
  currentHalf: 1 | 2
}

interface EventOption {
  group: string
  label: string
  eventType: string
  scoringContext?: Record<string, unknown>
  ownOnly?: boolean // event only makes sense for our own team (e.g. own-kickout variants)
}

const EVENT_OPTIONS: EventOption[] = [
  { group: 'Scoring', label: 'Goal', eventType: 'GOAL_SCORED' },
  { group: 'Scoring', label: 'Point', eventType: 'POINT_SCORED', scoringContext: { source: 'FROM_PLAY' } },
  { group: 'Scoring', label: '2-Pointer', eventType: 'POINT_SCORED', scoringContext: { source: 'FROM_PLAY', is_two_pointer: true } },
  { group: 'Scoring', label: 'Point (Free)', eventType: 'FREE_KICK', scoringContext: { scored: true } },
  { group: 'Scoring', label: '2-Pointer (Free)', eventType: 'FREE_KICK', scoringContext: { scored: true, is_two_pointer: true } },
  { group: 'Scoring', label: 'Free — Wide', eventType: 'FREE_KICK', scoringContext: { wide: true } },
  { group: 'Scoring', label: '45 (Scored)', eventType: 'FORTY_FIVE', scoringContext: { scored: true } },
  { group: 'Scoring', label: '45 (Missed)', eventType: 'FORTY_FIVE', scoringContext: { scored: false } },
  { group: 'Scoring', label: 'Penalty (Scored)', eventType: 'PENALTY', scoringContext: { scored: true } },
  { group: 'Scoring', label: 'Penalty (Missed)', eventType: 'PENALTY', scoringContext: { scored: false } },
  { group: 'Scoring', label: 'Wide', eventType: 'WIDE' },
  { group: 'Scoring', label: 'Short', eventType: 'SHORT' },
  { group: 'Scoring', label: 'Post Hit', eventType: 'POST_HIT' },
  { group: 'Scoring', label: 'Goal Chance (Saved)', eventType: 'GOAL_CHANCE' },

  { group: 'Turnovers', label: 'Turnover Won', eventType: 'TURNOVER_WON' },
  { group: 'Turnovers', label: 'Turnover Lost', eventType: 'TURNOVER_LOST' },
  { group: 'Turnovers', label: 'Unforced Error (Ours)', eventType: 'OUR_UNFORCED_ERROR' },
  { group: 'Turnovers', label: 'Unforced Error (Theirs)', eventType: 'OPP_UNFORCED_ERROR' },

  { group: 'Fouls', label: 'Free Kick', eventType: 'FREE_KICK' },

  { group: 'Cards', label: 'Yellow Card', eventType: 'YELLOW_CARD' },
  { group: 'Cards', label: 'Red Card', eventType: 'RED_CARD' },
  { group: 'Cards', label: 'Black Card', eventType: 'BLACK_CARD' },

  { group: 'Defense', label: 'Block Shot', eventType: 'BLOCK_SHOT' },
  { group: 'Defense', label: 'Block Pass', eventType: 'BLOCK_PASS' },
  { group: 'Defense', label: 'Interception', eventType: 'INTERCEPTION' },
  { group: 'Defense', label: 'Hook', eventType: 'HOOK' },
  { group: 'Defense', label: 'Spoil', eventType: 'SPOIL' },
  { group: 'Defense', label: 'Tackle', eventType: 'TACKLE' },
  { group: 'Defense', label: 'Ball Won', eventType: 'BALL_WON' },

  { group: 'Kickouts', label: 'Own Kickout — We Won', eventType: 'OWN_KICKOUT_WON' },
  { group: 'Kickouts', label: 'Own Kickout — Opposition Won', eventType: 'OWN_KICKOUT_OPPOSITION_WON' },
  { group: 'Kickouts', label: 'Own Kickout — We Won Break', eventType: 'OWN_KICKOUT_WON_BREAK' },
  { group: 'Kickouts', label: 'Own Kickout — Opposition Won Break', eventType: 'OWN_KICKOUT_OPPOSITION_WON_BREAK' },
  { group: 'Kickouts', label: 'Opp Kickout — We Won', eventType: 'OPP_KICKOUT_WON' },
  { group: 'Kickouts', label: 'Opp Kickout — Opposition Won', eventType: 'OPP_KICKOUT_OPPOSITION_WON' },
  { group: 'Kickouts', label: 'Opp Kickout — We Won Break', eventType: 'OPP_KICKOUT_WON_BREAK' },
  { group: 'Kickouts', label: 'Opp Kickout — Opposition Won Break', eventType: 'OPP_KICKOUT_OPPOSITION_WON_BREAK' },
  { group: 'Kickouts', label: 'Sideline Kick (Restart Out)', eventType: 'SIDELINE_KICK' },
  { group: 'Kickouts', label: 'Sideline Ball (Open Play)', eventType: 'SIDELINE_BALL' },

  { group: 'Substitution', label: 'Substitution', eventType: 'SUB_ON' },

  { group: 'Match Flow', label: 'Injury Stoppage', eventType: 'INJURY_STOPPAGE' },
  { group: 'Match Flow', label: 'Water Break', eventType: 'WATER_BREAK' },
]

function isKickoutType(eventType: string): boolean {
  return eventType.toUpperCase().includes('KICKOUT')
}

const optionKey = (o: EventOption) => `${o.eventType}::${o.label}`

export default function VideoManualEventModal({
  isOpen,
  onClose,
  onSubmit,
  players,
  matchLineup,
  onFieldPlayerIds,
  opponentName,
  clubName,
  currentMinute,
  currentHalf,
}: VideoManualEventModalProps) {
  const [selectedKey, setSelectedKey] = useState(optionKey(EVENT_OPTIONS[1]))
  const [team, setTeam] = useState<'team_a' | 'team_b'>('team_a')
  const [playerId, setPlayerId] = useState('')
  const [playerComingOn, setPlayerComingOn] = useState('')

  useEffect(() => {
    if (isOpen) {
      setSelectedKey(optionKey(EVENT_OPTIONS[1]))
      setTeam('team_a')
      setPlayerId('')
      setPlayerComingOn('')
    }
  }, [isOpen])

  if (!isOpen) return null

  const selected = EVENT_OPTIONS.find(o => optionKey(o) === selectedKey) ?? EVENT_OPTIONS[1]
  const isSub = selected.eventType === 'SUB_ON'
  const kickout = isKickoutType(selected.eventType)

  const rosterOptions = players.map(p => {
    const lineupEntry = matchLineup.find(l => l.player_id === p.id)
    return {
      id: p.id,
      name: p.name,
      jerseyNumber: lineupEntry?.match_jersey_number ?? lineupEntry?.player_jersey_number ?? p.jersey_number,
    }
  })

  const onFieldOptions = rosterOptions.filter(p => onFieldPlayerIds.has(p.id))
  const benchOptions = rosterOptions.filter(p => !onFieldPlayerIds.has(p.id))

  const groups = Array.from(new Set(EVENT_OPTIONS.map(o => o.group)))

  const handleSubmit = () => {
    onSubmit({
      eventType: selected.eventType,
      team: isSub ? 'team_a' : team,
      playerId: isSub ? (playerId || null) : (playerId || null),
      subInPlayerId: isSub ? (playerComingOn || null) : undefined,
      scoringContext: selected.scoringContext,
    })
    onClose()
  }

  const canSubmit = isSub ? !!playerId && !!playerComingOn : true

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg glass-card p-6 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-full bg-blue-500/20">
              <Plus className="text-blue-400" size={20} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Manual Event</h2>
              <p className="text-white/40 text-xs">{currentHalf === 2 ? currentMinute + 30 : currentMinute}' (Half {currentHalf})</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-5">
          {!isSub && !kickout && (
            <div>
              <label className="block text-white/80 text-sm font-semibold mb-2">Team</label>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setTeam('team_a')}
                  className={`p-3 rounded-xl text-sm font-semibold transition-all border-2 ${
                    team === 'team_a'
                      ? 'bg-emerald-600 text-white border-emerald-400 ring-2 ring-emerald-400/30'
                      : 'bg-white/5 text-white/40 border-white/10'
                  }`}
                >
                  {clubName}
                </button>
                <button
                  onClick={() => setTeam('team_b')}
                  className={`p-3 rounded-xl text-sm font-semibold transition-all border-2 ${
                    team === 'team_b'
                      ? 'bg-red-600 text-white border-red-400 ring-2 ring-red-400/30'
                      : 'bg-white/5 text-white/40 border-white/10'
                  }`}
                >
                  {opponentName}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-white/80 text-sm font-semibold mb-2">Event Type</label>
            <select
              value={selectedKey}
              onChange={(e) => { setSelectedKey(e.target.value); setPlayerId(''); setPlayerComingOn('') }}
              className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            >
              {groups.map(group => (
                <optgroup key={group} label={group} className="bg-slate-800 text-white">
                  {EVENT_OPTIONS.filter(o => o.group === group).map(o => (
                    <option key={optionKey(o)} value={optionKey(o)} className="bg-slate-800 text-white">
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {isSub ? (
            <>
              <div>
                <label className="block text-white/80 text-sm font-semibold mb-2">Coming Off</label>
                <SearchablePlayerSelect value={playerId} onChange={setPlayerId} players={onFieldOptions} placeholder="Select player coming off..." />
              </div>
              <div>
                <label className="block text-white/80 text-sm font-semibold mb-2">Coming On</label>
                <SearchablePlayerSelect value={playerComingOn} onChange={setPlayerComingOn} disabled={!playerId} players={benchOptions} placeholder="Select player coming on..." />
              </div>
            </>
          ) : (team === 'team_a' || kickout) && (
            <div>
              <label className="block text-white/80 text-sm font-semibold mb-2">
                Player {kickout && <span className="font-normal text-white/40">(optional)</span>}
              </label>
              <SearchablePlayerSelect value={playerId} onChange={setPlayerId} players={rosterOptions} />
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 px-4 py-3 rounded-xl bg-white/10 text-white/70 hover:text-white text-sm font-semibold transition-colors">
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={!canSubmit}
              className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-700 hover:to-emerald-800 text-white px-4 py-3 rounded-xl text-sm font-semibold transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Add Event
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
