import { useState, useRef, useEffect } from 'react'
import { BallPosition, PossessionTeam } from '@/types'

interface PitchEvent {
  id?: string | number
  pitch_x: number | null
  pitch_y: number | null
  event_type: string
  team?: string
  player_name?: string
  minute?: number
}

// Format event type for display
const formatEventType = (type: string): string => {
  return type
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase())
}

interface GAAPitchProps {
  onBallMove?: (position: BallPosition) => void
  ballPosition?: BallPosition | null
  readonly?: boolean
  showZones?: boolean
  events?: PitchEvent[]
}

// Get color for event dot based on type and team
const getEventColor = (event: PitchEvent): string => {
  const isDungloe = event.team === 'dungloe'

  switch (event.event_type) {
    case 'goal':
      return isDungloe ? '#10b981' : '#f97316'  // emerald vs orange
    case 'point':
    case 'point_free':
      return isDungloe ? '#6366f1' : '#fb7185'  // indigo vs rose
    case 'two_point':
    case 'two_point_free':
      return isDungloe ? '#8b5cf6' : '#fb7185'  // purple vs rose
    case 'wide':
    case 'wide_free':
      return '#fbbf24'  // amber
    case 'saved':
    case 'short':
      return '#f59e0b'  // yellow
    case 'turnover_won':
      return '#06b6d4'  // cyan
    case 'turnover_lost':
    case 'our_unforced_error':
    case 'opp_unforced_error':
      return '#ec4899'  // pink
    default:
      // Kickout events — color by who won
      if (event.event_type.includes('kickout') || event.event_type.includes('breaking_ball')) {
        const dungloeWon = event.event_type.includes('dungloe_won') || event.event_type === 'kickout_won'
        return dungloeWon ? '#06b6d4' : '#f97316'  // cyan for Dungloe won, orange for lost
      }
      return '#94a3b8'  // slate
  }
}

export default function GAAPitch({
  onBallMove,
  ballPosition,
  readonly = false,
  showZones = false,
  events = [],
}: GAAPitchProps) {
  const [localBallPosition, setLocalBallPosition] = useState<BallPosition | null>(
    ballPosition || null
  )
  const [selectedEvent, setSelectedEvent] = useState<PitchEvent | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close tooltip when tapping outside
  const handleContainerClick = (e: React.MouseEvent | React.TouchEvent) => {
    // Only close if clicking the container itself, not an event dot
    if (e.target === containerRef.current || e.target === svgRef.current) {
      setSelectedEvent(null)
    }
  }

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
    <div
      ref={containerRef}
      className="relative w-full aspect-[16/10] bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden"
      onClick={handleContainerClick}
      onTouchEnd={handleContainerClick}
    >
      {/* Event Tooltip */}
      {selectedEvent && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltipPos.x,
            top: tooltipPos.y - 10,
            transform: 'translate(-50%, -100%)'
          }}
        >
          <div className="bg-slate-900/95 backdrop-blur-sm text-white text-sm px-3 py-2 rounded-lg shadow-xl border border-white/10">
            <div className="font-semibold text-white">
              {formatEventType(selectedEvent.event_type)}
            </div>
            {selectedEvent.player_name && (
              <div className="text-white/80">{selectedEvent.player_name}</div>
            )}
            {selectedEvent.minute !== undefined && (
              <div className="text-white/60 text-xs">{selectedEvent.minute}'</div>
            )}
          </div>
          {/* Tooltip arrow */}
          <div className="w-0 h-0 mx-auto border-l-[6px] border-r-[6px] border-t-[6px] border-l-transparent border-r-transparent border-t-slate-900/95" />
        </div>
      )}

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
            
            {/* GAA Football */}
            <image
              href="/gaelic_football.svg"
              x={(localBallPosition.x / 100) * 1960 + 183 - 24}
              y={(localBallPosition.y / 100) * 1167 + 123 - 24}
              width="48"
              height="48"
              className="drop-shadow-lg"
            />
            {/* Team indicator ring */}
            <circle
              cx={(localBallPosition.x / 100) * 1960 + 183}
              cy={(localBallPosition.y / 100) * 1167 + 123}
              r="28"
              fill="none"
              stroke={
                localBallPosition.team === PossessionTeam.DUNGLOE
                  ? '#4f46e5'
                  : '#ef4444'
              }
              strokeWidth="4"
              opacity="0.8"
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

        {/* Event dots (for match result view) */}
        {events.length > 0 && events.map((event, idx) => {
          if (event.pitch_x === null || event.pitch_y === null) return null
          const x = (event.pitch_x / 100) * 1960 + 183
          const y = (event.pitch_y / 100) * 1167 + 123
          const color = getEventColor(event)

          return (
            <g key={event.id || idx}>
              <circle
                cx={x}
                cy={y}
                r="22"
                fill={color}
                stroke="white"
                strokeWidth="3"
                opacity={selectedEvent?.id === event.id ? 1 : 0.85}
                className="transition-all cursor-pointer"
                style={{ filter: selectedEvent?.id === event.id ? 'drop-shadow(0 0 8px rgba(255,255,255,0.5))' : 'none' }}
                // Desktop: hover to show tooltip
                onMouseEnter={(e) => {
                  const container = containerRef.current
                  if (container) {
                    const rect = container.getBoundingClientRect()
                    setTooltipPos({
                      x: e.clientX - rect.left,
                      y: e.clientY - rect.top
                    })
                  }
                  setSelectedEvent(event)
                }}
                onMouseLeave={() => setSelectedEvent(null)}
                // Touch: tap to toggle tooltip
                onTouchEnd={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  const touch = e.changedTouches[0]
                  const container = containerRef.current
                  if (container && touch) {
                    const rect = container.getBoundingClientRect()
                    setTooltipPos({
                      x: touch.clientX - rect.left,
                      y: touch.clientY - rect.top
                    })
                  }
                  // Toggle: tap again to close
                  setSelectedEvent(selectedEvent?.id === event.id ? null : event)
                }}
              />
            </g>
          )
        })}

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
    </div>
  )
}

