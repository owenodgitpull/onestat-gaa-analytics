import { useState } from 'react'
import { ChevronDown, Check, Shield } from 'lucide-react'
import { useClub } from '../contexts/ClubContext'
import { API_BASE } from '../services/api'

export default function TeamSwitcher() {
  const { club, clubs, switchClub } = useClub()
  const [isOpen, setIsOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Don't render if user only has one club (or none)
  if (clubs.length <= 1) return null

  const handleSwitch = async (clubId: string) => {
    if (clubId === club?.id || switching) return
    setSwitching(true)
    try {
      await switchClub(clubId)
      setIsOpen(false)
    } catch (err) {
      console.error('Failed to switch team:', err)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-white/5 transition-colors text-white/80 hover:text-white"
      >
        <Shield size={14} className="text-emerald-400" />
        <span className="text-xs font-medium max-w-[100px] truncate hidden sm:inline">
          {club?.short_name || club?.name || 'Team'}
        </span>
        <ChevronDown size={12} className="text-white/40" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-64 py-1.5 bg-slate-800 border border-white/10 rounded-xl shadow-xl z-20">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-white/30 uppercase tracking-wider">
              Switch Team
            </div>
            {clubs.map((m) => (
              <button
                key={m.club_id}
                onClick={() => handleSwitch(m.club_id)}
                disabled={switching}
                className={`w-full px-3 py-2 flex items-center gap-3 text-left transition-colors ${
                  m.club_id === club?.id
                    ? 'bg-emerald-500/10 text-white'
                    : 'text-white/70 hover:bg-white/5 hover:text-white'
                }`}
              >
                {m.club_logo_url ? (
                  <img
                    src={`${API_BASE}/club/logo/serve`}
                    alt=""
                    className="w-6 h-6 rounded object-contain flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div className="w-6 h-6 rounded bg-white/10 flex items-center justify-center flex-shrink-0">
                    <Shield size={12} className="text-white/40" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{m.club_short_name || m.club_name}</p>
                  <p className="text-[10px] text-white/40 capitalize">{m.role.replace('_', ' ')}</p>
                </div>
                {m.club_id === club?.id && (
                  <Check size={14} className="text-emerald-400 flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
