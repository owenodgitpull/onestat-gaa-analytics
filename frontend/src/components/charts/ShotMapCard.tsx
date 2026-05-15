import { useState, useMemo, useRef } from 'react'
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
    label: 'Off Target',
    color: '#ef4444',
    match: (s) => !s.is_score,
  },
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  goal: 'Goal',
  point: 'Point',
  point_free: 'Point (Free)',
  forty_five: "45'",
  two_point: '2-Pointer',
  two_point_free: '2-Pointer (Free)',
  wide: 'Wide',
  wide_free: 'Wide (Free)',
  saved: 'Saved',
  saved_goal: 'Goal Saved',
  short: 'Dropped Short',
  forty_five_missed: "45' Missed",
  penalty_saved: 'Penalty Saved',
  penalty_missed: 'Penalty Missed',
}

function getEventLabel(event_type: string): string {
  return EVENT_TYPE_LABELS[event_type] ?? event_type.replace(/_/g, ' ')
}

interface TooltipState {
  shot: ShotLocation
  x: number
  y: number
}

export default function ShotMapCard({ shotLocations, matchTrends }: ShotMapCardProps) {
  const [shotFilter, setShotFilter] = useState<'all' | 'own' | 'opponent'>('own')
  const [shotMatchRange, setShotMatchRange] = useState<'all' | '3' | '5'>('all')
  const [visibleTypes, setVisibleTypes] = useState<Set<ShotType>>(new Set(['goal', 'point', 'two_point', 'miss']))
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggleType = (type: ShotType) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        if (next.size > 1) next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }

  const teamFilteredShots = shotFilter === 'all'
    ? shotLocations
    : shotLocations.filter(s => s.team === shotFilter)

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

  const filteredShots = useMemo(() =>
    rangeFilteredShots.filter(s => {
      for (const [type, config] of Object.entries(SHOT_TYPE_CONFIG)) {
        if (visibleTypes.has(type as ShotType) && config.match(s)) return true
      }
      return false
    }),
    [rangeFilteredShots, visibleTypes]
  )

  const totalShots = rangeFilteredShots.length
  const scoredShots = rangeFilteredShots.filter(s => s.is_score)
  const goals = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.goal.match(s))
  const points = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.point.match(s))
  const twoPointers = rangeFilteredShots.filter(s => SHOT_TYPE_CONFIG.two_point.match(s))
  const accuracy = totalShots > 0 ? Math.round((scoredShots.length / totalShots) * 100) : 0

  const getShotColor = (shot: ShotLocation): string => {
    for (const config of Object.values(SHOT_TYPE_CONFIG)) {
      if (config.match(shot)) return config.color
    }
    return '#ef4444'
  }

  const showTooltip = (shot: ShotLocation, e: React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    let clientX: number, clientY: number
    if ('touches' in e) {
      clientX = e.touches[0].clientX
      clientY = e.touches[0].clientY
    } else {
      clientX = e.clientX
      clientY = e.clientY
    }
    setTooltip({ shot, x: clientX - rect.left, y: clientY - rect.top })
  }

  const hideTooltip = () => setTooltip(null)

  if (shotLocations.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-4">
          <MapPin size={18} className="text-white" />
          <h3 className="text-lg font-bold text-white">Shot Map</h3>
        </div>
        <div className="flex-1 flex items-center justify-center text-white/40 text-sm">
          No shot data recorded yet
        </div>
      </div>
    )
  }

  return (
    <div className="glass-card p-4 sm:p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-bold flex items-center gap-2 text-white shrink-0">
          <MapPin size={18} className="text-white" />
          Shot Map
        </h3>
        <div className="flex gap-1">
          {(['own', 'opponent', 'all'] as const).map(filter => (
            <button
              key={filter}
              onClick={() => setShotFilter(filter)}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all ${
                shotFilter === filter
                  ? 'bg-orange-600 text-white'
                  : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {filter === 'all' ? 'All' : filter === 'own' ? 'Team' : 'Opponent'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex gap-1">
          {(Object.entries(SHOT_TYPE_CONFIG) as [ShotType, typeof SHOT_TYPE_CONFIG[ShotType]][]).map(([type, config]) => {
            const active = visibleTypes.has(type)
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'bg-white/5 text-white/30'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0 transition-opacity"
                  style={{ backgroundColor: config.color, opacity: active ? 1 : 0.3 }}
                />
                {config.label}
              </button>
            )
          })}
        </div>
        {hasMatchIds && matchTrends.length > 3 && (
          <div className="flex gap-1 shrink-0">
            {([['all', 'All'], ['5', 'Last 5'], ['3', 'Last 3']] as const).map(([val, label]) => {
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

      <div
        ref={containerRef}
        className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden flex-1 min-h-0"
        style={{ aspectRatio: '16/10' }}
        onMouseLeave={hideTooltip}
      >
        <svg viewBox="0 0 2332 1446" className="w-full h-full">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          {filteredShots.map((shot, idx) => {
            const x = (shot.x / 100) * 1960 + 183
            const y = (shot.y / 100) * 1167 + 123
            const color = getShotColor(shot)
            return (
              <circle
                key={idx}
                cx={x}
                cy={y}
                r="22"
                fill={color}
                stroke="white"
                strokeWidth="3"
                opacity="0.85"
                className="cursor-pointer"
                onMouseEnter={(e) => showTooltip(shot, e)}
                onTouchStart={(e) => { e.preventDefault(); showTooltip(shot, e) }}
                onTouchEnd={hideTooltip}
              />
            )
          })}
        </svg>

        {tooltip && (
          <div
            className="absolute z-10 pointer-events-none bg-black/90 border border-white/20 rounded-lg px-3 py-2 text-xs text-white shadow-xl"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 36,
              transform: tooltip.x > (containerRef.current?.clientWidth ?? 0) / 2 ? 'translateX(-110%)' : undefined,
            }}
          >
            <div className="font-semibold">{getEventLabel(tooltip.shot.event_type)}</div>
            <div className="text-white/60 mt-0.5">{tooltip.shot.is_score ? 'Scored' : 'Not scored'}</div>
          </div>
        )}
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
