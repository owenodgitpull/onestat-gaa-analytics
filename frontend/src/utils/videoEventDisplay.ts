/**
 * How Video Tagging shows an event to a person: a plain label, a short detail, and which events are "background"
 * (hand passes, kick passes) that are recorded for the agent but kept out of the visible event list.
 * Same wording as Live Recording / Match Result, never raw type codes.
 */

import { displaySurname } from './playerName'

const VIDEO_EVENT_LABELS: Record<string, string> = {
  POINT_SCORED: 'Point', GOAL_SCORED: 'Goal', WIDE: 'Wide', SHORT: 'Dropped short', SAVED: 'Saved',
  HIT_POST: 'Hit post', POST_HIT: 'Hit post', BLOCK_SHOT: 'Block', BLOCK_PASS: 'Block',
  GOAL_CHANCE: 'Goal chance',
  FREE_KICK: 'Free', FORTY_FIVE: '45', PENALTY: 'Penalty',
  TURNOVER_WON: 'Turnover won', TURNOVER_LOST: 'Turnover lost', TACKLE_WON: 'Tackle won', INTERCEPTION: 'Interception',
  OUR_UNFORCED_ERROR: 'Unforced error', OPP_UNFORCED_ERROR: 'Their unforced error',
  FOUL_COMMITTED: 'Foul', FOUL_WON: 'Free won',
  YELLOW_CARD: 'Yellow card', BLACK_CARD: 'Black card', RED_CARD: 'Red card',
  HIGH_BALL: 'High ball', LONG_KICK_PASS: 'Kick pass', PASS_KICK: 'Kick pass', PASS_HAND: 'Hand pass',
  SOLO_RUN: 'Solo run', CATCH: 'Catch', PICKUP: 'Pick up', MARK_CLAIMED: 'Mark', HOOK: 'Hook', SPOIL: 'Spoil',
  BALL_WON: 'Ball won',
  PRESS_TRIGGER: 'Press',
  OWN_KICKOUT_WON: 'Our kickout won', OWN_KICKOUT_OPPOSITION_WON: 'Our kickout lost',
  OWN_KICKOUT_WON_BREAK: 'Our kickout won on the break', OWN_KICKOUT_OPPOSITION_WON_BREAK: 'Our kickout lost on the break',
  OWN_KICKOUT_SIDELINE: 'Our kickout out over the sideline',
  OPP_KICKOUT_WON: 'Their kickout - we won it', OPP_KICKOUT_OPPOSITION_WON: 'Their kickout - they kept it',
  OPP_KICKOUT_WON_BREAK: 'Their kickout - we won the break', OPP_KICKOUT_OPPOSITION_WON_BREAK: 'Their kickout - they won the break',
  OPP_KICKOUT_SIDELINE: 'Their kickout out over the sideline',
  KICKOUT_SHORT: 'Kickout short', KICKOUT_LONG: 'Kickout long',
  SIDELINE_KICK: 'Sideline kick', SIDELINE_BALL: 'Sideline ball', THROW_IN: 'Throw in',
  SUB_ON: 'Substitution', SUB_OFF: 'Sub off', HALF_TIME: 'Half time', FULL_TIME: 'Full time',
  INJURY_STOPPAGE: 'Injury stoppage', WATER_BREAK: 'Water break',
}

/** Words used by the detail line (sub types and descriptions that arrive as codes). */
const DETAIL_LABELS: Record<string, string> = {
  tackle: 'Tackle', strip: 'Strip', forced_interception: 'Forced interception',
  stray_pass: 'Stray pass', dropped_ball: 'Dropped ball', miscue: 'Miscue', kick_over_sideline: 'Kicked over the sideline',
  square_ball: 'Square ball', three_v_three: '3v3 breach', time_wasting: 'Time wasting',
  overcarrying: 'Overcarrying', picked_off_ground: 'Picked off the ground',
  pushing: 'Pushing', pulling: 'Pulling', charging: 'Charging', late_tackle: 'Late tackle', jersey_pull: 'Jersey pull',
  obstruction: 'Obstruction', dissent: 'Dissent', tactical: 'Tactical',
  block_recovery: 'Block recovered', completed: 'Completed', intercepted: 'Intercepted',
  won: 'Won', lost: 'Lost', won_clean: 'Won clean', won_break: 'Won on the break', lost_clean: 'Lost clean',
  lost_break: 'Lost on the break', lost_stray: 'Lost - went straight to them',
}

