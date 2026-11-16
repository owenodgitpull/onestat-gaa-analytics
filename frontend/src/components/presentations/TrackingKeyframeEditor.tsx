/**
 * TrackingKeyframeEditor: put a ring on one player in a clip slide and have it follow him.
 *
 * Owen (2026-11-16): the old version (click the player at a few moments, straight lines between) never followed
 * anyone - players change direction and the camera pans between clicks. Now: pause on the player, click him, press
 * Track. The editor steps through the clip 80 ms at a time and utils/videoTracker follows him, writing a keyframe at
 * each step. If the ring slips (or the tracker says it lost him) it pauses: click him again and press Track to carry on
 * from there (everything after that moment is redone). Saved as the slide's tracking_keyframes (0-100 of the frame).
 *
 * Tracker: utils/playerDetectTracker (a person detector + kit colour + movement, smoothed) when it loads; the ring then
 * only ever sits on a detected player and scales with him (keyframe `h`). Falls back to the colour-patch tracker
 * (utils/videoTracker) if the detector cannot load on this device.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Check, Loader2, Pause, Play, RotateCcw, Trash2, AlertCircle } from 'lucide-react'
import { presentationsAPI, type PresentationSlide, type TrackingKeyframe } from '@/services/presentationsApi'
import { videoSessionsAPI } from '@/services/videoApi'
import { PatchTracker, WORK_W, smoothPath } from '@/utils/videoTracker'
import { DetectTracker } from '@/utils/playerDetectTracker'
import TrackingRing from './TrackingRing'

interface TrackingKeyframeEditorProps {
  presentationId: string
  slide: PresentationSlide
  onClose: () => void
}

const STEP_MS = 80
const clock = (ms: number) => { const s = Math.max(0, ms) / 1000; return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}` }

export default function TrackingKeyframeEditor({ presentationId, slide, onClose }: TrackingKeyframeEditorProps) {
  const queryClient = useQueryClient()
  const [kfs, setKfs] = useState<TrackingKeyframe[]>([...(slide.tracking_keyframes || [])].sort((a, b) => a.video_timestamp_ms - b.video_timestamp_ms))
  const kfRef = useRef(kfs); kfRef.current = kfs
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const trackerRef = useRef<PatchTracker | null>(null)
  const detRef = useRef<DetectTracker | null>(null)          // one per editor; null until loaded (or if it failed)
  const seededDet = useRef(false)                            // this run uses the detector (else the patch tracker)
  const [detState, setDetState] = useState<'loading' | 'ready' | 'failed'>('loading')
  useEffect(() => {
    let live = true
    DetectTracker.create().then(t => { if (live) { detRef.current = t; setDetState('ready') } }).catch(() => { if (live) setDetState('failed') })
    return () => { live = false }
  }, [])
  const [seed, setSeed] = useState<{ x: number; y: number; t: number } | null>(null)
  const [tracking, setTracking] = useState(false)
  const [nowMs, setNowMs] = useState(slide.clip_start_ms ?? 0)
  const [msg, setMsg] = useState<{ kind: 'info' | 'warn' | 'error'; text: string }>({ kind: 'info', text: 'Pause where you can see the player clearly, then click on him.' })
  const startMs = slide.clip_start_ms ?? 0, endMs = slide.clip_end_ms ?? startMs + 15000

  const { data: session } = useQuery({
    queryKey: ['video-session-for-tracking', slide.video_session_id],
    queryFn: () => videoSessionsAPI.get(slide.video_session_id!),
    enabled: !!slide.video_session_id,
  })
  const saveMutation = useMutation({
    mutationFn: (kf: TrackingKeyframe[]) => presentationsAPI.updateSlide(presentationId, slide.id, { tracking_keyframes: kf }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] }); onClose() },
  })

  /** the current frame, 640 px wide, as pixels (null + a message if the video cannot be read) */
  const grab = useCallback((): ImageData | null => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return null
    const c = canvasRef.current || (canvasRef.current = document.createElement('canvas'))
    c.width = WORK_W; c.height = Math.round(WORK_W * v.videoHeight / v.videoWidth)
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(v, 0, 0, c.width, c.height)
    try { return ctx.getImageData(0, 0, c.width, c.height) } catch {
      setMsg({ kind: 'error', text: 'This video cannot be read for tracking (the browser blocked it). Reload the page and try again.' })
      return null
    }
  }, [])

  // keep the clip inside its range; time readout
  const clamp = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    const ms = v.currentTime * 1000
    if (ms < startMs - 50) v.currentTime = startMs / 1000
    else if (ms > endMs + 50) { v.pause(); v.currentTime = endMs / 1000 }
    setNowMs(Math.min(endMs, Math.max(startMs, ms)))
  }, [startMs, endMs])

  // The tracking loop: steps the clip STEP_MS at a time (seek, read the frame, search), not "play and read each frame".
  // Playing relied on the browser handing over every frame; a background or partly hidden window gets about one a
  // second, and a player moves out of the search area in that time (tested 2026-11-16). Stepping gives the tracker
  // the same small steps on any machine, and the ring is drawn on each step so the coach watches it follow.
  useEffect(() => {
    const v = videoRef.current
    if (!tracking || !v) return
    let stopped = false, misses = 0
    v.pause()
    const seekTo = (sec: number) => new Promise<void>(res => {
      const done = () => { clearTimeout(to); res() }
      const to = setTimeout(done, 4000)
      v.addEventListener('seeked', done, { once: true })
      v.currentTime = sec
    })
    ;(async () => {
      while (!stopped) {
        const next = v.currentTime * 1000 + STEP_MS
        if (next > endMs) {
          setTracking(false)
          setMsg({ kind: 'info', text: 'Reached the end of the clip. Play it back with the slider, then Save (or click him somewhere to redo from there).' })
          return
        }
        await seekTo(next / 1000)
        if (stopped) return
        const t = Math.round(v.currentTime * 1000)
        let r: { x: number; y: number; h?: number; lost: boolean; edge: boolean; cut?: boolean }
        if (seededDet.current && detRef.current) {
          r = detRef.current.update(v, t)
        } else {
          const f = grab()
          const tr = trackerRef.current
          if (!f || !tr) { setTracking(false); return }
          r = tr.update(f)
        }
        if (r.cut) {
          setTracking(false)
          setMsg({ kind: 'warn', text: `Camera cut at ${clock(t - startMs)}. Find him in the new shot, click on him and press Track.` })
          return
        }
        if (r.edge) {
          setTracking(false)
          setMsg({ kind: 'warn', text: `He went out of the picture at ${clock(t - startMs)}. When he is back in shot, click on him and press Track.` })
          return
        }
        // brief misses (a tackle, someone running across him) are carried through for up to ~0.5 s on his last spot
        misses = r.lost ? misses + 1 : 0
        if (misses >= (seededDet.current ? 5 : 6)) {
          setTracking(false)
          setMsg({ kind: 'warn', text: `Lost him at ${clock(t - startMs)} into the clip (a camera cut, or he was hidden). Click on him and press Track to carry on.` })
          return
        }
        if (r.lost) continue
        const kf: TrackingKeyframe = { video_timestamp_ms: t, x: Math.round(r.x * 100) / 100, y: Math.round(r.y * 100) / 100, ...(r.h ? { h: Math.round(r.h * 100) / 100 } : {}) }
        setKfs(prev => [...prev.filter(k => k.video_timestamp_ms < t - 40), kf])
      }
    })()
    return () => { stopped = true }
  }, [tracking, grab, startMs, endMs])

  const onClickVideo = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current
    if (!v || tracking) return
    v.pause()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100, y = ((e.clientY - rect.top) / rect.height) * 100
    const f = grab()
    if (!f) return
    const t = Math.round(v.currentTime * 1000)
    let sx = x, sy = y, sh: number | undefined
    seededDet.current = false
    if (detRef.current) {
      const r = detRef.current.seed(v, x, y, t)
      if (!r) {
        setSeed(null); trackerRef.current = null
        setMsg({ kind: 'warn', text: 'No player found there. Click right on him (pause where he is clearly visible).' })
        return
      }
      seededDet.current = true
      sx = r.x; sy = r.y; sh = r.h
    } else {
      trackerRef.current = new PatchTracker(f, x, y)
    }
    setSeed({ x: sx, y: sy, t })
    // this click replaces everything from here on
    setKfs(prev => [...prev.filter(k => k.video_timestamp_ms < t - 40), { video_timestamp_ms: t, x: Math.round(sx * 100) / 100, y: Math.round(sy * 100) / 100, ...(sh ? { h: Math.round(sh * 100) / 100 } : {}) }])
    setMsg({ kind: 'info', text: 'Got him. Press Track: it steps through the clip and the ring follows him. Pause and click him again if it slips.' })
  }

  const track = () => {
    if (!videoRef.current || (!trackerRef.current && !seededDet.current)) { setMsg({ kind: 'warn', text: 'Click on the player first.' }); return }
    setTracking(true)
    setMsg({ kind: 'info', text: 'Tracking: stepping through the clip. Press Pause if the ring slips off him.' })
  }
  const pause = () => { videoRef.current?.pause(); setTracking(false); trackerRef.current = null; seededDet.current = false; setSeed(null); setMsg({ kind: 'info', text: 'Paused. Click on him to carry on from here (or Save).' }) }
  const restart = () => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = startMs / 1000 } setTracking(false); setKfs([]); trackerRef.current = null; seededDet.current = false; setSeed(null); setMsg({ kind: 'info', text: 'Cleared. Pause where you can see the player clearly, then click on him.' }) }

  const covered = kfs.length ? Math.max(0, kfs[kfs.length - 1].video_timestamp_ms - kfs[0].video_timestamp_ms) : 0

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-white/80 text-sm"><Crosshair size={16} className="text-amber-400" aria-hidden="true" /> Tracking ring: click the player, press Track, it follows him.</div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-glass px-3 py-1.5 text-sm">Cancel</button>
          {kfs.length > 0 && (
            <button onClick={() => saveMutation.mutate([])} disabled={saveMutation.isPending} className="btn-glass px-3 py-1.5 text-sm flex items-center gap-1.5" title="Save the slide with no ring"><Trash2 size={14} aria-hidden="true" /> Remove ring</button>
          )}
          <button onClick={() => saveMutation.mutate(kfs.some(k => k.h != null) ? kfs : smoothPath(kfs))} disabled={saveMutation.isPending || tracking || kfs.length < 2} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm">
            {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />} Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {session?.download_url ? (
          <div className="relative cursor-crosshair" onClick={onClickVideo}>
            <video
              ref={videoRef}
              src={session.download_url}
              crossOrigin="anonymous"
              className="max-w-full max-h-[68vh] block"
              playsInline
              muted
              onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = startMs / 1000 }}
              onTimeUpdate={clamp}
              onSeeked={clamp}
            />
            <TrackingRing videoRef={videoRef} keyframes={kfs} live={seed && !tracking && Math.abs(nowMs - seed.t) < 120 ? seed : null} />
          </div>
        ) : (
          <div className="flex items-center gap-2 text-white/50 text-sm"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the clip…</div>
        )}
      </div>

      <div className="border-t border-white/10 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {tracking ? (
            <button onClick={pause} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-900 text-sm font-semibold"><Pause size={15} aria-hidden="true" /> Pause</button>
          ) : (
            <button onClick={track} disabled={!seed} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-sm font-semibold"><Play size={15} aria-hidden="true" /> Track</button>
          )}
          <button onClick={restart} disabled={tracking} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 text-sm"><RotateCcw size={14} aria-hidden="true" /> Start again</button>
          <input type="range" min={startMs} max={endMs} step={40} value={nowMs} disabled={tracking}
            onChange={e => { const v = videoRef.current; if (v) { v.pause(); v.currentTime = Number(e.target.value) / 1000 } setSeed(null); trackerRef.current = null; seededDet.current = false }}
            className="flex-1 min-w-[10rem] accent-amber-400" aria-label="Position in the clip" />
          <span className="text-xs text-white/60 tabular-nums">{clock(nowMs - startMs)} / {clock(endMs - startMs)}</span>
        </div>
        <p className={`text-sm flex items-center gap-2 ${msg.kind === 'error' ? 'text-red-300' : msg.kind === 'warn' ? 'text-amber-300' : 'text-white/70'}`} role="status">
          {tracking ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : msg.kind !== 'info' ? <AlertCircle size={14} aria-hidden="true" /> : null}
          {msg.text}
          {kfs.length > 1 && !tracking && <span className="text-white/45">· ring covers {(covered / 1000).toFixed(1)} s of the clip</span>}
        </p>
        <p className="text-xs text-white/45 flex items-center gap-1.5" role="status">
          {detState === 'loading' && <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Loading the player detector (first time only, a few seconds)…</>}
          {detState === 'ready' && 'Player detector on: the ring locks onto the player you click and follows him.'}
          {detState === 'failed' && 'The player detector could not load on this device: using colour tracking instead (less steady).'}
        </p>
      </div>
    </div>
  )
}
