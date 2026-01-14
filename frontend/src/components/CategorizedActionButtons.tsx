import { useState, useEffect } from 'react'
import { EventType, PossessionTeam } from '@/types'
import { 
  Target, 
  TrendingUp, 
  XCircle,
  CheckCircle,
  AlertCircle,
  Zap,
} from 'lucide-react'

interface CategorizedActionButtonsProps {
  onActionSelect: (eventType: EventType) => void
  disabled?: boolean
  activeCategory?: string
  onCategoryChange?: (category: string) => void
  currentPossession?: PossessionTeam
}

interface ActionButton {
  eventType: EventType
  label: string
  icon: typeof Target
}

const categories = [
  {
    id: 'scoring',
    label: 'Scoring',
    icon: Target,
    buttons: [
      { eventType: EventType.GOAL, label: 'Goal', icon: Target },
      { eventType: EventType.POINT, label: 'Point', icon: TrendingUp },
      { eventType: EventType.WIDE, label: 'Wide', icon: XCircle },
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
      { eventType: EventType.OWN_KICKOUT_WON, label: 'K/O Won', icon: CheckCircle },
      { eventType: EventType.OWN_KICKOUT_LOST, label: 'K/O Lost', icon: XCircle },
      { eventType: EventType.OWN_KICKOUT_BREAK_WON, label: 'Break Won', icon: Zap },
      { eventType: EventType.OWN_KICKOUT_BREAK_LOST, label: 'Break Lost', icon: XCircle },
    ]
  },
  {
    id: 'opp_kickouts',
    label: 'Opp K/O',
    icon: AlertCircle,
    buttons: [
      { eventType: EventType.OPP_KICKOUT_WON, label: 'K/O Won', icon: CheckCircle },
      { eventType: EventType.OPP_KICKOUT_LOST, label: 'K/O Lost', icon: XCircle },
      { eventType: EventType.OPP_KICKOUT_BREAK_WON, label: 'Break Won', icon: Zap },
      { eventType: EventType.OPP_KICKOUT_BREAK_LOST, label: 'Break Lost', icon: XCircle },
    ]
  },
]

export default function CategorizedActionButtons({ 
  onActionSelect, 
  disabled = false,
  activeCategory: externalActiveCategory,
  onCategoryChange,
  currentPossession = PossessionTeam.DUNGLOE
}: CategorizedActionButtonsProps) {
  const [internalActiveCategory, setInternalActiveCategory] = useState('scoring')
  
  // Use external control if provided, otherwise use internal state
  const activeCategory = externalActiveCategory ?? internalActiveCategory
  const setActiveCategory = onCategoryChange ?? setInternalActiveCategory
  
  // Sync internal state when external prop changes
  useEffect(() => {
    if (externalActiveCategory) {
      setInternalActiveCategory(externalActiveCategory)
    }
  }, [externalActiveCategory])

  const currentCategory = categories.find(cat => cat.id === activeCategory)
  
  // Determine if a button should be disabled based on possession
  const isButtonDisabled = (eventType: EventType): boolean => {
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

  return (
    <div className={`bg-slate-900 backdrop-blur-xl border border-white/20 rounded-xl shadow-2xl overflow-hidden ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
      {/* Action Buttons - Smaller */}
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
      </div>

      {/* Category Tabs - Smaller */}
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
      </div>
    </div>
  )
}

