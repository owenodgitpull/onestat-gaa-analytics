/**
 * Video clock <-> GPS UTC clock. Mirror of backend/app/services/gps_timeseries/clock.py: keep them in step.
 *
 * A match video has one or more PERIODS (first half, second half, extra time 1 and 2). The video has the breaks
 * cut out, so each period carries its own linear mapping:
 *
 *     gpsUtcMs = videoMs * rate + offsetMs
 *
 * A video time belongs to the latest period whose videoStartMs it has passed (before the first mark, period 1).
 * `rate` is 1 + drift and has measured within 0.001 of 1 on every match so far.
 */

export interface GpsPeriod {
  half: number
  video_start_ms: number
  video_end_ms?: number | null
  offset_ms: number
  rate?: number | null
  source?: 'auto' | 'manual'
  n_carries?: number
  median_residual_m?: number
  p75_residual_m?: number
}

export function periodForVideoMs(periods: GpsPeriod[], videoMs: number): GpsPeriod | null {
  const ps = [...periods].sort((a, b) => a.video_start_ms - b.video_start_ms)
  if (!ps.length) return null
  let cur = ps[0]
  for (const p of ps) if (videoMs >= p.video_start_ms) cur = p
  return cur
}

export function videoToGpsMs(periods: GpsPeriod[], videoMs: number): number | null {
  const p = periodForVideoMs(periods, videoMs)
  if (!p) return null
  return videoMs * (p.rate ?? 1) + p.offset_ms
}

/** Inverse mapping; a GPS time inside a cut (half-time) clamps to the start of the following period. */
export function gpsToVideoMs(periods: GpsPeriod[], gpsMs: number): number | null {
  const ps = [...periods].sort((a, b) => a.video_start_ms - b.video_start_ms)
  if (!ps.length) return null
  let clamp: number | null = null
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i]
    const v = (gpsMs - p.offset_ms) / (p.rate ?? 1)
    const start = p.video_start_ms
    const end = i + 1 < ps.length ? ps[i + 1].video_start_ms : Infinity
    if (v >= start && v < end) return v
    if (v < start && clamp === null && i > 0) clamp = start
  }
  return clamp ?? (gpsMs - ps[0].offset_ms) / (ps[0].rate ?? 1)
}

/** Format a UTC epoch ms as HH:MM:SS.s (UTC) for sync-check displays. */
export function formatUtc(ms: number): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}.${Math.floor(d.getUTCMilliseconds() / 100)}`
}
