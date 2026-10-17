/** Human label for a stored event type. One place, so a rename (e.g. "Kick Pass") can't be missed by a generic formatter. */
const OVERRIDES: Record<string, string> = {
  long_kick_pass: 'Kick Pass',
  throw_in: 'Throw-in won',
  pass_kick: 'Kick Pass',
}

export function humanEventType(type: string, titleCase = true): string {
  const key = String(type).toLowerCase().replace(/ /g, '_')
  if (OVERRIDES[key]) return titleCase ? OVERRIDES[key] : OVERRIDES[key].toLowerCase()
  const spaced = String(type).replace(/_/g, ' ')
  return titleCase ? spaced.replace(/\b\w/g, l => l.toUpperCase()) : spaced
}
