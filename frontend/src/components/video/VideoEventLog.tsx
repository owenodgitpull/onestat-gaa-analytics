/**
 * VideoEventLog — Scrollable event list with score progression, edit/delete actions.
 *
 * Shows running score with two-pointer annotations.
 * AI events (gemini_auto / keyframe_auto) get a purple "AI" badge and render dimmer until verified.
 * Supports collapsible mode: collapsed shows ~5 recent events, expanded scrolls full list.
 * Inline "add zone" button opens a pitch zone picker for events missing a pitch_zone.
 */

import { useMemo, useRef, useEffect, useState } from 'react'
import { Trash2, CheckCircle, Bot, ChevronDown, ChevronUp, MapPin, X, Pencil } from 'lucide-react'
import type { VideoEvent } from '../../services/videoApi'
import PitchZoneSelector from './PitchZoneSelector'
import type { PitchZone } from './PitchZoneSelector'

interface VideoEventLogProps {
  events: VideoEvent[]
  onSeek: (timestampMs: number) => void
  onDelete: (eventId: string) => void
  onVerify: (eventId: string) => void
  onEditZone?: (eventId: string, zone: PitchZone) => void
  /** Open the team-swap confirm for this event — parity with live
   * recording's handleEditEventClick/editChoice flow. */
  onEditTeam?: (eventId: string) => void
  /** Open the player picker for this event with no team change. */
  onEditPlayer?: (eventId: string) => void
  selectedEventId?: string | null
  collapsed?: boolean
  onToggle?: () => void
  onVerifyAll?: () => void
}

const EVENT_LABELS: Record<string, string> = {
  POINT_SCORED: 'Point', GOAL_SCORED: 'Goal', WIDE: 'Wide', SHORT: 'Short',
  POST_HIT: 'Post', GOAL_CHANCE: 'Goal Chance',
  PASS_HAND: 'Hand Pass', PASS_KICK: 'Kick Pass', SOLO_RUN: 'Solo',
  CATCH: 'Catch', PICKUP: 'Pick Up', MARK_CLAIMED: 'Mark',
  TACKLE: 'Tackle', BLOCK_SHOT: 'Block Shot', BLOCK_PASS: 'Block Pass',
  INTERCEPTION: 'Intercept', HOOK: 'Hook', SPOIL: 'Spoil',
  BALL_WON: 'Ball Won', TURNOVER_WON: 'T/O Won', TURNOVER_LOST: 'T/O Lost',
  FREE_KICK: 'Free', FORTY_FIVE: '45m Free', SIDELINE_KICK: 'Sideline',
  PENALTY: 'Penalty', KICKOUT_SHORT: 'KO Short', KICKOUT_LONG: 'KO Long',
  THROW_IN: 'Throw In',
  YELLOW_CARD: 'Yellow Card', RED_CARD: 'Red Card', BLACK_CARD: 'Black Card',
  SUB_ON: 'Sub On', SUB_OFF: 'Sub Off',
  HALF_TIME: 'Half Time', FULL_TIME: 'Full Time',
  INJURY_STOPPAGE: 'Injury Stop', WATER_BREAK: 'Water Break',
}

/** Short zone labels for the event row */
const ZONE_SHORT: Record<string, string> = {
  DEF_LEFT: 'DEF L', DEF_CENTRE: 'DEF', DEF_RIGHT: 'DEF R',
  MID_LEFT: 'MID L', MID_CENTRE: 'MID', MID_RIGHT: 'MID R',
  HF_LEFT: 'HF L', HF_CENTRE: 'HF', HF_RIGHT: 'HF R',
  FWD_LEFT: 'FWD L', FWD_CENTRE: 'FWD', FWD_RIGHT: 'FWD R',
  IF_LEFT: 'IF L', IF_CENTRE: 'IF', IF_RIGHT: 'IF R',
  SQ_LEFT: 'SQ L', SQ_CENTRE: 'SQ', SQ_RIGHT: 'SQ R',
}

const SCORING_EVENTS = ['POINT_SCORED', 'GOAL_SCORED', 'FREE_KICK', 'FORTY_FIVE', 'PENALTY']

function getEventBadgeColor(eventType: string): string {
  if (eventType === 'GOAL_SCORED') return 'bg-emerald-500/30 text-emerald-300'
  if (eventType === 'POINT_SCORED') return 'bg-cyan-500/30 text-cyan-300'
  if (eventType === 'WIDE' || eventType === 'SHORT') return 'bg-amber-500/30 text-amber-300'
  if (eventType.includes('TURNOVER')) return 'bg-red-500/30 text-red-300'
  if (eventType.includes('CARD')) return 'bg-yellow-500/30 text-yellow-300'
  if (eventType.includes('KICKOUT')) return 'bg-purple-500/30 text-purple-300'
  return 'bg-white/10 text-white/60'
}

