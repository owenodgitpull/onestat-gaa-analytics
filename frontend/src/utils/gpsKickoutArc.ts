/**
 * Kickout arc on the shared pitch artwork, for the GPS replay's display-only kickout correction.
 *
 * At a kickout nobody may be inside the arc at the kicking end. GPS dots near the arc can land a few metres inside the
 * DRAWN arc (the artwork's arc and a unit's 1-2 m error), so while a kickout is being taken the replay pulls any dot
 * that is inside it straight back out along the line from the centre of the goal: same angle, just far enough to sit
 * on the arc. Dots already outside are never moved. Stored GPS, tags and every figure the analysis uses are untouched.
 *
 * The boundary is the artwork's own traced arc (PITCH_ARC_POINTS, right-hand goal, svg units) plus its flat sections
 * along the 20 m line to the touchlines, so "inside" means inside what is drawn.
 */
import { PITCH_ARC_POINTS } from '../components/charts/ShootingEfficiencyHeatmap'
import { PITCH } from '../components/gps/GpsPitch'

const MARGIN_M = 0.6

/** boundary x (metres from the LEFT end) of the right-hand goal's arc at a given y (metres), for a pitch L x W */
function rightArcX(yM: number, L: number, W: number): number {
  const ySvg = PITCH.top + (yM / W) * PITCH.playH
  const pts = PITCH_ARC_POINTS
  let xSvg: number
  if (ySvg <= pts[0].y) xSvg = pts[0].x
  else if (ySvg >= pts[pts.length - 1].y) xSvg = pts[pts.length - 1].x
  else {
    xSvg = pts[pts.length - 1].x
    for (let i = 0; i < pts.length - 1; i++) {
      if (ySvg >= pts[i].y && ySvg <= pts[i + 1].y) {
        const t = (ySvg - pts[i].y) / (pts[i + 1].y - pts[i].y || 1)
        xSvg = pts[i].x + (pts[i + 1].x - pts[i].x) * t
        break
      }
    }
  }
  return ((xSvg - PITCH.left) / PITCH.playW) * L
}

/** is (x, y) metres inside the drawn arc at the given end (right = the x = L goal)? */
export function insideArc(x: number, y: number, right: boolean, L: number, W: number): boolean {
  const xr = right ? x : L - x
  return xr > rightArcX(y, L, W)
}

/** the point on the drawn arc (plus a small margin) straight out from the centre of the goal through (x, y) */
export function pullOutOfArc(x: number, y: number, right: boolean, L: number, W: number): { x: number; y: number } {
  if (!insideArc(x, y, right, L, W)) return { x, y }
  const gx = right ? L : 0, gy = W / 2
  let dx = x - gx, dy = y - gy
  let d = Math.hypot(dx, dy)
  if (d < 0.01) { dx = right ? -1 : 1; dy = 0; d = 1 }
  const ux = dx / d, uy = dy / d
  // walk outwards until the point is outside the drawn arc
  let r = d
  for (let k = 0; k < 400; k++) {
    r += 0.25
    const px = gx + ux * r, py = gy + uy * r
    if (py < 0 || py > W || !insideArc(px, py, right, L, W)) break
  }
  r += MARGIN_M
  return { x: gx + ux * r, y: Math.min(W, Math.max(0, gy + uy * r)) }
}
