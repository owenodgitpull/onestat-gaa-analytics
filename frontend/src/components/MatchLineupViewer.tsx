import { X, Users } from 'lucide-react'
import { useClub } from '@/contexts/ClubContext'
import ManMarkingPanel from './ManMarkingPanel'
import type { ManMarkingAssignment } from '../services/api'
import type { Player } from '../types'

interface LineupPlayer {
  player_id: string
  position_id: string
  is_substitute: boolean
  is_on_field: boolean
  player_name: string
  player_jersey_number: number | null
  match_jersey_number: number | null
}

interface PlayerMeta {
  goals: number
  points: number
  pointsFree: number
  twoPointers: number
  twoPointersFree: number
  fortyFives: number
  penaltyGoals: number
  yellowCard: boolean
  blackCard: boolean
  redCard: boolean
  subbedOff: boolean
}

interface MatchLineupViewerProps {
  isOpen: boolean
  onClose: () => void
  lineup: LineupPlayer[]
  events: any[]
  opponentName: string
  matchId?: string
  markingAssignments?: ManMarkingAssignment[]
  players?: Player[]
  onAddMarking?: (playerId: string, opponentName: string, notes?: string) => void
  onDeleteMarking?: (assignmentId: string) => void
}

const CAPTAIN_RE = /\s*\((?:c|vc)\)\s*$/i

function displaySurname(name: string) {
  const clean = name.replace(CAPTAIN_RE, '').trim()
  const isCaptain = /\(c\)/i.test(name)
  const surname = clean.split(' ').pop() || clean
  return isCaptain ? `${surname} ©` : surname
}

interface FormationPos {
  id: string
  x: number
  y: number
  label: string
}

const FORMATION_POSITIONS: FormationPos[] = [
  { id: 'gk', x: 7, y: 50, label: 'GK' },
  { id: 'fb-left', x: 20, y: 18, label: 'CB' },
  { id: 'fb-center', x: 20, y: 50, label: 'FB' },
  { id: 'fb-right', x: 20, y: 82, label: 'CB' },
  { id: 'hb-left', x: 35, y: 18, label: 'HB' },
  { id: 'hb-center', x: 35, y: 50, label: 'CHB' },
  { id: 'hb-right', x: 35, y: 82, label: 'HB' },
  { id: 'mf-left', x: 50, y: 35, label: 'MF' },
  { id: 'mf-right', x: 50, y: 65, label: 'MF' },
  { id: 'hf-left', x: 65, y: 18, label: 'HF' },
  { id: 'hf-center', x: 65, y: 50, label: 'CHF' },
  { id: 'hf-right', x: 65, y: 82, label: 'HF' },
  { id: 'ff-left', x: 80, y: 18, label: 'CF' },
  { id: 'ff-center', x: 80, y: 50, label: 'FF' },
  { id: 'ff-right', x: 80, y: 82, label: 'CF' },
]

function buildPlayerMeta(events: any[]): Map<string, PlayerMeta> {
  const map = new Map<string, PlayerMeta>()

  const getOrCreate = (pid: string): PlayerMeta => {
    if (!map.has(pid)) {
      map.set(pid, {
        goals: 0, points: 0, pointsFree: 0, twoPointers: 0,
        twoPointersFree: 0, fortyFives: 0, penaltyGoals: 0,
        yellowCard: false, blackCard: false, redCard: false,
        subbedOff: false,
      })
    }
    return map.get(pid)!
  }

  for (const e of events) {
    if (!e.player_id) continue
    const pid = String(e.player_id)
    const team = e.team || (e.is_home_team ? 'own' : 'opponent')
    if (team !== 'own') continue

    const m = getOrCreate(pid)
    switch (e.event_type) {
      case 'goal': m.goals++; break
      case 'point': m.points++; break
      case 'point_free': m.pointsFree++; break
      case 'two_point': m.twoPointers++; break
      case 'two_point_free': m.twoPointersFree++; break
      case 'forty_five': m.fortyFives++; break
      case 'penalty_goal': m.penaltyGoals++; break
      case 'yellow_card': m.yellowCard = true; break
      case 'black_card': m.blackCard = true; break
      case 'red_card': m.redCard = true; break
      case 'substitution': m.subbedOff = true; break
    }
  }

  return map
}

