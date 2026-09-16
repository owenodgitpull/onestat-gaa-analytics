/**
 * TrackingKeyframeEditor — manually keyframe a single tracking ring over a
 * clip slide (Phase 11, 10b). No automatic player-tracking data exists for
 * opposition players, so this is coach-placed: scrub the clip, click where
 * the player is, repeat a few times — Present mode linearly interpolates
 * between keyframes so the ring appears to follow the player.
 */

import { useState, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Crosshair, Trash2, Check } from 'lucide-react'
import { presentationsAPI, type PresentationSlide, type TrackingKeyframe } from '@/services/presentationsApi'
import { videoSessionsAPI } from '@/services/videoApi'

interface TrackingKeyframeEditorProps {
  presentationId: string
  slide: PresentationSlide
  onClose: () => void
}

function msToClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`
}

export default function TrackingKeyframeEditor({ presentationId, slide, onClose }: TrackingKeyframeEditorProps) {
  const queryClient = useQueryClient()
  const [keyframes, setKeyframes] = useState<TrackingKeyframe[]>(
    [...(slide.tracking_keyframes || [])].sort((a, b) => a.video_timestamp_ms - b.video_timestamp_ms)
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { data: session } = useQuery({
    queryKey: ['video-session-for-tracking', slide.video_session_id],
    queryFn: () => videoSessionsAPI.get(slide.video_session_id!),
    enabled: !!slide.video_session_id,
  })

  const saveMutation = useMutation({
    mutationFn: (kf: TrackingKeyframe[]) => presentationsAPI.updateSlide(presentationId, slide.id, { tracking_keyframes: kf }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] }); onClose() },
  })

  const placeKeyframe = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current || !videoRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    const t = Math.round(videoRef.current.currentTime * 1000)

    setKeyframes((prev) => {
      const withoutSameTime = prev.filter((k) => Math.abs(k.video_timestamp_ms - t) > 150)
      return [...withoutSameTime, { video_timestamp_ms: t, x, y }].sort((a, b) => a.video_timestamp_ms - b.video_timestamp_ms)
    })
  }, [])

  const removeKeyframe = (t: number) => setKeyframes((prev) => prev.filter((k) => k.video_timestamp_ms !== t))

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <div className="flex items-center gap-2 text-white/70 text-sm">
          <Crosshair size={16} className="text-amber-400" />
          Click on the player at a few points as the clip plays — each click drops a keyframe at that moment.
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-glass px-3 py-1.5 text-sm">Cancel</button>
          <button onClick={() => saveMutation.mutate(keyframes)} disabled={saveMutation.isPending} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm">
            <Check size={14} /> Save
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <div ref={containerRef} className="relative max-w-full max-h-full cursor-crosshair" onClick={placeKeyframe}>
          {session?.download_url ? (
            <video
              ref={videoRef}
              src={session.download_url}
              className="max-w-full max-h-[70vh] block"
              controls
              playsInline
              onLoadedMetadata={() => {
                if (videoRef.current && slide.clip_start_ms != null) videoRef.current.currentTime = slide.clip_start_ms / 1000
              }}
            />
          ) : (
            <div className="w-[70vw] h-[40vh] flex items-center justify-center text-white/40 text-sm">Loading…</div>
          )}
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
            {keyframes.map((k, i) => (
              <g key={k.video_timestamp_ms}>
                <circle cx={k.x} cy={k.y} r={2} fill="none" stroke="#FBBF24" strokeWidth={0.5} vectorEffect="non-scaling-stroke" />
                <text x={k.x} y={k.y - 3} fill="#FBBF24" fontSize="3" textAnchor="middle">{i + 1}</text>
              </g>
            ))}
          </svg>
        </div>
      </div>

      <div className="border-t border-white/10 p-3 flex items-center gap-2 overflow-x-auto">
        {keyframes.length === 0 ? (
          <p className="text-white/40 text-xs px-1">No keyframes yet — click the player on the video above.</p>
        ) : (
          keyframes.map((k) => (
            <div key={k.video_timestamp_ms} className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-2 py-1 flex-shrink-0">
              <span className="text-xs text-white/60 tabular-nums">{msToClock(k.video_timestamp_ms)}</span>
              <button onClick={() => removeKeyframe(k.video_timestamp_ms)} className="text-white/30 hover:text-red-400">
                <Trash2 size={11} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
