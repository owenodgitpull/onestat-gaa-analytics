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
  { id: 'all', label: 'All Events', eventTypes: null, color: 'indigo' },
  {
    id: 'shots',
    label: 'Shots',
    eventTypes: ['goal', 'point', 'two_point', 'wide', 'saved', 'short', 'point_free', 'two_point_free', 'wide_free'],
    color: 'amber'
  },
  { id: 'goals', label: 'Goals', eventTypes: ['goal'], color: 'emerald' },
  { id: 'points', label: 'Points', eventTypes: ['point', 'point_free'], color: 'blue' },
  { id: 'two_pointers', label: '2-Pointers', eventTypes: ['two_point', 'two_point_free'], color: 'purple' },
  { id: 'wides', label: 'Wides', eventTypes: ['wide', 'wide_free', 'short'], color: 'red' },
  {
    id: 'turnovers',
    label: 'Turnovers',
    eventTypes: ['turnover_won', 'turnover_lost', 'our_unforced_error', 'opp_unforced_error'],
    color: 'orange'
  },
  {
    id: 'kickouts',
    label: 'Kickouts',
    eventTypes: ['kickout_won', 'kickout_lost', 'kickout_won_clean', 'kickout_lost_break'],
    color: 'cyan'
  },
]

// Color mapping for dynamic classes
const colorClasses: Record<string, { active: string; inactive: string }> = {
  indigo: { active: 'bg-indigo-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  amber: { active: 'bg-amber-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  emerald: { active: 'bg-emerald-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  blue: { active: 'bg-blue-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  purple: { active: 'bg-purple-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  red: { active: 'bg-red-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  orange: { active: 'bg-orange-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
  cyan: { active: 'bg-cyan-600 text-white', inactive: 'bg-white/10 text-white/60 hover:bg-white/20' },
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
              className={`px-4 py-2 rounded-xl font-medium transition-all ${
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
