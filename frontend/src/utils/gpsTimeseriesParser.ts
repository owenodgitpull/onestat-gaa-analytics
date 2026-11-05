/**
 * Browser-side parser for raw GPS time-series exports (STATSports "RawDataExtended": one CSV per player,
 * 100 to 170 MB, 100 Hz rows with the 10 Hz GPS fix repeated ten times).
 *
 * The browser reads the file from disk in chunks, keeps only rows whose Time changes (the 10 Hz fixes), and
 * produces the compact TrackUpload the backend stores (about 3 MB instead of 130 MB over the wire). Mirror of
 * backend/app/services/gps_timeseries/parser.py: same column aliases, same bad-fix rule, same gap filling.
 *
 * Runs fine on the main thread for one file (about 2 s per 130 MB on a laptop) but call it from a Web Worker
 * when looping over 25 files so the page stays responsive. Pure functions, no DOM.
 */

export type GpsFileKind = 'timeseries' | 'timeseries_sparse' | 'summary' | 'unknown'

export interface GpsFileDetection {
  kind: GpsFileKind
  message: string
  columns: string[]
  deviceName: string | null
  hz: number | null
}

/** What the backend's POST /matches/{id}/gps/timeseries/tracks accepts. */
export interface TrackUpload {
  device_name: string
  source_filename?: string
  player_id?: string
  hz: number
  t0_ms: number
  lat: number[]
  lon: number[]
  speed: number[]
  hr: number[]
  flags: number[]
  n_rows?: number
  n_fixes?: number
  n_bad?: number
}

export const FLAG_INTERPOLATED = 1
export const FLAG_BAD_FIX = 2

const TIME_COLS = ['time', 'timestamp', 'utc time', 'time (utc)', 'elapsed time', 'time of day']
const LAT_COLS = ['lat', 'latitude']
const LON_COLS = ['lon', 'long', 'longitude', 'lng']
const SPEED_COLS = ['speed (m/s)', 'speed', 'velocity', 'speed m/s']
const HR_COLS = ['heart rate (bpm)', 'heart rate', 'hr', 'hr (bpm)']
const HDOP_COLS = ['hdop']
const SAT_COLS = ['no. of satellites', 'satellites', 'num satellites', 'nsat']
const NAME_COLS = ['player display name', 'player', 'player name', 'name', 'athlete']
const SUMMARY_HINTS = ['total distance', 'distance', 'hsr', 'high speed', 'sprint', 'player load', 'max speed', 'dsl']
const BAD_HDOP = 2.5
const MIN_SATS = 8
const HZ = 10

