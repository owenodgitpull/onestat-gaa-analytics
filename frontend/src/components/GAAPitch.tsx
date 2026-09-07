import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
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
  containerClassName?: string
  trail?: Array<{ x: number; y: number }>
  onTrailUpdate?: (trail: Array<{ x: number; y: number }>) => void
  /** Called on drag-end with all downsampled waypoints collected during the drag */
  onDragPath?: (waypoints: Array<{ x: number; y: number }>) => void
  /** Called during drag with current position — for updating status text without recording possession */
  onDragUpdate?: (position: BallPosition) => void
  /** Optional overlay rendered inside SVG via foreignObject — always relative to pitch graphic */
  svgOverlay?: React.ReactNode
  /**
   * Optional overlay anchored to the ball's current position. A render prop
   * (not a plain node) because it needs the ball's live SVG coordinates —
   * rendered as pure SVG children INSIDE the ball's own <g> group, in the
   * exact same render pass as the ball marker itself, so it moves in
   * perfect lockstep with zero possibility of lag/drift. An earlier version
   * rendered this as a separately-positioned HTML overlay (via foreignObject
   * or CSS percentage positioning) which visibly chased the ball during
   * drags and had unreliable touch hit-testing — do not go back to that.
   * Also receives the ball's raw pitch-% position (ballPctX/Y) alongside its
   * SVG coordinates, for callers that need to rank things by proximity to
   * the ball rather than just anchor a badge to it.
   */
  ballAnchoredOverlay?: (ballSvgX: number, ballSvgY: number, ballPctX: number, ballPctY: number) => React.ReactNode
  /**
   * Optional overlay spread across the pitch (not anchored to the ball),
   * rendered as pure SVG siblings BEFORE the ball's own <g> so the ball and
   * anything ball-anchored always paint on top. Re-invoked on every render
   * with the ball's live pitch-% position, including mid-drag, so it can
   * re-rank/re-highlight in real time as the ball moves — unlike
   * ballAnchoredOverlay this is NOT suppressed during a drag, since
   * "highlight likely targets while the ball is actively being moved" is
   * the whole point.
   */
  pitchOverlay?: (ballPctX: number, ballPctY: number) => React.ReactNode
  /** Show gradient border around the pitch edge inside the SVG */
  gradientBorder?: boolean
  /** Active ball carrier jersey number — renders badge on ball icon */
  carrierJerseyNumber?: number | null
  /**
   * Pulses both long touchlines (top and bottom edges of the pitch) amber —
   * shown while the user needs to tap ON the sideline itself (a kickout
   * logged as going out over the line), since that's easy to miss when the
   * pitch is small on a phone screen.
   */
  highlightSidelines?: boolean
  /**
   * Pulses a vertical line amber at the given pitch-% x — shown while the
   * user needs to tap ON the 45m line itself (a 45 is always kicked from
   * that exact line, never wherever the ball was previously). x is a raw
   * pitch-% value (same screen-relative frame every other tap position is
   * captured in) — the caller works out which of the two 45m lines is the
   * right one before passing it in, this just draws whichever one it's given.
   */
  highlight45LineX?: number | null
}

// Minimum distance (in pitch %) between recorded drag waypoints
const DRAG_SAMPLE_THRESHOLD = 3

