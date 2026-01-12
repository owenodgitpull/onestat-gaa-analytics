import { useState } from 'react'
import { EventType } from '@/types'
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

export default function CategorizedActionButtons({ onActionSelect }: CategorizedActionButtonsProps) {
  const [activeCategory, setActiveCategory] = useState('scoring')

  const currentCategory = categories.find(cat => cat.id === activeCategory)

  return (
    <div className="bg-slate-900 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
      {/* Action Buttons */}
      <div className="p-3 flex flex-wrap gap-2 justify-center min-h-[60px]">
        {currentCategory?.buttons.map((button) => {
          const Icon = button.icon
          return (
            <button
              key={button.eventType}
              onClick={() => onActionSelect(button.eventType)}
              className="btn-primary !py-2 !px-4 flex items-center space-x-2 text-sm"
            >
              <Icon size={16} />
              <span>{button.label}</span>
            </button>
          )
        })}
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
              className={`flex-1 flex flex-col items-center justify-center py-3 space-y-1 transition-all duration-200 ${
                isActive 
                  ? 'bg-indigo-600 text-white' 
                  : 'text-white/60 hover:text-white hover:bg-white/5'
              }`}
            >
              <Icon size={20} />
              <span className="text-xs font-medium">{category.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

