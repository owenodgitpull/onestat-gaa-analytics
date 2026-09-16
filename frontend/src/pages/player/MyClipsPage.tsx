/**
 * MyClipsPage — player portal view of clips/frames/cards a coach has
 * tagged them on from a Presentation (Phase 11, 10e). Mirrors
 * PlaybooksPage's "pushed content" pattern.
 */

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Film, Pencil, Type, Zap, X } from 'lucide-react'
import PlayerHeader from '../../components/PlayerHeader'
import { playerPortalAPI, type TaggedClipItem } from '@/services/playerPortalApi'
import AnnotationOverlay, { type AnnotationShape } from '@/components/presentations/AnnotationOverlay'

const TYPE_ICONS = { clip: Film, annotation: Pencil, text: Type, animation: Zap } as const

function ClipViewer({ item, onClose }: { item: TaggedClipItem; onClose: () => void }) {
  const { data: detail, isLoading } = useQuery({
    queryKey: ['tagged-clip-detail', item.slide_id],
    queryFn: () => playerPortalAPI.getTaggedClipDetail(item.slide_id),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-white/60 text-sm truncate">{item.presentation_title}</span>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/60 hover:text-white">
          <X size={20} />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center overflow-hidden px-4 pb-4">
        {isLoading || !detail ? (
          <p className="text-white/40 text-sm">Loading…</p>
        ) : detail.slide_type === 'text' ? (
          <div className="text-center px-6">
            <h2 className="text-2xl font-bold text-white mb-3">{detail.text_title}</h2>
            {detail.text_body && <p className="text-white/70 whitespace-pre-wrap">{detail.text_body}</p>}
          </div>
        ) : detail.video_url ? (
          <div className="relative max-w-full max-h-full">
            <video
              src={detail.video_url}
              className="max-w-full max-h-full block"
              controls={detail.slide_type === 'clip'}
              autoPlay={detail.slide_type === 'clip'}
              playsInline
              onLoadedMetadata={(e) => {
                const ms = detail.slide_type === 'annotation' ? detail.freeze_frame_ms : detail.clip_start_ms
                if (ms != null) e.currentTarget.currentTime = ms / 1000
              }}
            />
            {detail.slide_type === 'annotation' && detail.annotation_shapes && (
              <AnnotationOverlay shapes={detail.annotation_shapes as AnnotationShape[]} />
            )}
          </div>
        ) : (
          <p className="text-white/40 text-sm">Video unavailable.</p>
        )}
      </div>
      {detail?.voiceover_url && <audio src={detail.voiceover_url} autoPlay className="hidden" />}
    </div>
  )
}

export default function MyClipsPage() {
  const [selected, setSelected] = useState<TaggedClipItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['my-tagged-clips'],
    queryFn: () => playerPortalAPI.getTaggedClips(),
  })
  const clips = data?.clips || []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-4">
      <PlayerHeader title="My Clips" />

      {clips.length === 0 ? (
        <div className="glass-card p-8 text-center">
          <p className="text-white/40">No clips shared yet.</p>
          <p className="text-white/25 text-sm mt-1">Your coach can tag you on a clip from a presentation.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clips.map((item) => {
            const Icon = TYPE_ICONS[item.slide_type]
            return (
              <button
                key={item.slide_id}
                onClick={() => setSelected(item)}
                className="w-full glass-card p-4 text-left hover:bg-white/5 transition-all flex items-center gap-4"
              >
                <div className="flex-shrink-0 w-12 h-12 rounded-2xl bg-cyan-500/20 border border-cyan-500/30 flex items-center justify-center">
                  <Icon size={18} className="text-cyan-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-white font-medium truncate">{item.clip_label || item.text_title || 'Shared clip'}</p>
                  <p className="text-white/40 text-xs">{item.presentation_title}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {selected && <ClipViewer item={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
