/**
 * Attack-direction helpers — THE one place that knows how to turn raw pitch coordinates into a
 * direction-aware frame. Every chart / stat that cares about "short vs long", "attacking vs
 * defensive third", "left vs right" or "distance from goal" MUST go through these.
 *
 * Why: pitch_x / pitch_y are stored exactly as drawn on screen (0-100 each, x = 0 at the LEFT goal).
 * Which goal a team attacks depends on the match's `attacking_right_first_half` AND on the half
 * (teams swap ends at half-time), and the opposition always attacks the other way. Reading raw x as
 * if "own goal = x 0" is only right for one team in one half.
 *
 * Frames (all use 0-100 and rotate 180° when flipped, so left/right stay the team's own left/right):
 *   - "attack frame" of a team: that team attacks towards x = 100, its own goal is at x = 0.
 *     Looking at the pitch from its own goal: small y = its LEFT, large y = its RIGHT.
 *
 * Keep this file in step with backend/app/utils/attack_direction.py (same rules, same tests).
 */

export type Side = 'own' | 'opponent'

/** Is this event in the first half? `half` wins; else fall back to the minute vs half length. */
export function isFirstHalf(
  half: number | null | undefined,
  minute?: number | null,
  halfDurationMins?: number | null,
): boolean {
  if (half != null) return half === 1
  if (minute != null) return minute < (halfDurationMins || 30)
  return true
}

/**
 * Does OUR team attack towards x = 100 in this half?
 * `attackingRightFirstHalf` null/undefined = not recorded → assume true (the long-standing default).
 */
export function ownAttacksRight(
  attackingRightFirstHalf: boolean | null | undefined,
  half: number | null | undefined,
  minute?: number | null,
  halfDurationMins?: number | null,
): boolean {
  const base = attackingRightFirstHalf ?? true
  return isFirstHalf(half, minute, halfDurationMins) ? base : !base
}

/** The opposition always attacks the opposite way to us. */
export function sideAttacksRight(side: Side, ownRight: boolean): boolean {
  return side === 'own' ? ownRight : !ownRight
}

/** Re-express a raw point in the attack frame of a team that `attacksRight` (or not). */
export function toAttackFrame(
  x: number,
  y: number,
  attacksRight: boolean,
): { x: number; y: number } {
  return attacksRight ? { x, y } : { x: 100 - x, y: 100 - y }
}

/** Convenience: a raw point → the attack frame of `side` for an event in a given half. */
export function pointInSideFrame(
  x: number,
  y: number,
  side: Side,
  attackingRightFirstHalf: boolean | null | undefined,
  half: number | null | undefined,
  minute?: number | null,
  halfDurationMins?: number | null,
): { x: number; y: number } {
  const ownRight = ownAttacksRight(attackingRightFirstHalf, half, minute, halfDurationMins)
  return toAttackFrame(x, y, sideAttacksRight(side, ownRight))
}

/** True when the match has no recorded attack direction (so charts are guessing). */
export function directionUnknown(attackingRightFirstHalf: boolean | null | undefined): boolean {
  return attackingRightFirstHalf == null
}
