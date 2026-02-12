import { useState } from 'react'
import { EventType, PossessionTeam } from '@/types'
import {
  Target,
  TrendingUp,
  XCircle,
  CheckCircle,
  AlertCircle,
  Zap,
  Flag,
  Hand,
  Shield,
  Eye,
} from 'lucide-react'

interface RadialActionWheelProps {
  onActionSelect: (eventType: EventType) => void
  onFoulClick?: (team: 'dungloe' | 'opponent') => void
  on45Click?: () => void
  disabled?: boolean
  currentPossession?: PossessionTeam
  isIn2PointZone?: boolean
  pendingFreeKick?: boolean
  pendingFoul?: 'dungloe' | 'opponent' | null
  pending45?: boolean
  pendingKickoutPosition?: boolean
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
  activeCategory?: string | null
  onCategoryChange?: (cat: string | null) => void
  awaitingKickout?: boolean
}

type CategoryId = 'scoring' | 'turnovers' | 'our_kickouts' | 'opp_kickouts' | 'foul'

interface ActionButton {
  eventType: EventType
  label: string
  icon: typeof Target
}

const categoryConfig: Record<CategoryId, { label: string; icon: typeof Target; color: string }> = {
  scoring: { label: 'Shooting', icon: Target, color: '#6366f1' },
  turnovers: { label: 'Turnovers', icon: Zap, color: '#f59e0b' },
  our_kickouts: { label: 'Our K/O', icon: CheckCircle, color: '#10b981' },
  opp_kickouts: { label: 'Opp K/O', icon: AlertCircle, color: '#8b5cf6' },
  foul: { label: 'Foul', icon: Hand, color: '#06b6d4' },
}

const categoryButtons: Record<Exclude<CategoryId, 'foul'>, ActionButton[]> = {
  scoring: [
    { eventType: EventType.GOAL, label: 'Goal', icon: Target },
    { eventType: EventType.POINT, label: 'Point', icon: TrendingUp },
    { eventType: EventType.TWO_POINT, label: '2PT', icon: TrendingUp },
    { eventType: EventType.WIDE, label: 'Wide', icon: XCircle },
    { eventType: EventType.SAVED, label: 'Saved', icon: CheckCircle },
    { eventType: EventType.BLOCK, label: 'Block', icon: Shield },
  ],
  turnovers: [
    { eventType: EventType.TURNOVER_WON, label: 'T/O Won', icon: CheckCircle },
    { eventType: EventType.TURNOVER_LOST, label: 'T/O Lost', icon: AlertCircle },
    { eventType: EventType.OUR_UNFORCED_ERROR, label: 'Our UE', icon: XCircle },
    { eventType: EventType.OPP_UNFORCED_ERROR, label: 'Opp UE', icon: CheckCircle },
    { eventType: EventType.INTERCEPTION, label: 'Int', icon: Eye },
  ],
  our_kickouts: [
    { eventType: EventType.OWN_KICKOUT_DUNGLOE_WON, label: 'We Won', icon: CheckCircle },
    { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON, label: 'They Won', icon: XCircle },
    { eventType: EventType.OWN_KICKOUT_DUNGLOE_WON_BREAK, label: 'We Break', icon: Zap },
    { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, label: 'They Break', icon: XCircle },
  ],
  opp_kickouts: [
    { eventType: EventType.OPP_KICKOUT_DUNGLOE_WON, label: 'We Won', icon: CheckCircle },
    { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON, label: 'They Won', icon: XCircle },
    { eventType: EventType.OPP_KICKOUT_DUNGLOE_WON_BREAK, label: 'We Break', icon: Zap },
    { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK, label: 'They Break', icon: XCircle },
  ],
}

const freeKickOptions: ActionButton[] = [
  { eventType: EventType.POINT_FREE, label: 'Point', icon: Target },
  { eventType: EventType.TWO_POINT_FREE, label: '2PT', icon: Target },
  { eventType: EventType.WIDE_FREE, label: 'Wide', icon: XCircle },
]

const fortyFiveOptions: ActionButton[] = [
  { eventType: EventType.FORTY_FIVE, label: 'Scored', icon: CheckCircle },
  { eventType: EventType.FORTY_FIVE_MISSED, label: 'Missed', icon: XCircle },
]

