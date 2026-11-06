/**
 * Pitch for every GPS view, on the shared artwork (public/pitch-svg.svg, constants in docs/pitch-svg-geometry.md).
 * Children draw in METRES in our attack frame: x = 0 our goal line (left) .. lengthM their goal line (right),
 * y = 0 top touchline (our LEFT when attacking right) .. widthM. Use the `m` helper to place things.
 */
import type { ReactNode } from 'react'

export const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }

export function makeScale(lengthM: number, widthM: number) {
  const sx = PITCH.playW / lengthM, sy = PITCH.playH / widthM
  return {
    x: (xm: number) => PITCH.left + xm * sx,
    y: (ym: number) => PITCH.top + ym * sy,
    /** metres -> svg units (use for radii, stroke widths in metres) */
    len: (m: number) => m * sx,
    sx, sy,
  }
}

export type PitchScale = ReturnType<typeof makeScale>

export default function GpsPitch({ lengthM, widthM, children, className = '', label, onPointerDown }: {
  lengthM: number; widthM: number; children?: (s: PitchScale) => ReactNode; className?: string; label?: string
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
}) {
  const s = makeScale(lengthM, widthM)
  return (
    <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className={`w-full h-auto block select-none ${className}`} role="img" aria-label={label || 'Pitch'} onPointerDown={onPointerDown}>
      <image href="/pitch-svg.svg" x={0} y={0} width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="none" />
      {children?.(s)}
    </svg>
  )
}

/** "Our goal" / "attacking ->" captions under a pitch, so the frame is never ambiguous. */
export function PitchFrameCaption({ raw = false, team = 'We' }: { raw?: boolean; team?: string }) {
  return (
    <div className="flex justify-between text-[11px] text-white/45 px-1 mt-1">
      {raw ? <span>Camera view: as filmed (ends swap at half-time)</span> : <><span>Our goal</span><span>{team} attacking →</span></>}
    </div>
  )
}
