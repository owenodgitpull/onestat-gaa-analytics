/**
 * VideoEventLog — Scrollable event list with score progression, edit/delete actions.
 *
 * Shows running score with two-pointer annotations.
 * AI events (gemini_auto / keyframe_auto) get a purple "AI" badge and render dimmer until verified.
 * Supports collapsible mode: collapsed shows ~5 recent events, expanded scrolls full list.
 * Scoring points carry an explicit 1pt / 2pt toggle (the exact pitch position, not a coarse zone label,
 * is the source of truth for where an event happened).
 */

import { useMemo, useRef, useEffect, useState } from 'react'
import { seekTimeForEvent } from '../../utils/videoSeek'
import { videoEventLabel, videoEventDetail, isBackgroundVideoEvent } from '../../utils/videoEventDisplay'
import { Trash2, CheckCircle, Bot, ChevronDown, ChevronUp, Pencil, MapPin } from 'lucide-react'
import type { VideoEvent } from '../../services/videoApi'

interface VideoEventLogProps {
  events: VideoEvent[]
  onSeek: (timestampMs: number) => void
  onDelete: (eventId: string) => void
  onVerify: (eventId: string) => void
  /** Move this event to a new spot — the next tap(s) on the pitch set its position. */
  onMovePosition?: (eventId: string) => void
  /** Flip a scoring point between 1pt and 2pt (explicit — never derived from a zone label). */
  onToggleTwoPointer?: (eventId: string, makeTwoPointer: boolean) => void
  /** Open the team-swap confirm for this event — parity with live
   * recording's handleEditEventClick/editChoice flow. */
  onEditTeam?: (eventId: string) => void
  /** Open the player picker for this event with no team change. */
  onEditPlayer?: (eventId: string) => void
  /** A score the referee ruled out (square ball, overcarrying...): turns the score into the matching error so the
   *  score is right and the story is kept. */
  onDisallow?: (eventId: string, reason: string, reasonLabel: string) => void
  /** Open the chain editor (who carried, missing / extra steps) for a score, kickout or turnover. */
  onEditMove?: (eventId: string) => void
  /** Open the full fix-up form (players, type, outcome, time...) for any event. */
  onEditEvent?: (eventId: string) => void
  selectedEventId?: string | null
  collapsed?: boolean
  onToggle?: () => void
  onVerifyAll?: () => void
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

/** Why a score was ruled out: value = the unforced-error subtype it is stored under. */
const DISALLOW_REASONS: Array<{ value: string; label: string }> = [
  { value: 'square_ball', label: 'Square ball' },
  { value: 'overcarrying', label: 'Overcarrying' },
  { value: 'picked_off_ground', label: 'Picked off ground' },
  { value: 'three_v_three', label: '3v3 violation' },
  { value: 'other', label: 'Other' },
]

export default function VideoEventLog({
  events,
  onSeek,
  onDelete,
  onVerify,
  onToggleTwoPointer,
  onMovePosition,
  onEditTeam,
  onEditPlayer,
  onDisallow,
  onEditMove,
  onEditEvent,
  selectedEventId,
  collapsed = false,
  onToggle,
  onVerifyAll,
}: VideoEventLogProps) {
  const listRef = useRef<HTMLDivElement>(null)
  const [disallowFor, setDisallowFor] = useState<string | null>(null)
  // Hand passes and kick passes are kept for the agent but not listed (they would drown the real events)
  const [showPasses, setShowPasses] = useState(false)
  const passCount = useMemo(() => events.filter(isBackgroundVideoEvent).length, [events])

  // Calculate running score alongside events
  const eventsWithScore = useMemo(() => {
    const score: RunningScore = {
      team_a_goals: 0, team_a_points: 0,
      team_b_goals: 0, team_b_points: 0,
    }

    // Hand passes (the opposition pass-count taps) are not listed - live recording hides them too. A free short
    // pass is a free's outcome, so it stays.
    const listed = showPasses ? events : events.filter(e => !isBackgroundVideoEvent(e))
    return listed.map((event) => {
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
  }, [events, showPasses])

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
            Events ({eventsWithScore.length})
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

      {passCount > 0 && (
        <div className="flex justify-end px-3 py-1 border-b border-white/5">
          <button
            onClick={() => setShowPasses(v => !v)}
            className="text-[10px] text-white/35 hover:text-white/70 transition-colors"
            title="Hand passes and kick passes are recorded for the analysis but kept out of the list"
          >
            {showPasses ? 'Hide passes' : `Show ${passCount} passes`}
          </button>
        </div>
      )}

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
                  onClick={() => event.video_timestamp_ms != null && onSeek(seekTimeForEvent(event.video_timestamp_ms))}
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
                    {videoEventLabel(event.event_type)}
                  </span>

                  {/* AI badge */}
                  {isAI && (
                    <span className="text-[9px] bg-purple-500/30 text-purple-300 px-1.5 py-0.5 rounded-full font-bold shrink-0 flex items-center gap-0.5">
                      <Bot size={9} />
                      AI
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
                    {event.event_type === 'SUB_ON'
                      ? `${event.player_name ?? 'Player'} off · ${event.sub_in_player_name ?? 'Player'} on`
                      : (event.player_name || (event.jersey_number ? `#${event.jersey_number}` : ''))}
                  </span>

                  {/* Reason / outcome (never a raw code) */}
                  {(() => {
                    const detail = videoEventDetail(event)
                    return detail ? <span className="text-[10px] text-white/35 truncate max-w-[40%] shrink">{detail}</span> : null
                  })()}

                  {/* Score change indicator */}
                  {scoreChange && (
                    <span className="text-[10px] text-emerald-400 font-bold shrink-0">
                      +{scoreChange}
                    </span>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 shrink-0">
                    {/* 1pt / 2pt toggle — only for scoring points. Explicit, so a
                        mis-flagged score is a one-tap fix (no zone labels involved). */}
                    {onToggleTwoPointer && (event.event_type === 'POINT_SCORED' ||
                      (event.event_type === 'FREE_KICK' && event.scoring_context?.scored)) && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleTwoPointer(event.id, !isTwoPointer) }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white/40 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                        title={isTwoPointer ? 'Change to a 1-point score' : 'Change to a 2-point score'}
                      >
                        {isTwoPointer ? '→1pt' : '→2pt'}
                      </button>
                    )}
                    {/* Score ruled out by the referee: keeps the story, fixes the score */}
                    {onDisallow && (event.event_type === 'POINT_SCORED' || event.event_type === 'GOAL_SCORED' ||
                      (event.event_type === 'FREE_KICK' && event.scoring_context?.scored)) && (
                      disallowFor === event.id ? (
                        <select
                          autoFocus
                          defaultValue=""
                          onClick={(e) => e.stopPropagation()}
                          onBlur={() => setDisallowFor(null)}
                          onChange={(e) => {
                            const opt = DISALLOW_REASONS.find(r => r.value === e.target.value)
                            if (opt) onDisallow(event.id, opt.value, opt.label)
                            setDisallowFor(null)
                          }}
                          className="bg-slate-800 text-white text-[10px] rounded border border-white/20 px-1 py-0.5"
                        >
                          <option value="" disabled>Why?</option>
                          {DISALLOW_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                        </select>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDisallowFor(event.id) }}
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white/40 hover:text-amber-300 hover:bg-amber-500/10 transition-colors"
                          title="Ruled out by the referee (square ball, overcarrying...) - removes it from the score and keeps a note"
                        >
                          Disallowed
                        </button>
                      )
                    )}
                    {onEditMove && (event.event_type === 'POINT_SCORED' || event.event_type === 'GOAL_SCORED' ||
                      event.event_type.includes('KICKOUT') || event.event_type.includes('TURNOVER') ||
                      event.event_type === 'WIDE' || event.event_type === 'SHORT') && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditMove(event.id) }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white/40 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors"
                        title="Fix the move: who carried, missing or extra steps"
                      >
                        Move
                      </button>
                    )}
                    {onEditEvent && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onEditEvent(event.id) }}
                        className="px-1.5 py-0.5 rounded text-[10px] font-bold text-white/40 hover:text-blue-300 hover:bg-blue-500/10 transition-colors"
                        title="Fix this event: players, type, outcome, time"
                      >
                        Fix
                      </button>
                    )}
                    {onMovePosition && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onMovePosition(event.id) }}
                        className="p-1 text-white/20 hover:text-purple-300 transition-colors"
                        title="Move on the pitch"
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

    </div>
  )
}
