import { useState, useEffect, useMemo } from 'react'
import { Eye, Search, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { playersAPI } from '../../services/api'
import { useAuth } from '../../contexts/AuthContext'
import type { Player } from '../../types'

export default function PlayerPreviewSettings() {
  const { startPreview } = useAuth()
  const navigate = useNavigate()
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    playersAPI.getAll()
      .then(data => setPlayers(data.filter(p => p.active)))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return players
    return players.filter(p => p.name.toLowerCase().includes(q))
  }, [players, search])

  const handlePreview = (player: Player) => {
    startPreview({ id: player.id, name: player.name })
    navigate('/player')
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-white font-semibold">Preview as Player</h3>
        <p className="text-white/50 text-sm mt-1">
          See exactly what a player sees in their portal — read-only, no login required. Useful for checking what they'll see before an invite, or troubleshooting what they're reporting.
        </p>
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players..."
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-emerald-500/50"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-white/40">
          <Loader2 size={20} className="animate-spin" />
        </div>
      ) : error ? (
        <p className="text-red-400 text-sm">{error}</p>
      ) : filtered.length === 0 ? (
        <p className="text-white/40 text-sm py-6 text-center">No players found.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {filtered.map(player => (
            <button
              key={player.id}
              onClick={() => handlePreview(player)}
              className="flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-emerald-500/30 transition-all text-left group"
            >
              <div className="min-w-0">
                <div className="text-white font-medium truncate">{player.name}</div>
                <div className="text-white/40 text-xs capitalize">{player.position || 'No position set'}</div>
              </div>
              <Eye size={16} className="text-white/30 group-hover:text-emerald-400 flex-shrink-0 transition-colors" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
