/**
 * videoEventChartAdapter — converts tagged-but-not-yet-synced VideoEvents
 * into the shape live recording's chart components actually read.
 *
 * Video tagging stages events in a separate `video_events` table until an
 * explicit "Save to Match" sync writes them into `match_events`. Live
 * recording's charts mostly read a plain `events: any[]` prop, computed
 * client-side — they don't care WHERE the array came from, only its shape:
 * `event_type` (lowercase, e.g. 'point'/'goal'/'wide'), `team` ('own'/
 * 'opponent'), `minute`, `pitch_x`/`pitch_y` (0-100). This module produces
 * that shape from the video-tagging session's own in-memory events, so the
 * same chart components can render live, before any sync.
 *
 * The event_type mapping table mirrors the backend's VideoEventMapper
 * (backend/app/services/video/event_mapper.py) for the ~24 types it does
 * map. That backend mapper silently DROPS ~13 other video event types
 * (ball-movement micro-events like CATCH/PICKUP/TACKLE, plus match-flow
 * markers like HALF_TIME) since it's writing permanent MatchEvent rows and
 * has nowhere sensible to put them. This adapter is display-only, so it's
 * deliberately more lenient: micro-events fall through to 'other' instead
 * of vanishing, and only genuine non-events (HALF_TIME, FULL_TIME,
 * INJURY_STOPPAGE, WATER_BREAK, THROW_IN) are filtered out entirely.
 *
 * Team mapping is intentionally NOT ported from the backend's
 * `video_team_to_match_team` — that function has a bug (every call site in
 * the codebase passes `is_own_team=(team=='team_a')`, which makes BOTH
 * team_a and team_b resolve to Team.OWN). The real convention, confirmed
 * via the VideoEvent model's own comments, is simply team_a='own team'.
 */

import type { VideoEvent } from '../services/videoApi'
import { pointInSideFrame } from './attackDirection'
import type { ShotLocation } from '../services/api'

export type ChartTeam = 'own' | 'opponent'

/** The shape live recording's chart components actually read off each event
 *  (confirmed by reading each component directly — not the same as the
 *  stale `MatchEvent` TS interface in types/index.ts). */
export interface ChartEvent {
  event_type: string
  team: ChartTeam
  minute: number
  half: number
  pitch_x: number | null
  pitch_y: number | null
  player_id: string | null
  player_name: string | null
  sub_type: string | null
  match_id: string
}

export function mapVideoTeam(team: string): ChartTeam {
  return team === 'team_a' ? 'own' : 'opponent'
}

/** Context-dependent mapping for the 4 video event types whose outcome
 *  depends on scoring_context, mirroring VideoEventMapper.to_match_event_type. */
function mapContextDependent(ve: VideoEvent, isTwoPointer: boolean): string | null {
  const ctx = ve.scoring_context || {}
  switch (ve.event_type) {
    case 'POINT_SCORED':
      if (String(ctx.source ?? '').toUpperCase() === 'FROM_FREE' || String(ctx.source ?? '').toUpperCase() === 'FREE') return isTwoPointer ? 'two_point_free' : 'point_free'
      return isTwoPointer ? 'two_point' : 'point'
    case 'FREE_KICK':
      if (ctx.scored) return isTwoPointer ? 'two_point_free' : 'point_free'
      if (ctx.wide) return 'wide_free'
      return 'free_won'
    case 'FORTY_FIVE':
      return ctx.scored ? 'forty_five' : 'forty_five_missed'
    case 'PENALTY':
      return ctx.scored ? 'penalty_goal' : 'penalty_miss'
    default:
      return null
  }
}

/** Direct 1:1 mappings — same table as VideoEventMapper._TO_MATCH_EVENT. */
const DIRECT_MAP: Record<string, string> = {
  GOAL_SCORED: 'goal',
  SAVED: 'saved',
  HIT_POST: 'hit_post',
  TACKLE_WON: 'tackle_won',
  FOUL_COMMITTED: 'foul_committed',
  WIDE: 'wide',
  SHORT: 'short',
  TURNOVER_WON: 'turnover_won',
  TURNOVER_LOST: 'turnover_lost',
  BLOCK_SHOT: 'block',
  BLOCK_PASS: 'block',
  INTERCEPTION: 'interception',
  YELLOW_CARD: 'yellow_card',
  RED_CARD: 'red_card',
  BLACK_CARD: 'black_card',
  SUB_ON: 'substitution',
  SUB_OFF: 'substitution',
  OWN_KICKOUT_WON: 'own_kickout_won',
  OWN_KICKOUT_OPPOSITION_WON: 'own_kickout_opposition_won',
  OWN_KICKOUT_WON_BREAK: 'own_kickout_won_break',
  OWN_KICKOUT_OPPOSITION_WON_BREAK: 'own_kickout_opposition_won_break',
  OPP_KICKOUT_WON: 'opp_kickout_won',
  OPP_KICKOUT_OPPOSITION_WON: 'opp_kickout_opposition_won',
  OPP_KICKOUT_WON_BREAK: 'opp_kickout_won_break',
  OPP_KICKOUT_OPPOSITION_WON_BREAK: 'opp_kickout_opposition_won_break',
  OUR_UNFORCED_ERROR: 'unforced_error',
  OPP_UNFORCED_ERROR: 'unforced_error',
  // Long balls are real event types now (PASS_KICK = the old name for a long kick pass)
  LONG_KICK_PASS: 'long_kick_pass',
  PASS_KICK: 'long_kick_pass',
  HIGH_BALL: 'high_ball',
}

