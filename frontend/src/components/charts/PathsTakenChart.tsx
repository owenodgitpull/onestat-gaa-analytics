import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Eye } from 'lucide-react'
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

// Only display the last N recorded positions leading up to the outcome
const MAX_DISPLAY_POINTS = 10

const PITCH_X_OFFSET = 183
const PITCH_Y_OFFSET = 123
const PITCH_W = 1960
const PITCH_H = 1167

const toSvg = (px: number, py: number) => ({
  x: (px / 100) * PITCH_W + PITCH_X_OFFSET,
  y: (py / 100) * PITCH_H + PITCH_Y_OFFSET,
})

const getZoneId = (normX: number): string => {
  if (normX <= 4) return 'own_square'
  if (normX <= 10) return 'own_13'
  if (normX <= 15) return 'own_20'
  if (normX <= 31) return 'own_45'
  if (normX <= 50) return 'own_midfield'
  if (normX <= 69) return 'opp_midfield'
  if (normX <= 72) return 'opp_45'
  if (normX <= 86) return 'inside_arc'
  if (normX <= 91) return 'opp_20'
  if (normX <= 97) return 'opp_13'
  return 'opp_square'
}

const zoneDisplayName = (zoneId: string, y: number): string => {
  const lateral = y < 30 ? ' on the left' : y > 70 ? ' on the right' : ''
  const names: Record<string, string> = {
    own_square: 'our own square',
    own_13: 'our 13',
    own_20: 'our 20',
    own_45: 'our 45',
    own_midfield: 'midfield',
    opp_midfield: 'the opposition half',
    opp_45: 'inside the 45',
    inside_arc: 'inside the 40-meter arc',
    opp_20: 'the 20-meter line',
    opp_13: 'the 13-meter line',
    opp_square: 'the edge of the square',
  }
  return (names[zoneId] || zoneId) + lateral
}

const normalizeX = (rawX: number, minute: number, attackingRightFirstHalf: boolean): number => {
  const isFirstHalf = minute < 40
  const attackingRight = isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf
  return attackingRight ? rawX : 100 - rawX
}

const prettyAction = (raw: string): string => {
  const map: Record<string, string> = {
    turnover_won: 'a turnover',
    // turnover_lost as started_with means the opponent turned over — recording error or
    // chain stitching picked up the wrong first event; treat as a turnover gained.
    turnover_lost: 'an opposition turnover',
    tackle_won: 'a tackle',
    kickout_won: 'our kickout',
    own_kickout_won: 'our kickout',
    own_kickout_won_break: 'our kickout (breaking ball)',
    opp_kickout_won: 'opposition kickout won',
    opp_kickout_won_break: 'opposition kickout (breaking ball)',
    interception: 'an interception',
    block: 'a block',
    free_won: 'a free',
    foul_won: 'a free won',
    breaking_ball_won: 'a breaking ball',
    mark: 'a mark',
    hand_pass: 'a hand pass',
    kick_pass: 'a kick pass',
    goal: 'a goal',
    point: 'a point',
    two_point: 'a two-pointer',
    point_free: 'a pointed free',
    wide: 'a wide',
    wide_free: 'a wide free',
    forty_five: 'a 45',
    saved: 'a saved shot',
    short: 'a short shot',
  }
  return map[raw] || raw.replace(/_/g, ' ')
}

const thinPoints = (points: { x: number; y: number }[], minDist = 5): { x: number; y: number }[] => {
  if (points.length <= 2) return points
  const result = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = result[result.length - 1]
    const curr = points[i]
    const dist = Math.sqrt((curr.x - prev.x) ** 2 + (curr.y - prev.y) ** 2)
    if (dist >= minDist) result.push(curr)
  }
  result.push(points[points.length - 1])
  return result
}

const describePath = (
  points: { x: number; y: number }[],
  minute: number,
  attackingRightFirstHalf: boolean,
  startedWith?: string | null,
  outcome?: string | null,
  carriers?: string[],
): string => {
  if (points.length === 0) return ''

  const zones = points.map(p => {
    const nx = normalizeX(p.x, minute, attackingRightFirstHalf)
    return getZoneId(nx)
  })
  const uniqueZones = zones.filter((z, i) => i === 0 || z !== zones[i - 1])
  const lastPoint = points[points.length - 1]
  const lastY = lastPoint.y

  const startAction = startedWith ? prettyAction(startedWith) : null
  const startZone = zoneDisplayName(uniqueZones[0], points[0].y)
  const endZone = zoneDisplayName(uniqueZones[uniqueZones.length - 1], lastY)

  const outcomeVerb = outcome === 'goal' ? 'goaled' :
    outcome === 'wide' || outcome === 'wide_free' ? 'went wide' :
    outcome === 'short' ? 'dropped short' :
    outcome === 'saved' ? 'was saved' :
    'pointed'

  if (points.length === 1) {
    return `Shot from ${endZone} — ${outcomeVerb}`
  }

  if (uniqueZones.length <= 2) {
    const start = startAction ? `From ${startAction} ${startZone}` : `From ${startZone}`
    return `${start}. ${outcomeVerb.charAt(0).toUpperCase() + outcomeVerb.slice(1)} from ${endZone}`
  }

  const journeyZones: string[] = []
  const zoneProgression = ['own_square', 'own_13', 'own_20', 'own_45', 'own_midfield', 'opp_midfield', 'opp_45', 'inside_arc', 'opp_20', 'opp_13', 'opp_square']

  const middleZones = uniqueZones.slice(1, -1)
  let prevIdx = zoneProgression.indexOf(uniqueZones[0])

  for (const z of middleZones) {
    const currIdx = zoneProgression.indexOf(z)
    if (currIdx > prevIdx + 1) {
      journeyZones.push(zoneDisplayName(z, 50))
    } else if (currIdx > prevIdx) {
      journeyZones.push(zoneDisplayName(z, 50))
    }
    prevIdx = currIdx
  }

  const start = startAction ? `From ${startAction} ${startZone}` : `From ${startZone}`

  let carrierText = ''
  if (carriers && carriers.length > 0) {
    if (carriers.length === 1) {
      carrierText = `. ${carriers[0]} carried`
    } else {
      const surnames = carriers.map(n => n.split(' ').pop() || n)
      carrierText = `. ${surnames.slice(0, -1).join(' to ')} to ${surnames[surnames.length - 1]}`
    }
  }

  const dedupedJourney = journeyZones.filter((z, i) => i === 0 || z !== journeyZones[i - 1])
  const journey = dedupedJourney.length > 0
    ? ` through ${dedupedJourney.join(', ')}`
    : ''
  return `${start}${carrierText}${journey}. ${outcomeVerb.charAt(0).toUpperCase() + outcomeVerb.slice(1)} from ${endZone}`
}

