import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { MonitorPlay, Plus, Trash2, ChevronRight, Layers } from 'lucide-react'
import { presentationsAPI } from '@/services/presentationsApi'
import ConfirmationModal from '@/components/ConfirmationModal'

export default function PresentationsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: presentations = [], isLoading } = useQuery({
    queryKey: ['presentations'],
    queryFn: () => presentationsAPI.list(),
  })

  const createMutation = useMutation({
    mutationFn: () => presentationsAPI.create('Untitled Presentation'),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] })
      navigate(`/presentations/${created.id}`)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => presentationsAPI.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentations'] })
      setDeletingId(null)
    },
  })

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-indigo-600 flex items-center justify-center">
            <MonitorPlay size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Presentations</h1>
            <p className="text-white/60 text-sm">
              Video clips, tactical animations and talking points, built for the team meeting screen
            </p>
          </div>
        </div>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
          className="btn-primary flex items-center gap-2 px-4 py-2"
        >
          <Plus size={16} />
          New Presentation
        </button>
      </div>

      {isLoading ? (
        <div className="glass-card p-8 text-center text-white/50">Loading…</div>
      ) : presentations.length === 0 ? (
        <div className="glass-card p-10 text-center space-y-3">
          <MonitorPlay size={36} className="mx-auto text-white/30" />
          <p className="text-white/70 font-medium">No presentations yet</p>
          <p className="text-white/50 text-sm max-w-md mx-auto">
            Build a deck from tagged video clips, tactical animations from Match Prep, and text cards —
            then step through it full-screen for the team.
          </p>
          <button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className="btn-primary inline-flex items-center gap-2 px-4 py-2 mt-2"
          >
            <Plus size={16} />
            New Presentation
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {presentations.map((p) => (
            <Link
              key={p.id}
              to={`/presentations/${p.id}`}
              className="glass-card p-5 hover:bg-white/10 transition-all group relative"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-lg font-bold text-white pr-6">{p.title}</h3>
                <ChevronRight
                  size={20}
                  className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all flex-shrink-0"
                />
              </div>
              <div className="flex items-center justify-between text-sm text-white/50">
                <div className="flex items-center gap-1.5">
                  <Layers size={14} />
                  <span>{p.slide_count} slide{p.slide_count !== 1 ? 's' : ''}</span>
                </div>
                <span>{new Date(p.updated_at).toLocaleDateString()}</span>
              </div>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeletingId(p.id) }}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-500/20 text-white/40 hover:text-red-400"
                title="Delete presentation"
              >
                <Trash2 size={14} />
              </button>
            </Link>
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={() => deletingId && deleteMutation.mutate(deletingId)}
        title="Delete presentation?"
        message="This deck and all its slides will be permanently deleted. The underlying video clips and animations are not affected."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
