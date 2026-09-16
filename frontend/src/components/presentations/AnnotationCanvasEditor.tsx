import { useState, useRef, useCallback } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  X, MousePointer2, ArrowUpRight, Minus, Circle, Sun, Pencil, Type,
  Undo2, Redo2, Trash2, Check, Search,
} from 'lucide-react'
import { presentationsAPI, type PresentationSlide } from '@/services/presentationsApi'
import { videoSessionsAPI } from '@/services/videoApi'
import AnnotationOverlay, { ANNOTATION_COLORS, type AnnotationShape } from './AnnotationOverlay'

type Tool = 'select' | 'arrow' | 'line' | 'circle' | 'spotlight' | 'pencil' | 'text'

const TOOLS: { id: Tool; icon: typeof MousePointer2; label: string }[] = [
  { id: 'select', icon: MousePointer2, label: 'Select' },
  { id: 'arrow', icon: ArrowUpRight, label: 'Arrow' },
  { id: 'line', icon: Minus, label: 'Line' },
  { id: 'circle', icon: Circle, label: 'Circle' },
  { id: 'spotlight', icon: Sun, label: 'Spotlight' },
  { id: 'pencil', icon: Pencil, label: 'Pencil' },
  { id: 'text', icon: Type, label: 'Text' },
]

function genId() {
  return Math.random().toString(36).slice(2, 10)
}

interface AnnotationCanvasEditorProps {
  onClose: () => void
  onSaved: () => void
  presentationId: string
  /** When editing an existing annotation slide instead of creating a new one. */
  existingSlide?: PresentationSlide
}

