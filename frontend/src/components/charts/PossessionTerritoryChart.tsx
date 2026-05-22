import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Target } from 'lucide-react'
import { possessionAPI } from '@/services/api'

// SVG canvas dimensions (matches the GAA pitch image aspect ratio)
const SVG_W = 2332
const SVG_H = 1446

// Grid resolution for clustering events into spatial cells
const GRID_COLS = 10
const GRID_ROWS = 7

// Bubble radius range in SVG units
const MIN_R = 32
const MAX_R = 118

interface PossessionTerritoryChartProps {
  stats: any
  events: any[]
  matchId: string
  opponent: string
  insight?: string
  insightLoading?: boolean
  pollInterval?: number
  attackingRightFirstHalf?: boolean | null
  halfDurationMins?: number
}

interface Cluster {
  svgX: number
  svgY: number
  weight: number
  count: number
}

export default function PossessionTerritoryChart({
  stats,
  events,
  matchId,
  opponent,
  insight,
  insightLoading = false,
  pollInterval = 0,
  attackingRightFirstHalf,
  halfDurationMins = 30,
}: PossessionTerritoryChartProps) {
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')
  const [selectedHalf, setSelectedHalf] = useState<'all' | '1st' | '2nd'>('all')

  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => possessionAPI.getByMatch(matchId),
    enabled: !!matchId,
    refetchInterval: pollInterval || false,
  })

  // Normalise pitch_x into an "own goal = 0, opp goal = 100" frame
  // regardless of which half and which end the team was attacking.
  const getEffectiveX = (px: number, minute: number, forOwnTeam: boolean): number => {
    const hdm = halfDurationMins ?? 30
    const isFirstHalf = minute <= hdm
    const ownAttackingRight = attackingRightFirstHalf != null
      ? (isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf)
      : true
    const teamAttackingRight = forOwnTeam ? ownAttackingRight : !ownAttackingRight
    return teamAttackingRight ? px : 100 - px
  }

  const { clusters, totalWeight, zoneSummary } = useMemo(() => {
    const cells: Record<string, Cluster> = {}
    let defW = 0, midW = 0, atkW = 0

    const usePossession = possessionEvents && possessionEvents.length > 0
    const sourceData = usePossession ? possessionEvents : events

    sourceData.forEach((e: any) => {
      const px = e.pitch_x
      if (px == null) return

      const minute = e.minute || 0
      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== selectedTeam) return

      if (selectedHalf === '1st' && minute > halfDurationMins) return
      if (selectedHalf === '2nd' && minute <= halfDurationMins) return

      const ex = getEffectiveX(px, minute, team === 'own')
      // pitch_y is non-nullable on possession events; may be null on match events
      const ey = e.pitch_y != null ? e.pitch_y : 50

      const weight = usePossession ? (e.duration_seconds || 1) : 1

      // Accumulate zone totals for the summary strip
      if (ex < 35) defW += weight
      else if (ex < 65) midW += weight
      else atkW += weight

      // Map to grid cell
      const col = Math.min(Math.floor(ex / 100 * GRID_COLS), GRID_COLS - 1)
      const row = Math.min(Math.floor(ey / 100 * GRID_ROWS), GRID_ROWS - 1)
      const key = `${col},${row}`

      if (!cells[key]) {
        cells[key] = {
          svgX: (col + 0.5) / GRID_COLS * SVG_W,
          svgY: (row + 0.5) / GRID_ROWS * SVG_H,
          weight: 0,
          count: 0,
        }
      }
      cells[key].weight += weight
      cells[key].count += 1
    })

    const total = defW + midW + atkW
    return {
      clusters: Object.values(cells).sort((a, b) => b.weight - a.weight),
      totalWeight: total,
      zoneSummary: total > 0
        ? {
            def: Math.round(defW / total * 100),
            mid: Math.round(midW / total * 100),
            atk: Math.round(atkW / total * 100),
          }
        : null,
    }
  }, [possessionEvents, events, selectedTeam, selectedHalf, halfDurationMins, attackingRightFirstHalf])

  const maxWeight = clusters.length > 0 ? clusters[0].weight : 1
  const ownPosPct = Math.round(stats?.team_possession_percentage || 50)
  const possession = { own: ownPosPct, opponent: 100 - ownPosPct }
  const teamColor = selectedTeam === 'own' ? '#84cc16' : '#f97316'

  // Zone divider positions in SVG units
  const defMidLine = SVG_W * 0.35
  const midAtkLine = SVG_W * 0.65

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        <Target size={20} />
        Territory
      </h3>

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-1">
          <button
            onClick={() => setSelectedTeam('own')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedTeam === 'own' ? 'bg-lime-500 text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-current" /> DUN
          </button>
          <button
            onClick={() => setSelectedTeam('opponent')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
              selectedTeam === 'opponent' ? 'bg-orange-500 text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
            }`}
          >
            <div className="w-2 h-2 rounded-full bg-current" /> {opponent.substring(0, 3).toUpperCase()}
          </button>
        </div>

        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          {(['all', '1st', '2nd'] as const).map((half) => (
            <button
              key={half}
              onClick={() => setSelectedHalf(half)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                selectedHalf === half ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {half === 'all' ? 'All' : half}
            </button>
          ))}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="w-full h-auto rounded-lg overflow-hidden">
          {/* Pitch */}
          <rect width={SVG_W} height={SVG_H} fill="#2d5016" />
          <image href="/pitch-svg.svg" width={SVG_W} height={SVG_H} preserveAspectRatio="xMidYMid meet" />

          {/* Subtle zone tints — defensive red, attacking green */}
          <rect x={0} y={0} width={defMidLine} height={SVG_H} fill="#ef4444" fillOpacity="0.055" />
          <rect x={midAtkLine} y={0} width={SVG_W - midAtkLine} height={SVG_H} fill="#10b981" fillOpacity="0.055" />

          {/* Zone divider lines */}
          <line x1={defMidLine} y1={0} x2={defMidLine} y2={SVG_H}
            stroke="white" strokeOpacity="0.10" strokeWidth="5" strokeDasharray="22 18" />
          <line x1={midAtkLine} y1={0} x2={midAtkLine} y2={SVG_H}
            stroke="white" strokeOpacity="0.10" strokeWidth="5" strokeDasharray="22 18" />

          {/* Zone labels */}
          <text x={defMidLine * 0.5} y={SVG_H - 50} textAnchor="middle"
            fill="white" fillOpacity="0.18" fontSize="70" fontWeight="600" letterSpacing="6">DEF</text>
          <text x={(defMidLine + midAtkLine) * 0.5} y={SVG_H - 50} textAnchor="middle"
            fill="white" fillOpacity="0.18" fontSize="70" fontWeight="600" letterSpacing="6">MID</text>
          <text x={midAtkLine + (SVG_W - midAtkLine) * 0.5} y={SVG_H - 50} textAnchor="middle"
            fill="white" fillOpacity="0.18" fontSize="70" fontWeight="600" letterSpacing="6">ATK</text>

          {/* Empty state */}
          {clusters.length === 0 && (
            <text x={SVG_W / 2} y={SVG_H / 2} textAnchor="middle" dominantBaseline="middle"
              fill="white" fillOpacity="0.25" fontSize="110">
              No events recorded
            </text>
          )}

          {/* Cluster bubbles — rendered back-to-front (smallest first) */}
          {[...clusters].reverse().map((cluster, i) => {
            const t = Math.sqrt(cluster.weight / maxWeight)
            const r = MIN_R + t * (MAX_R - MIN_R)
            const fillOpacity = 0.28 + t * 0.52
            const pct = totalWeight > 0 ? Math.round(cluster.weight / totalWeight * 100) : 0
            const showLabel = r > 58 && pct >= 4
            const fontSize = Math.min(86, r * 0.70)

            return (
              <g key={i}>
                <circle
                  cx={cluster.svgX}
                  cy={cluster.svgY}
                  r={r}
                  fill={teamColor}
                  fillOpacity={fillOpacity}
                  stroke={teamColor}
                  strokeOpacity={Math.min(fillOpacity + 0.22, 0.92)}
                  strokeWidth={5}
                />
                {showLabel && (
                  <text
                    x={cluster.svgX}
                    y={cluster.svgY}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill="white"
                    fontSize={fontSize}
                    fontWeight="700"
                    opacity={0.95}
                  >
                    {pct}%
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Zone summary strip */}
      {zoneSummary && (
        <div className="mt-3 flex items-center justify-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-500/60 inline-block" />
            <span className="text-white/50">DEF</span>
            <span className="text-white/80 font-semibold">{zoneSummary.def}%</span>
          </span>
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-white/30 inline-block" />
            <span className="text-white/50">MID</span>
            <span className="text-white/80 font-semibold">{zoneSummary.mid}%</span>
          </span>
          <span className="text-white/20">·</span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500/60 inline-block" />
            <span className="text-white/50">ATK</span>
            <span className="text-white/80 font-semibold">{zoneSummary.atk}%</span>
          </span>
        </div>
      )}

      {/* Overall possession bar */}
      <div className="mt-3 pt-3 border-t border-white/10">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-lime-400 font-semibold w-10">{Math.round(possession.own)}%</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-white/10">
            <div className="bg-lime-500 transition-all" style={{ width: `${possession.own}%` }} />
            <div className="bg-orange-500 transition-all" style={{ width: `${possession.opponent}%` }} />
          </div>
          <span className="text-orange-400 font-semibold w-10 text-right">{Math.round(possession.opponent)}%</span>
        </div>
        <div className="flex justify-between text-[10px] text-white/40 mt-1 px-10">
          <span>Possession</span>
        </div>
      </div>

      {/* AI insight */}
      {insight ? (
        <div className="mt-4 p-3 rounded-lg bg-gradient-to-r from-orange-600/15 to-amber-600/15 border border-orange-500/30">
          <p className="text-xs text-white/70 leading-relaxed">{insight}</p>
        </div>
      ) : insightLoading ? (
        <div className="mt-4 p-3 rounded-lg bg-white/5 border border-white/10 animate-pulse">
          <div className="h-3 bg-white/10 rounded w-3/4 mb-1.5" />
          <div className="h-3 bg-white/10 rounded w-1/2" />
        </div>
      ) : null}
    </div>
  )
}
