import { Users, ChevronRight } from 'lucide-react'

interface PossessionSelectionModalProps {
  isOpen: boolean
  homeTeam: string
  awayTeam: string
  onSelect: (team: 'home' | 'away') => void
}

export default function PossessionSelectionModal({
  isOpen,
  homeTeam,
  awayTeam,
  onSelect
}: PossessionSelectionModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed top-0 left-0 right-0 bottom-0 z-[100] overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/90 backdrop-blur-md" />

      {/* Modal Container - Centered */}
      <div className="min-h-screen px-4 flex items-center justify-center">
        {/* Modal */}
        <div className="relative w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="p-8 border-b border-white/10 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 text-center">
          <div className="inline-flex p-3 rounded-full bg-indigo-600/30 mb-4">
            <Users size={32} className="text-indigo-300" />
          </div>
          <h2 className="text-3xl font-bold text-white mb-2">Who Has Possession?</h2>
          <p className="text-white/70">Select which team won the throw-in</p>
        </div>

        {/* Team Selection */}
        <div className="p-8 space-y-4">
          {/* Home Team */}
          <button
            onClick={() => onSelect('home')}
            className="w-full p-6 rounded-xl bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border-2 border-emerald-500/30 hover:border-emerald-500 hover:from-emerald-600/30 hover:to-teal-600/30 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                  {homeTeam[0]?.toUpperCase() || 'H'}
                </div>
                <div className="text-left">
                  <div className="text-xl font-bold text-white">{homeTeam}</div>
                  <div className="text-sm text-emerald-300">Home Team</div>
                </div>
              </div>
              <ChevronRight size={24} className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
          </button>

          {/* Divider */}
          <div className="flex items-center space-x-3">
            <div className="flex-1 h-px bg-white/10" />
            <span className="text-white/40 text-sm font-medium">VS</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Away Team */}
          <button
            onClick={() => onSelect('away')}
            className="w-full p-6 rounded-xl bg-gradient-to-r from-red-600/20 to-orange-600/20 border-2 border-red-500/30 hover:border-red-500 hover:from-red-600/30 hover:to-orange-600/30 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-red-600 to-orange-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
                  {awayTeam[0]?.toUpperCase() || 'A'}
                </div>
                <div className="text-left">
                  <div className="text-xl font-bold text-white">{awayTeam}</div>
                  <div className="text-sm text-red-300">Away Team</div>
                </div>
              </div>
              <ChevronRight size={24} className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
            </div>
          </button>
        </div>

        {/* Info Footer */}
        <div className="px-8 pb-8">
          <div className="p-4 rounded-lg bg-indigo-600/10 border border-indigo-500/30">
            <p className="text-sm text-white/70 text-center">
              💡 This helps us track possession accurately from the start of each half
            </p>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

