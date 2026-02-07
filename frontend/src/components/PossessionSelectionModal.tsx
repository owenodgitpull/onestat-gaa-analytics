import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Users, ChevronRight, ArrowRight, ArrowLeft, User } from 'lucide-react'

interface PossessionSelectionModalProps {
  isOpen: boolean
  homeTeam: string
  awayTeam: string
  onSelect: (team: 'home' | 'away', attackingRight: boolean) => void
}

// Mini pitch SVG component for visual direction selection
function MiniPitch({ direction, homeTeam }: { direction: 'left' | 'right'; homeTeam: string }) {
  const attackingRight = direction === 'right'

  return (
    <div className="relative w-full h-32 bg-emerald-800 rounded-lg overflow-hidden border-2 border-white/20">
      {/* Pitch markings */}
      <svg viewBox="0 0 200 100" className="w-full h-full">
        {/* Pitch outline */}
        <rect x="5" y="5" width="190" height="90" fill="none" stroke="white" strokeWidth="1" opacity="0.4" />

        {/* Center line */}
        <line x1="100" y1="5" x2="100" y2="95" stroke="white" strokeWidth="1" opacity="0.4" />

        {/* Center circle */}
        <circle cx="100" cy="50" r="15" fill="none" stroke="white" strokeWidth="1" opacity="0.4" />

        {/* Left goal */}
        <rect x="5" y="35" width="10" height="30" fill="none" stroke="white" strokeWidth="1" opacity="0.6" />

        {/* Right goal */}
        <rect x="185" y="35" width="10" height="30" fill="none" stroke="white" strokeWidth="1" opacity="0.6" />

        {/* Attack arrow */}
        {attackingRight ? (
          <>
            <line x1="60" y1="50" x2="140" y2="50" stroke="#10b981" strokeWidth="4" markerEnd="url(#arrowRight)" />
            <defs>
              <marker id="arrowRight" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#10b981" />
              </marker>
            </defs>
            {/* Team labels */}
            <text x="25" y="50" fill="white" fontSize="8" textAnchor="middle" opacity="0.8">{homeTeam[0]}</text>
            <text x="175" y="50" fill="#10b981" fontSize="10" textAnchor="middle" fontWeight="bold">GOAL</text>
          </>
        ) : (
          <>
            <line x1="140" y1="50" x2="60" y2="50" stroke="#3b82f6" strokeWidth="4" markerEnd="url(#arrowLeft)" />
            <defs>
              <marker id="arrowLeft" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
                <path d="M0,0 L0,6 L9,3 z" fill="#3b82f6" />
              </marker>
            </defs>
            {/* Team labels */}
            <text x="175" y="50" fill="white" fontSize="8" textAnchor="middle" opacity="0.8">{homeTeam[0]}</text>
            <text x="25" y="50" fill="#3b82f6" fontSize="10" textAnchor="middle" fontWeight="bold">GOAL</text>
          </>
        )}
      </svg>

      {/* User position indicator (bottom center - sideline) */}
      <div className="absolute bottom-1 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-black/60 px-2 py-0.5 rounded text-xs text-white/80">
        <User size={10} />
        <span>You</span>
      </div>
    </div>
  )
}

export default function PossessionSelectionModal({
  isOpen,
  homeTeam,
  awayTeam,
  onSelect
}: PossessionSelectionModalProps) {
  const [step, setStep] = useState<'direction' | 'possession'>('direction')
  const [attackingRight, setAttackingRight] = useState<boolean | null>(null)
  const [hoveredDirection, setHoveredDirection] = useState<'left' | 'right' | null>(null)

  if (!isOpen) return null

  const handleDirectionSelect = (direction: 'left' | 'right') => {
    setAttackingRight(direction === 'right')
    setStep('possession')
  }

  const handlePossessionSelect = (team: 'home' | 'away') => {
    if (attackingRight !== null) {
      onSelect(team, attackingRight)
      // Reset for next time
      setStep('direction')
      setAttackingRight(null)
      setHoveredDirection(null)
    }
  }

  const handleBack = () => {
    setStep('direction')
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
        {step === 'direction' ? (
          <>
            {/* Header - Attack Direction */}
            <div className="p-6 border-b border-white/10 bg-gradient-to-r from-indigo-600/20 to-purple-600/20 text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Attack Direction</h2>
              <p className="text-white/70 text-sm">Which way is {homeTeam} attacking this half?</p>
            </div>

            {/* Visual Pitch Preview */}
            <div className="px-6 pt-4">
              <MiniPitch
                direction={hoveredDirection || 'right'}
                homeTeam={homeTeam}
              />
              <p className="text-xs text-white/50 text-center mt-2">
                Stand at center sideline facing the pitch. Which goal is {homeTeam} attacking?
              </p>
            </div>

            {/* Direction Selection */}
            <div className="p-6 space-y-3">
              {/* Left to Right */}
              <button
                onClick={() => handleDirectionSelect('right')}
                onMouseEnter={() => setHoveredDirection('right')}
                onMouseLeave={() => setHoveredDirection(null)}
                className="w-full p-4 rounded-xl bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border-2 border-emerald-500/30 hover:border-emerald-500 hover:from-emerald-600/30 hover:to-teal-600/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-lg">
                      <ArrowRight size={24} className="text-white" />
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-bold text-white">Attacking Right →</div>
                      <div className="text-xs text-emerald-300">Goal is on your RIGHT side</div>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              </button>

              {/* Divider */}
              <div className="flex items-center space-x-3">
                <div className="flex-1 h-px bg-white/10" />
                <span className="text-white/40 text-xs font-medium">OR</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              {/* Right to Left */}
              <button
                onClick={() => handleDirectionSelect('left')}
                onMouseEnter={() => setHoveredDirection('left')}
                onMouseLeave={() => setHoveredDirection(null)}
                className="w-full p-4 rounded-xl bg-gradient-to-r from-blue-600/20 to-indigo-600/20 border-2 border-blue-500/30 hover:border-blue-500 hover:from-blue-600/30 hover:to-indigo-600/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg">
                      <ArrowLeft size={24} className="text-white" />
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-bold text-white">← Attacking Left</div>
                      <div className="text-xs text-blue-300">Goal is on your LEFT side</div>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            </div>

            {/* Info Footer */}
            <div className="px-6 pb-6">
              <div className="p-3 rounded-lg bg-indigo-600/10 border border-indigo-500/30">
                <p className="text-xs text-white/70 text-center">
                  This ensures "inside {awayTeam}'s arc" and similar descriptions are accurate
                </p>
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Header - Possession */}
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
                onClick={() => handlePossessionSelect('home')}
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
                onClick={() => handlePossessionSelect('away')}
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

              {/* Back Button */}
              <button
                onClick={handleBack}
                className="w-full p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/60 hover:text-white text-sm"
              >
                ← Back to direction selection
              </button>
            </div>

            {/* Visual Pitch Reminder */}
            <div className="px-6 pt-4">
              <MiniPitch
                direction={attackingRight ? 'right' : 'left'}
                homeTeam={homeTeam}
              />
            </div>

            {/* Info Footer */}
            <div className="px-6 pb-6">
              <div className="p-3 rounded-lg bg-indigo-600/10 border border-indigo-500/30">
                <p className="text-xs text-white/70 text-center">
                  {homeTeam} attacking {attackingRight ? 'left → right' : 'right → left'} this half
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