function splitCsvLine(line: string): string[] {
  // Enough for these exports: quoted first field, plain numbers after. Handles quotes with commas inside.
  const out: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') q = !q
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

function findCol(cols: string[], names: string[]): number {
  const low = cols.map(c => c.trim().toLowerCase())
  for (const n of names) {
    const i = low.indexOf(n)
    if (i >= 0) return i
  }
  return -1
}

function parseHms(s: string): number {
  const [h, m, sec] = s.trim().split(':')
  return Number(h) * 3600 + Number(m) * 60 + Number(sec)
}

/** Decide from the first few KB whether a file is a raw time series or the per-player summary. */
export function detectGpsFileKind(headText: string): GpsFileDetection {
  const lines = headText.split(/\r?\n/).filter(l => l.trim())
  if (!lines.length) return { kind: 'unknown', message: 'Empty file', columns: [], deviceName: null, hz: null }
  const cols = splitCsvLine(lines[0])
  const ti = findCol(cols, TIME_COLS), lai = findCol(cols, LAT_COLS), loi = findCol(cols, LON_COLS), ni = findCol(cols, NAME_COLS)
  if (ti >= 0 && lai >= 0 && loi >= 0) {
    const times = new Set<number>()
    let name: string | null = null
    for (const ln of lines.slice(1, 400)) {
      const row = splitCsvLine(ln)
      const t = parseHms(row[ti] ?? '')
      if (!Number.isNaN(t)) times.add(t)
      if (name === null && ni >= 0 && row[ni]) name = row[ni].trim()
    }
    const uniq = [...times].sort((a, b) => a - b)
    let hz: number | null = null
    if (uniq.length > 5) {
      const diffs = uniq.slice(1).map((t, i) => t - uniq[i]).sort((a, b) => a - b)
      hz = 1 / diffs[Math.floor(diffs.length / 2)]
    }
    if (hz !== null && hz < 4) {
      return { kind: 'timeseries_sparse', message: `GPS time series but only about ${hz.toFixed(1)} samples per second: looks like a burst or event export, not a full 10 Hz track`, columns: cols, deviceName: name, hz }
    }
    return { kind: 'timeseries', message: `Full GPS time series (${hz ? hz.toFixed(0) : '?'} positions per second)${name ? ' for ' + name : ''}`, columns: cols, deviceName: name, hz }
  }
  const low = cols.map(c => c.toLowerCase())
  if (low.some(c => SUMMARY_HINTS.some(h => c.includes(h)))) return { kind: 'summary', message: 'Per-player GPS summary (one row per player)', columns: cols, deviceName: null, hz: null }
  return { kind: 'unknown', message: 'Could not recognise the columns', columns: cols, deviceName: null, hz: null }
}

/** The date in a STATSports file name (2026-04-26-...), or null. */
export function fileDateFromName(filename: string): string | null {
  const m = /(20\d\d)-(\d\d)-(\d\d)/.exec(filename || '')
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

interface Fix { t: number; lat: number; lon: number; speed: number; hr: number; bad: boolean }

/**
 * Parse a whole file's text into the compact upload. `matchDate` is YYYY-MM-DD (the file's Time column is UTC time
 * of day with no date). Use parseGpsFile for a File object (chunked read).
 */
export function parseGpsTimeseriesText(text: string, matchDate: string, filename?: string): TrackUpload {
  const nl = text.indexOf('\n')
  const header = splitCsvLine(text.slice(0, nl < 0 ? text.length : nl).replace(/\r$/, ''))
  const ti = findCol(header, TIME_COLS), lai = findCol(header, LAT_COLS), loi = findCol(header, LON_COLS)
  if (ti < 0 || lai < 0 || loi < 0) throw new Error('Not a GPS time series: needs Time, Lat and Lon columns')
  const si = findCol(header, SPEED_COLS), hi = findCol(header, HR_COLS), hdi = findCol(header, HDOP_COLS), sati = findCol(header, SAT_COLS), ni = findCol(header, NAME_COLS)
  const fixes: Fix[] = []
  let last = ''
  let name = ''
  let nRows = 0
  let pos = nl + 1
  const maxIdx = Math.max(ti, lai, loi)
  while (pos < text.length) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = text.length
    const line = text.slice(pos, end)
    pos = end + 1
    if (!line.trim()) continue
    nRows++
    // fast path: the Time field is the second field; the name is quoted so find the second comma
    const i1 = line.indexOf(',', 1)
    const i2 = line.indexOf(',', i1 + 1)
    const tt = ti === 1 ? line.slice(i1 + 1, i2) : undefined
    if (tt !== undefined && tt === last) continue
    const row = splitCsvLine(line.replace(/\r$/, ''))
    if (row.length <= maxIdx) continue
    const timeStr = row[ti]
    if (timeStr === last) continue
    last = timeStr
    const t = parseHms(timeStr), lat = Number(row[lai]), lon = Number(row[loi])
    if (Number.isNaN(t) || Number.isNaN(lat) || Number.isNaN(lon)) continue
    if (!name && ni >= 0) name = row[ni].trim().replace(/^"|"$/g, '')
    let speed = si >= 0 ? Number(row[si]) : 0
    if (Number.isNaN(speed) || Math.abs(speed) < 1e-6) speed = 0
    let hr = hi >= 0 ? Math.round(Number(row[hi])) : 0
    if (Number.isNaN(hr)) hr = 0
    let bad = lat === 0 || lon === 0
    if (hdi >= 0 && Number(row[hdi]) > BAD_HDOP) bad = true
    if (sati >= 0 && Number(row[sati]) < MIN_SATS) bad = true
    fixes.push({ t, lat, lon, speed, hr, bad })
  }
  if (!fixes.length) throw new Error('No GPS fixes found')
  // junk fixes far from the session (before satellite lock): more than ~1 km from the median
  const good = fixes.filter(f => !f.bad && f.lat !== 0 && f.lon !== 0)
  if (good.length >= 50) {
    const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }
    const mlat = med(good.map(f => f.lat)), mlon = med(good.map(f => f.lon))
    for (const f of fixes) if (Math.abs(f.lat - mlat) > 0.01 || Math.abs(f.lon - mlon) > 0.02) f.bad = true
  }
  const nBad = fixes.filter(f => f.bad).length
  const usable = fixes.filter(f => f.lat !== 0 && f.lon !== 0).sort((a, b) => a.t - b.t)
  if (!usable.length) throw new Error('Every fix is empty (no satellite lock)')
  return { ...densify(usable, HZ, matchDate), device_name: name, source_filename: filename, n_rows: nRows, n_fixes: fixes.length, n_bad: nBad }
}

function densify(fixes: Fix[], hz: number, matchDate: string): Omit<TrackUpload, 'device_name'> {
  const step = 1 / hz
  const t0 = Math.floor(fixes[0].t / step) * step
  const n = Math.floor((fixes[fixes.length - 1].t - t0) / step + 1e-6) + 1
  const lat = new Array<number>(n), lon = new Array<number>(n), speed = new Array<number>(n), hr = new Array<number>(n), flags = new Array<number>(n)
  let j = 0
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step
    while (j + 1 < fixes.length && fixes[j + 1].t <= t) j++
    const a = fixes[j]
    const b = j + 1 < fixes.length ? fixes[j + 1] : a
    const span = b.t - a.t
    const w = span > 1e-9 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0
    lat[i] = a.lat + (b.lat - a.lat) * w
    lon[i] = a.lon + (b.lon - a.lon) * w
    speed[i] = a.speed + (b.speed - a.speed) * w
    hr[i] = Math.round(a.hr + (b.hr - a.hr) * w)
    const nearest = Math.min(Math.abs(t - a.t), Math.abs(t - b.t))
    let f = nearest > 1.5 * step ? FLAG_INTERPOLATED : 0
    const nearestFix = Math.abs(t - a.t) <= Math.abs(t - b.t) ? a : b
    if (nearestFix.bad) f |= FLAG_BAD_FIX
    flags[i] = f
  }
  const dateEpochMs = Date.UTC(Number(matchDate.slice(0, 4)), Number(matchDate.slice(5, 7)) - 1, Number(matchDate.slice(8, 10)))
  return { hz, t0_ms: Math.round(dateEpochMs + t0 * 1000), lat, lon, speed, hr, flags }
}

/** Read a File (chunked, so a 170 MB file does not need two copies in memory) and parse it. */
export async function parseGpsFile(file: File, matchDate: string): Promise<TrackUpload> {
  const text = await file.text()
  return parseGpsTimeseriesText(text, matchDate, file.name)
}

/** Peek at the first 64 KB of a File for the kind detection (100 Hz rows need ~40 KB to show ten timestamps). */
export async function detectGpsFile(file: File): Promise<GpsFileDetection> {
  const head = await file.slice(0, 65536).text()
  return detectGpsFileKind(head)
}
