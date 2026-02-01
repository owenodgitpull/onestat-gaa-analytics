import { useState, useEffect } from 'react'
import { EventType, PossessionTeam } from '@/types'
import {
  Target,
  TrendingUp,
  XCircle,
  CheckCircle,
  AlertCircle,
  Zap,
  AlertTriangle,
  Flag,
  Hand,
  MapPin,
} from 'lucide-react'

interface CategorizedActionButtonsProps {
  onActionSelect: (eventType: EventType) => void
  onFoulClick?: (team: 'dungloe' | 'opponent') => void
  on45Click?: () => void
  disabled?: boolean
  activeCategory?: string | null
  onCategoryChange?: (category: string | null) => void
  currentPossession?: PossessionTeam
  isIn2PointZone?: boolean
  pendingFreeKick?: boolean
  pendingFoul?: 'dungloe' | 'opponent' | null  // Track which team fouled
  pending45?: boolean
  pendingKickoutPosition?: boolean  // Waiting for user to click pitch for kickout position
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
}

const categories = [
  {
    id: 'scoring',
    label: 'Shooting',
    icon: Target,
    buttons: [
      { eventType: EventType.GOAL, label: 'Goal', icon: Target },
      { eventType: EventType.POINT, label: 'Point', icon: TrendingUp },
      { eventType: EventType.TWO_POINT, label: '2 Pointer', icon: TrendingUp },
      { eventType: EventType.WIDE, label: 'Wide', icon: XCircle },
      { eventType: EventType.SAVED, label: 'Saved', icon: CheckCircle },
    ]
  },
  {
    id: 'turnovers',
    label: 'Turnovers',
    icon: Zap,
    buttons: [
      { eventType: EventType.TURNOVER_WON, label: 'T/O Won', icon: CheckCircle },
      { eventType: EventType.TURNOVER_LOST, label: 'T/O Lost', icon: AlertCircle },
      { eventType: EventType.OUR_UNFORCED_ERROR, label: 'Our Unforced Error', icon: XCircle },
      { eventType: EventType.OPP_UNFORCED_ERROR, label: 'Opp Unforced Error', icon: CheckCircle },
    ]
  },
  {
    id: 'our_kickouts',
    label: 'Our K/O',
    icon: CheckCircle,
    buttons: [
      { eventType: EventType.OWN_KICKOUT_DUNGLOE_WON, label: 'Dungloe Won', icon: CheckCircle },
      { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON, label: 'Opposition Won', icon: XCircle },
      { eventType: EventType.OWN_KICKOUT_DUNGLOE_WON_BREAK, label: 'Dungloe Won Break', icon: Zap },
      { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, label: 'Opposition Won Break', icon: XCircle },
    ]
  },
  {
    id: 'opp_kickouts',
    label: 'Opp K/O',
    icon: AlertCircle,
    buttons: [
      { eventType: EventType.OPP_KICKOUT_DUNGLOE_WON, label: 'Dungloe Won', icon: CheckCircle },
      { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON, label: 'Opposition Won', icon: XCircle },
      { eventType: EventType.OPP_KICKOUT_DUNGLOE_WON_BREAK, label: 'Dungloe Won Break', icon: Zap },
      { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK, label: 'Opposition Won Break', icon: XCircle },
    ]
  },
]

// Free kick options shown after "Free Won" is clicked
const freeKickOptions = [
  { eventType: EventType.POINT_FREE, label: 'Point (Free)', icon: Target },
  { eventType: EventType.TWO_POINT_FREE, label: '2PT (Free)', icon: Target },
  { eventType: EventType.WIDE_FREE, label: 'Wide (Free)', icon: XCircle },
]

// 45 options - scored or missed
const fortyFiveOptions = [
  { eventType: EventType.FORTY_FIVE, label: '45 Scored', icon: CheckCircle },
  { eventType: EventType.FORTY_FIVE_MISSED, label: '45 Missed', icon: XCircle },
]

