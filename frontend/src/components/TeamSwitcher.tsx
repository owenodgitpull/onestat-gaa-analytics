import { useState } from 'react'
import { ChevronDown, Check, Shield } from 'lucide-react'
import { useClub } from '../contexts/ClubContext'
import { API_BASE } from '../services/api'

export default function TeamSwitcher() {
  const { club, clubs, logoUrl, switchClub } = useClub()
  const [isOpen, setIsOpen] = useState(false)
  const [switching, setSwitching] = useState(false)

  // Don't render if user only has one club (or none)
  if (clubs.length <= 1) return null

  const handleSwitch = async (clubId: string) => {
    if (clubId === club?.id || switching) return
    setIsOpen(false)
    setSwitching(true)
    try {
      await switchClub(clubId)
    } catch (err) {
      console.error('Failed to switch team:', err)
    } finally {
      setSwitching(false)
    }
  }

  return (
    <div className="relative flex items-center">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 rounded-lg hover:bg-white/5 transition-colors p-1"
      >
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={club?.name || 'Team'}
            className="h-7 lg:h-8 rounded-md object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        ) : (
          <div className="h-7 w-7 lg:h-8 lg:w-8 rounded-md bg-white/10 flex items-center justify-center">
            <Shield size={14} className="text-white/40" />
          </div>
        )}
        <ChevronDown size={14} className="text-white/60" />
      </button>

      {isOpen && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setIsOpen(false)} />
          <div className="absolute left-0 top-full mt-2 w-64 py-1.5 bg-slate-800 border border-white/10 rounded-xl shadow-xl z-[70]">
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
                    src={`${API_BASE}/club/logo/serve?club_id=${m.club_id}`}
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
