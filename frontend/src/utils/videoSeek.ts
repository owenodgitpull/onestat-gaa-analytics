/**
 * An event's video time is when the user TAPPED it, which is always a moment after the action
 * itself (reaction time + picking the player). Jumping to an event starts a few seconds earlier so
 * the action is on screen and plays into the tap.
 *
 * The lead is per event type, measured with the GPS sync on the first five synced inter-county matches (how long after the action the
 * tap landed; the p25 is used so the action is on screen for three taps in four): see docs/gps-build-handover.md.
 * Kickouts are tapped at the kick, so they only need a short lead. Unknown types keep the old 4 s.
 */
export const EVENT_SEEK_LEAD_MS = 4000

export const EVENT_SEEK_LEAD_BY_TYPE: Record<string, number> = {
  PASS_HAND: 3000,
  LONG_KICK_PASS: 3000,
  POINT_SCORED: 5000,
  GOAL_SCORED: 5000,
  WIDE: 5000,
  SHORT: 5000,
  SAVED: 5000,
  HIT_POST: 5000,
  FOUL_COMMITTED: 8000,
  OWN_KICKOUT_WON: 2000,
  OWN_KICKOUT_WON_BREAK: 2000,
  OWN_KICKOUT_OPPOSITION_WON: 2000,
  OWN_KICKOUT_OPPOSITION_WON_BREAK: 2000,
  OPP_KICKOUT_WON: 2000,
  OPP_KICKOUT_WON_BREAK: 2000,
  OPP_KICKOUT_OPPOSITION_WON: 2000,
  OPP_KICKOUT_OPPOSITION_WON_BREAK: 2000,
}

export const seekLeadForType = (eventType?: string | null): number =>
  (eventType && EVENT_SEEK_LEAD_BY_TYPE[eventType]) || EVENT_SEEK_LEAD_MS

export const seekTimeForEvent = (eventMs: number, eventType?: string | null): number =>
  Math.max(0, eventMs - seekLeadForType(eventType))
