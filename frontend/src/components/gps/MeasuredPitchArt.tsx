/**
 * A football pitch drawn to the ground's measured size (Owen 2026-11-23, after Jim McGuinness saw GPS dots a few metres
 * off the lines). Every marking is placed in metres from the goal lines, so it is exact for any length and width:
 *   13 m, 20 m and 45 m lines (and the 65 on a long pitch), halfway line, small rectangle 14 x 4.5 m, large rectangle
 *   19 x 13 m, goal 6.5 m, penalty spot 11 m, the 13 m semicircle on the 20 m line, and the 40 m arc from the centre of
 *   the goal line to where it meets the 20 m line.
 * The shared artwork (public/pitch-svg.svg) cannot do this: stretching it moves the 45 with the pitch length, and its
 * own 45 is drawn at 50.7 m of a 145 m pitch (measured). Tagging and the event charts keep the artwork.
 * Same look as the artwork: flat grass, off-white lines.
 */
import type { PitchScale } from './GpsPitch'

const LINE = '#f3f5ef'
const GRASS = '#33671c'

export default function MeasuredPitchArt({ s, svgW, svgH }: { s: PitchScale; svgW: number; svgH: number }) {
  const L = s.lengthM, W = s.widthM, mid = W / 2
  const lw = 11
  const x = (m: number) => s.x(m), y = (m: number) => s.y(m)
  const half = Math.sqrt(40 * 40 - 20 * 20)      // where the 40 m arc meets the 20 m line, metres either side of centre
  const stripes: number[] = []
  const band = L / 14
  for (let i = 0; i < 14; i += 2) stripes.push(i * band)

  const end = (right: boolean) => {
    const X = (d: number) => x(right ? L - d : d)
    const sweep = right ? 0 : 1
    const r40 = s.len(40), r13 = s.len(13)
    return (
      <g key={right ? 'r' : 'l'} fill="none" stroke={LINE} strokeWidth={lw}>
        {[13, 20, 45].map(d => <line key={d} x1={X(d)} y1={y(0)} x2={X(d)} y2={y(W)} />)}
        {L / 2 > 66 && <line x1={X(65)} y1={y(0)} x2={X(65)} y2={y(W)} strokeWidth={lw * 0.6} opacity={0.55} />}
        <rect x={Math.min(X(0), X(4.5))} y={y(mid - 7)} width={s.len(4.5)} height={s.len(14)} />
        <rect x={Math.min(X(0), X(13))} y={y(mid - 9.5)} width={s.len(13)} height={s.len(19)} />
        {/* 40 m arc, ending on the 20 m line */}
        <path d={`M ${X(20)} ${y(mid - half)} A ${r40} ${r40} 0 0 ${sweep} ${X(20)} ${y(mid + half)}`} />
        {/* 13 m semicircle on the 20 m line */}
        <path d={`M ${X(20)} ${y(mid - 13)} A ${r13} ${r13} 0 0 ${sweep} ${X(20)} ${y(mid + 13)}`} />
        {/* goal: 6.5 m between the posts, drawn 2 m deep behind the line */}
        <rect x={Math.min(X(0), X(-2))} y={y(mid - 3.25)} width={s.len(2)} height={s.len(6.5)} strokeWidth={lw * 0.7} />
        <circle cx={X(11)} cy={y(mid)} r={lw * 0.8} fill={LINE} stroke="none" />
      </g>
    )
  }
  const label = (d: number, text: string) => (
    <g key={text + d} fill="rgba(255,255,255,0.6)" fontSize={30} fontWeight={600} textAnchor="middle">
      <text x={x(d)} y={y(0) - 26}>{text}</text>
      <text x={x(L - d)} y={y(0) - 26}>{text}</text>
    </g>
  )
  return (
    <g aria-hidden="true">
      <rect x={0} y={0} width={svgW} height={svgH} fill={GRASS} />
      {stripes.map(m => <rect key={m} x={x(m)} y={y(0)} width={s.len(band)} height={s.len(W)} fill="#ffffff" opacity={0.035} />)}
      {end(false)}
      {end(true)}
      <line x1={x(L / 2)} y1={y(0)} x2={x(L / 2)} y2={y(W)} stroke={LINE} strokeWidth={lw} />
      <rect x={x(0)} y={y(0)} width={s.len(L)} height={s.len(W)} fill="none" stroke={LINE} strokeWidth={lw} />
      {label(20, '20 m')}
      {label(45, '45 m')}
      <text x={x(L / 2)} y={y(0) - 26} fill="rgba(255,255,255,0.6)" fontSize={30} fontWeight={600} textAnchor="middle">halfway</text>
    </g>
  )
}
