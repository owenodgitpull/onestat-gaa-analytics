import { useState, useRef, useEffect } from 'react'
import { BallPosition, PossessionTeam } from '@/types'

interface GAAPitchProps {
  onBallMove?: (position: BallPosition) => void
  ballPosition?: BallPosition | null
  readonly?: boolean
  showZones?: boolean
}

export default function GAAPitch({
  onBallMove,
  ballPosition,
  readonly = false,
  showZones = false,
}: GAAPitchProps) {
  const [localBallPosition, setLocalBallPosition] = useState<BallPosition | null>(
    ballPosition || null
  )
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (ballPosition) {
      setLocalBallPosition(ballPosition)
    }
  }, [ballPosition])

  const handlePitchClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (readonly) return

    const svg = svgRef.current
    if (!svg) return

    const rect = svg.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100

    const newPosition: BallPosition = {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
      team: localBallPosition?.team || PossessionTeam.DUNGLOE,
    }

    setLocalBallPosition(newPosition)
    onBallMove?.(newPosition)
  }

  // Check if position is in 2-point zone (40m+ from either goal)
  const isInTwoPointZone = (x: number) => {
    return x >= 40 && x <= 60
  }

  return (
    <div className="relative w-full aspect-[16/10] bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden">
      <svg
        ref={svgRef}
        viewBox="0 0 1000 625"
        className="w-full h-full cursor-pointer"
        onClick={handlePitchClick}
      >
        {/* Pitch background */}
        <rect width="1000" height="625" fill="#1a5f1a" />
        
        {/* 2-Point Zone Overlay (40m zones) - NO LABEL */}
        {showZones && (
          <rect x="400" y="0" width="200" height="625" fill="rgba(251, 191, 36, 0.08)" />
        )}

        {/* Outer boundary */}
        <rect
          x="50"
          y="50"
          width="900"
          height="525"
          className="pitch-line"
          strokeWidth="3"
        />

        {/* Halfway line (dashed) */}
        <line
          x1="500"
          y1="50"
          x2="500"
          y2="575"
          className="pitch-line"
          strokeDasharray="10,10"
        />

        {/* 45m lines */}
        <line x1="230" y1="50" x2="230" y2="575" className="pitch-line" />
        <line x1="770" y1="50" x2="770" y2="575" className="pitch-line" />

        {/* 21m lines (large rectangles) */}
        <rect x="50" y="150" width="130" height="325" className="pitch-line" />
        <rect x="820" y="150" width="130" height="325" className="pitch-line" />

        {/* Goal areas (small rectangles) */}
        <rect x="50" y="250" width="50" height="125" className="pitch-line" />
        <rect x="900" y="250" width="50" height="125" className="pitch-line" />

        {/* Large Semi-circles (20.5m arcs - at each end, curving INTO the pitch) */}
        <path
          d="M 180 175 A 130 130 0 0 1 180 450"
          className="pitch-line"
          fill="none"
        />
        <path
          d="M 820 175 A 130 130 0 0 0 820 450"
          className="pitch-line"
          fill="none"
        />

        {/* Smaller D-zones (13m arcs - inside the semi-circles) */}
        <path
          d="M 180 240 A 80 80 0 0 1 180 385"
          className="pitch-line"
          fill="none"
        />
        <path
          d="M 820 240 A 80 80 0 0 0 820 385"
          className="pitch-line"
          fill="none"
        />

        {/* Penalty spots */}
        <circle cx="125" cy="312.5" r="3" fill="white" />
        <circle cx="875" cy="312.5" r="3" fill="white" />

        {/* Goals */}
        <g className="pitch-line" strokeWidth="4">
          {/* Left goal */}
          <line x1="30" y1="250" x2="30" y2="375" />
          <line x1="30" y1="250" x2="10" y2="235" />
          <line x1="30" y1="375" x2="10" y2="390" />
          <line x1="10" y1="235" x2="10" y2="390" />
          
          {/* Right goal */}
          <line x1="970" y1="250" x2="970" y2="375" />
          <line x1="970" y1="250" x2="990" y2="235" />
          <line x1="970" y1="375" x2="990" y2="390" />
          <line x1="990" y1="235" x2="990" y2="390" />
        </g>

        {/* Ball position */}
        {localBallPosition && (
          <g className="animate-scale-in">
            {/* Shadow */}
            <ellipse
              cx={(localBallPosition.x / 100) * 900 + 50}
              cy={(localBallPosition.y / 100) * 525 + 50 + 5}
              rx="15"
              ry="8"
              fill="rgba(0, 0, 0, 0.3)"
            />
            
            {/* Ball */}
            <circle
              cx={(localBallPosition.x / 100) * 900 + 50}
              cy={(localBallPosition.y / 100) * 525 + 50}
              r="12"
              fill={
                localBallPosition.team === PossessionTeam.DUNGLOE
                  ? '#4f46e5'
                  : '#ef4444'
              }
              stroke="white"
              strokeWidth="2"
              className="drop-shadow-lg"
            />
            
            {/* 2-Point Zone Indicator */}
            {isInTwoPointZone(localBallPosition.x) && (
              <text
                x={(localBallPosition.x / 100) * 900 + 50}
                y={(localBallPosition.y / 100) * 525 + 30}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="14"
                fontWeight="bold"
                className="animate-fade-in"
              >
                2PT
              </text>
            )}
          </g>
        )}

        {/* Zone labels (if showZones) */}
        {showZones && (
          <g fill="white" fillOpacity="0.3" fontSize="12" fontWeight="500">
            <text x="125" y="312" textAnchor="middle">DEF</text>
            <text x="365" y="312" textAnchor="middle">MID</text>
            <text x="500" y="312" textAnchor="middle">CENTER</text>
            <text x="635" y="312" textAnchor="middle">MID</text>
            <text x="875" y="312" textAnchor="middle">ATK</text>
          </g>
        )}
      </svg>

      {/* Legend */}
      {!readonly && (
        <div className="absolute bottom-4 right-4 glass-card p-3 space-y-2 text-xs">
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-indigo-600 border-2 border-white"></div>
            <span>Dungloe</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-4 h-4 rounded-full bg-red-600 border-2 border-white"></div>
            <span>Opponent</span>
          </div>
          {showZones && (
            <div className="flex items-center space-x-2">
              <div className="w-4 h-4 rounded bg-amber-500/30 border border-amber-500"></div>
              <span>2-Point Zone</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

