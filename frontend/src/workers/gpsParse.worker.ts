/**
 * Parses one raw STATSports time-series CSV off the main thread (100-170 MB each, ~2 s per file).
 * In: { id, file: File, matchDate: 'YYYY-MM-DD' }. Out: { id, ok: true, track } or { id, ok: false, error }.
 * The page sends one file at a time so only one file's text is in memory at once.
 */
import { parseGpsFile, type TrackUpload } from '../utils/gpsTimeseriesParser'

export type GpsParseRequest = { id: string; file: File; matchDate: string }
export type GpsParseResponse = { id: string; ok: true; track: TrackUpload } | { id: string; ok: false; error: string }

const ctx = self as unknown as Worker

ctx.onmessage = async (e: MessageEvent<GpsParseRequest>) => {
  const { id, file, matchDate } = e.data
  try {
    const track = await parseGpsFile(file, matchDate)
    ctx.postMessage({ id, ok: true, track } satisfies GpsParseResponse)
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) } satisfies GpsParseResponse)
  }
}
