/**
 * An event's video time is when the user TAPPED it, which is always a moment after the action
 * itself (reaction time + picking the player). Jumping to an event starts a few seconds earlier so
 * the action is on screen and plays into the tap.
 */
export const EVENT_SEEK_LEAD_MS = 4000

export const seekTimeForEvent = (eventMs: number): number => Math.max(0, eventMs - EVENT_SEEK_LEAD_MS)
