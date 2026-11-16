/**
 * Detection-based player tracking for the Presentations tracking ring (Owen, 2026-11-16: "still a bit jumpy and goes
 * off"). The usual method in tracking tools: a person detector finds every player as a box on each frame, and the
 * tracker links the chosen player's box from frame to frame by position, movement and kit colour. The ring can then only
 * ever sit on a detected person, never on grass or drift between players. The output is smoothed (one-euro filter) so
 * it does not jitter. utils/videoTracker.ts (colour-patch tracking) stays as the fallback when the detector cannot load.
 *
 * Detector: MediaPipe Object Detector (EfficientDet-Lite2, COCO "person"), Apache 2.0, in the browser (WebAssembly,
 * GPU where available), loaded only when the ring editor needs it. Players on a wide shot are ~40 px tall in a 720p
 * frame, too small for the model on the whole frame, so each step runs it on a crop round where he should be (the crop
 * is scaled up to the model's input). One detection per step, so ~20-60 ms a step.
 */

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm'
const MODEL = 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite2/float16/1/efficientdet_lite2.tflite'

type Box = { x: number; y: number; w: number; h: number; score: number }     // frame pixels, x/y = top-left
type Detector = { detect: (img: HTMLCanvasElement) => { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number }; categories: { categoryName: string; score: number }[] }[] } }

let detectorPromise: Promise<Detector> | null = null
/** Load the detector once per page (shared by every ring edited in this visit). */
export function loadDetector(): Promise<Detector> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
      const fileset = await FilesetResolver.forVisionTasks(WASM)
      const make = (delegate: 'GPU' | 'CPU') => ObjectDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL, delegate },
        runningMode: 'IMAGE', scoreThreshold: 0.15, maxResults: 25, categoryAllowlist: ['person'],
      })
      try { return (await make('GPU')) as unknown as Detector } catch { return (await make('CPU')) as unknown as Detector }
    })()
    detectorPromise.catch(() => { detectorPromise = null })
  }
  return detectorPromise
}

/** One-euro filter: smooths jitter when he is still, keeps up when he sprints (the standard for tracked points). */
class OneEuro {
  private x: number | null = null
  private dx = 0
  private t: number | null = null
  constructor(private minCutoff = 1.2, private beta = 0.02, private dCutoff = 1.0) {}
  private alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt) }
  filter(v: number, tMs: number) {
    if (this.x == null || this.t == null) { this.x = v; this.t = tMs; return v }
    const dt = Math.max(1e-3, (tMs - this.t) / 1000)
    const dv = (v - this.x) / dt
    this.dx = this.dx + this.alpha(this.dCutoff, dt) * (dv - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x = this.x + this.alpha(cutoff, dt) * (v - this.x)
    this.t = tMs
    return this.x
  }
}

export interface DetectResult {
  x: number; y: number          // ring centre, 0-100 of the frame
  h: number                     // his height, 0-100 of the frame height (the ring scales with it)
  lost: boolean                 // no believable match this step
  cut: boolean                  // the picture changed completely (camera cut)
  edge: boolean                 // he is at the edge of the picture (walking out of shot)
}

export class DetectTracker {
  private cx = 0; private cy = 0; private bh = 40          // his box centre and height, frame pixels
  private vx = 0; private vy = 0
  private kit: [number, number, number] = [0, 0, 0]          // his look now (adapts slowly: light, shade, turning)
  private kit0: [number, number, number] = [0, 0, 0]         // his kit at the click: fixed, the gate is always against this
  private crop = document.createElement('canvas')
  private thumb = document.createElement('canvas')
  private lastThumb: Uint8ClampedArray | null = null
  private fx = new OneEuro(); private fy = new OneEuro(); private fh = new OneEuro(0.5, 0.005)
  private W = 0; private H = 0
  private constructor(private det: Detector) {}

  static async create(): Promise<DetectTracker> { return new DetectTracker(await loadDetector()) }

