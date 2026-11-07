/**
 * Pitch for every GPS view, drawn to scale for the match's length and width (PitchMarkings) on the shared canvas size.
 * Children draw in METRES in our attack frame: x = 0 our goal line (left) .. lengthM their goal line (right),
 * y = 0 top touchline (our LEFT when attacking right) .. widthM. Use the `m` helper to place things.
 */
import { useId, type ReactNode } from 'react'

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

export default function GpsPitch({ lengthM, widthM, children, className = '', label, onPointerDown, dim = false }: {
  lengthM: number; widthM: number; children?: (s: PitchScale) => ReactNode; className?: string; label?: string
  /** darken the grass so a colour scale on top (heat map) keeps its low end visible */
  dim?: boolean
  onPointerDown?: (e: React.PointerEvent<SVGSVGElement>) => void
}) {
  const s = makeScale(lengthM, widthM)
  return (
    <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className={`w-full h-auto block select-none ${className}`} role="img" aria-label={label || 'Pitch'} onPointerDown={onPointerDown}>
      <PitchMarkings s={s} L={lengthM} W={widthM} />
      {dim && <rect x={0} y={0} width={PITCH.svgW} height={PITCH.svgH} fill="#060a14" opacity={0.72} />}
      {children?.(s)}
    </svg>
  )
}

/**
 * The pitch drawn to scale in metres for THIS match's length and width, so GPS dots sit against the real markings.
 * (The shared /pitch-svg.svg artwork's arc is ~44.5 m at 145 m, not the 40 m arc: players standing on the real arc
 * were drawn ~4 m inside it.) GAA markings: 13 m, 20 m, 45 m and 65 m lines from each end line, halfway; small
 * rectangle 14 x 4.5 m, large rectangle 19 x 13 m, the 13 m-radius D on the 20 m line, the 40 m arc from the centre of
 * the goal, goals 6.5 m wide.
 */
function PitchMarkings({ s, L, W }: { s: PitchScale; L: number; W: number }) {
  const line = { stroke: '#F0F4EE', strokeWidth: 6, fill: 'none' } as const
  const cy = W / 2
  const ends = [{ g: 0, d: 1 }, { g: L, d: -1 }]   // goal line x and the direction into the pitch
  const clip = `gps-pitch-clip-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const arc = (gx: number, dir: number, r: number) => {
    // half circle of radius r (metres) centred on (gx, cy), on the pitch side; drawn as many points so the x/y scales may differ
    const pts: string[] = []
    for (let k = 0; k <= 64; k++) {
      const a = -Math.PI / 2 + (Math.PI * k) / 64
      pts.push(`${s.x(gx + dir * r * Math.cos(a))},${s.y(cy + r * Math.sin(a))}`)
    }
    return `M${pts.join('L')}`
  }
  const stripes = Array.from({ length: 12 }, (_, i) => i)
  return (
    <g>
      <rect x={0} y={0} width={PITCH.svgW} height={PITCH.svgH} fill="#32661B" />
      {stripes.map(i => i % 2 === 0 && (
        <rect key={i} x={s.x((L / 12) * i)} y={s.y(0)} width={s.len(L / 12)} height={W * s.sy} fill="#2E5F18" />
      ))}
      <defs><clipPath id={clip}><rect x={s.x(0)} y={s.y(0)} width={L * s.sx} height={W * s.sy} /></clipPath></defs>
      <rect x={s.x(0)} y={s.y(0)} width={L * s.sx} height={W * s.sy} {...line} />
      <line x1={s.x(L / 2)} y1={s.y(0)} x2={s.x(L / 2)} y2={s.y(W)} {...line} strokeDasharray="22 16" />
      {ends.map(({ g, d }) => (
        <g key={g}>
          {[13, 20, 45, 65].map(m => <line key={m} x1={s.x(g + d * m)} y1={s.y(0)} x2={s.x(g + d * m)} y2={s.y(W)} {...line} />)}
          <rect x={s.x(d > 0 ? g : g - 4.5)} y={s.y(cy - 7)} width={4.5 * s.sx} height={14 * s.sy} {...line} />
          <rect x={s.x(d > 0 ? g : g - 13)} y={s.y(cy - 9.5)} width={13 * s.sx} height={19 * s.sy} {...line} />
          <path d={arc(g + d * 20, d, 13)} {...line} clipPath={`url(#${clip})`} />
          <path d={arc(g, d, 40)} {...line} clipPath={`url(#${clip})`} />
          <line x1={s.x(g + d * 11)} y1={s.y(cy - 0.4)} x2={s.x(g + d * 11)} y2={s.y(cy + 0.4)} {...line} />
          <rect x={s.x(d > 0 ? g - 2.5 : g)} y={s.y(cy - 3.25)} width={2.5 * s.sx} height={6.5 * s.sy} {...line} />
        </g>
      ))}
    </g>
  )
}

/** "Our goal" / "attacking ->" captions under a pitch, so the frame is never ambiguous. */
export function PitchFrameCaption({ raw = false, team = 'We', ownRight }: { raw?: boolean; team?: string; ownRight?: boolean }) {
  return (
    <div className="flex justify-between text-[11px] text-white/45 px-1 mt-1">
      {!raw ? <><span>Our goal</span><span>{team} attacking →</span></>
        : ownRight == null ? <span>As filmed (ends swap at half-time)</span>
        : ownRight ? <><span>Our goal · as filmed</span><span>{team} attacking →</span></>
        : <><span>← {team} attacking</span><span>as filmed · Our goal</span></>}
    </div>
  )
}
