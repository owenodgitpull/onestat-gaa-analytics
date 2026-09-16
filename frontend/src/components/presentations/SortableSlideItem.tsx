import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Film, Zap, Type, Trash2 } from 'lucide-react'
import type { PresentationSlide } from '@/services/presentationsApi'

const SLIDE_ICONS = { clip: Film, animation: Zap, text: Type } as const

interface SortableSlideItemProps {
  slide: PresentationSlide
  index: number
  isSelected: boolean
  onSelect: () => void
  onDelete: () => void
}

export default function SortableSlideItem({ slide, index, isSelected, onSelect, onDelete }: SortableSlideItemProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: slide.id })
  const Icon = SLIDE_ICONS[slide.slide_type]

  const label = slide.slide_type === 'text'
    ? (slide.text_title || 'Text card')
    : slide.slide_type === 'clip'
      ? (slide.clip_label || 'Clip')
      : 'Tactical animation'

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`group flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
        isSelected ? 'bg-purple-500/15 border-purple-500/40' : 'bg-white/5 border-white/10 hover:bg-white/10'
      }`}
    >
      <span className="text-xs text-white/30 w-4 text-center flex-shrink-0">{index + 1}</span>
      <Icon size={14} className="text-white/50 flex-shrink-0" />
      <span className="text-sm text-white/80 truncate flex-1">{label}</span>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 flex-shrink-0"
      >
        <Trash2 size={12} />
      </button>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/10 text-white/30 hover:text-white cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
      >
        <GripVertical size={12} />
      </button>
    </div>
  )
}
