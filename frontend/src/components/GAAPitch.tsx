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
        viewBox="0 0 1000 1400"
        className="w-full h-full cursor-pointer"
        onClick={handlePitchClick}
      >
        {/* Pitch background */}
        <rect width="1000" height="1400" fill="#2d5016" />
        
        {/* 2-Point Zone Overlay (40m zones) - NO LABEL */}
        {showZones && (
          <rect x="400" y="0" width="200" height="1400" fill="rgba(251, 191, 36, 0.06)" />
        )}

        {/* Outer boundary */}
        <rect
          x="100"
          y="80"
          width="800"
          height="1240"
          className="pitch-line"
          strokeWidth="4"
        />

        {/* Halfway line (dashed) */}
        <line
          x1="100"
          y1="700"
          x2="900"
          y2="700"
          className="pitch-line"
          strokeDasharray="15,15"
          strokeWidth="4"
        />

        {/* 45m lines (top) */}
        <line x1="100" y1="400" x2="900" y2="400" className="pitch-line" strokeWidth="3" />
        
        {/* 45m lines (bottom) */}
        <line x1="100" y1="1000" x2="900" y2="1000" className="pitch-line" strokeWidth="3" />

        {/* 21m rectangles (large) - TOP */}
        <rect x="100" y="80" width="800" height="180" className="pitch-line" strokeWidth="3" fill="none" />
        
        {/* 21m rectangles (large) - BOTTOM */}
        <rect x="100" y="1140" width="800" height="180" className="pitch-line" strokeWidth="3" fill="none" />

        {/* Small goal areas (6m boxes) - TOP */}
        <rect x="350" y="80" width="300" height="80" className="pitch-line" strokeWidth="3" fill="none" />
        
        {/* Small goal areas (6m boxes) - BOTTOM */}
        <rect x="350" y="1240" width="300" height="80" className="pitch-line" strokeWidth="3" fill="none" />

        {/* Large Semi-circles (20.5m) - TOP - curves INWARD */}
        <path
          d="M 100 260 A 400 200 0 0 1 900 260"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />
        
        {/* Large Semi-circles (20.5m) - BOTTOM - curves INWARD */}
        <path
          d="M 100 1140 A 400 200 0 0 0 900 1140"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />

        {/* Smaller D-zones (13m) - TOP - curves INWARD */}
        <path
          d="M 300 220 A 200 100 0 0 1 700 220"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />
        
        {/* Smaller D-zones (13m) - BOTTOM - curves INWARD */}
        <path
          d="M 300 1180 A 200 100 0 0 0 700 1180"
          className="pitch-line"
          strokeWidth="3"
          fill="none"
        />

        {/* Penalty spots */}
        <circle cx="500" cy="180" r="4" fill="white" />
        <circle cx="500" cy="1220" r="4" fill="white" />

        {/* H-shaped Goal Posts - TOP */}
        <g className="pitch-line" strokeWidth="5" fill="none">
          <line x1="430" y1="80" x2="430" y2="10" />
          <line x1="570" y1="80" x2="570" y2="10" />
          <line x1="430" y1="40" x2="570" y2="40" />
        </g>
        
        {/* H-shaped Goal Posts - BOTTOM */}
        <g className="pitch-line" strokeWidth="5" fill="none">
          <line x1="430" y1="1320" x2="430" y2="1390" />
          <line x1="570" y1="1320" x2="570" y2="1390" />
          <line x1="430" y1="1360" x2="570" y2="1360" />
        </g>

        {/* Ball position */}
        {localBallPosition && (
          <g className="animate-scale-in">
            {/* Shadow */}
            <ellipse
              cx={(localBallPosition.x / 100) * 800 + 100}
              cy={(localBallPosition.y / 100) * 1240 + 80 + 5}
              rx="15"
              ry="8"
              fill="rgba(0, 0, 0, 0.3)"
            />
            
            {/* Ball */}
            <circle
              cx={(localBallPosition.x / 100) * 800 + 100}
              cy={(localBallPosition.y / 100) * 1240 + 80}
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
                x={(localBallPosition.x / 100) * 800 + 100}
                y={(localBallPosition.y / 100) * 1240 + 60}
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
            <text x="500" y="180" textAnchor="middle">DEF</text>
            <text x="500" y="550" textAnchor="middle">MID</text>
            <text x="500" y="700" textAnchor="middle">CENTER</text>
            <text x="500" y="850" textAnchor="middle">MID</text>
            <text x="500" y="1220" textAnchor="middle">ATK</text>
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

