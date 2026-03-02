import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Route, ChevronLeft, ChevronRight, Eye, EyeOff } from 'lucide-react'
import { matchesAPI } from '@/services/api'
import type { PitchPath } from '@/services/api'

interface PathsTakenChartProps {
  matchId: string
  pollInterval?: number
}

const OUTCOME_COLORS: Record<string, string> = {
  goal: '#10b981',
  point: '#10b981',
  point_free: '#34d399',
  two_point: '#06b6d4',
  two_point_free: '#22d3ee',
  wide: '#f59e0b',
  wide_free: '#fbbf24',
  forty_five: '#06b6d4',
  penalty_goal: '#10b981',
}

const OUTCOME_LABELS: Record<string, string> = {
  goal: 'Goal', point: 'Point', point_free: 'Point (free)',
  two_point: '2-Pointer', two_point_free: '2-Pointer (free)',
  wide: 'Wide', wide_free: 'Wide (free)', forty_five: '45m free',
  short: 'Short', saved: 'Saved', penalty_goal: 'Penalty',
}

const SCORING_TYPES = new Set(['goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five', 'penalty_goal'])
const WIDE_TYPES = new Set(['wide', 'wide_free'])

const PITCH_X_OFFSET = 183
const PITCH_Y_OFFSET = 123
const PITCH_W = 1960
const PITCH_H = 1167

const toSvg = (px: number, py: number) => ({
  x: (px / 100) * PITCH_W + PITCH_X_OFFSET,
  y: (py / 100) * PITCH_H + PITCH_Y_OFFSET,
})

// Convert pitch coordinates to a GAA-friendly zone name
// normX: 0 = own goal, 100 = opponent goal (always normalized for own team attacking direction)
const getZone = (normX: number, y: number): string => {
  let lateral = ''
  if (y < 30) lateral = ' on the left'
  else if (y > 70) lateral = ' on the right'

  if (normX <= 5) return `the own goal area`
  if (normX <= 13) return `the own 13m line${lateral}`
  if (normX <= 20) return `the own 21m line${lateral}`
  if (normX <= 35) return `the own 45m line${lateral}`
  if (normX <= 50) return `midfield${lateral}`
  if (normX <= 65) return `the opposition 45m line${lateral}`
  if (normX <= 80) return `outside the arc${lateral}`
  if (normX <= 90) return `inside the arc${lateral}`
  if (normX <= 97) return `the 13m line${lateral}`
  return `the square`
}

// Normalize raw pitch x (0=left of screen) to attacking x (0=own goal, 100=opp goal)
const normalizeX = (rawX: number, minute: number, attackingRightFirstHalf: boolean): number => {
  const isFirstHalf = minute <= 30
  const attackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
  return attackingRight ? rawX : 100 - rawX
}

// Prettify event type names for natural language
const prettyAction = (raw: string): string => {
  const map: Record<string, string> = {
    turnover_won: 'a turnover won',
    kickout_won: 'a kickout won',
    own_kickout_won: 'an own kickout won',
    own_kickout_won_break: 'a breaking ball from own kickout',
    opp_kickout_won: 'an opposition kickout won',
    opp_kickout_won_break: 'a breaking ball from opposition kickout',
    interception: 'an interception',
    block: 'a block',
    free_won: 'a free won',
    foul_won: 'a foul won',
    breaking_ball_won: 'a breaking ball won',
    mark: 'a mark',
  }
  return map[raw] || raw.replace(/_/g, ' ')
}

