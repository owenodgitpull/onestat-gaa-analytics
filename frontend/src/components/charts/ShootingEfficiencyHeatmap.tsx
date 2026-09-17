import { useMemo } from 'react'
import { Target } from 'lucide-react'
import type { ShotLocation } from '@/services/api'

interface Props {
  shots: ShotLocation[]
}

// ─── Pitch SVG constants ───────────────────────────────────────────────────
const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }
const toSvg = (xPct: number, yPct: number) => ({
  x: PITCH.left + (xPct / 100) * PITCH.playW,
  y: PITCH.top  + (yPct / 100) * PITCH.playH,
})

// ─── Distance-from-goal geometry ───────────────────────────────────────────
// Everything below works in SVG units, not raw x/y percent. Percent-space
// mixes "% of pitch length" (x) with "% of pitch width" (y) — two different
// physical scales — so a Euclidean test done directly on percentages draws
// an ellipse in real-world terms, not a circle. Converting to SVG units
// first (via toSvg, which already applies the correct per-axis scale) keeps
// every distance/radius comparison in one uniform scale, so a circle in
// SVG-space is actually a circle in metres.
//
// This chart no longer assumes a global pitch-length-in-metres constant at
// all (a 130m-vs-145m guess was the root cause of a long saga here — see
// [[project-svg-clip-rule-bug]] memory). Every boundary the chart actually
// draws (the arc, the 45m line, the Long zone's far edge) is pixel-traced
// directly from pitch-svg.svg's own artwork instead, so there's no global
// scale left to get wrong — each marking is measured against the real
// drawing, not derived from an assumed real-world distance.
const GOAL_SVG_X = PITCH.left + PITCH.playW

// The 2-point arc boundary is traced directly from /pitch-svg.svg's own
// artwork rather than computed from an assumed 40m radius. That background
// image already draws a curved reference line near this goal (visible as
// the white arc on the pitch); every previous attempt to compute an
// independent circle from assumed pitch dimensions left a visible gap
// against it, because the drawn curve isn't a perfect 40m circle centred
// exactly on the goal line pixel — it's a hand-traced curve. Using its
// actual coordinates (extracted by parsing that file's path data and
// flattening the bezier segments between the two points where the curve
// meets the flat sideways run — local (410,48) and (410,1106) inside the
// translate(1461,129) path) guarantees this chart's boundary sits exactly
// on top of the line the user is looking at, with zero gap by construction.
const PITCH_ARC_POINTS: { x: number; y: number }[] = [
  { x: 1871.00, y: 177.00 },
  { x: 1844.46, y: 191.47 },
  { x: 1811.06, y: 210.01 },
  { x: 1799.82, y: 218.24 },
  { x: 1775.80, y: 234.01 },
  { x: 1726.06, y: 275.02 },
  { x: 1691.50, y: 309.50 },
  { x: 1663.11, y: 341.95 },
  { x: 1616.33, y: 410.09 },
  { x: 1605.68, y: 427.02 },
  { x: 1598.90, y: 439.32 },
  { x: 1578.00, y: 488.00 },
  { x: 1571.38, y: 504.53 },
  { x: 1555.92, y: 556.15 },
  { x: 1551.43, y: 572.23 },
  { x: 1539.41, y: 645.00 },
  { x: 1538.07, y: 651.40 },
  { x: 1536.83, y: 688.15 },
  { x: 1536.80, y: 706.81 },
  { x: 1546.00, y: 820.12 },
  { x: 1555.35, y: 852.38 },
  { x: 1559.88, y: 871.52 },
  { x: 1570.94, y: 905.79 },
  { x: 1591.15, y: 953.78 },
  { x: 1607.39, y: 986.00 },
  { x: 1611.89, y: 994.98 },
  { x: 1617.46, y: 1003.21 },
  { x: 1629.08, y: 1021.83 },
  { x: 1637.00, y: 1033.62 },
  { x: 1687.05, y: 1097.70 },
  { x: 1711.14, y: 1123.27 },
  { x: 1739.24, y: 1149.10 },
  { x: 1761.75, y: 1167.09 },
  { x: 1770.00, y: 1175.00 },
  { x: 1778.00, y: 1180.80 },
  { x: 1792.62, y: 1189.62 },
  { x: 1807.98, y: 1200.02 },
  { x: 1819.82, y: 1208.26 },
  { x: 1829.27, y: 1214.09 },
  { x: 1840.00, y: 1220.00 },
  { x: 1871.00, y: 1235.00 },
]
// Both endpoints sit at this x — the same x the artwork's own flat side
// segments run at (≈20m from goal), so the flat connectors down to the
// touchlines below are a seamless continuation, not a separate estimate.
const FLAT_X = PITCH_ARC_POINTS[0].x

