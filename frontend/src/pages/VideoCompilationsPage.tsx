import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Film, Download, Trash2, Loader2, Clock, AlertCircle, CheckCircle2 } from 'lucide-react'
import { videoCompilationsAPI, type VideoCompilationItem } from '@/services/videoCompilationsApi'
import ConfirmationModal from '@/components/ConfirmationModal'

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Queued', color: 'text-white/50', icon: Clock },
  processing: { label: 'Processing', color: 'text-cyan-400', icon: Loader2 },
  completed: { label: 'Ready', color: 'text-emerald-400', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-red-400', icon: AlertCircle },
}

function formatDuration(ms: number | null): string {
  if (!ms) return ''
  const totalSec = Math.round(ms / 1000)
  return `${Math.floor(totalSec / 60)}:${(totalSec % 60).toString().padStart(2, '0')}`
}

function CompilationRow({ item, onDelete }: { item: VideoCompilationItem; onDelete: () => void }) {
  const [downloading, setDownloading] = useState(false)
  const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending
  const StatusIcon = config.icon

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const { download_url } = await videoCompilationsAPI.getDownloadUrl(item.id)
      window.open(download_url, '_blank')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="glass-card p-4 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-purple-500/20 border border-purple-500/30 flex items-center justify-center flex-shrink-0">
        <Film size={18} className="text-purple-400" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-white font-medium truncate">{item.title}</p>
        <div className="flex items-center gap-3 text-xs text-white/40 mt-0.5">
          <span>{item.clip_count} clip{item.clip_count !== 1 ? 's' : ''}</span>
          {item.output_duration_ms && <span>{formatDuration(item.output_duration_ms)}</span>}
          <span>{new Date(item.created_at).toLocaleDateString()}</span>
        </div>
        {item.status === 'failed' && item.error_message && (
          <p className="text-xs text-red-400/80 mt-1 truncate">{item.error_message}</p>
        )}
      </div>
      <div className={`flex items-center gap-1.5 text-xs font-medium flex-shrink-0 ${config.color}`}>
        <StatusIcon size={14} className={item.status === 'processing' ? 'animate-spin' : ''} />
        {config.label}
      </div>
      {item.status === 'completed' && (
        <button
          onClick={handleDownload}
          disabled={downloading}
          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs flex-shrink-0"
        >
          {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Download
        </button>
      )}
      <button
        onClick={onDelete}
        className="p-1.5 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 flex-shrink-0"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

export default function VideoCompilationsPage() {
  const queryClient = useQueryClient()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const { data: compilations = [], isLoading } = useQuery({
    queryKey: ['video-compilations'],
    queryFn: () => videoCompilationsAPI.list(),
    refetchInterval: (query) => {
      const data = query.state.data as VideoCompilationItem[] | undefined
      const stillWorking = data?.some(c => c.status === 'pending' || c.status === 'processing')
      return stillWorking ? 5000 : false
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => videoCompilationsAPI.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video-compilations'] })
      setDeletingId(null)
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-600 to-pink-600 flex items-center justify-center">
          <Film size={24} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Video Compilations</h1>
          <p className="text-white/60 text-sm">
            Ask the Analyst — "show me a player's wides this season" — and it builds a downloadable video here
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="glass-card p-8 text-center text-white/50">Loading…</div>
      ) : compilations.length === 0 ? (
        <div className="glass-card p-10 text-center space-y-2">
          <Film size={36} className="mx-auto text-white/30" />
          <p className="text-white/70 font-medium">No compilations yet</p>
          <p className="text-white/50 text-sm max-w-md mx-auto">
            Ask the Analyst to build one from tagged clips — e.g. "show me every high ball this season"
            or "compile a player's wides" — and it'll show up here once it's ready.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {compilations.map((item) => (
            <CompilationRow key={item.id} item={item} onDelete={() => setDeletingId(item.id)} />
          ))}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deletingId}
        onClose={() => setDeletingId(null)}
        onConfirm={() => deletingId && deleteMutation.mutate(deletingId)}
        title="Delete compilation?"
        message="This video will be permanently deleted. The original match footage and tagged events are not affected."
        confirmText="Delete"
        variant="danger"
      />
    </div>
  )
}
