/**
 * Shared helpers for parsing plain "YYYY-MM-DD" date strings (no time/
 * timezone component — e.g. TrainingSession.session_date, a SQL `Date`
 * column serialized via Python's `.isoformat()`).
 *
 * `new Date("2026-08-30")` parses a bare date string as UTC MIDNIGHT per
 * the JS spec, not local midnight. Formatting that with .toLocaleDateString()
 * then renders it in the viewer's LOCAL timezone — for anyone west of UTC
 * (any negative offset: the Americas, or simply a misconfigured device
 * clock), that rolls the displayed date back a full day. Never manifests
 * for a viewer in Ireland/UK (UTC+0/+1, never negative), which is why this
 * went unnoticed through most of development, but it's a real, live bug
 * for any other timezone — appending 'T00:00:00' (no Z) makes the JS Date
 * constructor parse the same string as LOCAL midnight instead, which is
 * what every caller here actually wants: "this calendar date, whoever's
 * looking at it."
 */
export function parseLocalDate(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00`)
}

/**
 * "Today" if the date is today (viewer's local calendar day), otherwise the
 * formatted date. Used where a date is shown alongside something session-
 * specific (an AI summary, a "last trained" note) — "Today" reads as fresher
 * and more immediate than spelling out the date, but only when it's true.
 */
export function formatSessionDateLabel(dateStr: string): string {
  const date = parseLocalDate(dateStr)
  const today = new Date()
  const isToday = date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  return isToday
    ? 'Today'
    : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
