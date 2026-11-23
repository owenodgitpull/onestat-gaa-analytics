/**
 * Stadiums: a ground's measured pitch, saved once per club and picked in match setup (backend routes/stadiums.py).
 * Picking one gives the match that pitch size; the GPS placement is redone with it.
 */
import { fetchAPI } from './api'

export interface Stadium {
  id: string
  name: string
  pitch_length_m: number
  pitch_width_m: number
  /** optional 2-4 corner flags [[lat, lon], ...] read off a map: fixes the pitch's angle exactly */
  corners: [number, number][] | null
  /** matches played there */
  matches: number
}

export type StadiumInput = { name: string; pitch_length_m: number; pitch_width_m: number; corners?: [number, number][] | null }

export const stadiumsApi = {
  list: () => fetchAPI<Stadium[]>('/stadiums'),
  create: (body: StadiumInput) => fetchAPI<Stadium>('/stadiums', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, body: Partial<StadiumInput>) => fetchAPI<Stadium>(`/stadiums/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
}

export const stadiumKeys = { all: ['stadiums'] as const }

/** "53.36027, -6.25208" per line (as copied from a map) -> [[lat, lon], ...]; null when empty; throws a readable message */
export function parseCorners(text: string): [number, number][] | null {
  const lines = text.split(/\n|;/).map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null
  const out: [number, number][] = []
  for (const l of lines) {
    const m = l.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/)
    if (!m) throw new Error(`Could not read "${l}" as latitude, longitude.`)
    const lat = parseFloat(m[1]), lon = parseFloat(m[2])
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new Error(`"${l}" is not a latitude, longitude.`)
    out.push([lat, lon])
  }
  if (out.length < 2 || out.length > 4) throw new Error('Give 2 corner flags on the same sideline, or all 4 corners.')
  return out
}
