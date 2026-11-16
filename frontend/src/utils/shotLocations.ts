import { pointInSideFrame } from './attackDirection'

const SHOT_TYPES = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss'])
const SCORE_TYPES = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])

/** Every shot rotated into the shooting team's attack frame (x = 100 is the goal it was aimed at), for
 * ShootingEfficiencyHeatmap. Shared by the Match Result page and the match report. */
export function buildShotLocations(events: any[], match: { half_duration_mins?: number | null; attacking_right_first_half?: boolean | null } | null | undefined) {
  const halfDuration = match?.half_duration_mins || 30
  const attackingRightFirstHalf = match?.attacking_right_first_half ?? true
  return (events || [])
    .filter((e: any) => SHOT_TYPES.has(e.event_type) && e.pitch_x != null)
    .map((e: any) => {
      const isOwn = e.team === 'own' || e.is_home_team
      const fp = pointInSideFrame(e.pitch_x as number, e.pitch_y ?? 50, isOwn ? 'own' : 'opponent', attackingRightFirstHalf, e.half, e.minute, halfDuration)
      return { x: fp.x, y: fp.y, event_type: e.event_type, is_score: SCORE_TYPES.has(e.event_type), team: e.team || (e.is_home_team ? 'own' : 'opponent'), match_id: e.match_id }
    })
}