// x of the arc boundary at a given y, linearly interpolated between the
// traced points (which are already ordered top-to-bottom) — used both to
// place each 2-point sub-zone's label in the middle of its actual (narrow,
// varying-width) sliver, and (below) to anchor the straight outer edge.
function arcXAtY(y: number): number {
  const pts = PITCH_ARC_POINTS
  if (y <= pts[0].y) return pts[0].x
  if (y >= pts[pts.length - 1].y) return pts[pts.length - 1].x
  for (let i = 0; i < pts.length - 1; i++) {
    if (y >= pts[i].y && y <= pts[i + 1].y) {
      const t = (y - pts[i].y) / (pts[i + 1].y - pts[i].y)
      return pts[i].x + t * (pts[i + 1].x - pts[i].x)
    }
  }
  return pts[pts.length - 1].x
}

// The straight outer edge is pixel-measured from the artwork's OWN,
// independently-drawn 45m line — a genuine full-height straight marking
// that turns out to exist in pitch-svg.svg after all (found by scanning
// every row of the rendered artwork for near-white pixels: a constant,
// unbroken vertical edge at x=1452–1459 across the entire playing height,
// y=130 to y=1270). A previous version of this constant instead anchored
// the line to the arc's own x at the pitch's vertical centre, reasoning
// that the two boundaries should touch with zero gap — that was wrong: a
// real 40m arc and a real 45m line are two independent markings that are
// NEVER supposed to touch, not even at the arc's closest point (there's a
// genuine ~5m gap between them everywhere, narrowest at the centre). Using
// the artwork's own drawn line for real gives that real gap back, the same
// way PITCH_ARC_POINTS already trusts the artwork over any formula.
const X45_SVG = 1455.5

const arcPointsStr = PITCH_ARC_POINTS.map(p => `${p.x} ${p.y}`).join(' L ')
const arcPointsReversedStr = [...PITCH_ARC_POINTS].reverse().map(p => `${p.x} ${p.y}`).join(' L ')
// The visible dashed border traces ONLY the arc and the straight outer edge
// — the two real reference lines. The flat connector/touchline segments
// that close the fill polygons (below) are real edges of the fill shapes
// but were never meant to be drawn as a border.
const ARC_STROKE_PATH = `M ${arcPointsStr}`
const OUTER_LINE_STROKE_PATH = `M ${X45_SVG} ${PITCH.top} L ${X45_SVG} ${PITCH.top + PITCH.playH}`

// Both shapes below are single SIMPLE (non-self-intersecting) polygons —
// no evenodd, no clipPath subtraction, no fill-rule/clip-rule distinction to
// get wrong. Each is just "walk the perimeter and close it."
const CLOSE_ZONE_POLY: { x: number; y: number }[] = [
  { x: GOAL_SVG_X, y: PITCH.top },
  { x: FLAT_X, y: PITCH.top },
  ...PITCH_ARC_POINTS,
  { x: FLAT_X, y: PITCH.top + PITCH.playH },
  { x: GOAL_SVG_X, y: PITCH.top + PITCH.playH },
]
const CLOSE_ZONE_PATH = `M ${CLOSE_ZONE_POLY.map(p => `${p.x} ${p.y}`).join(' L ')} Z`

const CRESCENT_PATH =
  `M ${X45_SVG} ${PITCH.top} ` +
  `L ${X45_SVG} ${PITCH.top + PITCH.playH} ` +
  `L ${FLAT_X} ${PITCH.top + PITCH.playH} ` +
  `L ${arcPointsReversedStr} ` +
  `L ${FLAT_X} ${PITCH.top} Z`