/** Display-only leniency: micro-events the backend drops on sync map to
 *  'other' here instead of disappearing (charts already handle an 'other'
 *  bucket gracefully by simply not matching any of their known-type sets). */
const LENIENT_OTHER: Set<string> = new Set([
  'POST_HIT', 'GOAL_CHANCE', 'KICKOUT_SHORT', 'KICKOUT_LONG', 'CATCH', 'PICKUP',
  'PASS_HAND', 'SOLO_RUN', 'MARK_CLAIMED', 'BALL_WON', 'TACKLE',
  'HOOK', 'SPOIL',
])

/** Genuine non-events — match-flow markers with no MatchEvent equivalent
 *  and nothing meaningful to chart. Filtered out entirely, not mapped. */
const FILTERED_OUT: Set<string> = new Set([
  'HALF_TIME', 'FULL_TIME', 'INJURY_STOPPAGE', 'WATER_BREAK', 'THROW_IN',
])

const ZONE_TWO_POINTER_ROWS = new Set(['DEF', 'MID', 'HF'])

function isTwoPointerZone(zone: string | null | undefined): boolean {
  if (!zone) return false
  const row = zone.split('_')[0]
  return ZONE_TWO_POINTER_ROWS.has(row)
}

/** Representative x/y (0-100) per pitch zone — same 6x3 grid as
 *  PitchZoneSelector.tsx's ZONE_DEFS, used as a coordinate fallback since
 *  video-tagged events are frequently zone-only (no precise pitch_x/y). */
const ZONE_X_CENTERS: Record<string, number> = { DEF: 8.5, MID: 25, HF: 41.5, FWD: 58.5, IF: 75, SQ: 91.5 }
const ZONE_Y_CENTERS: Record<string, number> = { LEFT: 16.5, CENTRE: 50, RIGHT: 83.5 }

function zoneToXY(zone: string | null | undefined): { x: number | null; y: number | null } {
  if (!zone) return { x: null, y: null }
  const [row, col] = zone.split('_')
  const x = ZONE_X_CENTERS[row]
  const y = ZONE_Y_CENTERS[col]
  return { x: x ?? null, y: y ?? null }
}

export function mapVideoEventType(ve: VideoEvent): string | null {
  if (FILTERED_OUT.has(ve.event_type)) return null

  if (ve.event_type === 'SIDELINE_KICK') {
    return mapVideoTeam(ve.team) === 'own' ? 'own_kickout_sideline' : 'opp_kickout_sideline'
  }

  const isTwoPointer = ve.scoring_context?.is_two_pointer ?? isTwoPointerZone(ve.pitch_zone)
  const contextMapped = mapContextDependent(ve, isTwoPointer)
  if (contextMapped) return contextMapped

  if (DIRECT_MAP[ve.event_type]) return DIRECT_MAP[ve.event_type]
  if (LENIENT_OTHER.has(ve.event_type)) return 'other'

  return 'other'
}

/** Convert the video-tagging session's in-memory events into the shape
 *  live recording's chart components read, so they can render live before
 *  any "Save to Match" sync. */
export function videoEventsToChartEvents(events: VideoEvent[]): ChartEvent[] {
  const out: ChartEvent[] = []
  for (const ve of events) {
    const eventType = mapVideoEventType(ve)
    if (!eventType) continue
    const { x: zoneX, y: zoneY } = zoneToXY(ve.pitch_zone)
    out.push({
      event_type: eventType,
      team: mapVideoTeam(ve.team),
      minute: ve.match_minute,
      half: ve.half,
      pitch_x: ve.pitch_x ?? zoneX,
      pitch_y: ve.pitch_y ?? zoneY,
      player_id: ve.player_id,
      player_name: ve.player_name,
      sub_type: ve.sub_type,
      match_id: ve.match_id,
    })
  }
  return out
}

const SHOT_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved',
  'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss',
])
const SCORE_TYPES = new Set([
  'goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five',
])

/** Ports MatchRecording.tsx's `shotLocations` useMemo (lines ~1035-1059)
 *  verbatim — same shot-type set, same half-aware x-normalization so a
 *  team's shots always face the same direction on the heatmap regardless
 *  of which half or which side of the pitch they were actually taken on. */
export function computeShotLocations(
  chartEvents: ChartEvent[],
  halfDurationMins: number | null | undefined,
  attackingRightFirstHalfInput: boolean | null | undefined,
): ShotLocation[] {
  const halfDuration = halfDurationMins || 30
  const attackingRightFirstHalf = attackingRightFirstHalfInput ?? true

  // Rotate the pitch (x AND y) into the SHOOTING team's attack frame (it attacks towards x=100) — the
  // old version only mirrored x, which swaps left and right for a team attacking right-to-left.
  return chartEvents
    .filter(e => SHOT_TYPES.has(e.event_type) && e.pitch_x != null)
    .map(e => {
      const isOwn = e.team === 'own'
      const p = pointInSideFrame(
        e.pitch_x as number, e.pitch_y ?? 50, isOwn ? 'own' : 'opponent',
        attackingRightFirstHalf, e.half, e.minute, halfDuration,
      )
      return {
        x: p.x,
        y: p.y,
        event_type: e.event_type,
        is_score: SCORE_TYPES.has(e.event_type),
        team: e.team,
        match_id: e.match_id,
      }
    })
}
