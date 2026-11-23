/**
 * One place that turns a saved pitch position (0-100 %, on the OLD ARTWORK's scale) into where it is drawn, and back.
 *
 * Why: tagged spots have always been saved as a percentage of the shared artwork (public/pitch-svg.svg), whose lines are
 * not at true distances (its 45 m line is at 50.7 m of a 145 m pitch). The GPS replay now draws a ground's pitch to scale
 * (components/gps/MeasuredPitchArt). When the live recording and video tagging screens draw that pitch too, a tap on its
 * true 45 must still be SAVED as the number the old artwork would have given for its 45, so old and new matches mean the
 * same thing and every chart keeps working. That conversion is the same one the backend uses (gps_analysis/frame.py
 * art_to_real) and the replay uses (GpsPitch artToRealX / realToArtX).
 *
 * The frame is OFF (null) unless a match has a saved ground: then every function here is exactly the old straight formula,
 * byte for byte (tested), and nothing a tagger sees or saves changes. The page that owns the match sets it.
 */
import { realToArtX, artToRealX } from '@/components/gps/GpsPitch'

export type PitchFrame = { L: number; W: number }

/** The artwork's play area inside its 2332 x 1446 canvas (same numbers as pitchGeometry.PITCH / GAAPitch). */
const A = { left: 183, top: 123, playW: 1960, playH: 1167 }

let frame: PitchFrame | null = null

export function setPitchFrame(f: PitchFrame | null | undefined) {
  frame = f && f.L >= 100 && f.L <= 160 && f.W >= 60 && f.W <= 100 ? { L: f.L, W: f.W } : null
}
export function getPitchFrame(): PitchFrame | null { return frame }

/** The frame for a match: only when a ground is saved on it (an old match, or none picked, keeps the artwork). */
export function frameForMatch(m: { stadium_id?: string | null; pitch_length_m?: number | null; pitch_width_m?: number | null } | null | undefined): PitchFrame | null {
  return m?.stadium_id && m.pitch_length_m && m.pitch_width_m ? { L: m.pitch_length_m, W: m.pitch_width_m } : null
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** saved % (x, with its y) -> svg x. y matters only near the 40 m arc, so pass it where it is known. */
export function pctToSvgX(pctX: number, pctY = 50): number {
  if (!frame) return (pctX / 100) * A.playW + A.left
  const { L, W } = frame
  const m = artToRealX(clamp(pctX, 0, 100) / 100 * L, clamp(pctY, 0, 100) / 100 * W, L, W)
  return A.left + (m / L) * A.playW
}

/** svg point -> saved % (x on the artwork's scale), unclamped when the frame is off (as before) */
export function svgToPctX(svgX: number, svgY: number): number {
  if (!frame) return ((svgX - A.left) / A.playW) * 100
  const { L, W } = frame
  const m = clamp((svgX - A.left) / A.playW, 0, 1) * L
  const y = clamp((svgY - A.top) / A.playH, 0, 1) * W
  return (realToArtX(m, y, L, W) / L) * 100
}

/** Where a 45 is taken from, as a saved %: the line the pitch DRAWS. Old artwork: the live-tuned 34 / 66. On the to-scale
 *  pitch the true 45 m line, which on the artwork's scale is 34.97 % / 65.03 %. */
export function fortyFiveLinePct(attacksRight: boolean): number {
  if (!frame) return attacksRight ? 66 : 34
  return attacksRight ? 65.03 : 34.97
}

/** saved % -> % of the whole 2332 x 1446 canvas, for HTML overlays positioned over the pitch */
export function pctToCanvasLeftPct(pctX: number, pctY = 50): number {
  return (pctToSvgX(pctX, pctY) / 2332) * 100
}
