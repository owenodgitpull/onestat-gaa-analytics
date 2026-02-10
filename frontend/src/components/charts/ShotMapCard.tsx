import { useState } from 'react'
import { MapPin } from 'lucide-react'
import type { ShotLocation, MatchTrend } from '@/services/api'

interface ShotMapCardProps {
  shotLocations: ShotLocation[]
  matchTrends: MatchTrend[]
}

export default function ShotMapCard({ shotLocations, matchTrends }: ShotMapCardProps) {
  const [shotFilter, setShotFilter] = useState<'all' | 'dungloe' | 'opponent'>('dungloe')
  const [shotMatchRange, setShotMatchRange] = useState<'all' | '3' | '5'>('all')

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
  const filteredShots = recentMatchIds
    ? teamFilteredShots.filter(s => recentMatchIds.has(s.match_id))
    : teamFilteredShots

  const totalShots = filteredShots.length
  const scoredShots = filteredShots.filter(s => s.is_score)
  const missedShots = filteredShots.filter(s => !s.is_score)
  const goals = filteredShots.filter(s => s.is_score && s.event_type === 'goal')
  const points = filteredShots.filter(s => s.is_score && ['point', 'point_free', 'forty_five'].includes(s.event_type))
  const twoPointers = filteredShots.filter(s => s.is_score && ['two_point', 'two_point_free'].includes(s.event_type))
  const accuracy = totalShots > 0 ? Math.round((scoredShots.length / totalShots) * 100) : 0

  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center space-x-2 text-white">
          <MapPin size={20} className="text-white" />
          <span>Shot Map</span>
        </h3>
        <div className="flex flex-col items-end gap-2">
          <div className="flex gap-1">
            {(['dungloe', 'opponent', 'all'] as const).map(filter => (
              <button
                key={filter}
                onClick={() => setShotFilter(filter)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                  shotFilter === filter
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
              >
                {filter === 'all' ? 'All' : filter === 'dungloe' ? 'Dungloe' : 'Opponent'}
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

      <div className="relative bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-xl overflow-hidden" style={{ aspectRatio: '16/10' }}>
        <svg viewBox="0 0 2332 1446" className="w-full h-full">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image href="/pitch-svg.svg" width="2332" height="1446" preserveAspectRatio="xMidYMid meet" />
          {filteredShots.map((shot, idx) => {
            const x = (shot.x / 100) * 1960 + 183
            const y = (shot.y / 100) * 1167 + 123
            const color = shot.is_score ? '#10b981' : '#ef4444'
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
          <div className="text-xl font-bold text-indigo-400">{points.length}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-2 text-center">
          <div className="text-white/50 text-[10px] mb-0.5">2-Ptrs</div>
          <div className="text-xl font-bold text-purple-400">{twoPointers.length}</div>
        </div>
      </div>

      <div className="flex justify-center gap-4 mt-3 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-emerald-500"></span>
          Scored ({scoredShots.length})
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-full bg-red-500"></span>
          Missed ({missedShots.length})
        </span>
      </div>
    </div>
  )
}
