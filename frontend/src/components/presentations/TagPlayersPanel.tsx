import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus, Check, Bell } from 'lucide-react'
import { presentationsAPI } from '@/services/presentationsApi'
import { api } from '@/services/api'

interface TagPlayersPanelProps {
  presentationId: string
  slideId: string
  taggedPlayerIds: string[]
}

export default function TagPlayersPanel({ presentationId, slideId, taggedPlayerIds }: TagPlayersPanelProps) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sent, setSent] = useState(false)

  const { data: players = [] } = useQuery({
    queryKey: ['players-for-tag-panel'],
    queryFn: () => api.players.getAll(),
    enabled: open,
  })

  const notifyMutation = useMutation({
    mutationFn: () => presentationsAPI.notifyPlayers(presentationId, slideId, Array.from(selected)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['presentation', presentationId] })
      setSent(true)
      setTimeout(() => { setOpen(false); setSent(false); setSelected(new Set()) }, 1200)
    },
  })

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-glass flex items-center gap-1.5 px-3 py-1.5 text-xs">
        <UserPlus size={12} />
        {taggedPlayerIds.length > 0 ? `Shared with ${taggedPlayerIds.length}` : 'Tag & Notify'}
      </button>
    )
  }

  return (
    <div className="space-y-2 border border-white/10 rounded-lg p-3 bg-white/5">
      <p className="text-xs text-white/50">Select players to notify — they'll see this clip in their portal.</p>
      <div className="max-h-40 overflow-y-auto space-y-1">
        {players.map((p) => {
          const isTagged = taggedPlayerIds.includes(p.id)
          const isSelected = selected.has(p.id)
          return (
            <label key={p.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/5 cursor-pointer text-sm">
              <input
                type="checkbox"
                checked={isSelected || isTagged}
                disabled={isTagged}
                onChange={(e) => {
                  const next = new Set(selected)
                  if (e.target.checked) next.add(p.id); else next.delete(p.id)
                  setSelected(next)
                }}
              />
              <span className={isTagged ? 'text-white/40' : 'text-white/80'}>{p.name}{isTagged ? ' (already tagged)' : ''}</span>
            </label>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => notifyMutation.mutate()}
          disabled={selected.size === 0 || notifyMutation.isPending}
          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs disabled:opacity-40"
        >
          {sent ? <Check size={12} /> : <Bell size={12} />}
          {sent ? 'Sent' : `Notify ${selected.size || ''}`}
        </button>
        <button onClick={() => setOpen(false)} className="btn-glass px-3 py-1.5 text-xs">Close</button>
      </div>
    </div>
  )
}
