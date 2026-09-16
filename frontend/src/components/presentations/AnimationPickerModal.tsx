import { useQuery } from '@tanstack/react-query'
import { X, Zap } from 'lucide-react'
import { api } from '@/services/api'

interface AnimationPickerModalProps {
  onClose: () => void
  onAdd: (setPieceRoutineId: string) => Promise<void>
}

const CATEGORY_LABELS: Record<string, string> = {
  attacking: 'Attacking',
  defensive: 'Defensive',
  kickout: 'Kickout',
}

export default function AnimationPickerModal({ onClose, onAdd }: AnimationPickerModalProps) {
  const { data: routines = [], isLoading } = useQuery({
    queryKey: ['set-pieces-for-picker'],
    queryFn: () => api.matchPrep.listSetPieces(),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Zap size={18} className="text-amber-400" />
            <h2 className="text-lg font-bold text-white">Add Tactical Animation</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {isLoading ? (
            <div className="text-center text-white/40 py-10 text-sm">Loading routines…</div>
          ) : routines.length === 0 ? (
            <div className="text-center text-white/40 py-10 text-sm">
              No set-piece routines yet. Build one in Match Prep first.
            </div>
          ) : (
            routines.map((routine) => (
              <button
                key={routine.id}
                onClick={() => onAdd(routine.id)}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{routine.name}</p>
                  <p className="text-xs text-white/40">{CATEGORY_LABELS[routine.category] || routine.category}</p>
                </div>
                <span className="text-xs font-semibold text-amber-400 flex-shrink-0">+ Add</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
