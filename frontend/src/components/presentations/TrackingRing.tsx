/**
 * The tracking ring drawn over a clip: follows the slide's keyframes (0-100 of the frame) every animation frame, round
 * whatever the video's shape (the svg uses the video's own pixel size). Shared by the editor and Present mode.
 */
import { useEffect, useState, type RefObject } from 'react'
import type { TrackingKeyframe } from '@/services/presentationsApi'

export function ringAt(kf: TrackingKeyframe[], t: number): { x: number; y: number } | null {
  if (!kf.length || t < kf[0].video_timestamp_ms - 200 || t > kf[kf.length - 1].video_timestamp_ms + 200) return null
  let lo = 0, hi = kf.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kf[m].video_timestamp_ms <= t) lo = m; else hi = m }
  const a = kf[lo], b = kf[hi]
  if (t <= a.video_timestamp_ms || a === b) return a
  if (t >= b.video_timestamp_ms) return b
  const f = (t - a.video_timestamp_ms) / (b.video_timestamp_ms - a.video_timestamp_ms || 1)
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
}

export default function TrackingRing({ videoRef, keyframes, live }: {
  videoRef: RefObject<HTMLVideoElement>; keyframes: TrackingKeyframe[] | null | undefined; live?: { x: number; y: number } | null
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 })
  useEffect(() => {
    let raf = 0
    const loop = () => {
      const v = videoRef.current
      if (v) {
        if (v.videoWidth && (v.videoWidth !== size.w || v.videoHeight !== size.h)) setSize({ w: v.videoWidth, h: v.videoHeight })
        const p = keyframes && keyframes.length ? ringAt(keyframes, v.currentTime * 1000) : null
        setPos(prev => (prev?.x === p?.x && prev?.y === p?.y ? prev : p))
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [videoRef, keyframes, size.w, size.h])
  const p = live || pos
  if (!p) return null
  const r = size.h * 0.055
  const cx = (p.x / 100) * size.w, cy = (p.y / 100) * size.h
  return (
    <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden="true">
      <ellipse cx={cx} cy={cy + r * 0.85} rx={r * 1.1} ry={r * 0.38} fill="none" stroke="#FBBF24" strokeWidth={size.h * 0.006} opacity={0.95} />
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#FBBF24" strokeWidth={size.h * 0.004} strokeDasharray={`${r * 0.5} ${r * 0.3}`} opacity={0.75} />
    </svg>
  )
}
