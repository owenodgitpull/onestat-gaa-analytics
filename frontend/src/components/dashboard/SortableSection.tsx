import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'

interface SortableSectionProps {
  id: string
  /** the section's name, for the controls' labels */
  label?: string
  onMoveUp?: () => void
  onMoveDown?: () => void
  children: React.ReactNode
}

/**
 * A season-dashboard section that can be moved: drag the grip, or tap the arrows (tablets have no hover, and the
 * grip used to sit off the left edge and only show on hover, so sections looked fixed).
 */
export default function SortableSection({ id, label, onMoveUp, onMoveDown, children }: SortableSectionProps) {
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
    zIndex: isDragging ? 40 : undefined,
  }
  const name = label || 'section'
  const btn = 'p-0.5 rounded-md text-white/40 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-20 disabled:hover:bg-transparent'

  return (
    <div ref={setNodeRef} style={style} className="relative group/section">
      <div className="flex items-center justify-end gap-0.5 mb-1 opacity-70 group-hover/section:opacity-100 transition-opacity" aria-label={`Move ${name}`}>
        <span className="text-[10px] uppercase tracking-wide text-white/35 mr-1 hidden group-hover/section:inline">Move {name}</span>
        <button type="button" onClick={onMoveUp} disabled={!onMoveUp} className={btn} aria-label={`Move ${name} up`} title="Move up">
          <ChevronUp size={16} />
        </button>
        <button type="button" onClick={onMoveDown} disabled={!onMoveDown} className={btn} aria-label={`Move ${name} down`} title="Move down">
          <ChevronDown size={16} />
        </button>
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          data-tour="section-drag-handle"
          className={`${btn} cursor-grab active:cursor-grabbing touch-none`}
          aria-label={`Drag ${name}`}
          title="Drag to reorder"
        >
          <GripVertical size={16} />
        </button>
      </div>
      {children}
    </div>
  )
}
