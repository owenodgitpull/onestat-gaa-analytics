/**
 * ONE definition of which events appear as dots on the Event Map, shared by Video Tagging, Live Recording and the
 * Match Result page so they can never drift apart. The map shows OUTCOMES (scores, misses, turnovers, kickouts, fouls,
 * defensive actions). Ball movement and bookkeeping markers - kick passes, high balls, hand passes, free short/high
 * restarts, press windows, opposition pass taps, subs - are not map events.
 */
const NOT_ON_MAP = new Set([
  'long_kick_pass', 'pass_kick', 'high_ball', 'free_short_pass', 'free_high_ball',
  'other', 'substitution', 'sideline_ball',
])

export function isMapEventType(eventType: string): boolean {
  return !NOT_ON_MAP.has(String(eventType).toLowerCase())
}