function formatScoreLine(m: PlayerMeta): string {
  const parts: string[] = []

  // Main score: goals-points format (combining all point types)
  const totalGoals = m.goals + m.penaltyGoals
  const totalPoints = m.points + m.pointsFree + m.twoPointers * 2 + m.twoPointersFree * 2 + m.fortyFives

  if (totalGoals > 0 || totalPoints > 0) {
    parts.push(`${totalGoals}-${String(totalPoints).padStart(2, '0')}`)
  }

  // Detail breakdown in parentheses
  const details: string[] = []
  if (m.pointsFree > 0) details.push(`${m.pointsFree}f`)
  if (m.twoPointers > 0) details.push(`${m.twoPointers}tp`)
  if (m.twoPointersFree > 0) details.push(`${m.twoPointersFree}tpf`)
  if (m.fortyFives > 0) details.push(`${m.fortyFives}×45`)
  if (m.penaltyGoals > 0) details.push(`${m.penaltyGoals}pen`)

  if (details.length > 0 && parts.length > 0) {
    parts[0] += ` (${details.join(', ')})`
  }

  return parts.join('')
}

export default function MatchLineupViewer({ isOpen, onClose, lineup, events, opponentName, matchId, markingAssignments, players, onAddMarking, onDeleteMarking }: MatchLineupViewerProps) {
  const { club } = useClub()
  const jerseyBg = club?.primary_colour || '#10B981'
  const jerseyText = club?.secondary_colour || '#FFFFFF'

  if (!isOpen) return null

  const playerMeta = buildPlayerMeta(events)

  const starters = lineup.filter(l => !l.is_substitute)
  const subs = lineup.filter(l => l.is_substitute)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 animate-fade-in">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-4xl glass-card p-3 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3 sm:mb-5">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="p-2 sm:p-2.5 rounded-full bg-emerald-500/20">
              <Users className="text-emerald-400" size={18} />
            </div>
            <div>
              <h2 className="text-base sm:text-xl font-bold text-white">Match Lineup</h2>
              <p className="text-[11px] sm:text-xs text-white/40">vs {opponentName}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        {/* Pitch */}
        <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden aspect-[16/10]">
          <svg viewBox="0 0 2332 1446" className="absolute inset-0 w-full h-full opacity-40">
            <rect width="2332" height="1446" fill="#2d5016" />
            <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          </svg>

          {FORMATION_POSITIONS.map((pos) => {
            const player = starters.find(l => l.position_id === pos.id)
            if (!player) return null

            const jersey = player.match_jersey_number ?? player.player_jersey_number
            const meta = playerMeta.get(String(player.player_id))
            const scoreLine = meta ? formatScoreLine(meta) : ''
            const isSubbedOff = meta?.subbedOff || !player.is_on_field

            return (
              <div
                key={pos.id}
                className="absolute transform -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
              >
                {/* Jersey */}
                <div
                  className={`w-6 h-6 sm:w-12 sm:h-12 rounded-full flex items-center justify-center font-bold text-[9px] sm:text-sm ring-1 sm:ring-2 shadow-lg transition-opacity ${isSubbedOff ? 'opacity-50' : ''}`}
                  style={{ backgroundColor: jerseyBg, color: jerseyText, '--tw-ring-color': jerseyText } as React.CSSProperties}
                >
                  {jersey ?? pos.label}
                </div>

                {/* Name + score */}
                <div className="absolute top-full mt-0.5 left-1/2 transform -translate-x-1/2 whitespace-nowrap flex flex-col items-center">
                  <span className="text-white text-[6px] sm:text-xs font-semibold bg-black/60 px-1 py-px sm:px-1.5 sm:py-0.5 rounded">
                    {displaySurname(player.player_name)}
                    {isSubbedOff && <span className="text-amber-400 ml-0.5">↓</span>}
                  </span>
                  {scoreLine && (
                    <span className="text-emerald-400 text-[5px] sm:text-[10px] font-bold bg-black/70 px-1 py-px sm:px-1.5 sm:py-0.5 rounded mt-0.5">
                      {scoreLine}
                    </span>
                  )}
                  {/* Cards */}
                  {meta && (meta.yellowCard || meta.blackCard || meta.redCard) && (
                    <div className="flex gap-0.5 mt-0.5">
                      {meta.yellowCard && <div className="w-1.5 h-2 sm:w-2.5 sm:h-3.5 rounded-[1px] bg-yellow-400" />}
                      {meta.blackCard && <div className="w-1.5 h-2 sm:w-2.5 sm:h-3.5 rounded-[1px] bg-gray-900 border border-white/30" />}
                      {meta.redCard && <div className="w-1.5 h-2 sm:w-2.5 sm:h-3.5 rounded-[1px] bg-red-600" />}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Substitutes */}
        {subs.length > 0 && (
          <div className="mt-3 sm:mt-4">
            <h3 className="text-xs sm:text-sm font-semibold text-white/50 mb-2">Substitutes</h3>
            <div className="flex flex-wrap gap-x-2.5 sm:gap-x-4 gap-y-2 justify-center">
              {subs.map((player, i) => {
                const jersey = player.match_jersey_number ?? player.player_jersey_number
                const meta = playerMeta.get(String(player.player_id))
                const scoreLine = meta ? formatScoreLine(meta) : ''
                const cameOn = player.is_on_field

                return (
                  <div key={player.player_id} className="flex flex-col items-center">
                    <div
                      className={`w-7 h-7 sm:w-9 sm:h-9 rounded-full flex items-center justify-center font-bold text-[10px] sm:text-xs ring-1 sm:ring-2 shadow-lg ${!cameOn ? 'opacity-40' : ''}`}
                      style={{ backgroundColor: jerseyBg, color: jerseyText, '--tw-ring-color': jerseyText } as React.CSSProperties}
                    >
                      {jersey ?? `S${i + 1}`}
                    </div>
                    <span className={`text-[9px] sm:text-[10px] font-semibold mt-1 ${cameOn ? 'text-white/80' : 'text-white/40'}`}>
                      {displaySurname(player.player_name)}
                      {cameOn && <span className="text-emerald-400 ml-0.5">↑</span>}
                    </span>
                    {scoreLine && (
                      <span className="text-emerald-400 text-[8px] sm:text-[9px] font-bold">{scoreLine}</span>
                    )}
                    {meta && (meta.yellowCard || meta.blackCard || meta.redCard) && (
                      <div className="flex gap-0.5 mt-0.5">
                        {meta.yellowCard && <div className="w-1.5 h-2.5 sm:w-2 sm:h-3 rounded-[1px] bg-yellow-400" />}
                        {meta.blackCard && <div className="w-1.5 h-2.5 sm:w-2 sm:h-3 rounded-[1px] bg-gray-900 border border-white/30" />}
                        {meta.redCard && <div className="w-1.5 h-2.5 sm:w-2 sm:h-3 rounded-[1px] bg-red-600" />}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Legend */}
        <div className="mt-3 sm:mt-4 flex flex-wrap gap-2 sm:gap-3 text-[9px] sm:text-[10px] text-white/40 justify-center">
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">0-02 (1f)</span> = score (frees)</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">tp</span> = two-pointer</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">tpf</span> = two-point free</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400 font-bold">45</span> = forty-five</span>
          <span className="flex items-center gap-1"><span className="text-amber-400">↓</span> subbed off</span>
          <span className="flex items-center gap-1"><span className="text-emerald-400">↑</span> came on</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-3.5 rounded-[1px] bg-yellow-400 inline-block" /> yellow</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-3.5 rounded-[1px] bg-gray-900 border border-white/30 inline-block" /> black</span>
          <span className="flex items-center gap-1"><div className="w-2.5 h-3.5 rounded-[1px] bg-red-600 inline-block" /> red</span>
        </div>

        {/* Man Marking Assignments */}
        {matchId && onAddMarking && onDeleteMarking && (
          <div className="mt-6 pt-5 border-t border-white/10">
            <ManMarkingPanel
              matchId={matchId}
              assignments={markingAssignments || []}
              players={players || []}
              onAdd={onAddMarking}
              onDelete={onDeleteMarking}
            />
          </div>
        )}
      </div>
    </div>
  )
}
