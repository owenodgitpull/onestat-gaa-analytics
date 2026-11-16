/**
 * A small single-player tracker for clips (Presentations tracking ring). The coach clicks the player once; each new
 * video frame is searched around his last spot for the patch that looks most like him (colour, sum of absolute
 * differences on a 640-px-wide copy of the frame). The template slowly takes on his current look so turning or a camera
 * zoom does not lose him; when the best match is poor it reports `lost` so the editor can ask for a click.
 * Pure JS on canvas pixels: no library. Needs the video loaded with crossOrigin="anonymous" (R2 sends CORS headers).
 */

export const WORK_W = 640

export interface TrackResult { x: number; y: number; score: number; lost: boolean; edge: boolean }   // x, y in 0-100 of the frame

export class PatchTracker {
  private tw: number
  private th: number
  private tpl: Float32Array
  private mask: Uint8Array   // 1 = the player's own pixels (unlike the grass round the patch edge); only these are compared
  private cx: number
  private cy: number
  private vx = 0
  private vy = 0
  private base = 0          // score at the start: "lost" is judged against it
  private bgc: [number, number, number] = [0, 0, 0]   // the grass round him (updated each step: stripes, shade)
  private kit: [number, number, number] = [0, 0, 0]   // his average colour at the click (kit + skin): fixed, so he never swaps to a black-kitted referee or a different jersey crossing him
  constructor(frame: ImageData, xPct: number, yPct: number) {
    const W = frame.width, H = frame.height
    // a player is roughly 1/9 of the frame tall on a wide broadcast shot, a bit more when zoomed: a body-sized patch
    this.th = Math.max(18, Math.round(H * 0.09))
    this.tw = Math.max(10, Math.round(this.th * 0.55))
    this.cx = (xPct / 100) * W
    this.cy = (yPct / 100) * H
    this.tpl = this.patch(frame, this.cx, this.cy)
    // background = the average colour round the patch edge (grass); the player = pixels clearly unlike it. A patch that
    // is mostly grass otherwise "matches" anywhere on the grass and slides with the camera.
    const { tw, th, tpl } = this
    let br = 0, bg = 0, bb = 0, n = 0
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (y > 1 && y < th - 2 && x > 1 && x < tw - 2) continue
      const k = (y * tw + x) * 3; br += tpl[k]; bg += tpl[k + 1]; bb += tpl[k + 2]; n++
    }
    br /= n; bg /= n; bb /= n
    this.bgc = [br, bg, bb]
    this.mask = new Uint8Array(tw * th)
    let on = 0
    for (let i = 0; i < tw * th; i++) {
      const k = i * 3
      if (Math.abs(tpl[k] - br) + Math.abs(tpl[k + 1] - bg) + Math.abs(tpl[k + 2] - bb) > 60) { this.mask[i] = 1; on++ }
    }
    if (on < tw * th * 0.08) this.mask.fill(1)     // nothing stands out (e.g. clicked beside him): compare the whole patch
    let kr = 0, kg = 0, kb = 0, kn = 0
    for (let i = 0; i < tw * th; i++) if (this.mask[i]) { kr += tpl[i * 3]; kg += tpl[i * 3 + 1]; kb += tpl[i * 3 + 2]; kn++ }
    this.kit = [kr / kn, kg / kn, kb / kn]
  }

  private patch(f: ImageData, cx: number, cy: number): Float32Array {
    const { tw, th } = this
    const out = new Float32Array(tw * th * 3)
    const x0 = Math.round(cx - tw / 2), y0 = Math.round(cy - th / 2)
    let k = 0
    for (let y = 0; y < th; y++) {
      const yy = Math.min(f.height - 1, Math.max(0, y0 + y))
      for (let x = 0; x < tw; x++) {
        const xx = Math.min(f.width - 1, Math.max(0, x0 + x))
        const i = (yy * f.width + xx) * 4
        out[k++] = f.data[i]; out[k++] = f.data[i + 1]; out[k++] = f.data[i + 2]
      }
    }
    return out
  }

  /** grass colour = average of the patch's border at (cx, cy) */
  private border(f: ImageData, cx: number, cy: number): [number, number, number] {
    const p = this.patch(f, cx, cy), { tw, th } = this
    let r = 0, g = 0, b = 0, n = 0
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      if (y > 1 && y < th - 2 && x > 1 && x < tw - 2) continue
      const k = (y * tw + x) * 3; r += p[k]; g += p[k + 1]; b += p[k + 2]; n++
    }
    return [r / n, g / n, b / n]
  }

  /** [look, grass, kit] at the patch centred at (cx, cy), over his pixels: look = difference from his learned look
   * (changes as he runs and turns), grass = how much the patch looks like the grass round him (an empty bit of pitch
   * must never win: the ring slid onto grass and stayed there), kit = how far its average colour is from his at the
   * click (fixed: a black-kitted referee or another jersey crossing him must not take the ring) */
  private parts(f: ImageData, cx: number, cy: number): [number, number, number] {
    const { tw, th, tpl, mask } = this
    const [gr, gg, gb] = this.bgc
    const x0 = Math.round(cx - tw / 2), y0 = Math.round(cy - th / 2)
    let s = 0, gp = 0, n = 0, mr = 0, mg = 0, mb = 0
    for (let y = 0; y < th; y++) {
      const yy = y0 + y
      if (yy < 0 || yy >= f.height) continue
      for (let x = 0; x < tw; x++) {
        const xx = x0 + x
        if (xx < 0 || xx >= f.width || !mask[y * tw + x]) continue
        const i = (yy * f.width + xx) * 4, k = (y * tw + x) * 3
        const r = f.data[i], g = f.data[i + 1], b = f.data[i + 2]
        s += Math.abs(r - tpl[k]) + Math.abs(g - tpl[k + 1]) + Math.abs(b - tpl[k + 2])
        const dg = Math.abs(r - gr) + Math.abs(g - gg) + Math.abs(b - gb)
        if (dg < 70) gp += 70 - dg
        mr += r; mg += g; mb += b
        n++
      }
    }
    if (!n) return [Infinity, Infinity, Infinity]
    const [kr, kg, kb] = this.kit
    return [s / n, gp / n, Math.abs(mr / n - kr) + Math.abs(mg / n - kg) + Math.abs(mb / n - kb)]
  }

  private score(f: ImageData, cx: number, cy: number): number {
    const [l, g, k] = this.parts(f, cx, cy)
    return l + g + 0.8 * k
  }

  update(f: ImageData): TrackResult {
    const R = Math.round(f.width * 0.05)          // search radius: a fast run plus a camera pan in one 80 ms step
    const px = this.cx + this.vx, py = this.cy + this.vy   // predicted from the last movement
    let best = Infinity, bx = px, by = py
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const v = this.score(f, px + dx, py + dy)
      if (v < best) { best = v; bx = px + dx; by = py + dy }
    }
    const cx0 = bx, cy0 = by
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = this.score(f, cx0 + dx, cy0 + dy)
      if (v < best) { best = v; bx = cx0 + dx; by = cy0 + dy }
    }
    const [, grass, kit] = this.parts(f, bx, by)
    if (!this.base) this.base = Math.max(10, best)
    // lost = the best spot looks like grass, or is a different colour of kit. Not "looks less like him than at the
    // click": a running player's look changes every step (that rule gave up on players in plain view).
    const lost = grass > 30 || kit > 95
    if (!lost) {
      this.vx = 0.6 * this.vx + 0.4 * (bx - this.cx)
      this.vy = 0.6 * this.vy + 0.4 * (by - this.cy)
      this.cx = bx; this.cy = by
      this.bgc = this.border(f, bx, by)
      // keep learning his look as he runs and turns (his own pixels only); the fixed kit colour stops it drifting
      const cur = this.patch(f, bx, by), m = this.mask
      for (let i = 0; i < m.length; i++) if (m[i]) for (let c = 0; c < 3; c++) this.tpl[i * 3 + c] = 0.85 * this.tpl[i * 3 + c] + 0.15 * cur[i * 3 + c]
    }
    // at the edge of the picture he is walking out of shot: the search cannot follow him there
    const edge = this.cx < this.tw * 0.6 || this.cx > f.width - this.tw * 0.6 || this.cy < this.th * 0.4 || this.cy > f.height - this.th * 0.4
    return { x: (this.cx / f.width) * 100, y: (this.cy / f.height) * 100, score: best, lost, edge }
  }
}

/** Light smoothing of a keyframe path (removes the frame-to-frame jitter of the search), keeping times. */
export function smoothPath<T extends { video_timestamp_ms: number; x: number; y: number }>(kf: T[], r = 2): T[] {
  return kf.map((k, i) => {
    let sx = 0, sy = 0, n = 0
    for (let j = Math.max(0, i - r); j <= Math.min(kf.length - 1, i + r); j++) { sx += kf[j].x; sy += kf[j].y; n++ }
    return { ...k, x: Math.round((sx / n) * 100) / 100, y: Math.round((sy / n) * 100) / 100 }
  })
}
