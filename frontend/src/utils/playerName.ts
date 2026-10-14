/**
 * Player names can carry a captain / vice-captain marker, e.g. "Peadar Mogan (c)". Anything that takes the "last word"
 * of a name to show a surname then showed the marker alone ("(c)"). These helpers take the marker off first and show it
 * as a small (c) badge instead.
 */

const CAPTAIN_RE = /\s*\((?:c|vc)\)\s*$/i

/** The name without the captain marker: "Peadar Mogan (c)" -> "Peadar Mogan". */
export function cleanPlayerName(name: string | null | undefined): string {
  return (name || '').replace(CAPTAIN_RE, '').trim()
}

export function isCaptainName(name: string | null | undefined): boolean {
  return /\(c\)\s*$/i.test(name || '')
}

/** Surname for a pitch circle / picker chip: "Mogan" (with a small captain mark: "Mogan ©"). */
export function displaySurname(name: string | null | undefined, withCaptainMark = true): string {
  const clean = cleanPlayerName(name)
  const surname = clean.split(' ').pop() || clean
  return withCaptainMark && isCaptainName(name) ? `${surname} ©` : surname
}

/** Initials: "Peadar Mogan (c)" -> "PM". */
export function playerInitials(name: string | null | undefined, max = 3): string {
  return cleanPlayerName(name).split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, max)
}