const sentenceCase = (s: string): string => {
  const t = s.replace(/_/g, ' ').trim()
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : t
}

export function videoEventLabel(eventType: string): string {
  return VIDEO_EVENT_LABELS[eventType] || sentenceCase(eventType)
}

/** Passes are recorded for the agent (transition speed, carrying style) but are not "events" a person scans. */
export function isBackgroundVideoEvent(e: { event_type: string; description?: string | null }): boolean {
  if (e.event_type === 'LONG_KICK_PASS' || e.event_type === 'PASS_KICK') return true
  if (e.event_type === 'PASS_HAND') return (e.description || '').trim().toLowerCase() !== 'free short pass'
  return false
}

const detailWord = (code: string | null | undefined): string => {
  if (!code) return ''
  const key = code.trim().toLowerCase().replace(/ /g, '_')
  return DETAIL_LABELS[key] || sentenceCase(code)
}

/** Short extra line for an event (reason, outcome, note), or '' when there is nothing useful to add. */
const SHOT_TYPES = new Set(['POINT_SCORED', 'GOAL_SCORED', 'WIDE', 'SHORT', 'SAVED', 'HIT_POST', 'POST_HIT', 'GOAL_CHANCE'])
const FOOT_WORDS: Record<string, string> = { L: 'left foot', R: 'right foot', F: 'fist' }

/** A half-sentence for a shot: "from play, left foot, assisted by Moore, under pressure". Only what was tagged. */
function shotPhrase(e: {
  event_type: string; scoring_context?: Record<string, any> | null; assist_player_name?: string | null
}): string {
  const sc = e.scoring_context || {}
  const src = String(sc.source ?? '').toUpperCase()
  const bits: string[] = []
  if (src.includes('FREE')) bits.push('from a free')
  else if (src.includes('45')) bits.push('from a 45')
  else if (src.includes('PLAY')) bits.push('from play')
  const foot = FOOT_WORDS[String(sc.foot ?? '').trim().charAt(0).toUpperCase()]
  if (foot) bits.push(foot)
  const assist = (e.assist_player_name || sc.assist_player_name || '').toString().trim()
  if (assist && (e.event_type === 'POINT_SCORED' || e.event_type === 'GOAL_SCORED')) bits.push(`assisted by ${displaySurname(assist, false)}`)
  if (sc.under_pressure === true) bits.push('under pressure')
  return bits.join(', ')
}

export function videoEventDetail(e: {
  event_type: string; sub_type?: string | null; description?: string | null
  scoring_context?: Record<string, any> | null; assist_player_name?: string | null; brought_forward?: boolean
}): string {
  if (SHOT_TYPES.has(e.event_type)) {
    const p = shotPhrase(e)
    const extra = e.sub_type ? detailWord(e.sub_type) : ''
    return [p, extra].filter(Boolean).join(' · ')
  }
  const parts: string[] = []
  const sc = e.scoring_context || {}
  if (e.event_type === 'FREE_KICK') {
    parts.push(sc.scored ? 'Scored' : sc.wide ? 'Wide' : 'Free won')
  } else if (e.event_type === 'POINT_SCORED' && String(sc.source ?? '').toUpperCase().includes('FREE')) {
    parts.push('From a free')
  }
  if (e.sub_type) parts.push(detailWord(e.sub_type))
  const d = (e.description || '').trim()
  const generic = new Set(['kick pass', 'high ball', 'hand pass'])
  if (d && !generic.has(d.toLowerCase()) && !/^[A-Z_]+$/.test(d)) {
    const word = detailWord(d)
    if (!parts.includes(word)) parts.push(d === word ? d : d)
  }
  if (e.event_type === 'FOUL_COMMITTED' && e.brought_forward) parts.push('brought forward')
  return Array.from(new Set(parts)).join(' · ')
}