// Get color for event dot based on type and team
const getEventColor = (event: PitchEvent): string => {
  const isOwn = event.team === 'own'

  switch (event.event_type) {
    case 'goal':
      return isOwn ? '#10b981' : '#ef4444'    // emerald / red
    case 'point':
    case 'point_free':
    case 'forty_five':
      return isOwn ? '#10b981' : '#f97316'    // emerald / orange
    case 'two_point':
    case 'two_point_free':
      return isOwn ? '#10b981' : '#eab308'    // emerald / yellow
    case 'wide':
    case 'wide_free':
    case 'forty_five_missed':
      return '#fbbf24'                         // amber — near miss
    case 'saved':
    case 'short':
      return '#94a3b8'                         // slate — stopped/short
    case 'block':
    case 'tackle_won':
      return '#a78bfa'                         // violet — defensive
    case 'interception':
      return '#2dd4bf'                         // teal — interception (kept distinct from block/tackle)
    case 'turnover_won':
      return '#3b82f6'                         // blue — won possession
    case 'turnover_lost':
    case 'unforced_error':
      return '#ec4899'                         // hot pink — lost possession
    case 'foul_won':
      return '#6366f1'                         // indigo — free won (good for us)
    case 'foul_committed':
      return '#d946ef'                         // fuchsia — foul conceded (bad for us)
    default:
      if (event.event_type.includes('kickout') || event.event_type.includes('breaking_ball')) {
        const ownTeamWon = event.event_type.includes('_won') && !event.event_type.includes('opposition_won')
        return ownTeamWon ? '#06b6d4' : '#f43f5e'  // cyan / rose
      }
      return '#94a3b8'
  }
}

// Convert pitch percentage to SVG coordinates
const toSvgX = (pctX: number) => (pctX / 100) * 1960 + 183
const toSvgY = (pctY: number) => (pctY / 100) * 1167 + 123


