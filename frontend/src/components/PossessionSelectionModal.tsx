import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Users, ChevronRight, ArrowRight, ArrowLeft } from 'lucide-react'

interface PossessionSelectionModalProps {
  isOpen: boolean
  homeTeam: string
  awayTeam: string
  onSelect: (team: 'home' | 'away', attackingRight: boolean) => void
  /** Skip direction step (auto-derived for second half) */
  skipDirection?: boolean
  /** Pre-set attacking direction when skipDirection is true */
  defaultAttackingRight?: boolean
}

// Scaled-down version of the real GAA pitch with direction arrow overlay
function MiniPitch({ direction, homeTeam }: { direction: 'left' | 'right'; homeTeam: string }) {
  const attackingRight = direction === 'right'
  const arrowColor = attackingRight ? '#10b981' : '#3b82f6'

  return (
    <div className="relative w-full rounded-lg overflow-hidden border-2 border-white/20">
      {/* Real GAA pitch SVG (same as GAAPitch component) */}
      <svg viewBox="0 0 2332 1446" className="w-full h-auto">
        <rect width="2332" height="1446" fill="#2d5016" />
        <image
          href="/pitch-svg.svg"
          width="2332"
          height="1446"
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Direction arrow overlay */}
        <defs>
          <marker id={`miniArrow-${direction}`} markerWidth="20" markerHeight="20" refX="18" refY="10" orient="auto">
            <path d="M0,0 L0,20 L20,10 z" fill={arrowColor} />
          </marker>
        </defs>
        {attackingRight ? (
          <>
            <line x1="700" y1="723" x2="1600" y2="723" stroke={arrowColor} strokeWidth="12" markerEnd={`url(#miniArrow-${direction})`} opacity="0.9" />
            <text x="400" y="740" fill="white" fontSize="100" textAnchor="middle" fontWeight="bold" opacity="0.8">{homeTeam}</text>
            <text x="1900" y="740" fill={arrowColor} fontSize="100" textAnchor="middle" fontWeight="bold">GOAL</text>
          </>
        ) : (
          <>
            <line x1="1600" y1="723" x2="700" y2="723" stroke={arrowColor} strokeWidth="12" markerEnd={`url(#miniArrow-${direction})`} opacity="0.9" />
            <text x="1900" y="740" fill="white" fontSize="100" textAnchor="middle" fontWeight="bold" opacity="0.8">{homeTeam}</text>
            <text x="400" y="740" fill={arrowColor} fontSize="100" textAnchor="middle" fontWeight="bold">GOAL</text>
          </>
        )}
      </svg>
    </div>
  )
}

export default function PossessionSelectionModal({
  isOpen,
  homeTeam,
  awayTeam,
  onSelect,
  skipDirection = false,
  defaultAttackingRight = true,
}: PossessionSelectionModalProps) {
  const [step, setStep] = useState<'direction' | 'possession'>('direction')
  const [attackingRight, setAttackingRight] = useState<boolean | null>(null)
  const [hoveredDirection, setHoveredDirection] = useState<'left' | 'right' | null>(null)

  // When modal opens with skipDirection, jump straight to possession step
  useEffect(() => {
    if (isOpen && skipDirection) {
      setStep('possession')
      setAttackingRight(defaultAttackingRight)
    } else if (isOpen) {
      setStep('direction')
      setAttackingRight(null)
    }
  }, [isOpen, skipDirection, defaultAttackingRight])

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
            <div className="p-6 border-b border-white/10 bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 text-center">
              <h2 className="text-2xl font-bold text-white mb-2">Attack Direction</h2>
              <p className="text-white/70 text-sm">Which way is {homeTeam} attacking this half?</p>
            </div>

            {/* Visual Pitch Preview */}
            <div className="px-6 pt-4">
              <MiniPitch
                direction={hoveredDirection || 'right'}
                homeTeam={homeTeam}
              />
            </div>

            {/* Direction Selection */}
            <div className="p-6 space-y-3">
              {/* Left to Right */}
              <button
                onClick={() => handleDirectionSelect('right')}
                onMouseEnter={() => setHoveredDirection('right')}
                onMouseLeave={() => setHoveredDirection(null)}
                className="w-full p-4 rounded-xl bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 border-2 border-emerald-500/30 hover:border-emerald-500 hover:from-emerald-600/30 hover:to-cyan-600/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center shadow-lg">
                      <ArrowRight size={24} className="text-white" />
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-bold text-white">Attacking LEFT TO RIGHT</div>
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
                className="w-full p-4 rounded-xl bg-gradient-to-r from-blue-600/20 to-emerald-600/20 border-2 border-blue-500/30 hover:border-blue-500 hover:from-blue-600/30 hover:to-emerald-600/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-600 to-emerald-600 flex items-center justify-center shadow-lg">
                      <ArrowLeft size={24} className="text-white" />
                    </div>
                    <div className="text-left">
                      <div className="text-lg font-bold text-white">Attacking RIGHT TO LEFT</div>
                    </div>
                  </div>
                  <ChevronRight size={20} className="text-white/40 group-hover:text-white group-hover:translate-x-1 transition-all" />
                </div>
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Header - Possession */}
            <div className="p-8 border-b border-white/10 bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 text-center">
              <div className="inline-flex p-3 rounded-full bg-emerald-600/30 mb-4">
                <Users size={32} className="text-emerald-300" />
              </div>
              <h2 className="text-3xl font-bold text-white mb-2">Who Has Possession?</h2>
              <p className="text-white/70">Select which team won the throw-in</p>
            </div>

            {/* Team Selection */}
            <div className="p-8 space-y-4">
              {/* Home Team */}
              <button
                onClick={() => handlePossessionSelect('home')}
                className="w-full p-6 rounded-xl bg-gradient-to-r from-emerald-600/20 to-cyan-600/20 border-2 border-emerald-500/30 hover:border-emerald-500 hover:from-emerald-600/30 hover:to-cyan-600/30 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-4">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-600 to-cyan-600 flex items-center justify-center text-2xl font-bold text-white shadow-lg">
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

              {/* Back Button (only when direction was manually selected) */}
              {!skipDirection && (
                <button
                  onClick={handleBack}
                  className="w-full p-3 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition-all text-white/60 hover:text-white text-sm"
                >
                  ← Back to direction selection
                </button>
              )}
            </div>

            {/* Visual Pitch Reminder */}
            <div className="px-6 pb-4">
              <MiniPitch
                direction={attackingRight ? 'right' : 'left'}
                homeTeam={homeTeam}
              />
              <div className="p-3 mt-2 rounded-lg bg-emerald-600/10 border border-emerald-500/30">
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
