import { Eye, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

/**
 * Shown across every /player/* page when an admin is using "preview as
 * player" — deliberately impossible to miss, so viewing another player's
 * portal is never confusable with being logged in as them.
 */
export default function PlayerPreviewBanner() {
  const { user, previewPlayer, exitPreview } = useAuth()
  const navigate = useNavigate()

  if (!previewPlayer || user?.role !== 'club_admin') return null

  return (
    <div className="sticky top-0 z-40 flex items-center justify-between gap-3 px-4 py-2 bg-amber-500/90 backdrop-blur-md text-slate-900 text-sm font-semibold shadow-lg">
      <span className="flex items-center gap-2 truncate">
        <Eye size={16} className="flex-shrink-0" />
        Viewing as {previewPlayer.name} — Admin Preview (read-only)
      </span>
      <button
        onClick={() => {
          exitPreview()
          navigate('/')
        }}
        className="flex items-center gap-1 px-3 py-1 rounded-lg bg-slate-900/10 hover:bg-slate-900/20 transition-colors flex-shrink-0"
      >
        <X size={14} />
        Exit
      </button>
    </div>
  )
}
