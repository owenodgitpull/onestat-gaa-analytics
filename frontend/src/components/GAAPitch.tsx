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
        viewBox="0 0 1400 1000"
        className="w-full h-full cursor-pointer"
        onClick={handlePitchClick}
      >
        {/* Pitch background */}
        <rect width="1400" height="1000" fill="#2d5016" />
        
        {/* 2-Point Zone Overlay (40m zones) - NO LABEL */}
        {showZones && (
          <rect x="0" y="400" width="1400" height="200" fill="rgba(251, 191, 36, 0.06)" />
        )}

        {/* Outer boundary */}
        <rect
          x="80"
          y="100"
          width="1240"
          height="800"
          className="pitch-line"
          strokeWidth="4"
        />

        {/* Halfway line (dashed) - VERTICAL */}
        <line
          x1="700"
          y1="100"
          x2="700"
          y2="900"
          className="pitch-line"
          strokeDasharray="15,15"
          strokeWidth="4"
        />

        {/* 45m lines (left) */}
        <line x1="400" y1="100" x2="400" y2="900" className="pitch-line" strokeWidth="3" />
        
        {/* 45m lines (right) */}
        <line x1="1000" y1="100" x2="1000" y2="900" className="pitch-line" strokeWidth="3" />

        {/* 21m rectangles (large) - LEFT */}
        <rect x="80" y="100" width="180" height="800" className="pitch-line" strokeWidth="3" fill="none" />
        
        {/* 21m rectangles (large) - RIGHT */}
        <rect x="1140" y="100" width="180" height="800" className="pitch-line" strokeWidth="3" fill="none" />

        {/* Small goal areas (6m boxes) - LEFT */}
        <rect x="80" y="350" width="80" height="300" className="pitch-line" strokeWidth="3" fill="none" />
        
        {/* Small goal areas (6m boxes) - RIGHT */}
        <rect x="1240" y="350" width="80" height="300" className="pitch-line" strokeWidth="3" fill="none" />

        {/* Large Semi-circles (20.5m) - LEFT - curves INWARD */}
        <path
          d="M 260 100 A 200 400 0 0 0 260 900"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />
        
        {/* Large Semi-circles (20.5m) - RIGHT - curves INWARD */}
        <path
          d="M 1140 100 A 200 400 0 0 1 1140 900"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />

        {/* Smaller D-zones (13m) - LEFT - curves INWARD */}
        <path
          d="M 220 300 A 100 200 0 0 0 220 700"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />
        
        {/* Smaller D-zones (13m) - RIGHT - curves INWARD */}
        <path
          d="M 1180 300 A 100 200 0 0 1 1180 700"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />

        {/* Penalty spots */}
        <circle cx="180" cy="500" r="4" fill="white" />
        <circle cx="1220" cy="500" r="4" fill="white" />

        {/* H-shaped Goal Posts - LEFT */}
        <g className="pitch-line" strokeWidth="5" fill="none">
          <line x1="80" y1="430" x2="10" y2="430" />
          <line x1="80" y1="570" x2="10" y2="570" />
          <line x1="40" y1="430" x2="40" y2="570" />
        </g>
        
        {/* H-shaped Goal Posts - RIGHT */}
        <g className="pitch-line" strokeWidth="5" fill="none">
          <line x1="1320" y1="430" x2="1390" y2="430" />
          <line x1="1320" y1="570" x2="1390" y2="570" />
          <line x1="1360" y1="430" x2="1360" y2="570" />
        </g>

        {/* Ball position */}
        {localBallPosition && (
          <g className="animate-scale-in">
            {/* Shadow */}
            <ellipse
              cx={(localBallPosition.x / 100) * 1240 + 80}
              cy={(localBallPosition.y / 100) * 800 + 100 + 5}
              rx="15"
              ry="8"
              fill="rgba(0, 0, 0, 0.3)"
            />
            
            {/* Ball */}
            <circle
              cx={(localBallPosition.x / 100) * 1240 + 80}
              cy={(localBallPosition.y / 100) * 800 + 100}
              r="14"
              fill={
                localBallPosition.team === PossessionTeam.DUNGLOE
                  ? '#4f46e5'
                  : '#ef4444'
              }
              stroke="white"
              strokeWidth="3"
              className="drop-shadow-lg"
            />
            
            {/* 2-Point Zone Indicator */}
            {isInTwoPointZone(localBallPosition.x) && (
              <text
                x={(localBallPosition.x / 100) * 1240 + 80}
                y={(localBallPosition.y / 100) * 800 + 80}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="16"
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
          <g fill="white" fillOpacity="0.3" fontSize="14" fontWeight="600">
            <text x="180" y="500" textAnchor="middle">DEF</text>
            <text x="550" y="500" textAnchor="middle">MID</text>
            <text x="700" y="500" textAnchor="middle">CENTER</text>
            <text x="850" y="500" textAnchor="middle">MID</text>
            <text x="1220" y="500" textAnchor="middle">ATK</text>
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

