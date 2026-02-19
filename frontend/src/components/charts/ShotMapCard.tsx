import { useState, useMemo } from 'react'
import { MapPin } from 'lucide-react'
import type { ShotLocation, MatchTrend } from '@/services/api'

interface ShotMapCardProps {
  shotLocations: ShotLocation[]
  matchTrends: MatchTrend[]
}

type ShotType = 'goal' | 'point' | 'two_point' | 'miss'

const SHOT_TYPE_CONFIG: Record<ShotType, { label: string; color: string; match: (s: ShotLocation) => boolean }> = {
  goal: {
    label: 'Goals',
    color: '#f59e0b',
    match: (s) => s.is_score && s.event_type === 'goal',
  },
  point: {
    label: 'Points',
    color: '#10b981',
    match: (s) => s.is_score && ['point', 'point_free', 'forty_five'].includes(s.event_type),
  },
  two_point: {
    label: '2-Ptrs',
    color: '#06b6d4',
    match: (s) => s.is_score && ['two_point', 'two_point_free'].includes(s.event_type),
  },
  miss: {
    label: 'Missed',
    color: '#ef4444',
    match: (s) => !s.is_score,
  },
}

export default function ShotMapCard({ shotLocations, matchTrends }: ShotMapCardProps) {
  const [shotFilter, setShotFilter] = useState<'all' | 'own' | 'opponent'>('own')
  const [shotMatchRange, setShotMatchRange] = useState<'all' | '3' | '5'>('all')
  const [visibleTypes, setVisibleTypes] = useState<Set<ShotType>>(new Set(['goal', 'point', 'two_point', 'miss']))

  const toggleType = (type: ShotType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type) // Don't allow empty
      } else {
        next.add(type)
      }
      return next
    })
  }

  // Filter shots by team
  const teamFilteredShots = shotFilter === 'all'
    ? shotLocations
    : shotLocations.filter(s => s.team === shotFilter)

  // Filter shots by match range
  const hasMatchIds = teamFilteredShots.length > 0 && !!teamFilteredShots[0].match_id
  const recentMatchIds = (() => {
    if (shotMatchRange === 'all' || !hasMatchIds) return null
    const count = parseInt(shotMatchRange)
    if (count >= matchTrends.length) return null
    const recentMatches = matchTrends.slice(0, count)
    return new Set(recentMatches.map(m => m.match_id))
  })()
  const rangeFilteredShots = recentMatchIds
    ? teamFilteredShots.filter(s => recentMatchIds.has(s.match_id))
    : teamFilteredShots

  // Filter by shot type
  const filteredShots = useMemo(() =>
    rangeFilteredShots.filter(s => {
      for (const [type, config] of Object.entries(SHOT_TYPE_CONFIG)) {
        if (visibleTypes.has(type as ShotType) && config.match(s)) return true
      }
      return false
    }),
    [rangeFilteredShots, visibleTypes]
  )

  // How many matches are represented in this view?
  const matchCount = useMemo(() => {
    const ids = new Set(rangeFilteredShots.map(s => s.match_id).filter(Boolean))
    return ids.size
  }, [rangeFilteredShots])

  // Stats from range-filtered (before type filter) for the stat bar
  const totalShots = rangeFilteredShots.length
  const scoredShots = rangeFilteredShots.filter(s => s.is_score)
  const goals = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.goal.match(s))
  const points = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.point.match(s))
  const twoPointers = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.two_point.match(s))
  const accuracy = totalShots > 0 ? Math.round((scoredShots.length / totalShots) * 100) : 0

  // Get color for a shot on the map
  const getShotColor = (shot: ShotLocation): string => {
    for (const config of Object.values(SHOT_TYPE_CONFIG)) {
      if (config.match(shot)) return config.color
    }
    return '#ef4444'
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center space-x-2 text-white">
          <MapPin size={20} className="text-white" />
          <span>Shot Map</span>
        </h3>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {(['own', 'opponent', 'all'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setShotFilter(filter)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  shotFilter === filter
                    ? 'bg-orange-600 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {filter === 'all' ? 'All' : filter === 'own' ? 'Team' : 'Opponent'}
              </button>
            ))}
          </div>
          {hasMatchIds && matchTrends.length > 3 && (
            <div className="flex gap-1">
              {([['all', 'All Matches'], ['5', 'Last 5'], ['3', 'Last 3']] as const).map(([val, label]) => {
                const count = val === 'all' ? Infinity : parseInt(val)
                const disabled = count >= matchTrends.length && val !== 'all'
                return (
                  <button
                    key={val}
                    onClick={() => !disabled && setShotMatchRange(val as 'all' | '3' | '5')}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                      disabled
                        ? 'text-white/20 cursor-default'
                        : shotMatchRange === val
                          ? 'bg-white/20 text-white'
                          : 'text-white/40 hover:text-white/60'
                    }`}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Shot type toggles + match context */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1.5">
          {(Object.entries(SHOT_TYPE_CONFIG) as [ShotType, typeof SHOT_TYPE_CONFIG[ShotType]][]).map(([type, config]) => {
            const active = visibleTypes.has(type)
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-white/30'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full transition-opacity"
                  style={{ backgroundColor: config.color, opacity: active ? 1 : 0.3 }}
                />
                {config.label}
              </button>
            )
          })}
        </div>
        {matchCount > 0 && (
          <span className="text-[10px] text-white/35">
            Across {matchCount} {matchCount === 1 ? 'match' : 'matches'} — updates as season progresses
          </span>
        )}
      </div>

      <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden flex-1 min-h-0" style={{ aspectRatio: '16/10' }}>
        <svg viewBox="0 0 2332 1446" className="w-full h-full">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          {filteredShots.map((shot, idx) => {
            const x = (shot.x / 100) * 1960 + 183
            const y = (shot.y / 100) * 1167 + 123
            const color = getShotColor(shot)
            return (
              <circle key={idx} cx={x} cy={y} r="18" fill={color} stroke="white" strokeWidth="3" opacity="0.85" />
            )
          })}
        </svg>
      </div>

      <div className="grid grid-cols-5 gap-2 mt-4">
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">Total</div>
          <div className="text-xl font-bold text-white">{totalShots}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">Accuracy</div>
          <div className="text-xl font-bold text-emerald-400">{accuracy}%</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">Goals</div>
          <div className="text-xl font-bold text-amber-400">{goals.length}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">Points</div>
          <div className="text-xl font-bold text-emerald-400">{points.length}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">2-Ptrs</div>
          <div className="text-xl font-bold text-cyan-400">{twoPointers.length}</div>
        </div>
      </div>
    </div>
  )
}