// Standard even-odd ray-casting point-in-polygon test, run against the
// exact same CLOSE_ZONE_POLY vertex list used for the fill above — so
// "which zone is this shot in" and "where the coloured boundary is drawn"
// can never disagree, because they're the same geometry.
function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y
    const xj = poly[j].x, yj = poly[j].y
    const intersects = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}

const X45_PCT = ((X45_SVG - PITCH.left) / PITCH.playW) * 100 // derived from the same pixel-measured 45m line as X45_SVG above — long zone's near edge matches the 2-point zone's outer edge exactly, by construction
// Long zone's outer (far) edge. User report 2026-09-17: the Long zone's
// colour stopped visibly short of a real line drawn in the pitch artwork,
// leaving a strip of bare pitch between the colour and that line. The
// previous value here (a computed "60m from goal" formula, X60_PCT) was
// never pixel-verified against the artwork the way X45_SVG/PITCH_ARC_POINTS
// already were — same class of bug as the rest of this chart's history.
// pitch-svg.svg turns out to have TWO real <line> elements (found by
// grepping the raw SVG for <line>, not <path> — easy to miss since every
// other marking in this file is a <path>): x=1264 and x=1062 (its mirror
// at the far end). x=1264 sits ~5m goal-side of the current X60_PCT edge —
// exactly the small, "close to it" gap reported — so use it directly
// instead of the formula.
const X_LONG_FAR_SVG = 1264
const X60_PCT = ((X_LONG_FAR_SVG - PITCH.left) / PITCH.playW) * 100 // ≈ 55.15

function isCloseRange(xPct: number, yPct: number) {
  const p = toSvg(xPct, yPct)
  return pointInPolygon(p.x, p.y, CLOSE_ZONE_POLY)
}

// Higher-opacity, more distinct colours so they read clearly on dark green
function getColor(pct: number) {
  if (pct >= 70) return 'rgba(16,185,129,0.75)'   // emerald
  if (pct >= 50) return 'rgba(234,179,8,0.80)'    // bright yellow — clearly different from green
  if (pct >= 30) return 'rgba(249,115,22,0.75)'   // orange
  return 'rgba(239,68,68,0.75)'                    // red
}
// The 2-point zone gets its own flat colour (purple) rather than the
// green/yellow/orange/red efficiency scale the other zones use — it's a
// visually distinct category (its own scoring value, its own dashed
// boundary), not another entry on that scale. The three Close sub-zones
// (Left/Centre/Right) get one flat colour too, for the same reason — one
// visual category, sub-divided for the per-third stats in the text, not
// three independently-graded efficiency cells.
const TWO_POINT_COLOR = 'rgba(168,85,247,0.55)'
const CLOSE_ZONE_COLOR = 'rgba(16,185,129,0.55)'
const CLOSE_ZONE_COLOR_EMPTY = 'rgba(16,185,129,0.15)'
const TWO_POINT_COLOR_EMPTY = 'rgba(168,85,247,0.15)'

// ─── Zone definitions ──────────────────────────────────────────────────────
// xMin/xMax/yMin/yMax define the bounding rect; arcBased applies the arc filter
interface ZoneDef {
  id: string; label: string
  xMin: number; xMax: number; yMin: number; yMax: number
  arcBased?: 'inside' | 'outside'
  twoPoint?: boolean
}

