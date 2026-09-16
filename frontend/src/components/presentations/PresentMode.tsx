import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { PlaybackEngine, elementsToPhases } from '@/components/playbook'
import { api } from '@/services/api'
import { presentationsAPI } from '@/services/presentationsApi'
import { videoSessionsAPI } from '@/services/videoApi'
import type { PresentationSlide, TrackingKeyframe } from '@/services/presentationsApi'
import AnnotationOverlay from './AnnotationOverlay'

interface PresentModeProps {
  presentationId: string
  title: string
  slides: PresentationSlide[]
  startIndex?: number
  onClose: () => void
}

function interpolateTracking(keyframes: TrackingKeyframe[], t: number): { x: number; y: number } | null {
  if (!keyframes.length) return null
  const sorted = keyframes
  if (t <= sorted[0].video_timestamp_ms) return sorted[0]
  const last = sorted[sorted.length - 1]
  if (t >= last.video_timestamp_ms) return last
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1]
    if (t >= a.video_timestamp_ms && t <= b.video_timestamp_ms) {
      const frac = (t - a.video_timestamp_ms) / (b.video_timestamp_ms - a.video_timestamp_ms || 1)
      return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac }
    }
  }
  return null
}

/** Autoplays a slide's voiceover narration once, resets per slide. Used for
 * clip/text/annotation slides — animation slides use PlaybackEngine's own
 * built-in voiceoverUrl sync instead (see AnimationSlide below). */
function SlideVoiceoverAudio({ presentationId, slide }: { presentationId: string; slide: PresentationSlide }) {
  const { data } = useQuery({
    queryKey: ['slide-voiceover-url', presentationId, slide.id],
    queryFn: () => presentationsAPI.getVoiceoverUrl(presentationId, slide.id),
    enabled: slide.has_voiceover,
  })
  if (!data?.voiceover_url) return null
  return <audio key={slide.id} src={data.voiceover_url} autoPlay />
}

function ClipSlide({ slide }: { slide: PresentationSlide }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasEnded, setHasEnded] = useState(false)
  const [ringPos, setRingPos] = useState<{ x: number; y: number } | null>(null)

  const { data: session } = useQuery({
    queryKey: ['video-session-for-slide', slide.video_session_id],
    queryFn: () => videoSessionsAPI.get(slide.video_session_id!),
    enabled: !!slide.video_session_id,
  })

  useEffect(() => {
    setHasEnded(false)
  }, [slide.id])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !session?.download_url || slide.clip_start_ms == null) return
    const startSec = slide.clip_start_ms / 1000
    const handleLoaded = () => {
      video.currentTime = startSec
      video.play().catch(() => {})
    }
    video.addEventListener('loadedmetadata', handleLoaded)
    return () => video.removeEventListener('loadedmetadata', handleLoaded)
  }, [session?.download_url, slide.clip_start_ms])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    const ms = video.currentTime * 1000
    if (slide.tracking_keyframes && slide.tracking_keyframes.length > 0) {
      setRingPos(interpolateTracking(slide.tracking_keyframes, ms))
    }
    if (slide.clip_end_ms != null && !hasEnded && ms >= slide.clip_end_ms) {
      video.pause()
      setHasEnded(true)
    }
  }, [slide.clip_end_ms, slide.tracking_keyframes, hasEnded])

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black">
      {!session?.download_url ? (
        <p className="text-white/50 text-sm">Loading clip…</p>
      ) : (
        <div className="relative max-w-full max-h-full">
          <video
            ref={videoRef}
            src={session.download_url}
            className="max-w-full max-h-full block"
            onTimeUpdate={handleTimeUpdate}
            playsInline
          />
          {ringPos && (
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
              <circle cx={ringPos.x} cy={ringPos.y} r={4} fill="none" stroke="#FBBF24" strokeWidth={0.8} vectorEffect="non-scaling-stroke">
                <animate attributeName="opacity" values="1;0.5;1" dur="1.2s" repeatCount="indefinite" />
              </circle>
            </svg>
          )}
        </div>
      )}
      {slide.clip_label && (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/50 px-4 py-1.5 rounded-full">
          {slide.clip_label}
        </p>
      )}
    </div>
  )
}

