/**
 * Event Filter Toggles for Match Result view
 * Allows filtering which events are displayed on the pitch
 */

interface FilterCategory {
  id: string
  label: string
  eventTypes: string[] | null  // null means "all"
  color: string
}

const filterCategories: FilterCategory[] = [
  { id: 'all', label: 'All', eventTypes: null, color: 'primary' },
  {
    id: 'shots',
    label: 'Shots',
    eventTypes: ['goal', 'point', 'two_point', 'wide', 'saved', 'short', 'hit_post', 'point_free', 'two_point_free', 'wide_free'],
    color: 'amber'
  },
  { id: 'goals', label: 'Goals', eventTypes: ['goal'], color: 'emerald' },
  { id: 'points', label: 'Pts', eventTypes: ['point', 'point_free'], color: 'blue' },
  { id: 'two_pointers', label: '2pt', eventTypes: ['two_point', 'two_point_free'], color: 'teal' },
  { id: 'wides', label: 'Wides', eventTypes: ['wide', 'wide_free', 'short'], color: 'red' },
  {
    id: 'turnovers',
    label: 'T/O',
    eventTypes: ['turnover_won', 'turnover_lost', 'our_unforced_error', 'opp_unforced_error'],
    color: 'orange'
  },
  {
    id: 'kickouts',
    label: 'K/O',
    eventTypes: [
      'kickout_won', 'kickout_lost', 'breaking_ball_won', 'breaking_ball_lost',
      'own_kickout_won', 'own_kickout_opposition_won',
      'own_kickout_won_break', 'own_kickout_opposition_won_break',
      'opp_kickout_won', 'opp_kickout_opposition_won',
      'opp_kickout_won_break', 'opp_kickout_opposition_won_break',
      'own_kickout_sideline', 'opp_kickout_sideline',
    ],
    color: 'cyan'
  },
  {
    id: 'defence',
    label: 'Defence',
    eventTypes: ['block', 'interception', 'tackle_won'],
    color: 'violet'
  },
  {
    id: 'fouls',
    label: 'Fouls',
    eventTypes: ['foul_won', 'foul_committed'],
    color: 'pink'
  },
  {
    id: 'forty_fives',
    label: '45s',
    eventTypes: ['forty_five', 'forty_five_missed'],
    color: 'violet'
  },
]

// Color mapping for dynamic classes
const colorClasses: Record<string, { active: string; inactive: string }> = {
  primary: { active: 'bg-orange-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  amber: { active: 'bg-amber-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  emerald: { active: 'bg-emerald-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  blue: { active: 'bg-blue-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  teal: { active: 'bg-teal-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  red: { active: 'bg-red-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  orange: { active: 'bg-orange-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  cyan: { active: 'bg-cyan-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  pink: { active: 'bg-pink-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  violet: { active: 'bg-violet-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
}

interface EventFilterTogglesProps {
  activeFilters: Set<string>
  onToggle: (filters: Set<string>) => void
}

export default function EventFilterToggles({ activeFilters, onToggle }: EventFilterTogglesProps) {
  const handleToggle = (filterId: string) => {
    const newFilters = new Set(activeFilters)

    if (filterId === 'all') {
      // Reset to show all
      newFilters.clear()
      newFilters.add('all')
    } else {
      // Remove 'all' if selecting specific filter
      newFilters.delete('all')

      if (newFilters.has(filterId)) {
        newFilters.delete(filterId)
      } else {
        newFilters.add(filterId)
      }

      // If nothing selected, default to all
      if (newFilters.size === 0) {
        newFilters.add('all')
      }
    }

    onToggle(newFilters)
  }

  return (
    <div className="glass-card p-4">
      <div className="flex flex-wrap gap-2 justify-center">
        {filterCategories.map((cat) => {
          const isActive = activeFilters.has(cat.id)
          const classes = colorClasses[cat.color]

          return (
            <button
              key={cat.id}
              onClick={() => handleToggle(cat.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                isActive ? classes.active : classes.inactive
              }`}
            >
              {cat.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

const LEGEND_ITEMS = [
  { color: '#10b981', label: 'Own score' },
  { color: '#ef4444', label: 'Opp goal' },
  { color: '#f97316', label: 'Opp point' },
  { color: '#eab308', label: 'Opp 2pt' },
  { color: '#fbbf24', label: 'Wide' },
  { color: '#94a3b8', label: 'Saved / Short' },
  { color: '#06b6d4', label: 'KO won' },
  { color: '#f43f5e', label: 'KO lost' },
  { color: '#3b82f6', label: 'Turnover won' },
  { color: '#ec4899', label: 'Turnover lost' },
  { color: '#a78bfa', label: 'Block / Tackle' },
]

export function EventMapLegend() {
  return (
    <div className="glass-card px-3 py-2">
      <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center">
        {LEGEND_ITEMS.map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-white/55">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Get event types for active filters
 * Used to filter events for pitch display
 */
export function getEventTypesForFilters(activeFilters: Set<string>): string[] | null {
  if (activeFilters.has('all')) {
    return null  // Show all events
  }

  const eventTypes: string[] = []

  for (const filterId of activeFilters) {
    const category = filterCategories.find((c) => c.id === filterId)
    if (category?.eventTypes) {
      eventTypes.push(...category.eventTypes)
    }
  }

  return eventTypes.length > 0 ? eventTypes : null
}