const ZONES: ZoneDef[] = [
  // Inside the composite close-range boundary (arc + 20m flat sides) —
  // clipped to CLOSE_ZONE_PATH below. xMin:65 is just a loose bounding box;
  // the real boundary is the clip.
  { id: 'close_left',   label: 'Close Left',   xMin: 65, xMax: 100, yMin: 0,  yMax: 33,  arcBased: 'inside' },
  { id: 'close_center', label: 'Close Centre',  xMin: 65, xMax: 100, yMin: 33, yMax: 67,  arcBased: 'inside' },
  { id: 'close_right',  label: 'Close Right',  xMin: 65, xMax: 100, yMin: 67, yMax: 100, arcBased: 'inside' },
  // Outside the composite boundary, out to the 45m line — split into thirds
  // now that the zone properly reaches the real 45m line (wide enough to
  // read three numbers; the first attempt at this split was reverted when
  // the zone was still squeezed up against a mis-measured arc).
  { id: 'two_point_left',   label: '2-Pt Left',   xMin: 65, xMax: 100, yMin: 0,  yMax: 33,  arcBased: 'outside', twoPoint: true },
  { id: 'two_point_center', label: '2-Pt Centre', xMin: 65, xMax: 100, yMin: 33, yMax: 67,  arcBased: 'outside', twoPoint: true },
  { id: 'two_point_right',  label: '2-Pt Right',  xMin: 65, xMax: 100, yMin: 67, yMax: 100, arcBased: 'outside', twoPoint: true },
  // Long range: from the pixel-traced X_LONG_FAR_SVG line out to the 45m
  // line — both real markings pixel-traced from the artwork, so this zone's
  // colour touches both boundaries with no gap on either side, and stops
  // well short of midfield.
  { id: 'long_left',   label: 'Long Left',   xMin: X60_PCT, xMax: X45_PCT, yMin: 0,  yMax: 33  },
  { id: 'long_center', label: 'Long Centre',  xMin: X60_PCT, xMax: X45_PCT, yMin: 33, yMax: 67  },
  { id: 'long_right',  label: 'Long Right',  xMin: X60_PCT, xMax: X45_PCT, yMin: 67, yMax: 100 },
]