// Build a human-readable natural language path description
const describePath = (
  points: { x: number; y: number }[],
  minute: number,
  attackingRightFirstHalf: boolean,
  startedWith?: string | null,
): string => {
  if (points.length === 0) return ''

  const zones = points.map(p => {
    const nx = normalizeX(p.x, minute, attackingRightFirstHalf)
    return getZone(nx, p.y)
  })
  // Deduplicate consecutive zones
  const uniqueZones = zones.filter((z, i) => i === 0 || z !== zones[i - 1])

  if (points.length === 1) {
    return `Shot taken from ${uniqueZones[0]}`
  }

  const origin = uniqueZones[0]
  const startAction = startedWith ? prettyAction(startedWith) : 'play'

  if (uniqueZones.length === 1) {
    return `Started with ${startAction} in ${origin}`
  }

  if (uniqueZones.length === 2) {
    return `Started with ${startAction} at ${origin}, finished from ${uniqueZones[1]}`
  }

  // 3+ zones: describe the journey through intermediate zones
  const middle = uniqueZones.slice(1, -1)
  const end = uniqueZones[uniqueZones.length - 1]
  return `Started with ${startAction} at ${origin}, worked through ${middle.join(', ')} and finished from ${end}`
}

export default function PathsTakenChart({ matchId, pollInterval = 0 }: PathsTakenChartProps) {
  const [mode, setMode] = useState<'scores' | 'wides'>('scores')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null) // null = show all

  const { data: pathsData } = useQuery({
    queryKey: ['pitch-paths', matchId],
    queryFn: () => matchesAPI.getPitchPaths(matchId),
    enabled: !!matchId,
    refetchInterval: pollInterval || false,
  })

  const allPaths = pathsData?.paths || []
  const attackingRightFirstHalf = pathsData?.attacking_right_first_half ?? true

  const { scores, wides } = useMemo(() => {
    const scores: PitchPath[] = []
    const wides: PitchPath[] = []
    for (const p of allPaths) {
      if (SCORING_TYPES.has(p.outcome)) scores.push(p)
      else if (WIDE_TYPES.has(p.outcome)) wides.push(p)
    }
    return { scores, wides }
  }, [allPaths])

  const currentPaths = mode === 'scores' ? scores : wides
  const hasData = currentPaths.length > 0

  // Reset selection when switching mode
  const handleModeChange = (newMode: 'scores' | 'wides') => {
    setMode(newMode)
    setSelectedIdx(null)
  }

  const goToPath = (idx: number) => {
    if (idx < 0) setSelectedIdx(currentPaths.length - 1)
    else if (idx >= currentPaths.length) setSelectedIdx(0)
    else setSelectedIdx(idx)
  }

  // Which paths to render on pitch
  const visiblePaths = selectedIdx !== null ? [currentPaths[selectedIdx]] : currentPaths
  const activeDetail = selectedIdx !== null ? currentPaths[selectedIdx] : null

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        <Route size={20} />
        Paths Taken
      </h3>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-3">
        <button
          onClick={() => handleModeChange('scores')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'scores' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          Scores ({scores.length})
        </button>
        <button
          onClick={() => handleModeChange('wides')}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'wides' ? 'bg-amber-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          Wides ({wides.length})
        </button>
      </div>

      {/* Pitch SVG — natural aspect ratio */}
      <div className="rounded-lg overflow-hidden max-w-2xl mx-auto">
        <svg viewBox="0 0 2332 1446" className="w-full h-auto">
          <rect width="2332" height="1446" fill="#2d5016" />
          <image
            href="/pitch-svg.svg"
            width="2332"
            height="1446"
            preserveAspectRatio="xMidYMid meet"
          />
          <rect width="2332" height="1446" fill="rgba(0,0,0,0.3)" />

          {hasData && visiblePaths.map((path, vIdx) => {
            const points = path.points || []
            if (points.length === 0) return null

            // Find the real index in currentPaths for numbering
            const realIdx = selectedIdx !== null ? selectedIdx : currentPaths.indexOf(path)
            const svgPoints = points.map(p => toSvg(p.x, p.y))
            const color = OUTCOME_COLORS[path.outcome] || '#10b981'
            const num = realIdx + 1
            const isHighlighted = selectedIdx === null || vIdx === 0

            if (svgPoints.length === 1) {
              return (
                <g key={vIdx} opacity={isHighlighted ? 1 : 0.25}>
                  <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={36} fill={color} stroke="white" strokeWidth={4} />
                  <text x={svgPoints[0].x} y={svgPoints[0].y + 14} textAnchor="middle" fill="white" fontSize={44} fontWeight="bold">{num}</text>
                </g>
              )
            }

            const pathD = svgPoints.map((p, i) =>
              i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
            ).join(' ')
            const last = svgPoints[svgPoints.length - 1]

            return (
              <g key={vIdx} opacity={isHighlighted ? 0.9 : 0.2}>
                <path d={pathD} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} />
                <path d={pathD} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
                {svgPoints.slice(1, -1).map((p, di) => (
                  <circle key={di} cx={p.x} cy={p.y} r={14} fill={color} stroke="white" strokeWidth={2} opacity={0.7} />
                ))}
                <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={22} fill={color} stroke="white" strokeWidth={3} opacity={0.8} />
                <circle cx={last.x} cy={last.y} r={36} fill={color} stroke="white" strokeWidth={4} />
                <text x={last.x} y={last.y + 14} textAnchor="middle" fill="white" fontSize={44} fontWeight="bold">{num}</text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Path Navigator */}
      {hasData && (
        <div className="mt-3">
          {/* Navigation controls */}
          <div className="flex items-center gap-2 mb-2">
            {/* Show all / single toggle */}
            <button
              onClick={() => setSelectedIdx(selectedIdx !== null ? null : 0)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedIdx === null
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
              }`}
            >
              {selectedIdx === null ? <Eye size={12} /> : <EyeOff size={12} />}
              {selectedIdx === null ? 'All' : 'All'}
            </button>

            {/* Path number pills */}
            <div className="flex-1 flex items-center gap-1 overflow-x-auto no-scrollbar">
              {currentPaths.map((path, idx) => {
                const color = OUTCOME_COLORS[path.outcome] || '#10b981'
                const isSelected = selectedIdx === idx
                return (
                  <button
                    key={idx}
                    onClick={() => setSelectedIdx(isSelected ? null : idx)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 transition-all"
                    style={{
                      backgroundColor: isSelected ? color : 'transparent',
                      border: `2px solid ${isSelected ? color : 'rgba(255,255,255,0.2)'}`,
                      opacity: isSelected ? 1 : 0.6,
                    }}
                  >
                    {idx + 1}
                  </button>
                )
              })}
            </div>

            {/* Prev/Next arrows */}
            {selectedIdx !== null && (
              <div className="flex gap-1">
                <button
                  onClick={() => goToPath(selectedIdx - 1)}
                  className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white/70 hover:bg-white/20 transition-all"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => goToPath(selectedIdx + 1)}
                  className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-white/70 hover:bg-white/20 transition-all"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Detail card for selected path */}
          {activeDetail && (() => {
            const color = OUTCOME_COLORS[activeDetail.outcome] || '#10b981'
            const outcomeLabel = OUTCOME_LABELS[activeDetail.outcome] || activeDetail.outcome?.replace(/_/g, ' ')
            const pathDesc = describePath(
              activeDetail.points || [], activeDetail.minute,
              attackingRightFirstHalf, activeDetail.started_with
            )
            return (
              <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: color }}
                >
                  {selectedIdx! + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-semibold text-sm">
                    {activeDetail.player || 'Unknown'} — <span style={{ color }}>{outcomeLabel}</span>
                    <span className="text-white/40 font-normal ml-1">{activeDetail.minute}'</span>
                  </div>
                  <div className="text-white/50 text-xs leading-relaxed mt-0.5">
                    {pathDesc}
                  </div>
                </div>
              </div>
            )
          })()}

          {/* Summary when viewing all */}
          {selectedIdx === null && (
            <p className="text-white/40 text-xs text-center mt-1">
              Tap a number to focus on a single path
            </p>
          )}
        </div>
      )}

      {!hasData && (
        <div className="mt-4 text-center text-white/40 text-sm py-4">
          {mode === 'scores' ? 'No scoring paths recorded yet' : 'No wide paths recorded yet'}
        </div>
      )}
    </div>
  )
}
