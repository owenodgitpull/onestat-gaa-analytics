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
  Shield,
  Eye,
  Crosshair,
  ArrowLeftRight,
} from 'lucide-react'

interface CategorizedActionButtonsProps {
  onActionSelect: (eventType: EventType) => void
  onFoulClick?: (team: 'own' | 'opponent') => void
  on45Click?: () => void
  onDiscipline?: (eventType: EventType) => void
  disabled?: boolean
  activeCategory?: string | null
  onCategoryChange?: (category: string | null) => void
  currentPossession?: PossessionTeam
  isIn2PointZone?: boolean
  pendingFreeKick?: boolean
  pendingFoul?: 'own' | 'opponent' | null  // Track which team fouled
  pending45?: boolean
  pendingKickoutPosition?: boolean  // Waiting for user to click pitch for kickout position
  awaitingKickout?: boolean  // Score just happened, kickout expected next
  isInPenaltyArea?: boolean  // Ball is near opponent's goal (inside 13m line)
  onCancelFree?: () => void
  onCancel45?: () => void
  onCancelKickout?: () => void
  compact?: boolean  // Phone landscape: single-row layout
}

const categories = [
  {
    id: 'scoring',
    label: 'Shooting',
    icon: Target,
    buttons: [
      { eventType: EventType.GOAL, label: 'Goal', icon: Target },
      { eventType: EventType.POINT, label: 'Point', icon: TrendingUp },
      { eventType: EventType.TWO_POINT, label: '2 PT', icon: TrendingUp },
      { eventType: EventType.WIDE, label: 'Wide', icon: XCircle },
      { eventType: EventType.SAVED, label: 'Saved', icon: CheckCircle },
      { eventType: EventType.BLOCK, label: 'Blocked', icon: Shield },
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
      { eventType: EventType.INTERCEPTION, label: 'Interception', icon: Eye },
    ]
  },
  {
    id: 'our_kickouts',
    label: 'Our K/O',
    icon: CheckCircle,
    buttons: [
      { eventType: EventType.OWN_KICKOUT_WON, label: 'We Won', icon: CheckCircle },
      { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON, label: 'Opposition Won', icon: XCircle },
      { eventType: EventType.OWN_KICKOUT_WON_BREAK, label: 'We Won Break', icon: Zap },
      { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK, label: 'Opposition Won Break', icon: XCircle },
    ]
  },
  {
    id: 'opp_kickouts',
    label: 'Opp K/O',
    icon: AlertCircle,
    buttons: [
      { eventType: EventType.OPP_KICKOUT_WON, label: 'We Won', icon: CheckCircle },
      { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON, label: 'Opposition Won', icon: XCircle },
      { eventType: EventType.OPP_KICKOUT_WON_BREAK, label: 'We Won Break', icon: Zap },
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
  onDiscipline,
  disabled = false,
  activeCategory: externalActiveCategory,
  onCategoryChange,
  currentPossession = PossessionTeam.OWN,
  isIn2PointZone = false,
  pendingFreeKick = false,
  pendingFoul = null,
  pending45 = false,
  pendingKickoutPosition = false,
  awaitingKickout = false,
  isInPenaltyArea: _isInPenaltyArea = false,
  onCancelFree,
  onCancel45,
  onCancelKickout,
  compact = false
}: CategorizedActionButtonsProps) {
  const [internalActiveCategory, setInternalActiveCategory] = useState('scoring')
  const [showFoulSelection, setShowFoulSelection] = useState(false)
  const [showPenOptions, setShowPenOptions] = useState(false)

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

  // Reset pen options when leaving scoring category
  useEffect(() => {
    if (activeCategory !== 'scoring') setShowPenOptions(false)
  }, [activeCategory])

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

    const hasPossession = currentPossession === PossessionTeam.OWN

    // If our team has possession, disable these opponent-focused events:
    if (hasPossession) {
      return [
        EventType.TURNOVER_WON,      // Can't win turnover if we have ball
        EventType.OPP_UNFORCED_ERROR, // Opponent can't error if we have ball
        // INTERCEPTION + BLOCK stay enabled — opponent can intercept/block our pass/shot
      ].includes(eventType)
    } else {
      // If opponent has possession, disable these own-team-focused events:
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
              onFoulClick?.('own')
            }}
            disabled={disabled}
            className="flex-1 btn-primary !py-3 !px-4 flex flex-col items-center space-y-1 text-sm bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500"
          >
            <span className="font-bold">Our Foul</span>
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
            <span className="text-xs opacity-80">We win free</span>
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
        <div className="px-3 py-2 bg-gradient-to-r from-emerald-600/30 to-cyan-600/30 border-b border-emerald-500/30">
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
        <div className="px-3 py-2 bg-gradient-to-r from-blue-600/30 to-emerald-600/30 border-b border-blue-500/30">
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
                    ? 'bg-gradient-to-r from-emerald-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500'
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
    const isOwnFoul = pendingFoul === 'own'
    const headerText = isOwnFoul
      ? 'Opponent Free - Select Outcome'
      : 'Our Free - Select Outcome'

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
          {/* Short pass — just clears free kick state, play continues */}
          <button
            onClick={onCancelFree}
            disabled={disabled}
            className="btn-primary !py-1.5 !px-3 flex items-center space-x-1.5 text-xs bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500"
          >
            <ArrowLeftRight size={14} />
            <span>Short Pass</span>
          </button>
        </div>
      </div>
    )
  }

  // Compact mode: single-row layout for phone landscape
  if (compact) {
    return (
      <div data-tour="action-category-tabs" className={`bg-slate-900 backdrop-blur-xl border border-white/20 rounded-lg shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
        <div className="flex items-stretch">
          {/* Category tabs — left side, narrow */}
          <div className="flex flex-col border-r border-white/10 bg-slate-900/80">
            {categories.map((category) => {
              const Icon = category.icon
              const isActive = activeCategory === category.id
              const isKickoutTab = category.id === 'our_kickouts' || category.id === 'opp_kickouts'
              const shouldPulse = isKickoutTab && awaitingKickout && !isActive

              return (
                <button
                  key={category.id}
                  onClick={() => setActiveCategory(category.id)}
                  className={`px-2 py-1 flex items-center gap-1 transition-all duration-200 text-[9px] font-medium whitespace-nowrap ${
                    isActive
                      ? 'bg-emerald-600 text-white'
                      : shouldPulse
                        ? 'bg-amber-500/20 text-amber-300 animate-pulse'
                        : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <Icon size={11} />
                  <span>{category.label}</span>
                </button>
              )
            })}
            <button
              onClick={() => setShowFoulSelection(true)}
              disabled={disabled}
              className="px-2 py-1 flex items-center gap-1 transition-all text-[9px] font-medium text-white/60 hover:text-white hover:bg-white/5"
            >
              <Hand size={11} />
              <span>Foul</span>
            </button>
          </div>

          {/* Action buttons — center, scrollable */}
          <div className="flex-1 flex flex-wrap gap-1 p-1.5 items-center justify-center overflow-x-auto">
            {currentCategory?.buttons.map((button) => {
              const Icon = button.icon
              const isContextDisabled = isButtonDisabled(button.eventType)
              const isDisabled = disabled || isContextDisabled
              return (
                <button
                  key={button.eventType}
                  onClick={() => onActionSelect(button.eventType)}
                  disabled={isDisabled}
                  className={`btn-primary !py-1 !px-2 flex items-center space-x-1 text-[10px] flex-shrink-0 ${
                    isDisabled ? 'opacity-30 cursor-not-allowed' : ''
                  }`}
                >
                  <Icon size={11} />
                  <span>{button.label}</span>
                </button>
              )
            })}
            {activeCategory === 'scoring' && currentPossession === PossessionTeam.OWN && on45Click && (
              <button onClick={on45Click} disabled={disabled}
                className="btn-primary !py-1 !px-2 flex items-center space-x-1 text-[10px] flex-shrink-0 bg-gradient-to-r from-blue-600 to-emerald-600">
                <Flag size={11} /><span>45</span>
              </button>
            )}
            {activeCategory === 'scoring' && !showPenOptions && (
              <button onClick={() => setShowPenOptions(true)} disabled={disabled}
                className="btn-primary !py-1 !px-2 flex items-center space-x-1 text-[10px] flex-shrink-0">
                <Crosshair size={11} /><span>Pen</span>
              </button>
            )}
            {activeCategory === 'scoring' && showPenOptions && (
              <>
                <button onClick={() => { onActionSelect(EventType.PENALTY_GOAL); setShowPenOptions(false) }} disabled={disabled}
                  className="btn-primary !py-1 !px-2 flex items-center space-x-1 text-[10px] flex-shrink-0">
                  <Crosshair size={11} /><span>Pen Goal</span>
                </button>
                <button onClick={() => { onActionSelect(EventType.PENALTY_MISS); setShowPenOptions(false) }} disabled={disabled}
                  className="btn-primary !py-1 !px-2 flex items-center space-x-1 text-[10px] flex-shrink-0">
                  <Crosshair size={11} /><span>Pen Miss</span>
                </button>
              </>
            )}
          </div>

          {/* Discipline cards — right side */}
          <div className="flex flex-col items-center justify-center gap-0.5 px-1 border-l border-white/10">
            <button onClick={() => onDiscipline?.(EventType.YELLOW_CARD)} disabled={disabled}
              className="p-1 rounded hover:bg-yellow-500/20 disabled:opacity-30 transition-all active:scale-90" title="Yellow Card">
              <div className="w-3 h-4 rounded-[2px] bg-yellow-400 border border-yellow-500/50" />
            </button>
            <button onClick={() => onDiscipline?.(EventType.BLACK_CARD)} disabled={disabled}
              className="p-1 rounded hover:bg-slate-500/20 disabled:opacity-30 transition-all active:scale-90" title="Black Card">
              <div className="w-3 h-4 rounded-[2px] bg-slate-800 border border-slate-400/50" />
            </button>
            <button onClick={() => onDiscipline?.(EventType.RED_CARD)} disabled={disabled}
              className="p-1 rounded hover:bg-red-500/20 disabled:opacity-30 transition-all active:scale-90" title="Red Card">
              <div className="w-3 h-4 rounded-[2px] bg-red-500 border border-red-600/50" />
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div data-tour="action-category-tabs" className={`bg-slate-900 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Action Buttons */}
      <div data-tour="scoring-buttons" className="p-2 flex flex-nowrap gap-1 justify-center min-h-[48px] overflow-x-auto">
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
              className={`btn-primary !py-1.5 !px-2.5 flex items-center space-x-1 text-xs flex-shrink-0 ${
                isDisabled ? 'opacity-30 cursor-not-allowed' : ''
              }`}
            >
              <Icon size={13} />
              <span>{button.label}</span>
            </button>
          )
        })}

        {/* 45 button - inline with scoring buttons when our team has possession */}
        {activeCategory === 'scoring' && currentPossession === PossessionTeam.OWN && on45Click && (
          <button
            onClick={on45Click}
            disabled={disabled}
            className="btn-primary !py-1.5 !px-2.5 flex items-center space-x-1 text-xs flex-shrink-0 bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-700 hover:to-emerald-700"
          >
            <Flag size={13} />
            <span>45</span>
          </button>
        )}

        {/* Penalty button - inline with scoring, expands to Goal/Miss options */}
        {activeCategory === 'scoring' && !showPenOptions && (
          <button
            onClick={() => setShowPenOptions(true)}
            disabled={disabled}
            className="btn-primary !py-1.5 !px-2.5 flex items-center space-x-1 text-xs flex-shrink-0"
          >
            <Crosshair size={13} />
            <span>Pen</span>
          </button>
        )}
        {activeCategory === 'scoring' && showPenOptions && (
          <>
            <button
              onClick={() => { onActionSelect(EventType.PENALTY_GOAL); setShowPenOptions(false) }}
              disabled={disabled}
              className="btn-primary !py-1.5 !px-2.5 flex items-center space-x-1 text-xs flex-shrink-0"
            >
              <Crosshair size={13} />
              <span>Pen Goal</span>
            </button>
            <button
              onClick={() => { onActionSelect(EventType.PENALTY_MISS); setShowPenOptions(false) }}
              disabled={disabled}
              className="btn-primary !py-1.5 !px-2.5 flex items-center space-x-1 text-xs flex-shrink-0"
            >
              <Crosshair size={13} />
              <span>Pen Miss</span>
            </button>
          </>
        )}
      </div>

      {/* Category Tabs + Discipline */}
      <div className="flex border-t border-white/10 bg-slate-900/80">
        {categories.map((category) => {
          const Icon = category.icon
          const isActive = activeCategory === category.id
          const isKickoutTab = category.id === 'our_kickouts' || category.id === 'opp_kickouts'
          const shouldPulse = isKickoutTab && awaitingKickout && !isActive

          return (
            <button
              key={category.id}
              onClick={() => setActiveCategory(category.id)}
              {...(category.id === 'turnovers' ? { 'data-tour': 'turnovers-tab' } : {})}
              className={`flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 transition-all duration-200 ${
                isActive
                  ? 'bg-emerald-600 text-white'
                  : shouldPulse
                    ? 'bg-amber-500/20 text-amber-300 animate-pulse border-t-2 border-amber-400'
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
          data-tour="fouls-tab"
          onClick={() => setShowFoulSelection(true)}
          disabled={disabled}
          className="flex-1 flex flex-col items-center justify-center py-2 space-y-0.5 transition-all duration-200 text-white/60 hover:text-white hover:bg-white/5"
        >
          <Hand size={16} />
          <span className="text-[10px] font-medium">Foul</span>
        </button>

        {/* Discipline cards */}
        <div data-tour="discipline-cards" className="flex items-center gap-0.5 px-1 border-l border-white/10">
          <button
            onClick={() => onDiscipline?.(EventType.YELLOW_CARD)}
            disabled={disabled}
            className="p-1.5 rounded-lg hover:bg-yellow-500/20 disabled:opacity-30 transition-all active:scale-90"
            title="Yellow Card"
          >
            <div className="w-3.5 h-5 rounded-[2px] bg-yellow-400 border border-yellow-500/50" />
          </button>
          <button
            onClick={() => onDiscipline?.(EventType.BLACK_CARD)}
            disabled={disabled}
            className="p-1.5 rounded-lg hover:bg-slate-500/20 disabled:opacity-30 transition-all active:scale-90"
            title="Black Card (10 min sin bin)"
          >
            <div className="w-3.5 h-5 rounded-[2px] bg-slate-800 border border-slate-400/50" />
          </button>
          <button
            onClick={() => onDiscipline?.(EventType.RED_CARD)}
            disabled={disabled}
            className="p-1.5 rounded-lg hover:bg-red-500/20 disabled:opacity-30 transition-all active:scale-90"
            title="Red Card"
          >
            <div className="w-3.5 h-5 rounded-[2px] bg-red-500 border border-red-600/50" />
          </button>
        </div>
      </div>
    </div>
  )
}
