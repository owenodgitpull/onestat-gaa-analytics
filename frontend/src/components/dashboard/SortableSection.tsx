import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripHorizontal } from 'lucide-react'

interface SortableSectionProps {
  id: string
  children: React.ReactNode
}

export default function SortableSection({ id, children }: SortableSectionProps) {
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

  return (
    <div ref={setNodeRef} style={style} className="relative group/section">
      {/* Section drag handle — overlaps left edge on hover */}
      <div className="absolute -left-6 top-2 opacity-0 group-hover/section:opacity-100 transition-opacity z-10">
        <button
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          data-tour="section-drag-handle"
          className="p-1 rounded-lg hover:bg-white/10 text-white/30 hover:text-white/60 transition-colors cursor-grab active:cursor-grabbing touch-none"
          title="Drag to reorder section"
        >
          <GripHorizontal size={16} />
        </button>
      </div>
      {children}
    </div>
  )
}
