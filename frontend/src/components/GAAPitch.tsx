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
        viewBox="0 0 2332 1446"
        className="w-full h-full cursor-pointer"
        onClick={handlePitchClick}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Use the exact SVG from the file - Background */}
        <rect width="2332" height="1446" fill="#2d5016" />
        
        {/* 2-Point Zone Overlay (subtle) */}
        {showZones && (
          <rect x="900" y="0" width="532" height="1446" fill="rgba(251, 191, 36, 0.05)" />
        )}

        {/* Main GAA Pitch - Scaled from original SVG */}
        <g>
          {/* Outer boundary */}
          <rect x="183" y="123" width="1960" height="1167" stroke="white" strokeWidth="4" fill="none" />
          
          {/* Halfway line (dashed) */}
          <line x1="1166" y1="123" x2="1166" y2="1290" stroke="white" strokeWidth="4" strokeDasharray="20,20" fill="none" />
          
          {/* 45m lines */}
          <line x1="644" y1="123" x2="644" y2="1290" stroke="white" strokeWidth="3" fill="none" />
          <line x1="1688" y1="123" x2="1688" y2="1290" stroke="white" strokeWidth="3" fill="none" />
          
          {/* Large rectangles (21m) */}
          <rect x="183" y="123" width="300" height="1167" stroke="white" strokeWidth="3" fill="none" />
          <rect x="1849" y="123" width="300" height="1167" stroke="white" strokeWidth="3" fill="none" />
          
          {/* Small goal areas (6m) */}
          <rect x="183" y="462" width="150" height="545" stroke="white" strokeWidth="3" fill="none" />
          <rect x="1999" y="462" width="150" height="545" stroke="white" strokeWidth="3" fill="none" />
          
          {/* Large semi-circles (20.5m) curving inward */}
          <path d="M 483 290 A 430 430 0 0 0 483 1120" stroke="white" strokeWidth="3" fill="none" />
          <path d="M 1849 290 A 430 430 0 0 1 1849 1120" stroke="white" strokeWidth="3" fill="none" />
          
          {/* Smaller D-zones (13m) */}
          <path d="M 483 500 A 250 250 0 0 0 483 910" stroke="white" strokeWidth="3" fill="none" />
          <path d="M 1849 500 A 250 250 0 0 1 1849 910" stroke="white" strokeWidth="3" fill="none" />
          
          {/* Penalty spots */}
          <circle cx="370" cy="705" r="6" fill="white" />
          <circle cx="1962" cy="705" r="6" fill="white" />
          
          {/* H-shaped goal posts */}
          <g stroke="white" strokeWidth="6" fill="none">
            {/* Left goal */}
            <line x1="183" y1="580" x2="100" y2="580" />
            <line x1="183" y1="830" x2="100" y2="830" />
            <line x1="140" y1="580" x2="140" y2="830" />
            
            {/* Right goal */}
            <line x1="2149" y1="580" x2="2232" y2="580" />
            <line x1="2149" y1="830" x2="2232" y2="830" />
            <line x1="2192" y1="580" x2="2192" y2="830" />
          </g>
        </g>

        {/* Ball position */}
        {localBallPosition && (
          <g className="animate-scale-in">
            {/* Shadow */}
            <ellipse
              cx={(localBallPosition.x / 100) * 1960 + 183}
              cy={(localBallPosition.y / 100) * 1167 + 123 + 8}
              rx="20"
              ry="10"
              fill="rgba(0, 0, 0, 0.3)"
            />
            
            {/* Ball */}
            <circle
              cx={(localBallPosition.x / 100) * 1960 + 183}
              cy={(localBallPosition.y / 100) * 1167 + 123}
              r="18"
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
                x={(localBallPosition.x / 100) * 1960 + 183}
                y={(localBallPosition.y / 100) * 1167 + 103}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="20"
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
          <g fill="white" fillOpacity="0.3" fontSize="18" fontWeight="600">
            <text x="370" y="710" textAnchor="middle">DEF</text>
            <text x="900" y="710" textAnchor="middle">MID</text>
            <text x="1166" y="710" textAnchor="middle">CENTER</text>
            <text x="1432" y="710" textAnchor="middle">MID</text>
            <text x="1962" y="710" textAnchor="middle">ATK</text>
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

