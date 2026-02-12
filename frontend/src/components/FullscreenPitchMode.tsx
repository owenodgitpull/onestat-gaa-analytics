import { useEffect, useState } from 'react'
import GAAPitch from '@/components/GAAPitch'
import RadialActionWheel from '@/components/RadialActionWheel'
import { BallPosition, PossessionTeam, EventType } from '@/types'
import { X, Clock } from 'lucide-react'

interface FullscreenPitchModeProps {
  isOpen: boolean
  onClose: () => void
  // Pitch state
  ballPosition: BallPosition
  onBallMove: (position: BallPosition) => void
  readonly?: boolean
  // Match state
  matchPhase: string
  minute: number
  seconds: number
  dungloeGoals: number
  dungloePoints: number
  opponentGoals: number
  opponentPoints: number
  opponent: string
  // Action handling
  onActionSelect: (eventType: EventType) => void
  onFoulClick?: (team: 'dungloe' | 'opponent') => void
  on45Click?: () => void
  currentPossession: PossessionTeam
  isIn2PointZone: boolean
  pendingFreeKick: boolean
  pendingFoul: 'dungloe' | 'opponent' | null
  pending45: boolean
  pendingKickoutPosition: boolean
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
  // Context awareness — mirrors CategorizedActionButtons
  activeCategory?: string | null
  onCategoryChange?: (cat: string | null) => void
  awaitingKickout?: boolean
  // Event toast
  latestEventDescription?: string
}

export default function FullscreenPitchMode({
  isOpen,
  onClose,
  ballPosition,
  onBallMove,
  readonly = false,
  matchPhase,
  minute,
  seconds,
  dungloeGoals,
  dungloePoints,
  opponentGoals,
  opponentPoints,
  opponent,
  onActionSelect,
  onFoulClick,
  on45Click,
  currentPossession,
  isIn2PointZone,
  pendingFreeKick,
  pendingFoul,
  pending45,
  pendingKickoutPosition,
  onCancelFree,
  onCancel45,
  onCancelKickout,
  activeCategory,
  onCategoryChange,
  awaitingKickout = false,
  latestEventDescription,
}: FullscreenPitchModeProps) {
  const [toastVisible, setToastVisible] = useState(false)
  const [toastText, setToastText] = useState('')

  // Escape key to close
  useEffect(() => {
    if (!isOpen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isOpen, onClose])

  // Lock body scroll
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isOpen])

  // Event toast — show latest event and auto-fade
  useEffect(() => {
    if (latestEventDescription && isOpen) {
      setToastText(latestEventDescription)
      setToastVisible(true)
      const timer = setTimeout(() => setToastVisible(false), 4000)
      return () => clearTimeout(timer)
    }
  }, [latestEventDescription, isOpen])

  if (!isOpen) return null

  const formatTime = `${minute}:${seconds.toString().padStart(2, '0')}`
  const actionsDisabled = matchPhase === 'not_started' || matchPhase === 'finished'

  // Phase badge
  const phaseLabel = matchPhase === 'first_half' ? '1st Half'
    : matchPhase === 'second_half' ? '2nd Half'
    : matchPhase === 'half_time' ? 'Half Time'
    : matchPhase === 'finished' ? 'FT'
    : 'Pre-Match'

  // Status banner for awaiting kickout
  const showKickoutBanner = awaitingKickout && !pendingKickoutPosition

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col">
      {/* Top HUD Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/80 backdrop-blur-sm border-b border-white/10 flex-shrink-0">
        {/* Close button */}
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-all"
          title="Exit fullscreen (Esc)"
        >
          <X size={18} />
        </button>

        {/* Score */}
        <div className="flex items-center gap-4 text-center">
          <div className="text-right">
            <div className="text-lg font-bold text-white">
              {dungloeGoals}-{String(dungloePoints).padStart(2, '0')}
            </div>
            <div className="text-[10px] text-white/50">Dungloe</div>
          </div>
          <div className="flex flex-col items-center">
            <div className="text-white/40 text-xs">vs</div>
          </div>
          <div className="text-left">
            <div className="text-lg font-bold text-white/80">
              {opponentGoals}-{String(opponentPoints).padStart(2, '0')}
            </div>
            <div className="text-[10px] text-white/50">{opponent}</div>
          </div>
        </div>

        {/* Timer + Phase */}
        <div className="flex items-center gap-2">
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-600/30 text-indigo-300 border border-indigo-500/30">
            {phaseLabel}
          </span>
          <div className="flex items-center gap-1 px-3 py-1 rounded-lg bg-white/5 border border-white/10">
            <Clock size={14} className="text-indigo-400" />
            <span className="font-mono text-lg font-bold text-white">{formatTime}</span>
          </div>
        </div>
      </div>

      {/* Kickout awaiting banner */}
      {showKickoutBanner && (
        <div className="flex-shrink-0 px-4 py-1.5 bg-amber-600/20 border-b border-amber-500/30 text-center">
          <span className="text-xs font-semibold text-amber-300">Awaiting Kickout — Select outcome below</span>
        </div>
      )}

      {/* Pitch Area — fills remaining space, pitch scales to fill */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black">
        {/*
          The pitch SVG has a 16:10 viewBox (2332x1446). We use aspect-[16/10] to maintain
          the ratio, and w-full + max-h-full so it scales up to fill available space
          in both dimensions without overflow.
        */}
        <GAAPitch
          ballPosition={ballPosition}
          onBallMove={onBallMove}
          showZones={true}
          readonly={readonly}
          containerClassName="w-full max-h-full aspect-[16/10] bg-gradient-to-br from-green-900/40 to-green-800/40"
        />

        {/* Event Toast — bottom of pitch area */}
        <div
          className={`absolute bottom-32 left-1/2 -translate-x-1/2 transition-all duration-500 ${
            toastVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          }`}
        >
          <div className="bg-slate-900/90 backdrop-blur-sm text-white text-sm px-4 py-2 rounded-xl border border-white/20 shadow-xl max-w-md text-center">
            {toastText}
          </div>
        </div>
      </div>

      {/* Bottom Controls — Radial Action Wheel */}
      <div className="flex-shrink-0 pb-4 pt-2 bg-gradient-to-t from-black via-black/90 to-transparent">
        <RadialActionWheel
          onActionSelect={onActionSelect}
          onFoulClick={onFoulClick}
          on45Click={on45Click}
          disabled={actionsDisabled}
          currentPossession={currentPossession}
          isIn2PointZone={isIn2PointZone}
          pendingFreeKick={pendingFreeKick}
          pendingFoul={pendingFoul}
          pending45={pending45}
          pendingKickoutPosition={pendingKickoutPosition}
          onCancelFree={onCancelFree}
          onCancel45={onCancel45}
          onCancelKickout={onCancelKickout}
          activeCategory={activeCategory}
          onCategoryChange={onCategoryChange}
          awaitingKickout={awaitingKickout}
        />
      </div>
    </div>
  )
}