export default function ShootingEfficiencyHeatmap({ shots }: Props) {
  const teamShots = useMemo(() => shots.filter(s => s.team === 'own'), [shots])

  const zoneStats = useMemo(() => {
    return ZONES.map(zone => {
      const inBox = (s: ShotLocation) =>
        s.x >= zone.xMin && s.x < zone.xMax && s.y >= zone.yMin && s.y < zone.yMax
      const zoneShots = teamShots.filter(s => {
        if (!inBox(s)) return false
        if (zone.arcBased === 'inside')  return  isCloseRange(s.x, s.y)
        if (zone.arcBased === 'outside') return !isCloseRange(s.x, s.y)
        return true
      })
      const total = zoneShots.length
      // For the 2-point zone specifically, "scored" must mean "converted as
      // a two-pointer" — a shot taken from outside the arc that goes in as
      // a GOAL (worth 3, not 2) is a real score and correctly counts as an
      // attempt here, but counting it as a "make" inflated the 2-point
      // conversion rate with scores that were never actually 2-pointers.
      // Every other zone keeps the general is_score flag (a goal from close
      // range genuinely is that zone's kind of score).
      const scored = zone.twoPoint
        ? zoneShots.filter(s => s.event_type === 'two_point' || s.event_type === 'two_point_free').length
        : zoneShots.filter(s => s.is_score).length
      const pct = total > 0 ? Math.round((scored / total) * 100) : -1
      return { ...zone, total, scored, pct }
    })
  }, [teamShots])

  const insight = useMemo(() => {
    const z = zoneStats.filter(z => z.total >= 3)
    if (!z.length) return null
    const best  = z.reduce((a, b) => a.pct > b.pct ? a : b)
    const worst = z.reduce((a, b) => a.pct < b.pct ? a : b)
    if (worst.pct < 40)
      return `Low conversion from ${worst.label.toLowerCase()} (${worst.pct}% from ${worst.total} shots). Best: ${best.label.toLowerCase()} at ${best.pct}%.`
    return `Strongest from ${best.label.toLowerCase()} (${best.pct}% from ${best.total} shots).`
  }, [zoneStats])

  // Centre SVG coords for a zone's bounding rect (for text placement)
  const zoneCentre = (z: ZoneDef) => {
    const tl = toSvg(z.xMin, z.yMin)
    const br = toSvg(z.xMax, z.yMax)
    return { cx: (tl.x + br.x) / 2, cy: (tl.y + br.y) / 2, tl, br }
  }

  const standardZones = zoneStats.filter(z => !z.twoPoint)
  const twoPointZones = zoneStats.filter(z => z.twoPoint)

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Target size={20} />
          Shooting Efficiency
        </h3>
      </div>

      {teamShots.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40">No shot data available</div>
      ) : (
        <>
          <div className="relative rounded-xl overflow-hidden flex-1 min-h-0">
            <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full h-full">
              <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
              <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

              <defs>
                {/* CLOSE_ZONE_PATH is a single simple polygon (no evenodd
                    subtraction needed), so clip-rule/fill-rule can't
                    disagree here regardless of which is set. */}
                <clipPath id="seh-close-zone">
                  <path d={CLOSE_ZONE_PATH} />
                </clipPath>
                {/* CRESCENT_PATH is likewise a single simple polygon — same
                    safety as above, used to clip the three 2-point thirds. */}
                <clipPath id="seh-crescent">
                  <path d={CRESCENT_PATH} />
                </clipPath>
              </defs>

              {/* ── RENDER ORDER: long → 2-pt crescent fill → close zone thirds
                  → 40m arc / 45m line border → text ── Close zones render
                  before the border but after the crescent fill, so they
                  always win at the boundary; the border strokes render last
                  so they're never hidden under any zone fill. */}

              {/* 1. Long zones (plain rects, no arc clipping needed) */}
              {standardZones.filter(z => !z.arcBased).map(zone => {
                const { tl, br } = zoneCentre(zone)
                return (
                  <rect key={zone.id}
                    x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                    fill={zone.total === 0 ? 'rgba(0,0,0,0.28)' : getColor(zone.pct)}
                    stroke="rgba(255,255,255,0.22)" strokeWidth="2"
                  />
                )
              })}

              {/* 2. 2-Point zone thirds: clipped to CRESCENT_PATH (a simple
                  polygon, so — like the close-zone clip — immune to any
                  clip-rule/fill-rule disagreement). No stroke on the clip
                  itself: its perimeter includes the flat 20m-line/touchline/
                  45m-line segments needed to close the shape, which aren't
                  meant to be drawn as a border; the border is added
                  separately in step 4 using only the true reference lines.
                  Each third gets its own thin white divider, same as the
                  Close thirds. */}
              {twoPointZones.map(zone => {
                const { tl, br } = zoneCentre(zone)
                return (
                  <g key={zone.id} clipPath="url(#seh-crescent)">
                    <rect
                      x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                      fill={zone.total === 0 ? TWO_POINT_COLOR_EMPTY : TWO_POINT_COLOR}
                      stroke="rgba(255,255,255,0.18)" strokeWidth="2"
                    />
                  </g>
                )
              })}

              {/* 3. Close zones: clipped to the composite close-range boundary */}
              {standardZones.filter(z => z.arcBased === 'inside').map(zone => {
                const { tl, br } = zoneCentre(zone)
                return (
                  <g key={zone.id} clipPath="url(#seh-close-zone)">
                    <rect
                      x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                      fill={zone.total === 0 ? CLOSE_ZONE_COLOR_EMPTY : CLOSE_ZONE_COLOR}
                      stroke="rgba(255,255,255,0.22)" strokeWidth="2"
                    />
                  </g>
                )
              })}

              {/* 4. Border: only the two real reference lines — the 40m arc
                  and the 45m line — using the exact same point data as the
                  fill shapes above, so they sit pixel-on-top of the actual
                  colour boundary rather than a separately-computed line. */}
              <path d={ARC_STROKE_PATH} fill="none"
                stroke="rgba(251,191,36,0.85)" strokeWidth="5" strokeDasharray="24 14" />
              <path d={OUTER_LINE_STROKE_PATH} fill="none"
                stroke="rgba(251,191,36,0.85)" strokeWidth="5" strokeDasharray="24 14" />

              {/* 5. All zone-stat text rendered last — never clipped, always on
                  top. Each text cluster sits on a soft dark backdrop pill so
                  it stays legible over whichever zone colour (or busy pitch
                  artwork) happens to be behind it — text alone had no
                  guaranteed contrast against the lighter yellow/green fills. */}
              {standardZones.map(zone => {
                const { tl, br, cy } = zoneCentre(zone)
                // Long zone sits directly against the 2-Pt zone with zero gap
                // between them (by design — see X45_PCT above), and the 2-Pt
                // crescent is narrowest right at centre, so its label crowds
                // up against whatever sits at the true centre of the Long
                // zone's own box. Bias the Long zone's text further toward
                // its midfield-side edge (away from goal, away from the 2-Pt
                // boundary) to open up breathing room between the two label
                // clusters — the coloured zone itself is untouched, only
                // where the text sits within it. Close zone's text cluster
                // (percentage + count + label) is similarly biased toward
                // its goal-side edge (br, since xMax=100 sits at the goal
                // line) rather than the plain bounding-box centre — user
                // feedback 2026-09-18: the Close/2-Pt clusters read as too
                // far from goal, Long's own bias was already right.
                const textX = zone.arcBased ? tl.x + (br.x - tl.x) * 0.8 : tl.x + (br.x - tl.x) * 0.12
                const labelW = zone.label.length * 17 + 24
                return (
                  <g key={`text-${zone.id}`}>
                    <rect x={textX - 115} y={cy - 88} width={230} height={140} rx={18}
                      fill="rgba(0,0,0,0.45)" />
                    <rect x={textX - labelW / 2} y={tl.y + 20} width={labelW} height={40} rx={8}
                      fill="rgba(0,0,0,0.7)" />
                    <text x={textX} y={cy - 28} textAnchor="middle" fill="white" fontSize="72" fontWeight="bold"
                      opacity={zone.total > 0 ? 1 : 0.3}>
                      {zone.total > 0 ? `${zone.pct}%` : '-'}
                    </text>
                    <text x={textX} y={cy + 32} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="42">
                      {zone.total > 0 ? `${zone.scored}/${zone.total}` : ''}
                    </text>
                    <text x={textX} y={tl.y + 55} textAnchor="middle" fill="white" fontSize="40" fontWeight="600">
                      {zone.label}
                    </text>
                  </g>
                )
              })}
              {twoPointZones.map(z => {
                // Centre of THIS third's actual sliver: the crescent's width
                // varies with y (narrowest at the centre, where the arc
                // bulges closest to the 45m line; widest near the
                // touchlines), so each third's label needs its own x,
                // computed from the arc's real position at that y rather
                // than a single shared value that would sit outside the
                // colour in the narrow middle third.
                const cy = (toSvg(z.xMin, z.yMin).y + toSvg(z.xMin, z.yMax).y) / 2
                const arcXHere = arcXAtY(cy)
                // Biased toward the arc (goal-side edge of the crescent, arcXHere)
                // rather than the plain midpoint with X45_SVG (the far/45m-line
                // edge) — same "move closer to goal" feedback as the Close zone.
                const cx = X45_SVG + (arcXHere - X45_SVG) * 0.7
                const labelW = z.label.length * 17 + 24
                return (
                  <g key={`text-${z.id}`}>
                    <rect x={cx - 115} y={cy - 88} width={230} height={140} rx={18}
                      fill="rgba(0,0,0,0.45)" />
                    <rect x={cx - labelW / 2} y={cy - 114} width={labelW} height={40} rx={8}
                      fill="rgba(0,0,0,0.7)" />
                    <text x={cx} y={cy - 28} textAnchor="middle" fill="white" fontSize="72" fontWeight="bold"
                      opacity={z.total > 0 ? 1 : 0.3}>
                      {z.total > 0 ? `${z.pct}%` : '-'}
                    </text>
                    <text x={cx} y={cy + 32} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="42">
                      {z.total > 0 ? `${z.scored}/${z.total}` : ''}
                    </text>
                    <text x={cx} y={cy - 87} textAnchor="middle" fill="rgba(251,191,36,0.95)" fontSize="40" fontWeight="bold">
                      {z.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 text-xs flex-wrap">
            {[
              ['rgba(16,185,129,0.85)', '≥70%'],
              ['rgba(234,179,8,0.9)',   '50–69%'],
              ['rgba(249,115,22,0.85)', '30–49%'],
              ['rgba(239,68,68,0.85)',  '<30%'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ background: c }} />
                <span className="text-white/60">{l}</span>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: CLOSE_ZONE_COLOR }} />
              <span className="text-white/60">Close</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(168,85,247,0.75)', border: '2px dashed rgba(251,191,36,0.7)' }} />
              <span className="text-white/60">2-Pt Zone</span>
            </div>
          </div>

          {insight && (
            <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-sm text-white/80">{insight}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
