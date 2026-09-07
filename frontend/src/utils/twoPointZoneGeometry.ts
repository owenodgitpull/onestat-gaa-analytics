/**
 * Geometry for Simple Scoring's "where can a 2-pointer be taken from" pitch
 * shading/validation. The curved boundary is copied verbatim from
 * `ShootingEfficiencyHeatmap.tsx`'s `PITCH_ARC_POINTS` — that file traces
 * the pitch artwork's own drawn 40m arc pixel-for-pixel (see its own header
 * comment for how) rather than approximating it with a circle/ellipse, so
 * reusing the same points here is what makes the live shading actually line
 * up with the white arc drawn on the pitch. Duplicated rather than imported
 * from that chart component — this codebase's established policy for
 * pitch-geometry constants (see `pitchGeometry.ts`'s own header) is to keep
 * consumers decoupled so a change for one never risks the other.
 *
 * The points below were traced for the RIGHT-side goal. `mirrorX` reflects
 * them for a team attacking left — the pitch artwork's two arcs are
 * symmetric, so a mirrored copy of one is pixel-accurate for the other.
 */

import { PITCH } from './pitchGeometry'

const ARC_POINTS_ATTACKING_RIGHT: { x: number; y: number }[] = [
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

// Both arc endpoints sit at this x — the artwork's own flat side segments
// run at the same x down to the touchlines, so extending straight from here
// to the pitch edge is a seamless continuation, not a separate estimate.
const FLAT_X = ARC_POINTS_ATTACKING_RIGHT[0].x
const GOAL_X_RIGHT = PITCH.left + PITCH.playW
const CENTER_X = PITCH.left + PITCH.playW / 2 // the halfway line, and the mirror axis

export type TwoPointDirection = 'left' | 'right'

function mirrorX(x: number): number {
  return 2 * CENTER_X - x
}

function arcPoints(direction: TwoPointDirection) {
  return direction === 'right'
    ? ARC_POINTS_ATTACKING_RIGHT
    : ARC_POINTS_ATTACKING_RIGHT.map(p => ({ x: mirrorX(p.x), y: p.y }))
}

function flatX(direction: TwoPointDirection): number {
  return direction === 'right' ? FLAT_X : mirrorX(FLAT_X)
}

function goalX(direction: TwoPointDirection): number {
  return direction === 'right' ? GOAL_X_RIGHT : PITCH.left
}

/** Fill path for the "too close" zone — inside the 40m arc, invalid for a
 *  2-pointer. Traces the goal line, the arc's own curve, and the flat run
 *  connecting the arc's ends out to the touchlines. */
export function closeZonePath(direction: TwoPointDirection): string {
  const pts = arcPoints(direction)
  const fx = flatX(direction)
  const gx = goalX(direction)
  const poly = [
    { x: gx, y: PITCH.top },
    { x: fx, y: PITCH.top },
    ...pts,
    { x: fx, y: PITCH.top + PITCH.playH },
    { x: gx, y: PITCH.top + PITCH.playH },
  ]
  return `M ${poly.map(p => `${p.x} ${p.y}`).join(' L ')} Z`
}

/** Just the curved boundary itself, for a stroked outline matching the
 *  pitch artwork's own drawn arc line. */
export function arcStrokePath(direction: TwoPointDirection): string {
  const pts = arcPoints(direction)
  return `M ${pts.map(p => `${p.x} ${p.y}`).join(' L ')}`
}

/**
 * Fill path for the valid 2-pointer region: the shooting team's whole
 * attacking half (from the halfway line onward), minus the area inside the
 * 40m arc — i.e. the purple zone the shooting-efficiency chart highlights,
 * PLUS the rest of midfield, per the product call that any open-play shot
 * outside the arc counts, not just the chart's own tighter analysis band.
 * Same "walk the perimeter" construction as closeZonePath, just anchored to
 * the halfway line instead of the goal line, so the two shapes are always
 * geometrically disjoint by construction — nowhere is shaded as both valid
 * and invalid.
 */
export function validZonePath(direction: TwoPointDirection): string {
  const pts = arcPoints(direction)
  const fx = flatX(direction)
  const reversed = [...pts].reverse()
  return (
    `M ${CENTER_X} ${PITCH.top} ` +
    `L ${CENTER_X} ${PITCH.top + PITCH.playH} ` +
    `L ${fx} ${PITCH.top + PITCH.playH} ` +
    `L ${reversed.map(p => `${p.x} ${p.y}`).join(' L ')} ` +
    `L ${fx} ${PITCH.top} Z`
  )
}

/** Even-odd ray-casting point-in-polygon test against the exact same
 *  vertex list closeZonePath draws, so "is this tap too close" and "where
 *  the red shading is" can never disagree. */
function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
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

/** pctX/pctY are 0-100 pitch-percentage coordinates (0 = left goal line). */
export function isInsideCloseZone(pctX: number, pctY: number, direction: TwoPointDirection): boolean {
  const svgX = PITCH.left + (pctX / 100) * PITCH.playW
  const svgY = PITCH.top + (pctY / 100) * PITCH.playH
  const pts = arcPoints(direction)
  const fx = flatX(direction)
  const gx = goalX(direction)
  const poly = [
    { x: gx, y: PITCH.top },
    { x: fx, y: PITCH.top },
    ...pts,
    { x: fx, y: PITCH.top + PITCH.playH },
    { x: gx, y: PITCH.top + PITCH.playH },
  ]
  return pointInPolygon(svgX, svgY, poly)
}

/** A 2-pointer is valid outside the 40m arc, but never from the shooting
 *  team's own defensive half — nobody can realistically kick a 2-pointer
 *  from there even though it's technically ">40m from goal" too. */
export function isValidTwoPointerSpot(pctX: number, pctY: number, direction: TwoPointDirection): boolean {
  if (isInsideCloseZone(pctX, pctY, direction)) return false
  const inOwnDefensiveHalf = direction === 'right' ? pctX < 50 : pctX > 50
  return !inOwnDefensiveHalf
}

/** SVG-pixel x of the halfway line — the valid zone's outer (non-arc) edge. */
export const HALFWAY_SVG_X = CENTER_X