  /** Detect people in a square crop centred on (cx, cy) of `size` frame pixels; boxes back in frame pixels. */
  private detectAround(v: HTMLVideoElement, cx: number, cy: number, size: number): { boxes: Box[]; px: ImageData; ox: number; oy: number } {
    const s = Math.round(Math.min(size, this.W, this.H))
    const ox = Math.round(Math.min(Math.max(0, cx - s / 2), this.W - s)), oy = Math.round(Math.min(Math.max(0, cy - s / 2), this.H - s))
    const c = this.crop
    c.width = s; c.height = s
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(v, ox, oy, s, s, 0, 0, s, s)
    const res = this.det.detect(c)
    const boxes: Box[] = []
    for (const d of res.detections) {
      const b = d.boundingBox
      if (!b || b.height < 6) continue
      boxes.push({ x: ox + b.originX, y: oy + b.originY, w: b.width, h: b.height, score: d.categories[0]?.score ?? 0 })
    }
    return { boxes, px: ctx.getImageData(0, 0, s, s), ox, oy }
  }

  /** his kit colour: average of the top 55% of the box, leaving out pixels like the grass round it */
  private kitOf(b: Box, px: ImageData, ox: number, oy: number): [number, number, number] | null {
    const x0 = Math.max(0, Math.round(b.x - ox + b.w * 0.2)), x1 = Math.min(px.width, Math.round(b.x - ox + b.w * 0.8))
    const y0 = Math.max(0, Math.round(b.y - oy + b.h * 0.1)), y1 = Math.min(px.height, Math.round(b.y - oy + b.h * 0.55))
    // grass = the strip just below his feet
    let gr = 0, gg = 0, gb = 0, gn = 0
    const fy = Math.min(px.height - 1, Math.round(b.y - oy + b.h + 3))
    for (let x = Math.max(0, Math.round(b.x - ox - b.w * 0.5)); x < Math.min(px.width, Math.round(b.x - ox + b.w * 1.5)); x++) {
      const i = (fy * px.width + x) * 4; gr += px.data[i]; gg += px.data[i + 1]; gb += px.data[i + 2]; gn++
    }
    if (gn) { gr /= gn; gg /= gn; gb /= gn }
    let r = 0, g = 0, bl = 0, n = 0
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * px.width + x) * 4
      const pr = px.data[i], pg = px.data[i + 1], pb = px.data[i + 2]
      if (gn && Math.abs(pr - gr) + Math.abs(pg - gg) + Math.abs(pb - gb) < 50) continue
      r += pr; g += pg; bl += pb; n++
    }
    return n >= 4 ? [r / n, g / n, bl / n] : null
  }

  private cutCheck(v: HTMLVideoElement): boolean {
    const t = this.thumb
    t.width = 48; t.height = 27
    const ctx = t.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(v, 0, 0, 48, 27)
    const d = ctx.getImageData(0, 0, 48, 27).data
    let diff = 0
    if (this.lastThumb) for (let i = 0; i < d.length; i += 4) diff += Math.abs(d[i] - this.lastThumb[i]) + Math.abs(d[i + 1] - this.lastThumb[i + 1]) + Math.abs(d[i + 2] - this.lastThumb[i + 2])
    const cut = !!this.lastThumb && diff / (48 * 27) > 120     // mean colour change per pixel over all 3 channels
    this.lastThumb = new Uint8ClampedArray(d)
    return cut
  }

  /** The coach clicked at (xPct, yPct): pick the detected person there. False if nobody is detected near the click. */
  seed(v: HTMLVideoElement, xPct: number, yPct: number, tMs: number): DetectResult | null {
    this.W = v.videoWidth; this.H = v.videoHeight
    const px = (xPct / 100) * this.W, py = (yPct / 100) * this.H
    const { boxes, px: img, ox, oy } = this.detectAround(v, px, py, this.H * 0.4)
    // the box containing the click, else the nearest within a body height
    let best: Box | null = null, bd = Infinity
    for (const b of boxes) {
      const inside = px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h
      const d = Math.hypot(b.x + b.w / 2 - px, b.y + b.h / 2 - py) / b.h
      const score = inside ? d - 1 : d
      if (score < bd && (inside || d < 1.2)) { bd = score; best = b }
    }
    if (!best) return null
    this.cx = best.x + best.w / 2; this.cy = best.y + best.h / 2; this.bh = best.h; this.vx = this.vy = 0
    this.kit = this.kitOf(best, img, ox, oy) || this.kit
    this.kit0 = [...this.kit] as [number, number, number]
    this.fx = new OneEuro(); this.fy = new OneEuro(); this.fh = new OneEuro(0.5, 0.005)
    this.lastThumb = null
    this.cutCheck(v)
    return this.out(tMs, false, false)
  }

  private out(tMs: number, lost: boolean, cut: boolean): DetectResult {
    const x = this.fx.filter(this.cx, tMs), y = this.fy.filter(this.cy, tMs), h = this.fh.filter(this.bh, tMs)
    const edge = this.cx < this.bh * 0.3 || this.cx > this.W - this.bh * 0.3 || this.cy < this.bh * 0.3 || this.cy > this.H - this.bh * 0.3
    return { x: (x / this.W) * 100, y: (y / this.H) * 100, h: (h / this.H) * 100, lost, cut, edge }
  }

  /** One step: find him in the current frame. */
  update(v: HTMLVideoElement, tMs: number): DetectResult {
    if (this.cutCheck(v)) return this.out(tMs, true, true)
    const pxp = this.cx + this.vx, pyp = this.cy + this.vy
    const { boxes, px, ox, oy } = this.detectAround(v, pxp, pyp, Math.max(this.H * 0.3, this.bh * 6))
    let best: Box | null = null, bc = Infinity, bestKit: [number, number, number] | null = null
    for (const b of boxes) {
      const bx = b.x + b.w / 2, by = b.y + b.h / 2
      const dist = Math.hypot(bx - pxp, by - pyp) / this.bh                       // in body heights
      if (dist > 1.6) continue
      const k = this.kitOf(b, px, ox, oy)
      const diff = (a: number[], c: number[]) => (Math.abs(a[0] - c[0]) + Math.abs(a[1] - c[1]) + Math.abs(a[2] - c[2])) / 100
      const kd = k ? diff(k, this.kit) : 0.8
      const kd0 = k ? diff(k, this.kit0) : 0.8
      // a different kit (or the referee), judged against his kit AT THE CLICK so it can never drift onto another team
      // (it did: two players overlapping make one box, and a slowly-learned colour followed the other man). Measured on
      // Dublin v Donegal: his own boxes 0.02-0.5, the Dublin player beside him ~1.0
      if (kd0 > 0.75 || kd > 0.75) continue
      const size = Math.abs(Math.log(b.h / this.bh))
      const cost = dist + 1.8 * kd + 0.8 * size - 0.3 * b.score
      if (cost < bc) { bc = cost; best = b; bestKit = k }
    }
    if (!best) {
      // coast on his last movement for this step; the editor stops after a few misses in a row
      this.cx = pxp; this.cy = pyp; this.vx *= 0.7; this.vy *= 0.7
      return this.out(tMs, true, false)
    }
    const nx = best.x + best.w / 2, ny = best.y + best.h / 2
    this.vx = 0.5 * this.vx + 0.5 * (nx - this.cx); this.vy = 0.5 * this.vy + 0.5 * (ny - this.cy)
    this.cx = nx; this.cy = ny; this.bh = 0.7 * this.bh + 0.3 * best.h
    if (bestKit && best.h > this.bh * 0.6 && best.h < this.bh * 1.6) this.kit = [0, 1, 2].map(i => 0.95 * this.kit[i] + 0.05 * bestKit![i]) as [number, number, number]
    return this.out(tMs, false, false)
  }
}
