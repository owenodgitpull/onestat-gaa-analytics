import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, EyeOff, PinOff } from 'lucide-react'

interface SortableChartCardProps {
  id: string
  children: React.ReactNode
  colSpan?: 1 | 2
  isAiPinned?: boolean
  onHide?: () => void
  onUnpin?: () => void
  isFirst?: boolean
}

export default function SortableChartCard({
  id,
  children,
  colSpan,
  isAiPinned,
  onHide,
  onUnpin,
  isFirst,
}: SortableChartCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 50 : undefined,
  }

  return (
    <div ref={setNodeRef} style={style} className={`relative group min-h-[340px] h-full${colSpan === 2 ? ' md:col-span-2' : ''}`}>
      {/* Action buttons — visible on hover */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {isAiPinned && onUnpin && (
          <button
            onClick={onUnpin}
            className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-red-500/30 text-white/60 hover:text-red-400 transition-colors backdrop-blur-sm"
            title="Unpin chart"
          >
            <PinOff size={14} />
          </button>
        )}
        {!isAiPinned && onHide && (
          <button
            onClick={onHide}
            className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-white/20 text-white/60 hover:text-white transition-colors backdrop-blur-sm"
            title="Hide chart"
          >
            <EyeOff size={14} />
          </button>
        )}
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          {...(isFirst ? { 'data-tour': 'chart-drag-handle' } : {})}
          className="p-1.5 rounded-lg bg-slate-800/90 hover:bg-white/20 text-white/60 hover:text-white transition-colors cursor-grab active:cursor-grabbing backdrop-blur-sm touch-none"
          title="Drag to reorder"
        >
          <GripVertical size={14} />
        </button>
      </div>

      {children}
    </div>
  )
}