interface RunningScore {
  team_a_goals: number
  team_a_points: number
  team_b_goals: number
  team_b_points: number
}

export default function VideoEventLog({
  events,
  onSeek,
  onDelete,
  onVerify,
  onEditZone,
  onEditTeam,
  onEditPlayer,
  selectedEventId,
  collapsed = false,
  onToggle,
  onVerifyAll,
}: VideoEventLogProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [zonePicker, setZonePicker] = useState<{ eventId: string; currentZone: PitchZone | null } | null>(null)

  // Calculate running score alongside events
  const eventsWithScore = useMemo(() => {
    const score: RunningScore = {
      team_a_goals: 0, team_a_points: 0,
      team_b_goals: 0, team_b_points: 0,
    }

    return events.map((event) => {
      let scoreChange = ''
      const isTwoPointer = event.scoring_context?.is_two_pointer

      if (event.event_type === 'GOAL_SCORED') {
        if (event.team === 'team_a') score.team_a_goals++
        else score.team_b_goals++
        scoreChange = 'GOAL'
      } else if (event.event_type === 'POINT_SCORED') {
        const pts = isTwoPointer ? 2 : 1
        if (event.team === 'team_a') score.team_a_points += pts
        else score.team_b_points += pts
        scoreChange = isTwoPointer ? '2pt' : '1pt'
      } else if (SCORING_EVENTS.includes(event.event_type) && event.scoring_context?.scored !== false) {
        // Free kick, penalty, 45 that scored
        if (event.scoring_context?.scored) {
          const pts = isTwoPointer ? 2 : (event.event_type === 'PENALTY' ? 3 : 1)
          if (event.event_type === 'PENALTY') {
            if (event.team === 'team_a') score.team_a_goals++
            else score.team_b_goals++
            scoreChange = 'GOAL (pen)'
          } else {
            if (event.team === 'team_a') score.team_a_points += pts
            else score.team_b_points += pts
            scoreChange = isTwoPointer ? '2pt' : '1pt'
          }
        }
      }

      return {
        event,
        score: { ...score },
        scoreChange,
        isTwoPointer: !!isTwoPointer,
      }
    })
  }, [events])

  const currentScore = eventsWithScore.length > 0
    ? eventsWithScore[eventsWithScore.length - 1].score
    : { team_a_goals: 0, team_a_points: 0, team_b_goals: 0, team_b_points: 0 }

  const teamATotal = currentScore.team_a_goals * 3 + currentScore.team_a_points
  const teamBTotal = currentScore.team_b_goals * 3 + currentScore.team_b_points

  const hasUnverifiedAI = events.some(e => (e.source === 'gemini_auto' || e.source === 'keyframe_auto') && !e.is_verified)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [events.length])

  const handleZoneSelect = (zone: PitchZone) => {
    if (zonePicker && onEditZone) {
      onEditZone(zonePicker.eventId, zone)
    }
    setZonePicker(null)
  }

  return (
    <div className="flex flex-col">
      {/* Sticky header: score + event count + toggle + verify all */}
      <button
        onClick={onToggle}
        className="flex items-center justify-between bg-white/5 px-4 py-3 border-b border-white/10 cursor-pointer hover:bg-white/[0.07] transition-colors rounded-t-lg"
      >
        <div className="flex items-center gap-3">
          {/* Score */}
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">
              {currentScore.team_a_goals}-{String(currentScore.team_a_points).padStart(2, '0')}
            </span>
            <span className="text-xs text-white/30">({teamATotal})</span>
            <span className="text-white/30 text-xs">vs</span>
            <span className="text-sm font-bold text-white">
              {currentScore.team_b_goals}-{String(currentScore.team_b_points).padStart(2, '0')}
            </span>
            <span className="text-xs text-white/30">({teamBTotal})</span>
          </div>

          {/* Event count */}
          <span className="text-xs text-white/40">
            Events ({events.length})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Verify All button */}
          {hasUnverifiedAI && onVerifyAll && (
            <span
              onClick={(e) => { e.stopPropagation(); onVerifyAll() }}
              className="text-xs bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 px-3 py-1 rounded-full font-medium transition-all cursor-pointer"
            >
              Verify All AI
            </span>
          )}

          {/* Toggle chevron */}
          {onToggle && (
            collapsed
              ? <ChevronDown size={16} className="text-white/40" />
              : <ChevronUp size={16} className="text-white/40" />
          )}
        </div>
      </button>

      {/* Event list */}
      <div
        ref={listRef}
        className={`overflow-y-auto transition-all duration-300 ${
          collapsed ? 'max-h-[220px]' : 'max-h-[400px]'
        }`}
      >
        <div className="space-y-1 p-2">
          {eventsWithScore.length === 0 ? (
            <p className="text-center text-white/30 text-sm py-8">
              No events tagged yet. Use the quick actions or auto-analyse.
            </p>
          ) : (
            eventsWithScore.map(({ event, scoreChange, isTwoPointer }) => {
              const isAI = event.source === 'gemini_auto' || event.source === 'keyframe_auto'
              const isUnverifiedAI = isAI && !event.is_verified

              return (
                <div
                  key={event.id}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                    selectedEventId === event.id
                      ? 'bg-emerald-500/20 ring-1 ring-emerald-400/50'
                      : 'bg-white/[0.03] hover:bg-white/[0.06]'
                  } ${isUnverifiedAI ? 'opacity-70' : ''}`}
                  onClick={() => event.video_timestamp_ms != null && onSeek(event.video_timestamp_ms)}
                >
                  {/* Time */}
                  <span className="text-xs text-white/40 w-10 shrink-0 font-mono">
                    {event.match_minute}:{String(event.match_second).padStart(2, '0')}
                  </span>

                  {/* Team indicator */}
                  <span className={`w-1.5 h-6 rounded-full shrink-0 ${
                    event.team === 'team_a' ? 'bg-emerald-500' : 'bg-orange-500'
                  }`} />

                  {/* Event badge */}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${getEventBadgeColor(event.event_type)}`}>
                    {EVENT_LABELS[event.event_type] || event.event_type}
                  </span>

                  {/* AI badge */}
                  {isAI && (
                    <span className="text-[9px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded-full font-bold shrink-0 flex items-center gap-0.5">
                      <Bot size={9} />
                      AI
                    </span>
                  )}

                  {/* Zone badge (if set) */}
                  {event.pitch_zone && (
                    <span className="text-[9px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full shrink-0">
                      {ZONE_SHORT[event.pitch_zone] || event.pitch_zone}
                    </span>
                  )}

                  {/* Two-pointer badge */}
                  {isTwoPointer && (
                    <span className="text-[10px] bg-cyan-500/30 text-cyan-300 px-1.5 py-0.5 rounded-full font-bold shrink-0">
                      2pt
                    </span>
                  )}

                  {/* Player name */}
                  <span className="text-xs text-white/50 truncate flex-1 min-w-0">
                    {event.player_name || (event.jersey_number ? `#${event.jersey_number}` : '')}
                  </span>

                  {/* Score change indicator */}
                  {scoreChange && (
                    <span className="text-[10px] text-emerald-400 font-bold shrink-0">
                      +{scoreChange}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    {/* Add/edit zone button */}
                    {onEditZone && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setZonePicker({
                            eventId: event.id,
                            currentZone: (event.pitch_zone as PitchZone) || null,
                          })
                        }}
                        className={`p-1 transition-colors ${
                          event.pitch_zone
                            ? 'text-white/20 hover:text-blue-400'
                            : 'text-orange-400/60 hover:text-orange-400'
                        }`}
                        title={event.pitch_zone ? 'Change zone' : 'Add zone'}
                      >
                        <MapPin size={14} />
                      </button>
                    )}
                    {!event.is_verified && event.source !== 'human_tag' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onVerify(event.id) }}
                        className="p-1 text-white/20 hover:text-emerald-400 transition-colors"
                        title="Verify"
                      >
                        <CheckCircle size={14} />
                      </button>
                    )}
                    {/* Edit team/player — parity with live recording's pencil
                        edit. Team swap first (the common mistake: wrong-team
                        score), plain player re-attribution as a second tap. */}
                    {onEditTeam && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditTeam(event.id) }}
                        className="p-1 text-white/20 hover:text-blue-400 transition-colors"
                        title="Edit team"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    {onEditPlayer && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditPlayer(event.id) }}
                        className="p-1 text-[9px] font-bold text-white/20 hover:text-blue-400 transition-colors w-[14px] h-[14px] flex items-center justify-center"
                        title="Edit player"
                      >
                        P
                      </button>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(event.id) }}
                      className="p-1 text-white/20 hover:text-red-400 transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Inline zone picker popup */}
      {zonePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setZonePicker(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative bg-slate-900 border border-white/10 rounded-xl p-4 w-full max-w-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <MapPin size={16} className="text-blue-400" />
                <span className="text-sm font-semibold text-white">Select Pitch Zone</span>
              </div>
              <button
                onClick={() => setZonePicker(null)}
                className="p-1 text-white/40 hover:text-white transition-colors"
              >
                <X size={16} />
              </button>
            </div>
            <PitchZoneSelector
              selectedZone={zonePicker.currentZone}
              onZoneSelect={handleZoneSelect}
              highlightTwoPointer
            />
          </div>
        </div>
      )}
    </div>
  )
}