export default function CategorizedActionButtons({
  onActionSelect,
  onFoulClick,
  on45Click,
  disabled = false,
  activeCategory: externalActiveCategory,
  onCategoryChange,
  currentPossession = PossessionTeam.DUNGLOE,
  isIn2PointZone = false,
  pendingFreeKick = false,
  pendingFoul = null,
  pending45 = false,
  pendingKickoutPosition = false,
  onCancelFree,
  onCancel45,
  onCancelKickout
}: CategorizedActionButtonsProps) {
  const [internalActiveCategory, setInternalActiveCategory] = useState('scoring')
  const [showFoulSelection, setShowFoulSelection] = useState(false)

  // Use external control if provided (and not null), otherwise use internal state
  const activeCategory = externalActiveCategory === null ? 'scoring' : (externalActiveCategory ?? internalActiveCategory)
  const setActiveCategory = onCategoryChange ?? setInternalActiveCategory

  // Sync internal state when external prop changes
  useEffect(() => {
    if (externalActiveCategory === null) {
      setInternalActiveCategory('scoring')
    } else if (externalActiveCategory) {
      setInternalActiveCategory(externalActiveCategory)
    }
  }, [externalActiveCategory])

  const currentCategory = categories.find(cat => cat.id === activeCategory)

  // Determine if a button should be disabled based on possession
  const isButtonDisabled = (eventType: EventType): boolean => {
    // Disable 2-pointer if not in 2-point zone
    if (eventType === EventType.TWO_POINT && !isIn2PointZone) {
      return true
    }

    // Disable regular point if IN 2-point zone (must use 2-pointer button)
    if (eventType === EventType.POINT && isIn2PointZone) {
      return true
    }

    // For free kicks: disable 2PT free if not in 2-point zone
    if (eventType === EventType.TWO_POINT_FREE && !isIn2PointZone) {
      return true
    }

    // Disable regular point free if IN 2-point zone
    if (eventType === EventType.POINT_FREE && isIn2PointZone) {
      return true
    }

    const hasPossession = currentPossession === PossessionTeam.DUNGLOE

    // If Dungloe has possession, disable these opponent-focused events:
    if (hasPossession) {
      return [
        EventType.TURNOVER_WON,      // Can't win turnover if we have ball
        EventType.OPP_UNFORCED_ERROR // Opponent can't error if we have ball
      ].includes(eventType)
    } else {
      // If opponent has possession, disable these Dungloe-focused events:
      return [
        EventType.TURNOVER_LOST,     // Can't lose turnover if opponent has ball
        EventType.OUR_UNFORCED_ERROR // We can't error if opponent has ball
      ].includes(eventType)
    }
  }

  // Show foul team selection
  if (showFoulSelection) {
    return (
      <div className={`bg-slate-900 backdrop-blur-xl border-2 border-red-500/50 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* Foul Header */}
        <div className="px-3 py-2 bg-gradient-to-r from-red-600/30 to-orange-600/30 border-b border-red-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Hand size={16} className="text-red-400" />
              <span className="text-sm font-semibold text-red-300">Who Committed the Foul?</span>
            </div>
            <button
              onClick={() => setShowFoulSelection(false)}
              className="text-xs text-white/60 hover:text-white px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Foul Team Selection Buttons */}
        <div className="p-3 flex gap-3 justify-center">
          <button
            onClick={() => {
              setShowFoulSelection(false)
              onFoulClick?.('dungloe')
            }}
            disabled={disabled}
            className="flex-1 btn-primary !py-3 !px-4 flex flex-col items-center space-y-1 text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
          >
            <span className="font-bold">Dungloe Foul</span>
            <span className="text-xs opacity-80">Select who fouled</span>
          </button>
          <button
            onClick={() => {
              setShowFoulSelection(false)
              onFoulClick?.('opponent')
            }}
            disabled={disabled}
            className="flex-1 btn-primary !py-3 !px-4 flex flex-col items-center space-y-1 text-sm bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-700 hover:to-rose-700"
          >
            <span className="font-bold">Opp Foul</span>
            <span className="text-xs opacity-80">Dungloe wins free</span>
          </button>
        </div>

        {/* Tip */}
        <div className="px-3 py-2 bg-white/5 border-t border-white/10">
          <p className="text-xs text-white/50 text-center">
            Select which team committed the foul
          </p>
        </div>
      </div>
    )
  }

  // Show kickout position selection prompt
  if (pendingKickoutPosition) {
    return (
      <div className={`bg-slate-900 backdrop-blur-xl border-2 border-emerald-500/50 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* Kickout Position Header */}
        <div className="px-3 py-2 bg-gradient-to-r from-emerald-600/30 to-teal-600/30 border-b border-emerald-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPin size={16} className="text-emerald-400" />
              <span className="text-sm font-semibold text-emerald-300">Select Kickout Position</span>
            </div>
            <button
              onClick={onCancelKickout}
              className="text-xs text-white/60 hover:text-white px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Instruction */}
        <div className="p-4 flex items-center justify-center space-x-3">
          <MapPin size={20} className="text-emerald-400 animate-pulse" />
          <p className="text-white font-medium">
            Click on pitch where kickout was won
          </p>
        </div>

        {/* Tip */}
        <div className="px-3 py-2 bg-white/5 border-t border-white/10">
          <p className="text-xs text-white/50 text-center">
            Tap the location on the pitch to record where the ball was contested
          </p>
        </div>
      </div>
    )
  }

  // Show 45 options menu
  if (pending45) {
    return (
      <div className={`bg-slate-900 backdrop-blur-xl border-2 border-blue-500/50 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* 45 Header */}
        <div className="px-3 py-2 bg-gradient-to-r from-blue-600/30 to-indigo-600/30 border-b border-blue-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Flag size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-blue-300">45 - Select Outcome</span>
            </div>
            <button
              onClick={onCancel45}
              className="text-xs text-white/60 hover:text-white px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* 45 Action Buttons */}
        <div className="p-2 flex flex-wrap gap-1.5 justify-center min-h-[48px]">
          {fortyFiveOptions.map((button) => {
            const Icon = button.icon
            const isScored = button.eventType === EventType.FORTY_FIVE

            return (
              <button
                key={button.label}
                onClick={() => onActionSelect(button.eventType)}
                disabled={disabled}
                className={`btn-primary !py-1.5 !px-4 flex items-center space-x-1.5 text-xs ${
                  isScored
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700'
                    : 'bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700'
                }`}
              >
                <Icon size={14} />
                <span>{button.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tip */}
        <div className="px-3 py-2 bg-white/5 border-t border-white/10">
          <p className="text-xs text-white/50 text-center">
            Ball went wide off defender - 45m free awarded
          </p>
        </div>
      </div>
    )
  }

  // Show free kick options menu
  if (pendingFreeKick) {
    const isDungloeFoul = pendingFoul === 'dungloe'
    const headerText = isDungloeFoul
      ? 'Opponent Free - Select Outcome'
      : 'Dungloe Free - Select Outcome'
    const tipText = isDungloeFoul
      ? 'Record what opponent did with the free kick'
      : 'Move the ball to play a short free (menu will close)'

    return (
      <div className={`bg-slate-900 backdrop-blur-xl border-2 border-amber-500/50 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        {/* Free Kick Header */}
        <div className="px-3 py-2 bg-gradient-to-r from-amber-600/30 to-orange-600/30 border-b border-amber-500/30">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle size={16} className="text-amber-400" />
              <span className="text-sm font-semibold text-amber-300">{headerText}</span>
            </div>
            <button
              onClick={onCancelFree}
              className="text-xs text-white/60 hover:text-white px-2 py-1 rounded bg-white/10 hover:bg-white/20 transition-all"
            >
              Cancel
            </button>
          </div>
        </div>

        {/* Free Kick Action Buttons */}
        <div className="p-2 flex flex-wrap gap-1.5 justify-center min-h-[48px]">
          {freeKickOptions.map((button) => {
            const Icon = button.icon
            const isContextDisabled = isButtonDisabled(button.eventType)
            const isDisabled = disabled || isContextDisabled

            return (
              <button
                key={button.eventType}
                onClick={() => onActionSelect(button.eventType)}
                disabled={isDisabled}
                title={isContextDisabled ? 'Not applicable from this position' : ''}
                className={`btn-primary !py-1.5 !px-3 flex items-center space-x-1.5 text-xs ${
                  isDisabled ? 'opacity-30 cursor-not-allowed' : ''
                }`}
              >
                <Icon size={14} />
                <span>{button.label}</span>
              </button>
            )
          })}
        </div>

        {/* Tip */}
        <div className="px-3 py-2 bg-white/5 border-t border-white/10">
          <p className="text-xs text-white/50 text-center">
            {tipText}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`bg-slate-900 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Action Buttons */}
      <div className="p-2 flex flex-wrap gap-1.5 justify-center min-h-[48px]">
        {currentCategory?.buttons.map((button) => {
          const Icon = button.icon
          const isContextDisabled = isButtonDisabled(button.eventType)
          const isDisabled = disabled || isContextDisabled

          return (
            <button
              key={button.eventType}
              onClick={() => onActionSelect(button.eventType)}
              disabled={isDisabled}
              title={isContextDisabled ? 'Not applicable with current possession' : ''}
              className={`btn-primary !py-1.5 !px-3 flex items-center space-x-1.5 text-xs ${
                isDisabled ? 'opacity-30 cursor-not-allowed' : ''
              }`}
            >
              <Icon size={14} />
              <span>{button.label}</span>
            </button>
          )
        })}

        {/* 45 button - shown in scoring category when Dungloe has possession (like Wide but off defender) */}
        {activeCategory === 'scoring' && currentPossession === PossessionTeam.DUNGLOE && (
          <button
            onClick={on45Click}
            disabled={disabled}
            className="btn-primary !py-1.5 !px-3 flex items-center space-x-1.5 text-xs bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            <Flag size={14} />
            <span>45</span>
          </button>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex border-t border-white/10 bg-slate-900/80">
        {categories.map((category) => {
          const Icon = category.icon
          const isActive = activeCategory === category.id

          return (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              className={`flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 transition-all duration-200 ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={16} />
              <span className="text-[10px] font-medium">{category.label}</span>
            </button>
          )
        })}

        {/* Foul - category level button */}
        <button
          onClick={() => setShowFoulSelection(true)}
          disabled={disabled}
          className="flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 transition-all duration-200 text-white/60 hover:text-white hover:bg-white/5"
        >
          <Hand size={16} />
          <span className="text-[10px] font-medium">Foul</span>
        </button>
      </div>
    </div>
  )
}