function AnnotationSlide({ slide }: { slide: PresentationSlide }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const { data: session } = useQuery({
    queryKey: ['video-session-for-slide', slide.video_session_id],
    queryFn: () => videoSessionsAPI.get(slide.video_session_id!),
    enabled: !!slide.video_session_id,
  })

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black">
      {!session?.download_url ? (
        <p className="text-white/50 text-sm">Loading frame…</p>
      ) : (
        <div className="relative max-w-full max-h-full">
          <video
            ref={videoRef}
            src={session.download_url}
            className="max-w-full max-h-full block"
            playsInline
            muted
            onLoadedMetadata={() => {
              if (videoRef.current && slide.freeze_frame_ms != null) videoRef.current.currentTime = slide.freeze_frame_ms / 1000
            }}
          />
          <AnnotationOverlay shapes={slide.annotation_shapes || []} />
        </div>
      )}
      {slide.clip_label && (
        <p className="absolute bottom-6 left-1/2 -translate-x-1/2 text-white/80 text-sm bg-black/50 px-4 py-1.5 rounded-full">
          {slide.clip_label}
        </p>
      )}
    </div>
  )
}

function TextSlide({ slide }: { slide: PresentationSlide }) {
  return (
    <div className="w-full h-full flex flex-col items-center justify-center px-12 text-center">
      <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">{slide.text_title}</h2>
      {slide.text_body && (
        <p className="text-lg md:text-xl text-white/70 max-w-2xl whitespace-pre-wrap">{slide.text_body}</p>
      )}
    </div>
  )
}

function AnimationSlide({ presentationId, slide, onDone }: { presentationId: string; slide: PresentationSlide; onDone: () => void }) {
  const { data: routine } = useQuery({
    queryKey: ['set-piece-for-slide', slide.set_piece_routine_id],
    queryFn: () => api.matchPrep.getSetPiece(slide.set_piece_routine_id!),
    enabled: !!slide.set_piece_routine_id,
  })
  const { data: voiceover } = useQuery({
    queryKey: ['slide-voiceover-url', presentationId, slide.id],
    queryFn: () => presentationsAPI.getVoiceoverUrl(presentationId, slide.id),
    enabled: slide.has_voiceover,
  })

  if (!routine) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <p className="text-white/50 text-sm">Loading animation…</p>
      </div>
    )
  }

  return (
    <PlaybackEngine
      phases={elementsToPhases(routine.elements)}
      routineName={routine.name}
      voiceoverUrl={voiceover?.voiceover_url || null}
      onClose={onDone}
    />
  )
}

export default function PresentMode({ presentationId, title, slides, startIndex = 0, onClose }: PresentModeProps) {
  const [index, setIndex] = useState(startIndex)
  const slide = slides[index]

  const goNext = useCallback(() => {
    setIndex((i) => (i < slides.length - 1 ? i + 1 : i))
  }, [slides.length])

  const goPrev = useCallback(() => {
    setIndex((i) => (i > 0 ? i - 1 : i))
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === ' ') goNext()
      else if (e.key === 'ArrowLeft') goPrev()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [goNext, goPrev, onClose])

  if (!slide) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
        <div className="text-center space-y-3">
          <p className="text-white/60">This presentation has no slides yet.</p>
          <button onClick={onClose} className="btn-glass px-4 py-2">Close</button>
        </div>
      </div>
    )
  }

  // Animation slides render their own fullscreen PlaybackEngine overlay —
  // don't also draw our own chrome underneath it.
  if (slide.slide_type === 'animation') {
    return <AnimationSlide presentationId={presentationId} slide={slide} onDone={goNext} />
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 text-white/50 text-sm">
        <span className="truncate max-w-[60%]">{title}</span>
        <div className="flex items-center gap-4">
          <span>{index + 1} / {slides.length}</span>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 hover:text-white">
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Slide content */}
      <div className="flex-1 relative overflow-hidden">
        {slide.slide_type === 'clip' && <ClipSlide key={slide.id} slide={slide} />}
        {slide.slide_type === 'text' && <TextSlide slide={slide} />}
        {slide.slide_type === 'annotation' && <AnnotationSlide key={slide.id} slide={slide} />}
        <SlideVoiceoverAudio presentationId={presentationId} slide={slide} />

        {index > 0 && (
          <button
            onClick={goPrev}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
        )}
        {index < slides.length - 1 && (
          <button
            onClick={goNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/15 text-white/60 hover:text-white transition-colors"
          >
            <ChevronRight size={24} />
          </button>
        )}
      </div>
    </div>
  )
}
