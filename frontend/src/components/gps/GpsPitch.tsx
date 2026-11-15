/**
 * Pitch for every GPS view, on the shared artwork (public/pitch-svg.svg, constants in docs/pitch-svg-geometry.md).
 * Children draw in METRES in our attack frame: x = 0 our goal line (left) .. lengthM their goal line (right),
 * y = 0 top touchline (our LEFT when attacking right) .. widthM. Use the `m` helper to place things.
 */
import type { ReactNode } from 'react'

export const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }

/**
 * The artwork is not to scale everywhere (measured 2026-11-15, see backend gps_analysis/frame.py ART_FRACTIONS): its 40 m
 * arc sits at ~44.5 m and its 45 m line at ~50.7 m on the 145 m length. GPS views (warp on) draw TRUE metres where they
 * belong relative to the drawn lines; the numbers stay true metres. Same table as the backend, which turns tagged spots
 * into true metres (art_to_real). ART_WARP = false restores the straight 145 m scaling everywhere.
 */
export const ART_WARP = true
const ART_FRACTIONS: Record<number, number> = { 13: 0.0993, 20: 0.1345, 40: 0.3069, 45: 0.3497, 65: 0.4483 }

function warpTable(L: number): [number[], number[]] {
  const real = [0, 13, 20, 40, 45], art = [0, ...[13, 20, 40, 45].map(k => ART_FRACTIONS[k] * L)]
  if (L / 2 > 66) { real.push(65); art.push(ART_FRACTIONS[65] * L) }
  real.push(L / 2); art.push(L / 2)
  return [real, art]
}
function interp(v: number, xs: number[], ys: number[]) {
  if (v <= xs[0]) return ys[0]
  for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1])
  return ys[ys.length - 1]
}
function realToArtD(d: number, dy: number, L: number) {
  const [real, art] = warpTable(L)
  const xa = interp(d, real, art)
  const r = Math.hypot(d, dy), ra = interp(r, real, art)
  const xr = ra > Math.abs(dy) ? Math.sqrt(ra * ra - dy * dy) : xa
  const w = Math.min(1, Math.max(0, (52 - r) / 8)) * Math.min(1, Math.max(0, (d - 12) / 6))
  return w * xr + (1 - w) * xa
}
/** true metres from our goal line -> where the artwork draws that spot (metres on the straight 145 m scale) */
export function realToArtX(x: number, y: number, L: number, W: number) {
  const near = x <= L / 2, d = near ? x : L - x
  const da = realToArtD(Math.max(0, d), y - W / 2, L)
  return near ? da : L - da
}
/** inverse of realToArtX (y never changes) */
export function artToRealX(x: number, y: number, L: number, W: number) {
  const near = x <= L / 2, target = near ? x : L - x, dy = y - W / 2
  let lo = 0, hi = L / 2
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (realToArtD(mid, dy, L) < target) lo = mid; else hi = mid }
  const d = (lo + hi) / 2
  return near ? d : L - d
}

export function makeScale(lengthM: number, widthM: number, warp = false) {
  const sx = PITCH.playW / lengthM, sy = PITCH.playH / widthM
  const on = warp && ART_WARP
  return {
    /** x in true metres; pass the point's y too so spots near the arc land right against it (default: pitch centre) */
    x: (xm: number, ym?: number) => PITCH.left + (on ? realToArtX(xm, ym ?? widthM / 2, lengthM, widthM) : xm) * sx,
    y: (ym: number) => PITCH.top + ym * sy,
    /** metres -> svg units (use for radii, stroke widths in metres) */
    len: (m: number) => m * sx,
    sx, sy, warp: on, lengthM, widthM,
  }
}

export type PitchScale = ReturnType<typeof makeScale>

export default function GpsPitch({ lengthM, widthM, children, className = '', label, onPointerDown, dim = false, half, warp = true, fit = true }: {
  lengthM: number; widthM: number; children?: (s: PitchScale) => ReactNode; className?: string; label?: string
  /** darken the grass so a colour scale on top (heat map) keeps its low end visible */
  dim?: boolean
  /** show only our half (the left, x = 0 .. lengthM / 2, plus a little past halfway) */
  half?: 'left'
  /** draw true metres against the artwork's lines (GPS views); the replay passes false */
  warp?: boolean
  /** cap the height so the whole pitch fits on screen (the replay passes false) */
  fit?: boolean
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
}) {
  const s = makeScale(lengthM, widthM, warp)
  const vw = half === 'left' ? Math.round(PITCH.left + PITCH.playW / 2 + 60) : PITCH.svgW
  return (
    <svg viewBox={`0 0 ${vw} ${PITCH.svgH}`} className={`w-full h-auto block select-none mx-auto ${className}`} style={fit ? { maxWidth: pitchMaxWidth(half) } : undefined} role="img" aria-label={label || 'Pitch'} onPointerDown={onPointerDown}>
      <image href="/pitch-svg.svg" x={0} y={0} width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="none" />
      {dim && <rect x={0} y={0} width={PITCH.svgW} height={PITCH.svgH} fill="#060a14" opacity={0.72} />}
      {children?.(s)}
    </svg>
  )
}

/** Widest a pitch may be so its height stays within ~68% of the screen: the page stays full width, only pitches are capped. */
export function pitchMaxWidth(half?: 'left') {
  const vw = half === 'left' ? PITCH.left + PITCH.playW / 2 + 60 : PITCH.svgW
  return `calc(68vh * ${(vw / PITCH.svgH).toFixed(3)})`
}

/** "Our goal" / "attacking ->" captions under a pitch, so the frame is never ambiguous. */
export function PitchFrameCaption({ raw = false, team = 'We', ownRight, fit = true }: { raw?: boolean; team?: string; ownRight?: boolean; fit?: boolean }) {
  return (
    <div className="flex justify-between text-[11px] text-white/45 px-1 mt-1 mx-auto" style={fit ? { maxWidth: pitchMaxWidth() } : undefined}>
      {!raw ? <><span>Our goal</span><span>{team} attacking →</span></>
        : ownRight == null ? <span>As filmed (ends swap at half-time)</span>
        : ownRight ? <><span>Our goal · as filmed</span><span>{team} attacking →</span></>
        : <><span>← {team} attacking</span><span>as filmed · Our goal</span></>}
    </div>
  )
}