export default function AnnotationCanvasEditor({ onClose, onSaved, presentationId, existingSlide }: AnnotationCanvasEditorProps) {
  const [videoSessionId, setVideoSessionId] = useState<string | null>(existingSlide?.video_session_id ?? null)
  const [freezeFrameMs, setFreezeFrameMs] = useState<number | null>(existingSlide?.freeze_frame_ms ?? null)
  const [suggestedLabel, setSuggestedLabel] = useState(existingSlide?.clip_label ?? '')
  const [search, setSearch] = useState('')

  const [tool, setTool] = useState<Tool>('arrow')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const initialShapes = existingSlide?.annotation_shapes ?? []
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialShapes)
  const [history, setHistory] = useState<AnnotationShape[][]>([initialShapes])
  const [historyIdx, setHistoryIdx] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawing, setDrawing] = useState<AnnotationShape | null>(null)
  const [textDraft, setTextDraft] = useState<{ x: number; y: number } | null>(null)
  const [saving, setSaving] = useState(false)

  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { data: clips = [] } = useQuery({
    queryKey: ['clip-library-for-annotation', search],
    queryFn: () => presentationsAPI.searchClipLibrary({ search: search || undefined }),
    enabled: !videoSessionId,
  })

  const { data: session } = useQuery({
    queryKey: ['video-session-for-annotation', videoSessionId],
    queryFn: () => videoSessionsAPI.get(videoSessionId!),
    enabled: !!videoSessionId,
  })

  const pushHistory = (next: AnnotationShape[]) => {
    const truncated = history.slice(0, historyIdx + 1)
    setHistory([...truncated, next])
    setHistoryIdx(truncated.length)
    setShapes(next)
  }

  const undo = () => {
    if (historyIdx === 0) return
    setHistoryIdx(historyIdx - 1)
    setShapes(history[historyIdx - 1])
  }
  const redo = () => {
    if (historyIdx >= history.length - 1) return
    setHistoryIdx(historyIdx + 1)
    setShapes(history[historyIdx + 1])
  }

  const posFromEvent = useCallback((e: React.PointerEvent): { x: number; y: number } => {
    const rect = containerRef.current!.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    return { x, y }
  }, [])

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!videoSessionId) return
    const pos = posFromEvent(e)

    if (tool === 'select') return
    if (tool === 'text') {
      setTextDraft(pos)
      return
    }
    if (tool === 'arrow' || tool === 'line') {
      setDrawing({ id: genId(), type: tool, points: [pos, pos], color })
    } else if (tool === 'circle' || tool === 'spotlight') {
      setDrawing({ id: genId(), type: tool, cx: pos.x, cy: pos.y, r: 0.1, color })
    } else if (tool === 'pencil') {
      setDrawing({ id: genId(), type: 'pencil', points: [pos], color })
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drawing) return
    const pos = posFromEvent(e)
    if (drawing.type === 'arrow' || drawing.type === 'line') {
      setDrawing({ ...drawing, points: [drawing.points[0], pos] })
    } else if (drawing.type === 'circle' || drawing.type === 'spotlight') {
      const dx = pos.x - drawing.cx
      const dy = pos.y - drawing.cy
      setDrawing({ ...drawing, r: Math.max(1, Math.sqrt(dx * dx + dy * dy)) })
    } else if (drawing.type === 'pencil') {
      setDrawing({ ...drawing, points: [...drawing.points, pos] })
    }
  }

  const handlePointerUp = () => {
    if (!drawing) return
    pushHistory([...shapes, drawing])
    setDrawing(null)
  }

  const commitText = (text: string) => {
    if (textDraft && text.trim()) {
      pushHistory([...shapes, { id: genId(), type: 'text', x: textDraft.x, y: textDraft.y, text: text.trim(), color }])
    }
    setTextDraft(null)
  }

  const deleteSelected = () => {
    if (!selectedId) return
    pushHistory(shapes.filter(s => s.id !== selectedId))
    setSelectedId(null)
  }

  const handleSave = async () => {
    if (!videoSessionId || freezeFrameMs == null) return
    setSaving(true)
    try {
      if (existingSlide) {
        await presentationsAPI.updateSlide(presentationId, existingSlide.id, { annotation_shapes: shapes })
      } else {
        await presentationsAPI.addAnnotationSlide(presentationId, {
          video_session_id: videoSessionId,
          freeze_frame_ms: freezeFrameMs,
          annotation_shapes: shapes,
          clip_label: suggestedLabel,
        })
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  // Step 1: pick the source frame
  if (!videoSessionId) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
        <div className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col">
          <div className="flex items-center justify-between p-5 border-b border-white/10">
            <h2 className="text-lg font-bold text-white">Pick a frame to annotate</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
              <X size={18} />
            </button>
          </div>
          <div className="p-4 border-b border-white/10 relative">
            <Search size={15} className="absolute left-7 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by opponent or player…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
            {clips.map((clip) => (
              <button
                key={clip.video_event_id}
                onClick={() => {
                  setVideoSessionId(clip.video_session_id)
                  setFreezeFrameMs(clip.video_timestamp_ms)
                  setSuggestedLabel(clip.suggested_label)
                }}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors"
              >
                <p className="text-sm font-medium text-white truncate">{clip.suggested_label}</p>
                <span className="text-xs font-semibold text-purple-400 flex-shrink-0">Use frame</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Step 2: draw
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 flex-wrap gap-2">
        <div className="flex items-center gap-1">
          {TOOLS.map((t) => {
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => { setTool(t.id); setSelectedId(null) }}
                title={t.label}
                className={`p-2 rounded-lg ${tool === t.id ? 'bg-purple-500/30 text-purple-300' : 'text-white/50 hover:bg-white/10 hover:text-white'}`}
              >
                <Icon size={16} />
              </button>
            )
          })}
          <div className="w-px h-5 bg-white/10 mx-1" />
          {ANNOTATION_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              className={`w-5 h-5 rounded-full border-2 ${color === c ? 'border-white' : 'border-transparent'}`}
              style={{ backgroundColor: c }}
            />
          ))}
          <div className="w-px h-5 bg-white/10 mx-1" />
          <button onClick={undo} disabled={historyIdx === 0} className="p-2 rounded-lg text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30">
            <Undo2 size={16} />
          </button>
          <button onClick={redo} disabled={historyIdx >= history.length - 1} className="p-2 rounded-lg text-white/50 hover:bg-white/10 hover:text-white disabled:opacity-30">
            <Redo2 size={16} />
          </button>
          {tool === 'select' && selectedId && (
            <button onClick={deleteSelected} className="p-2 rounded-lg text-red-400 hover:bg-red-500/20">
              <Trash2 size={16} />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="btn-glass px-3 py-1.5 text-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm">
            <Check size={14} />
            {saving ? 'Saving…' : 'Save Slide'}
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        <div
          ref={containerRef}
          className="relative max-w-full max-h-full"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          style={{ touchAction: 'none' }}
        >
          {session?.download_url ? (
            <video
              ref={videoRef}
              src={session.download_url}
              className="max-w-full max-h-[75vh] block"
              onLoadedMetadata={() => {
                if (videoRef.current && freezeFrameMs != null) videoRef.current.currentTime = freezeFrameMs / 1000
              }}
              playsInline
              muted
            />
          ) : (
            <div className="w-[70vw] h-[40vh] flex items-center justify-center text-white/40 text-sm">Loading frame…</div>
          )}
          <AnnotationOverlay
            shapes={drawing ? [...shapes, drawing] : shapes}
            selectedId={tool === 'select' ? selectedId : null}
            onSelect={tool === 'select' ? setSelectedId : undefined}
          />
          {textDraft && (
            <input
              autoFocus
              className="absolute bg-black/80 border border-white/30 rounded px-1.5 py-0.5 text-sm text-white outline-none"
              style={{ left: `${textDraft.x}%`, top: `${textDraft.y}%`, color }}
              onBlur={(e) => commitText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
