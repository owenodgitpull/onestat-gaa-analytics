import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { ArrowLeft, Plus, Play, Film, Zap, Type, Pencil, Crosshair } from 'lucide-react'
import { presentationsAPI, type PresentationSlide } from '@/services/presentationsApi'
import SortableSlideItem from '@/components/presentations/SortableSlideItem'
import ClipPickerModal from '@/components/presentations/ClipPickerModal'
import AnimationPickerModal from '@/components/presentations/AnimationPickerModal'
import AnnotationCanvasEditor from '@/components/presentations/AnnotationCanvasEditor'
import TrackingKeyframeEditor from '@/components/presentations/TrackingKeyframeEditor'
import SlideVoiceoverRecorder from '@/components/presentations/SlideVoiceoverRecorder'
import TagPlayersPanel from '@/components/presentations/TagPlayersPanel'
import PresentMode from '@/components/presentations/PresentMode'

function msToClock(ms: number): string {
  const totalSec = Math.round(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function SlideFooter({ presentationId, slide }: { presentationId: string; slide: PresentationSlide }) {
  return (
    <div className="flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-white/10">
      <SlideVoiceoverRecorder presentationId={presentationId} slideId={slide.id} hasVoiceover={slide.has_voiceover} />
      <TagPlayersPanel presentationId={presentationId} slideId={slide.id} taggedPlayerIds={slide.tagged_player_ids || []} />
    </div>
  )
}

function SlideDetailPanel({
  presentationId, slide, onUpdate, onEditTracking,
}: {
  presentationId: string
  slide: PresentationSlide
  onUpdate: (data: Partial<{ clip_start_ms: number; clip_end_ms: number; clip_label: string; text_title: string; text_body: string }>) => void
  onEditTracking: () => void
}) {
  const [textTitle, setTextTitle] = useState(slide.text_title || '')
  const [textBody, setTextBody] = useState(slide.text_body || '')
  const [clipLabel, setClipLabel] = useState(slide.clip_label || '')
  const [startSec, setStartSec] = useState(((slide.clip_start_ms ?? 0) / 1000).toFixed(1))
  const [endSec, setEndSec] = useState(((slide.clip_end_ms ?? 0) / 1000).toFixed(1))

  useEffect(() => {
    setTextTitle(slide.text_title || '')
    setTextBody(slide.text_body || '')
    setClipLabel(slide.clip_label || '')
    setStartSec(((slide.clip_start_ms ?? 0) / 1000).toFixed(1))
    setEndSec(((slide.clip_end_ms ?? 0) / 1000).toFixed(1))
  }, [slide.id])

  if (slide.slide_type === 'text') {
    return (
      <div className="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wide">Title</label>
            <input
              value={textTitle}
              onChange={(e) => setTextTitle(e.target.value)}
              onBlur={() => onUpdate({ text_title: textTitle })}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-lg font-bold focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wide">Body (optional)</label>
            <textarea
              value={textBody}
              onChange={(e) => setTextBody(e.target.value)}
              onBlur={() => onUpdate({ text_body: textBody })}
              rows={5}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm resize-none focus:outline-none focus:border-purple-500/50"
            />
          </div>
        </div>
        <SlideFooter presentationId={presentationId} slide={slide} />
      </div>
    )
  }

  if (slide.slide_type === 'clip') {
    return (
      <div className="max-w-lg">
        <div className="space-y-4">
          <div>
            <label className="text-xs text-white/50 uppercase tracking-wide">Label</label>
            <input
              value={clipLabel}
              onChange={(e) => setClipLabel(e.target.value)}
              onBlur={() => onUpdate({ clip_label: clipLabel })}
              className="w-full mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <div className="flex gap-4">
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">Start (sec)</label>
              <input
                type="number" step="0.5" value={startSec}
                onChange={(e) => setStartSec(e.target.value)}
                onBlur={() => onUpdate({ clip_start_ms: Math.round(parseFloat(startSec) * 1000) })}
                className="w-24 mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
              />
            </div>
            <div>
              <label className="text-xs text-white/50 uppercase tracking-wide">End (sec)</label>
              <input
                type="number" step="0.5" value={endSec}
                onChange={(e) => setEndSec(e.target.value)}
                onBlur={() => onUpdate({ clip_end_ms: Math.round(parseFloat(endSec) * 1000) })}
                className="w-24 mt-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
              />
            </div>
          </div>
          <p className="text-xs text-white/40">
            Plays {msToClock(slide.clip_start_ms ?? 0)} – {msToClock(slide.clip_end_ms ?? 0)} from the source video.
          </p>
          <button onClick={onEditTracking} className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <Crosshair size={12} />
            {slide.tracking_keyframes && slide.tracking_keyframes.length > 0
              ? `Tracking ring — ${slide.tracking_keyframes.length} keyframes`
              : 'Add tracking ring'}
          </button>
        </div>
        <SlideFooter presentationId={presentationId} slide={slide} />
      </div>
    )
  }

  if (slide.slide_type === 'annotation') {
    return (
      <div className="max-w-lg">
        <div className="space-y-2">
          <p className="text-white font-medium">{slide.clip_label || 'Annotated frame'}</p>
          <p className="text-white/50 text-xs">{(slide.annotation_shapes || []).length} shapes drawn</p>
          <button onClick={onEditTracking} className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs">
            <Pencil size={12} /> Edit annotation
          </button>
        </div>
        <SlideFooter presentationId={presentationId} slide={slide} />
      </div>
    )
  }

  return (
    <div className="max-w-lg">
      <div className="text-white/50 text-sm">
        Tactical animation — plays full-screen in Present mode. Edit the routine itself in Match Prep.
      </div>
      <SlideFooter presentationId={presentationId} slide={slide} />
    </div>
  )
}

export default function PresentationEditor() {
  const { presentationId } = useParams<{ presentationId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [selectedSlideId, setSelectedSlideId] = useState<string | null>(null)
  const [showClipPicker, setShowClipPicker] = useState(false)
  const [showAnimationPicker, setShowAnimationPicker] = useState(false)
  const [showAnnotationEditor, setShowAnnotationEditor] = useState(false)
  const [editingAnnotationSlide, setEditingAnnotationSlide] = useState<PresentationSlide | null>(null)
  const [editingTrackingSlide, setEditingTrackingSlide] = useState<PresentationSlide | null>(null)
  const [presenting, setPresenting] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  const { data: presentation, isLoading } = useQuery({
    queryKey: ['presentation', presentationId],
    queryFn: () => presentationsAPI.get(presentationId!),
    enabled: !!presentationId,
  })

  useEffect(() => {
    if (presentation) setTitleDraft(presentation.title)
  }, [presentation?.title])

  useEffect(() => {
    if (presentation && presentation.slides.length > 0 && !selectedSlideId) {
      setSelectedSlideId(presentation.slides[0].id)
    }
  }, [presentation, selectedSlideId])

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] })

  const renameMutation = useMutation({
    mutationFn: (title: string) => presentationsAPI.rename(presentationId!, title),
    onSuccess: invalidate,
  })

  const addClipMutation = useMutation({
    mutationFn: (data: { video_session_id: string; clip_start_ms: number; clip_end_ms: number; clip_label: string }) =>
      presentationsAPI.addClipSlide(presentationId!, data),
    onSuccess: (slide) => { invalidate(); setSelectedSlideId(slide.id) },
  })

  const addAnimationMutation = useMutation({
    mutationFn: (routineId: string) => presentationsAPI.addAnimationSlide(presentationId!, routineId),
    onSuccess: (slide) => { invalidate(); setSelectedSlideId(slide.id); setShowAnimationPicker(false) },
  })

  const addTextMutation = useMutation({
    mutationFn: () => presentationsAPI.addTextSlide(presentationId!, 'New text card'),
    onSuccess: (slide) => { invalidate(); setSelectedSlideId(slide.id) },
  })

  const updateSlideMutation = useMutation({
    mutationFn: ({ slideId, data }: { slideId: string; data: Parameters<typeof presentationsAPI.updateSlide>[2] }) =>
      presentationsAPI.updateSlide(presentationId!, slideId, data),
    onSuccess: invalidate,
  })

  const deleteSlideMutation = useMutation({
    mutationFn: (slideId: string) => presentationsAPI.deleteSlide(presentationId!, slideId),
    onSuccess: invalidate,
  })

  const reorderMutation = useMutation({
    mutationFn: (slideIds: string[]) => presentationsAPI.reorderSlides(presentationId!, slideIds),
    onSuccess: invalidate,
  })

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!presentation || !over || active.id === over.id) return
    const ids = presentation.slides.map(s => s.id)
    const oldIndex = ids.indexOf(active.id as string)
    const newIndex = ids.indexOf(over.id as string)
    const reordered = [...ids]
    reordered.splice(oldIndex, 1)
    reordered.splice(newIndex, 0, active.id as string)
    reorderMutation.mutate(reordered)
  }

  if (isLoading || !presentation) {
    return <div className="glass-card p-8 text-center text-white/50">Loading…</div>
  }

  const selectedSlide = presentation.slides.find(s => s.id === selectedSlideId) || null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => navigate('/presentations')} className="btn-glass p-2 flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => titleDraft.trim() && titleDraft !== presentation.title && renameMutation.mutate(titleDraft.trim())}
            className="text-xl font-bold text-white bg-transparent border-b border-transparent hover:border-white/20 focus:border-purple-500/50 focus:outline-none px-1 min-w-0"
          />
        </div>
        <button
          onClick={() => setPresenting(true)}
          disabled={presentation.slides.length === 0}
          className="btn-primary flex items-center gap-2 px-4 py-2 flex-shrink-0 disabled:opacity-40"
        >
          <Play size={16} />
          Present
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        {/* Slide list */}
        <div className="glass-card p-3 space-y-3">
          <div className="grid grid-cols-2 gap-1.5">
            <button onClick={() => setShowClipPicker(true)} className="btn-glass flex flex-col items-center gap-1 py-2.5 text-xs">
              <Film size={16} /> Clip
            </button>
            <button onClick={() => setShowAnimationPicker(true)} className="btn-glass flex flex-col items-center gap-1 py-2.5 text-xs">
              <Zap size={16} /> Animation
            </button>
            <button onClick={() => addTextMutation.mutate()} className="btn-glass flex flex-col items-center gap-1 py-2.5 text-xs">
              <Type size={16} /> Text
            </button>
            <button onClick={() => setShowAnnotationEditor(true)} className="btn-glass flex flex-col items-center gap-1 py-2.5 text-xs">
              <Pencil size={16} /> Annotate
            </button>
          </div>

          {presentation.slides.length === 0 ? (
            <p className="text-white/40 text-xs text-center py-6">No slides yet — add one above.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={presentation.slides.map(s => s.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1.5">
                  {presentation.slides.map((slide, i) => (
                    <SortableSlideItem
                      key={slide.id}
                      slide={slide}
                      index={i}
                      isSelected={slide.id === selectedSlideId}
                      onSelect={() => setSelectedSlideId(slide.id)}
                      onDelete={() => {
                        deleteSlideMutation.mutate(slide.id)
                        if (selectedSlideId === slide.id) setSelectedSlideId(null)
                      }}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Detail panel */}
        <div className="glass-card p-6">
          {!selectedSlide ? (
            <div className="flex items-center justify-center h-full text-white/40 text-sm py-12">
              <div className="text-center space-y-2">
                <Plus size={24} className="mx-auto text-white/20" />
                <p>Add a clip, animation, annotation, or text card to get started</p>
              </div>
            </div>
          ) : (
            <SlideDetailPanel
              presentationId={presentationId!}
              slide={selectedSlide}
              onUpdate={(data) => updateSlideMutation.mutate({ slideId: selectedSlide.id, data })}
              onEditTracking={() => {
                if (selectedSlide.slide_type === 'annotation') setEditingAnnotationSlide(selectedSlide)
                else setEditingTrackingSlide(selectedSlide)
              }}
            />
          )}
        </div>
      </div>

      {showClipPicker && (
        <ClipPickerModal
          onClose={() => setShowClipPicker(false)}
          onAdd={async (clip) => { await addClipMutation.mutateAsync(clip) }}
        />
      )}
      {showAnimationPicker && (
        <AnimationPickerModal
          onClose={() => setShowAnimationPicker(false)}
          onAdd={async (id) => { await addAnimationMutation.mutateAsync(id) }}
        />
      )}
      {showAnnotationEditor && (
        <AnnotationCanvasEditor
          presentationId={presentationId!}
          onClose={() => setShowAnnotationEditor(false)}
          onSaved={() => { setShowAnnotationEditor(false); invalidate() }}
        />
      )}
      {editingAnnotationSlide && (
        <AnnotationCanvasEditor
          presentationId={presentationId!}
          existingSlide={editingAnnotationSlide}
          onClose={() => setEditingAnnotationSlide(null)}
          onSaved={() => { setEditingAnnotationSlide(null); invalidate() }}
        />
      )}
      {editingTrackingSlide && (
        <TrackingKeyframeEditor
          presentationId={presentationId!}
          slide={editingTrackingSlide}
          onClose={() => setEditingTrackingSlide(null)}
        />
      )}
      {presenting && (
        <PresentMode
          presentationId={presentationId!}
          title={presentation.title}
          slides={presentation.slides}
          startIndex={Math.max(0, presentation.slides.findIndex(s => s.id === selectedSlideId))}
          onClose={() => setPresenting(false)}
        />
      )}
    </div>
  )
}
