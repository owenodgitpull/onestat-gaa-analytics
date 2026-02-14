import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Route } from 'lucide-react'
import { possessionAPI } from '@/services/api'

interface PathsTakenChartProps {
  matchId: string
  events: any[]
  pollInterval?: number
}

interface Path {
  points: { x: number; y: number }[]
  minute: number
  outcome: string // 'goal' | 'point' | 'two_point' | 'wide' etc
}

const OUTCOME_COLORS: Record<string, string> = {
  goal: '#10b981',
  point: '#6366f1',
  point_free: '#818cf8',
  two_point: '#8b5cf6',
  two_point_free: '#a78bfa',
  wide: '#f59e0b',
  wide_free: '#fbbf24',
}

export default function PathsTakenChart({ matchId, events, pollInterval = 0 }: PathsTakenChartProps) {
  const [mode, setMode] = useState<'scores' | 'wides'>('scores')
  const [selectedPath, setSelectedPath] = useState<number | null>(null)

  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => possessionAPI.getByMatch(matchId),
    enabled: !!matchId,
    refetchInterval: pollInterval || false,
  })

  // Build paths: for each scoring/wide event, trace back the preceding Dungloe possession events
  const paths = useMemo(() => {
    if (!possessionEvents || possessionEvents.length === 0) return { scores: [], wides: [] }

    // Sort possession events by time
    const sortedPoss = [...possessionEvents].sort((a, b) => {
      if (a.minute !== b.minute) return a.minute - b.minute
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    })

    // Build possession phases for Dungloe: consecutive events where team is dungloe/home
    const phases: { events: typeof sortedPoss; endMinute: number }[] = []
    let currentPhase: typeof sortedPoss = []

    for (const pe of sortedPoss) {
      const isDungloe = pe.is_home_team === true
      if (isDungloe) {
        currentPhase.push(pe)
      } else {
        if (currentPhase.length > 0) {
          phases.push({ events: currentPhase, endMinute: currentPhase[currentPhase.length - 1].minute })
          currentPhase = []
        }
      }
    }
    if (currentPhase.length > 0) {
      phases.push({ events: currentPhase, endMinute: currentPhase[currentPhase.length - 1].minute })
    }

    // Categorize scoring/wide match events for Dungloe
    const scoringTypes = ['goal', 'point', 'two_point', 'point_free', 'two_point_free']
    const wideTypes = ['wide', 'wide_free']

    const dungloeEvents = events.filter((e: any) => {
      const team = e.team || (e.is_home_team ? 'dungloe' : 'opponent')
      return team === 'dungloe'
    })

    const matchToPhase = (matchEvent: any): Path | null => {
      const eventMinute = matchEvent.minute || 0
      // Find the closest phase that ends at or just before this event
      let bestPhase = null
      let bestDiff = Infinity
      for (const phase of phases) {
        const diff = eventMinute - phase.endMinute
        if (diff >= -1 && diff < bestDiff) {
          bestDiff = diff
          bestPhase = phase
        }
      }

      if (!bestPhase || bestPhase.events.length < 2) return null

      const points = bestPhase.events.map(pe => ({
        x: pe.x_coord ?? 0,
        y: pe.y_coord ?? 0,
      }))

      return {
        points,
        minute: eventMinute,
        outcome: matchEvent.event_type,
      }
    }

    const scorePaths: Path[] = dungloeEvents
      .filter((e: any) => scoringTypes.includes(e.event_type))
      .map(matchToPhase)
      .filter((p): p is Path => p !== null)

    const widePaths: Path[] = dungloeEvents
      .filter((e: any) => wideTypes.includes(e.event_type))
      .map(matchToPhase)
      .filter((p): p is Path => p !== null)

    return { scores: scorePaths, wides: widePaths }
  }, [possessionEvents, events])

  const currentPaths = mode === 'scores' ? paths.scores : paths.wides
  const hasData = currentPaths.length > 0

  return (
    <div className="glass-card p-4">
      <h3 className="text-lg font-bold text-white mb-3 flex items-center gap-2">
        <Route size={20} />
        Paths Taken
      </h3>

      {/* Mode Toggle */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setMode('scores'); setSelectedPath(null) }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'scores' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          Scores ({paths.scores.length})
        </button>
        <button
          onClick={() => { setMode('wides'); setSelectedPath(null) }}
          className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
            mode === 'wides' ? 'bg-amber-600 text-white' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          Wides ({paths.wides.length})
        </button>
      </div>

      {/* Pitch with paths */}
      <div className="relative">
        <svg viewBox="0 0 2332 1446" className="w-full h-auto rounded-lg overflow-hidden">
          {/* Pitch background */}
          <rect width="2332" height="1446" fill="#2d5016" />
          <image
            href="/pitch-svg.svg"
            width="2332"
            height="1446"
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Semi-transparent overlay to make paths stand out */}
          <rect width="2332" height="1446" fill="rgba(0,0,0,0.3)" />

          {/* Path lines */}
          {hasData && currentPaths.map((path, pathIdx) => {
            const isSelected = selectedPath === pathIdx
            const isOther = selectedPath !== null && !isSelected
            const color = OUTCOME_COLORS[path.outcome] || '#ffffff'

            // Convert pitch coords (0-100) to SVG coords
            // Pitch area: x 183–2143 (1960 units), y 123–1290 (1167 units)
            const svgPoints = path.points.map(p => ({
              x: (p.x / 100) * 1960 + 183,
              y: (p.y / 100) * 1167 + 123,
            }))

            if (svgPoints.length < 2) return null

            const pathD = svgPoints.map((p, i) =>
              i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
            ).join(' ')

            return (
              <g
                key={pathIdx}
                opacity={isOther ? 0.15 : isSelected ? 1 : 0.7}
                className="cursor-pointer transition-opacity"
                onClick={() => setSelectedPath(isSelected ? null : pathIdx)}
              >
                {/* Path line */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={color}
                  strokeWidth={isSelected ? 8 : 5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />

                {/* Start dot */}
                <circle cx={svgPoints[0].x} cy={svgPoints[0].y} r={isSelected ? 18 : 12} fill={color} opacity="0.6" />

                {/* End dot (outcome) */}
                <circle
                  cx={svgPoints[svgPoints.length - 1].x}
                  cy={svgPoints[svgPoints.length - 1].y}
                  r={isSelected ? 22 : 16}
                  fill={color}
                  stroke="white"
                  strokeWidth={isSelected ? 4 : 2}
                />

                {/* Minute label on end dot */}
                {(isSelected || selectedPath === null) && (
                  <text
                    x={svgPoints[svgPoints.length - 1].x}
                    y={svgPoints[svgPoints.length - 1].y + 5}
                    textAnchor="middle"
                    fill="white"
                    fontSize={isSelected ? 20 : 16}
                    fontWeight="bold"
                  >
                    {path.minute}'
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend / Info */}
      {hasData ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {selectedPath !== null && currentPaths[selectedPath] ? (
            <div className="w-full p-2 rounded-lg bg-white/5 border border-white/10 text-white/80">
              <span className="font-semibold">{currentPaths[selectedPath].minute}'</span>
              {' — '}
              {currentPaths[selectedPath].outcome.replace(/_/g, ' ')}
              {' — '}
              {currentPaths[selectedPath].points.length} touches in buildup
            </div>
          ) : (
            <p className="text-white/40">Tap a path to see details</p>
          )}
        </div>
      ) : (
        <div className="mt-4 text-center text-white/40 text-sm py-4">
          {mode === 'scores' ? 'No scoring paths recorded yet' : 'No wide paths recorded yet'}
        </div>
      )}
    </div>
  )
}