export default function PathsTakenChart({ matchId, pollInterval = 0 }: PathsTakenChartProps) {
  const [mode, setMode] = useState<'scores' | 'wides'>('scores')
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)

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

  const handleModeChange = (newMode: 'scores' | 'wides') => {
    setMode(newMode)
    setSelectedIdx(null)
  }

  const goToPath = (idx: number) => {
    if (idx < 0) setSelectedIdx(currentPaths.length - 1)
    else if (idx >= currentPaths.length) setSelectedIdx(0)
    else setSelectedIdx(idx)
  }

  const visiblePaths = selectedIdx !== null ? [currentPaths[selectedIdx]] : currentPaths
  const activeDetail = selectedIdx !== null ? currentPaths[selectedIdx] : null

  // Build description for the active path using only the display points.
  // Cap carriers at 6 names — full chain can have 30+ which becomes unreadable.
  const MAX_CARRIERS = 6
  const activeDescription = activeDetail ? (() => {
    const displayPoints = (activeDetail.points || []).slice(-MAX_DISPLAY_POINTS)
    const allCarriers: string[] = (activeDetail as any).carriers || []
    const carriers = allCarriers.length > MAX_CARRIERS
      ? ['...', ...allCarriers.slice(-MAX_CARRIERS)]
      : allCarriers
    return describePath(
      displayPoints,
      activeDetail.minute,
      attackingRightFirstHalf,
      activeDetail.started_with,
      activeDetail.outcome,
      carriers,
    )
  })() : null

  return (
    <div className="glass-card p-4 overflow-hidden">
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

      {/* Start/end marker legend */}
      {hasData && (
        <div className="flex items-center justify-center gap-4 mb-2 text-[10px] text-white/40">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-slate-900 border-2 border-white" />
            Start
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
            End (outcome)
          </span>
        </div>
      )}

      {/* Detail card — shown ABOVE pitch so it's always visible */}
      {activeDetail && (() => {
        const color = OUTCOME_COLORS[activeDetail.outcome] || '#10b981'
        const outcomeLabel = OUTCOME_LABELS[activeDetail.outcome] || activeDetail.outcome?.replace(/_/g, ' ')
        return (
          <div className="flex items-start gap-3 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 mb-3">
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
                {activeDescription}
              </div>
            </div>
          </div>
        )
      })()}

      {/* Pitch SVG */}
      <div className="rounded-lg overflow-hidden w-full">
        <svg viewBox="0 0 2332 1446" style={{ width: '100%', height: 'auto', display: 'block' }}>
          <rect width="2332" height="1446" fill="#2d5016" />
          <image
            href="/pitch-svg.svg"
            width="2332"
            height="1446"
            preserveAspectRatio="xMidYMid meet"
          />
          <rect width="2332" height="1446" fill="rgba(0,0,0,0.3)" />

          {hasData && visiblePaths.map((path, vIdx) => {
            const rawPoints = path.points || []
            // Display only the last MAX_DISPLAY_POINTS — keeps path readable
            const displayPoints = rawPoints.slice(-MAX_DISPLAY_POINTS)
            if (displayPoints.length === 0) return null

            const points = thinPoints(displayPoints, selectedIdx === null ? 6 : 4)
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
            const showDots = selectedIdx !== null

            return (
              <g key={vIdx} opacity={isHighlighted ? 0.9 : 0.2}>
                <path d={pathD} fill="none" stroke={color} strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" opacity={0.2} />
                <path d={pathD} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
                {showDots && svgPoints.slice(1, -1).map((p, di) => (
                  <circle key={di} cx={p.x} cy={p.y} r={14} fill={color} stroke="white" strokeWidth={2} opacity={0.7} />
                ))}
                {/* Start marker: hollow white ring so it reads distinctly from the solid,
                    outcome-colored end marker below — same color for both made it hard
                    to tell at a glance which end of the path was the start. */}
                <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={22} fill="#0f172a" stroke="white" strokeWidth={4} opacity={0.95} />
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
          <div className="flex items-center gap-2">
            {/* Show all toggle */}
            <button
              onClick={() => setSelectedIdx(selectedIdx !== null ? null : 0)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                selectedIdx === null
                  ? 'bg-white/15 text-white border border-white/20'
                  : 'bg-white/5 text-white/50 border border-white/10 hover:bg-white/10'
              }`}
            >
              <Eye size={12} />
              All
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

          {selectedIdx === null && (
            <p className="text-white/40 text-xs text-center mt-2">
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
