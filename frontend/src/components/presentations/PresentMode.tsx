import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, ChevronLeft, ChevronRight } from 'lucide-react'
import { PlaybackEngine, elementsToPhases } from '@/components/playbook'
import { api } from '@/services/api'
import { videoSessionsAPI } from '@/services/videoApi'
import type { PresentationSlide } from '@/services/presentationsApi'

interface PresentModeProps {
  title: string
  slides: PresentationSlide[]
  startIndex?: number
  onClose: () => void
}

function ClipSlide({ slide }: { slide: PresentationSlide }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [hasEnded, setHasEnded] = useState(false)

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
    if (!video || slide.clip_end_ms == null || hasEnded) return
    if (video.currentTime * 1000 >= slide.clip_end_ms) {
      video.pause()
      setHasEnded(true)
    }
  }, [slide.clip_end_ms, hasEnded])

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-black">
      {!session?.download_url ? (
        <p className="text-white/50 text-sm">Loading clip…</p>
      ) : (
        <video
          ref={videoRef}
          src={session.download_url}
          className="max-w-full max-h-full"
          onTimeUpdate={handleTimeUpdate}
          playsInline
        />
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

function AnimationSlide({ slide, onDone }: { slide: PresentationSlide; onDone: () => void }) {
  const { data: routine } = useQuery({
    queryKey: ['set-piece-for-slide', slide.set_piece_routine_id],
    queryFn: () => api.matchPrep.getSetPiece(slide.set_piece_routine_id!),
    enabled: !!slide.set_piece_routine_id,
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
      onClose={onDone}
    />
  )
}

export default function PresentMode({ title, slides, startIndex = 0, onClose }: PresentModeProps) {
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
    return <AnimationSlide slide={slide} onDone={goNext} />
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
