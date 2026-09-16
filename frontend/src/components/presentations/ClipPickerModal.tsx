import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, Film, Loader2 } from 'lucide-react'
import { presentationsAPI, ClipLibraryEntry, DEFAULT_CLIP_LEAD_MS, DEFAULT_CLIP_TAIL_MS } from '@/services/presentationsApi'
import { api } from '@/services/api'

interface ClipPickerModalProps {
  onClose: () => void
  onAdd: (clip: {
    video_session_id: string
    clip_start_ms: number
    clip_end_ms: number
    clip_label: string
  }) => Promise<void>
}

export default function ClipPickerModal({ onClose, onAdd }: ClipPickerModalProps) {
  const [search, setSearch] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [addingId, setAddingId] = useState<string | null>(null)

  const { data: players = [] } = useQuery({
    queryKey: ['players-for-clip-picker'],
    queryFn: () => api.players.getAll(),
  })

  const { data: clips = [], isLoading } = useQuery({
    queryKey: ['clip-library', search, playerId],
    queryFn: () => presentationsAPI.searchClipLibrary({
      search: search || undefined,
      playerId: playerId || undefined,
    }),
  })

  const handleAdd = async (clip: ClipLibraryEntry) => {
    setAddingId(clip.video_event_id)
    try {
      await onAdd({
        video_session_id: clip.video_session_id,
        clip_start_ms: Math.max(0, clip.video_timestamp_ms - DEFAULT_CLIP_LEAD_MS),
        clip_end_ms: clip.video_timestamp_ms + DEFAULT_CLIP_TAIL_MS,
        clip_label: clip.suggested_label,
      })
    } finally {
      setAddingId(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="glass-card w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <Film size={18} className="text-purple-400" />
            <h2 className="text-lg font-bold text-white">Add Clip</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="p-4 border-b border-white/10 flex gap-2">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by opponent or player…"
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-purple-500/50"
            />
          </div>
          <select
            value={playerId}
            onChange={(e) => setPlayerId(e.target.value)}
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-purple-500/50"
          >
            <option value="">All players</option>
            {players.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {isLoading ? (
            <div className="text-center text-white/40 py-10 text-sm">Loading clips…</div>
          ) : clips.length === 0 ? (
            <div className="text-center text-white/40 py-10 text-sm">
              No tagged clips found. Tag events in Video Tagging first.
            </div>
          ) : (
            clips.map((clip) => (
              <button
                key={clip.video_event_id}
                onClick={() => handleAdd(clip)}
                disabled={addingId === clip.video_event_id}
                className="w-full flex items-center justify-between gap-3 p-3 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-left transition-colors disabled:opacity-50"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{clip.suggested_label}</p>
                  <p className="text-xs text-white/40">{clip.match_date}</p>
                </div>
                {addingId === clip.video_event_id ? (
                  <Loader2 size={16} className="animate-spin text-purple-400 flex-shrink-0" />
                ) : (
                  <span className="text-xs font-semibold text-purple-400 flex-shrink-0">+ Add</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
