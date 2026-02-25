/**
 * VideoEventLog — Scrollable event list with score progression, edit/delete actions.
 *
 * Shows running score with two-pointer annotations.
 */

import { useMemo } from 'react'
import { Trash2, CheckCircle } from 'lucide-react'
import type { VideoEvent } from '../../services/videoApi'

interface VideoEventLogProps {
  events: VideoEvent[]
  onSeek: (timestampMs: number) => void
  onDelete: (eventId: string) => void
  onVerify: (eventId: string) => void
  selectedEventId?: string | null
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
  selectedEventId,
}: VideoEventLogProps) {
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

  return (
    <div className="flex flex-col h-full">
      {/* Score header */}
      <div className="flex items-center justify-between bg-white/5 rounded-t-lg px-4 py-3 border-b border-white/10">
        <div className="text-center">
          <span className="text-xs text-emerald-400/60 block">Team A</span>
          <span className="text-lg font-bold text-white">
            {currentScore.team_a_goals}-{String(currentScore.team_a_points).padStart(2, '0')}
          </span>
          <span className="text-xs text-white/40 block">({teamATotal})</span>
        </div>
        <span className="text-white/30 text-sm">vs</span>
        <div className="text-center">
          <span className="text-xs text-orange-400/60 block">Team B</span>
          <span className="text-lg font-bold text-white">
            {currentScore.team_b_goals}-{String(currentScore.team_b_points).padStart(2, '0')}
          </span>
          <span className="text-xs text-white/40 block">({teamBTotal})</span>
        </div>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto space-y-1 p-2">
        {eventsWithScore.length === 0 ? (
          <p className="text-center text-white/30 text-sm py-8">
            No events tagged yet. Pause the video and tag events.
          </p>
        ) : (
          eventsWithScore.map(({ event, scoreChange, isTwoPointer }) => (
            <div
              key={event.id}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all ${
                selectedEventId === event.id
                  ? 'bg-emerald-500/20 ring-1 ring-emerald-400/50'
                  : 'bg-white/[0.03] hover:bg-white/[0.06]'
              }`}
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
                {!event.is_verified && event.source !== 'human_tag' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onVerify(event.id) }}
                    className="p-1 text-white/20 hover:text-emerald-400 transition-colors"
                    title="Verify"
                  >
                    <CheckCircle size={14} />
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
          ))
        )}
      </div>
    </div>
  )
}
