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
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Background */}
        <rect width="2332" height="1446" fill="#2d5016" />
        
        {/* Use the EXACT pitch from the SVG file */}
        <image 
          href="/pitch-svg.svg" 
          width="2332" 
          height="1446"
          preserveAspectRatio="xMidYMid meet"
        />

        {/* Ball position */}
        {localBallPosition && (
          <g className="animate-scale-in">
            {/* Shadow */}
            <ellipse
              cx={(localBallPosition.x / 100) * 1960 + 183}
              cy={(localBallPosition.y / 100) * 1167 + 123 + 8}
              rx="20"
              ry="10"
              fill="rgba(0, 0, 0, 0.5)"
            />
            
            {/* Ball */}
            <circle
              cx={(localBallPosition.x / 100) * 1960 + 183}
              cy={(localBallPosition.y / 100) * 1167 + 123}
              r="22"
              fill={
                localBallPosition.team === PossessionTeam.DUNGLOE
                  ? '#4f46e5'
                  : '#ef4444'
              }
              stroke="white"
              strokeWidth="4"
              className="drop-shadow-lg"
            />
            
            {/* 2-Point Zone Indicator */}
            {isInTwoPointZone(localBallPosition.x) && (
              <text
                x={(localBallPosition.x / 100) * 1960 + 183}
                y={(localBallPosition.y / 100) * 1167 + 103}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="24"
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
          <g fill="white" fillOpacity="0.4" fontSize="22" fontWeight="700">
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
              <div className="w-4 h-4 rounded-full bg-amber-500 border-2 border-white"></div>
              <span>2-Point Zone</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