export default function GAAPitch({
  onBallMove,
  ballPosition,
  readonly = false,
  showZones = false,
  events = [],
  containerClassName,
  trail,
  onTrailUpdate,
  onDragPath,
  onDragUpdate,
  svgOverlay,
  ballAnchoredOverlay,
  pitchOverlay,
  gradientBorder = false,
  carrierJerseyNumber,
  highlightSidelines = false,
  highlight45LineX = null,
}: GAAPitchProps) {
  const [localBallPosition, setLocalBallPosition] = useState<BallPosition | null>(
    ballPosition || null
  )
  const [dragPosition, setDragPosition] = useState<BallPosition | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<PitchEvent | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef(false)
  const dragWaypointsRef = useRef<Array<{ x: number; y: number }>>([])

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

  const clientToPercent = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null

    // Use SVG's own coordinate transform — immune to aspect-ratio letterboxing
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())

    const x = ((svgPt.x - 183) / 1960) * 100
    const y = ((svgPt.y - 123) / 1167) * 100

    return {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, y)),
    }
  }, [])

  // SVG pointerUp — handles tap-to-place (not drag)
  const handlePitchPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (readonly || draggingRef.current) return

    const pos = clientToPercent(e.clientX, e.clientY)
    if (!pos) return

    const newPosition: BallPosition = {
      x: pos.x,
      y: pos.y,
      team: localBallPosition?.team || PossessionTeam.OWN,
    }

    setLocalBallPosition(newPosition)
    onBallMove?.(newPosition)

    // Add to trail
    if (onTrailUpdate && trail) {
      onTrailUpdate([...trail.slice(-49), { x: pos.x, y: pos.y }])
    }
  }

  // Ball drag handlers
  const handleBallPointerDown = (e: React.PointerEvent<SVGGElement>) => {
    if (readonly) return
    e.stopPropagation()
    draggingRef.current = true
    ;(e.target as Element).setPointerCapture(e.pointerId)
    // Initialize drag position and waypoint collection
    dragWaypointsRef.current = []
    if (localBallPosition) {
      setDragPosition({ ...localBallPosition })
      dragWaypointsRef.current.push({ x: localBallPosition.x, y: localBallPosition.y })
    }
  }

  const handleBallPointerMove = (e: React.PointerEvent<SVGGElement>) => {
    if (!draggingRef.current || readonly) return

    const pos = clientToPercent(e.clientX, e.clientY)
    if (!pos) return

    const newDragPos: BallPosition = {
      x: pos.x,
      y: pos.y,
      team: localBallPosition?.team || PossessionTeam.OWN,
    }
    setDragPosition(newDragPos)

    // Update parent so status text + 2PT zone updates during drag
    onDragUpdate?.(newDragPos)

    // Downsample: only record waypoint if moved > threshold from last recorded point
    const waypoints = dragWaypointsRef.current
    const last = waypoints[waypoints.length - 1]
    if (!last || Math.hypot(pos.x - last.x, pos.y - last.y) >= DRAG_SAMPLE_THRESHOLD) {
      waypoints.push({ x: pos.x, y: pos.y })
    }

    // Append to trail during drag (visual only, no API call)
    if (onTrailUpdate && trail) {
      onTrailUpdate([...trail.slice(-49), { x: pos.x, y: pos.y }])
    }
  }

  const handleBallPointerUp = (e: React.PointerEvent<SVGGElement>) => {
    if (!draggingRef.current) return
    e.stopPropagation()
    ;(e.target as Element).releasePointerCapture(e.pointerId)
    draggingRef.current = false

    if (dragPosition) {
      // Ensure final position is in waypoints
      const waypoints = dragWaypointsRef.current
      const last = waypoints[waypoints.length - 1]
      if (!last || last.x !== dragPosition.x || last.y !== dragPosition.y) {
        waypoints.push({ x: dragPosition.x, y: dragPosition.y })
      }

      // Flush collected waypoints (batch possession recording)
      if (onDragPath && waypoints.length > 1) {
        onDragPath(waypoints)
      }
      dragWaypointsRef.current = []

      // Commit final position (fires the main onBallMove for the endpoint)
      setLocalBallPosition(dragPosition)
      onBallMove?.(dragPosition)
      setDragPosition(null)
    }
  }

  // Mobile browsers can fire pointercancel instead of pointerup mid-gesture
  // (system gesture takeover, focus change, etc.) — without handling it,
  // draggingRef.current never resets to false, which permanently hid the
  // ball-anchored overlay (it's suppressed while "dragging") until reload.
  // Treat a cancel as an abort, not a placement: reset state, don't commit.
  const handleBallPointerCancel = () => {
    if (!draggingRef.current) return
    draggingRef.current = false
    dragWaypointsRef.current = []
    setDragPosition(null)
  }

  // Check if position is in 2-point zone (outside both 40m arcs)
  // Uses elliptical geometry matching MatchRecording.tsx isIn2PointZone
  const isInTwoPointZone = (x: number, y: number) => {
    const X_R = 29.0
    const Y_R = 46.0
    const dy = y - 50
    // Check distance from BOTH goals — 2-point zone is outside both arcs
    const distFromRight = Math.sqrt(Math.pow((100 - x) / X_R, 2) + Math.pow(dy / Y_R, 2))
    const distFromLeft = Math.sqrt(Math.pow(x / X_R, 2) + Math.pow(dy / Y_R, 2))
    return distFromRight > 1.0 && distFromLeft > 1.0
  }

  // The position to render — drag position takes priority during drag
  const displayPosition = dragPosition || localBallPosition

  // Trail rendering as SVG elements
  const trailColor = displayPosition?.team === PossessionTeam.OWN ? '#059669' : '#ef4444'

  const trailElements = useMemo(() => {
    if (!trail || trail.length < 2) return null

    // Build SVG path string
    const pathPoints = trail.map(p => `${toSvgX(p.x)},${toSvgY(p.y)}`)
    const pathD = `M ${pathPoints.join(' L ')}`

    return (
      <g style={{ pointerEvents: 'none' }}>
        {/* Connecting line */}
        <path
          d={pathD}
          fill="none"
          stroke={trailColor}
          strokeWidth={6}
          strokeOpacity={0.35}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {/* Trail dots with progressive opacity */}
        {trail.map((p, i) => {
          const progress = trail.length > 1 ? i / (trail.length - 1) : 1
          const opacity = 0.15 + progress * 0.55
          const radius = 14 + progress * 14
          return (
            <circle
              key={i}
              cx={toSvgX(p.x)}
              cy={toSvgY(p.y)}
              r={radius}
              fill={trailColor}
              opacity={opacity}
            />
          )
        })}
      </g>
    )
  }, [trail, trailColor])

  return (
    <div
      ref={containerRef}
      className={containerClassName ?? "relative w-full aspect-[16/10] bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden"}
      // Some callers (FullscreenPitchMode) pass a containerClassName without
      // "relative" — inline style guarantees the ball-anchored overlay below
      // always has a real positioning root, regardless of the caller's class.
      style={{ position: 'relative' }}
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
        style={{ touchAction: 'none' }}
        onPointerUp={handlePitchPointerUp}
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

        {/* Sideline highlight — pulses both touchlines (top and bottom edges
            of the playing area) while a kickout-over-the-sideline tap is
            pending, so the exact tappable strip is obvious rather than
            guessed at. Purely visual — doesn't affect hit-testing. */}
        {highlightSidelines && (
          <>
            <rect x={183} y={123 - 16} width={1960} height={32} fill="#fbbf24" opacity={0.3} className="animate-pulse" />
            <rect x={183} y={123 + 1167 - 16} width={1960} height={32} fill="#fbbf24" opacity={0.3} className="animate-pulse" />
            <line x1={183} y1={123} x2={2143} y2={123} stroke="#fbbf24" strokeWidth={6} className="animate-pulse" />
            <line x1={183} y1={1290} x2={2143} y2={1290} stroke="#fbbf24" strokeWidth={6} className="animate-pulse" />
          </>
        )}

        {/* 45m line highlight — a 45 is always taken from directly on this
            line, so it needs to be obvious rather than guessed at (same
            reasoning as the sideline highlight above). Unlike the sideline
            case (a spot on an edge), this is a full vertical line the user
            can tap ANYWHERE along — so instead of a single crisp stroke, it
            layers a soft glow that pulses out from the line on both sides,
            reading as "this whole line lights up", not just a marked point. */}
        {highlight45LineX != null && (
          <>
            {/* Outer glow — widest, faintest layer */}
            <rect x={toSvgX(highlight45LineX) - 55} y={123} width={110} height={1167} fill="#fbbf24" opacity={0.12} className="animate-pulse" />
            {/* Mid glow */}
            <rect x={toSvgX(highlight45LineX) - 28} y={123} width={56} height={1167} fill="#fbbf24" opacity={0.22} className="animate-pulse" />
            {/* Core tappable strip */}
            <rect x={toSvgX(highlight45LineX) - 12} y={123} width={24} height={1167} fill="#fbbf24" opacity={0.3} className="animate-pulse" />
            {/* Crisp centre line so the exact 45m mark still reads precisely */}
            <line
              x1={toSvgX(highlight45LineX)} y1={123}
              x2={toSvgX(highlight45LineX)} y2={1290}
              stroke="#fbbf24" strokeWidth={5} strokeDasharray="20,14" className="animate-pulse"
            />
          </>
        )}

        {/* Event dots (for match result view) */}
        {events.length > 0 && events.map((event, idx) => {
          if (event.pitch_x === null || event.pitch_y === null) return null
          // 45s are always taken from the 45m line — snap x to nearest 45m line, keep y.
          // 34/66 matches compute45LineX in MatchRecording.tsx (the live-tuned
          // capture-time snap, confirmed against the pitch SVG's actual drawn
          // line on-device 2026-09-07 — not the theoretical 45/145≈31/69,
          // which this display snap was stuck on until now, pulling historical
          // 45 dots off the true line toward the 40m arc).
          const isFortyFive = event.event_type === 'forty_five' || event.event_type === 'forty_five_missed'
          const displayX = isFortyFive
            ? (event.pitch_x < 50 ? 34 : 66)
            : event.pitch_x
          const x = toSvgX(displayX)
          const y = toSvgY(event.pitch_y)
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

        {/* Trail (rendered after event dots, before ball) */}
        {trailElements}

        {/* Pitch-spread overlay (e.g. faint likely-receiver dots) — rendered
            before the ball's own <g> so the ball/radial always paint on top
            when they overlap. Not suppressed during drag, unlike
            ballAnchoredOverlay — it needs to live-update as the ball moves. */}
        {pitchOverlay && displayPosition && pitchOverlay(displayPosition.x, displayPosition.y)}

        {/* Ball position */}
        {displayPosition && (
          <g
            className={draggingRef.current ? '' : 'animate-scale-in'}
            style={{ cursor: readonly ? 'default' : 'grab' }}
            onPointerDown={handleBallPointerDown}
            onPointerMove={handleBallPointerMove}
            onPointerUp={handleBallPointerUp}
            onPointerCancel={handleBallPointerCancel}
          >
            {/* Shadow */}
            <ellipse
              cx={toSvgX(displayPosition.x)}
              cy={toSvgY(displayPosition.y) + 8}
              rx="21"
              ry="10.5"
              fill="rgba(0, 0, 0, 0.5)"
            />

            {/* GAA Football — 5% bigger (48 -> 50.4) */}
            <image
              href="/gaelic_football.svg"
              x={toSvgX(displayPosition.x) - 25.2}
              y={toSvgY(displayPosition.y) - 25.2}
              width="50.4"
              height="50.4"
              className="drop-shadow-lg"
            />
            {/* Team indicator ring — 5% bigger (28 -> 29.4) */}
            <circle
              cx={toSvgX(displayPosition.x)}
              cy={toSvgY(displayPosition.y)}
              r="29.4"
              fill="none"
              stroke={
                displayPosition.team === PossessionTeam.OWN
                  ? '#059669'
                  : '#ef4444'
              }
              strokeWidth="4"
              opacity="0.8"
            />

            {/* 2-Point Zone Indicator */}
            {isInTwoPointZone(displayPosition.x, displayPosition.y) && (
              <text
                x={toSvgX(displayPosition.x)}
                y={toSvgY(displayPosition.y) - 20}
                textAnchor="middle"
                fill="#fbbf24"
                fontSize="24"
                fontWeight="bold"
                className="animate-fade-in"
              >
                2PT
              </text>
            )}

            {/* Carrier jersey number badge */}
            {carrierJerseyNumber != null && (
              <g>
                <circle
                  cx={toSvgX(displayPosition.x) + 22}
                  cy={toSvgY(displayPosition.y) - 22}
                  r="18"
                  fill={displayPosition.team === PossessionTeam.OWN ? '#059669' : '#ef4444'}
                  stroke="white"
                  strokeWidth="2"
                />
                <text
                  x={toSvgX(displayPosition.x) + 22}
                  y={toSvgY(displayPosition.y) - 17}
                  textAnchor="middle"
                  fill="white"
                  fontSize="18"
                  fontWeight="bold"
                >
                  {carrierJerseyNumber}
                </text>
              </g>
            )}

            {/* Suppressed entirely while actively dragging the ball — draggingRef is a
                ref so this check is just read at render time, no extra state needed.
                Keeping the picker's shapes out of the DOM during a drag guarantees they
                can never intercept/compete for pointer capture with the drag gesture
                itself, which must stay instant and 1:1 with the finger — that takes
                priority over the picker being tappable mid-drag (it wasn't meant to be
                used while dragging anyway). */}
            {ballAnchoredOverlay && !draggingRef.current && ballAnchoredOverlay(toSvgX(displayPosition.x), toSvgY(displayPosition.y), displayPosition.x, displayPosition.y)}
          </g>
        )}


        {/* Zone labels (if showZones) */}
        {showZones && (
          <g fill="white" fillOpacity="0.4" fontSize="22" fontWeight="700">
            <text x="370" y="710" textAnchor="middle">DEF</text>
            <text x="1962" y="710" textAnchor="middle">ATK</text>
          </g>
        )}

        {/* Optional overlay — rendered inside SVG so it scales with the pitch */}
        {svgOverlay && (
          <foreignObject x="30" y="25" width="1000" height="120">
            {svgOverlay}
          </foreignObject>
        )}

        {/* Gradient border — drawn inside SVG at the pitch edge */}
        {gradientBorder && (
          <>
            <defs>
              <linearGradient id="pitchBorderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00E676" />
                <stop offset="100%" stopColor="#00B0FF" />
              </linearGradient>
            </defs>
            <rect
              x="1" y="1" width="2330" height="1444" rx="8"
              fill="none"
              stroke="url(#pitchBorderGradient)"
              strokeWidth="4"
              pointerEvents="none"
            />
          </>
        )}
      </svg>
    </div>
  )
}