export default function RadialActionWheel({
  onActionSelect,
  onFoulClick,
  on45Click,
  disabled = false,
  currentPossession = PossessionTeam.DUNGLOE,
  isIn2PointZone = false,
  pendingFreeKick = false,
  pendingFoul = null,
  pending45 = false,
  pendingKickoutPosition = false,
  onCancelFree,
  onCancel45,
  onCancelKickout,
  activeCategory: externalCategory,
  onCategoryChange,
  awaitingKickout = false,
}: RadialActionWheelProps) {
  const [internalCategory, setInternalCategory] = useState<CategoryId>('scoring')
  const [showFoulSelection, setShowFoulSelection] = useState(false)

  // Use external category if provided, otherwise internal state
  const activeCategory: CategoryId = (externalCategory as CategoryId) || internalCategory
  const setActiveCategory = (cat: CategoryId) => {
    setInternalCategory(cat)
    onCategoryChange?.(cat)
  }

  const isButtonDisabled = (eventType: EventType): boolean => {
    if (eventType === EventType.TWO_POINT && !isIn2PointZone) return true
    if (eventType === EventType.POINT && isIn2PointZone) return true
    if (eventType === EventType.TWO_POINT_FREE && !isIn2PointZone) return true
    if (eventType === EventType.POINT_FREE && isIn2PointZone) return true

    const hasPossession = currentPossession === PossessionTeam.DUNGLOE
    if (hasPossession) {
      return [EventType.TURNOVER_WON, EventType.OPP_UNFORCED_ERROR, EventType.INTERCEPTION, EventType.BLOCK].includes(eventType)
    } else {
      return [EventType.TURNOVER_LOST, EventType.OUR_UNFORCED_ERROR].includes(eventType)
    }
  }

  // Determine which buttons to show in the outer ring
  let outerButtons: ActionButton[] = []
  let contextLabel = ''
  let showCancel = false
  let onCancel: (() => void) | undefined

  if (pendingKickoutPosition) {
    contextLabel = 'Tap pitch for landing'
    showCancel = true
    onCancel = onCancelKickout
  } else if (pending45) {
    outerButtons = fortyFiveOptions
    contextLabel = '45 — Select Outcome'
    showCancel = true
    onCancel = onCancel45
  } else if (pendingFreeKick) {
    outerButtons = freeKickOptions
    const isDungloeFoul = pendingFoul === 'dungloe'
    contextLabel = isDungloeFoul ? 'Opp Free' : 'Dungloe Free'
    showCancel = true
    onCancel = onCancelFree
  } else if (showFoulSelection) {
    contextLabel = 'Who Fouled?'
    showCancel = true
    onCancel = () => setShowFoulSelection(false)
  } else if (activeCategory === 'foul') {
    contextLabel = 'Foul'
    // Show foul selection automatically
    if (!showFoulSelection) {
      setShowFoulSelection(true)
    }
  } else {
    outerButtons = categoryButtons[activeCategory] || []
    // Add 45 button to scoring
    if (activeCategory === 'scoring' && currentPossession === PossessionTeam.DUNGLOE) {
      outerButtons = [...outerButtons, { eventType: EventType.FORTY_FIVE as EventType, label: '45', icon: Flag }]
    }
    contextLabel = categoryConfig[activeCategory]?.label || ''
  }

  const categoryIds: CategoryId[] = ['scoring', 'turnovers', 'our_kickouts', 'opp_kickouts', 'foul']
  const innerRadius = 55
  const outerRadius = 120

  return (
    <div className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`} style={{ width: 280, height: 280, margin: '0 auto' }}>
      {/* Center hub */}
      <div
        className="absolute rounded-full bg-slate-900/90 border-2 border-white/20 flex flex-col items-center justify-center backdrop-blur-sm z-10"
        style={{
          width: 56,
          height: 56,
          left: '50%',
          top: '50%',
          transform: 'translate(-50%, -50%)',
        }}
      >
        <span className="text-[9px] font-bold text-white/90 text-center leading-tight">{contextLabel}</span>
      </div>

      {/* Cancel button — shown above center when in contextual mode */}
      {showCancel && onCancel && (
        <button
          onClick={onCancel}
          className="absolute z-20 px-2 py-0.5 text-[10px] rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white border border-white/20 transition-all"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50px)',
          }}
        >
          Cancel
        </button>
      )}

      {/* Inner ring — category selectors */}
      {categoryIds.map((catId, i) => {
        const angle = (i * 360) / categoryIds.length - 90 // Start from top
        const rad = (angle * Math.PI) / 180
        const x = Math.cos(rad) * innerRadius
        const y = Math.sin(rad) * innerRadius
        const config = categoryConfig[catId]
        const Icon = config.icon
        const isActive = activeCategory === catId && !pendingFreeKick && !pending45 && !pendingKickoutPosition && !showFoulSelection

        return (
          <button
            key={catId}
            onClick={() => {
              if (catId === 'foul') {
                setShowFoulSelection(true)
                setActiveCategory('foul')
              } else {
                setActiveCategory(catId)
                setShowFoulSelection(false)
              }
            }}
            className={`absolute rounded-full flex items-center justify-center transition-all duration-200 ${
              isActive
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-110'
                : 'bg-slate-800/90 text-white/70 hover:text-white hover:bg-slate-700/90'
            } border border-white/20`}
            style={{
              width: 40,
              height: 40,
              left: `calc(50% + ${x}px)`,
              top: `calc(50% + ${y}px)`,
              transform: 'translate(-50%, -50%)',
            }}
            title={config.label}
          >
            <Icon size={16} />
          </button>
        )
      })}

      {/* Outer ring — action buttons or foul selection */}
      {showFoulSelection ? (
        // Foul team selection
        <>
          {[
            { label: 'Dungloe\nFoul', team: 'dungloe' as const, angle: -45 },
            { label: 'Opp\nFoul', team: 'opponent' as const, angle: 45 },
          ].map((foul) => {
            const rad = ((foul.angle - 90) * Math.PI) / 180
            const x = Math.cos(rad) * outerRadius
            const y = Math.sin(rad) * outerRadius

            return (
              <button
                key={foul.team}
                onClick={() => {
                  setShowFoulSelection(false)
                  setActiveCategory('scoring')
                  onFoulClick?.(foul.team)
                }}
                className={`absolute rounded-xl flex flex-col items-center justify-center transition-all duration-200 border border-white/20 ${
                  foul.team === 'dungloe'
                    ? 'bg-indigo-600/80 hover:bg-indigo-500/80 text-white'
                    : 'bg-violet-600/80 hover:bg-violet-500/80 text-white'
                }`}
                style={{
                  width: 56,
                  height: 48,
                  left: `calc(50% + ${x}px)`,
                  top: `calc(50% + ${y}px)`,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <span className="text-[9px] font-bold leading-tight text-center whitespace-pre-line">{foul.label}</span>
              </button>
            )
          })}
        </>
      ) : (
        // Regular action buttons
        outerButtons.map((button, i) => {
          const count = outerButtons.length
          const spreadAngle = Math.min(360, count * 55) // Spread buttons
          const startAngle = -90 - spreadAngle / 2
          const angle = startAngle + (i * spreadAngle) / Math.max(1, count - 1)
          const rad = (angle * Math.PI) / 180
          const x = Math.cos(rad) * outerRadius
          const y = Math.sin(rad) * outerRadius
          const Icon = button.icon
          const btnDisabled = disabled || isButtonDisabled(button.eventType)

          // Special handling for 45 button
          const is45Button = button.label === '45'
          const handleClick = () => {
            if (is45Button) {
              on45Click?.()
            } else {
              onActionSelect(button.eventType)
            }
          }

          return (
            <button
              key={button.eventType + button.label}
              onClick={handleClick}
              disabled={btnDisabled}
              className={`absolute rounded-xl flex flex-col items-center justify-center transition-all duration-200 border border-white/20 ${
                btnDisabled
                  ? 'bg-slate-800/40 text-white/30 cursor-not-allowed'
                  : 'bg-slate-800/90 text-white hover:bg-indigo-600/80 hover:scale-110 hover:shadow-lg active:scale-95'
              }`}
              style={{
                width: 50,
                height: 44,
                left: `calc(50% + ${x}px)`,
                top: `calc(50% + ${y}px)`,
                transform: 'translate(-50%, -50%)',
                minWidth: 44,
                minHeight: 44,
              }}
              title={button.label}
            >
              <Icon size={14} />
              <span className="text-[8px] font-semibold mt-0.5 leading-tight">{button.label}</span>
            </button>
          )
        })
      )}
    </div>
  )
}
