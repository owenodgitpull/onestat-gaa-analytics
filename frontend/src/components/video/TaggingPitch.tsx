/**
 * TaggingPitch — the video-tagging panel's touch pitch.
 *
 * DELIBERATE FORK of `frontend/src/components/GAAPitch.tsx`'s drag/tap/
 * rendering logic. `GAAPitch.tsx` is live match recording's well-tested
 * pitch component — this file exists so video tagging's new permanent
 * side/below tracking panel (replacing the old floating `BallMinimap`) can
 * gain orientation support (`horizontal` | `vertical`) without touching
 * live match recording's file AT ALL. See
 * `C:\Users\owen_\.claude\plans\transient-discovering-wall.md` for the full
 * rationale — the short version: the drag/tap/accuracy logic here is
 * proven and copied verbatim rather than reimplemented, but it now lives as
 * a second copy so `GAAPitch.tsx` keeps zero diff and zero risk from this
 * change. If you fix a bug in the drag/tap handling here, check whether
 * `GAAPitch.tsx` has the same bug — the two are not kept in sync
 * automatically.
 *
 * Differences from GAAPitch.tsx:
 *  - Adds `orientation: 'horizontal' | 'vertical'`. Vertical rotates the
 *    pitch 90° so it displays goal-to-goal top-to-bottom (for a tall side
 *    column on landscape tablets). This is a PURE geometric transpose, not
 *    a redrawn/rescaled pitch: all content (background image, ball, trail)
 *    is drawn in the same native pitch-percentage space GAAPitch has always
 *    used (via `pitchGeometry.ts`, shared with `PitchOverlay.tsx`), wrapped
 *    in a single rotated `<g>`. Hit-testing reads that same `<g>`'s
 *    `getScreenCTM()`, so rendering and tap/drag math can never drift out
 *    of sync — a tap at a given real-world pitch location always resolves
 *    to the identical canonical {x, y} percentage regardless of which
 *    orientation is currently displayed.
 *  - Drops `events`, `showZones`, `readonly` — Event Map / read-only
 *    concerns from live match recording's result view, irrelevant to video
 *    tagging (which is always an interactive tracking panel, never a
 *    read-only chart).
 */

import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { BallPosition, PossessionTeam } from '@/types'
import { PITCH, toSvg, fromSvg, getViewBox, getPitchGroupTransform, type PitchOrientation } from '@/utils/pitchGeometry'

interface TaggingPitchProps {
  orientation: PitchOrientation
  onBallMove?: (position: BallPosition) => void
  ballPosition?: BallPosition | null
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
   * perfect lockstep with zero possibility of lag/drift.
   * Also receives the ball's raw pitch-% position (ballPctX/Y) alongside its
   * SVG coordinates, for callers that need to rank things by proximity to
   * the ball rather than just anchor a badge to it.
   */
  ballAnchoredOverlay?: (ballSvgX: number, ballSvgY: number, ballPctX: number, ballPctY: number) => React.ReactNode
  /**
   * Optional overlay spread across the pitch (not anchored to the ball),
   * rendered as pure SVG siblings BEFORE the ball's own <g> so the ball and
   * anything ball-anchored always paint on top. Re-invoked on every render
   * with the ball's live pitch-% position, including mid-drag.
   */
  pitchOverlay?: (ballPctX: number, ballPctY: number) => React.ReactNode
  /** Show gradient border around the pitch edge inside the SVG */
  gradientBorder?: boolean
  /** Active ball carrier jersey number — renders badge on ball icon */
  carrierJerseyNumber?: number | null
  /** Suppress all tap/drag interaction (e.g. while a confirm overlay is open
   * elsewhere on screen) — dims the panel and ignores pointer events, same
   * as the old BallMinimap's `disabled` prop. */
  disabled?: boolean
}

// Minimum distance (in pitch %) between recorded drag waypoints
const DRAG_SAMPLE_THRESHOLD = 3

// Convert pitch percentage to native SVG coordinates (pre-rotation — see pitchGeometry.ts)
const toSvgX = (pctX: number) => toSvg(pctX, 0).x
const toSvgY = (pctY: number) => toSvg(0, pctY).y

export default function TaggingPitch({
  orientation,
  onBallMove,
  ballPosition,
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
  disabled = false,
}: TaggingPitchProps) {
  const [localBallPosition, setLocalBallPosition] = useState<BallPosition | null>(
    ballPosition || null
  )
  const [dragPosition, setDragPosition] = useState<BallPosition | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // The rotated wrapper — all hit-testing goes through THIS element's CTM so
  // rendering and tap/drag math can never disagree about orientation.
  const groupRef = useRef<SVGGElement>(null)
  const draggingRef = useRef(false)
  const dragWaypointsRef = useRef<Array<{ x: number; y: number }>>([])

  useEffect(() => {
    if (ballPosition) {
      setLocalBallPosition(ballPosition)
    }
  }, [ballPosition])

  const clientToPercent = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    const group = groupRef.current
    if (!svg || !group) return null

    // Use the rotated group's own CTM — immune to aspect-ratio letterboxing
    // AND automatically accounts for the vertical-orientation rotation,
    // since getScreenCTM() on an element includes that element's own
    // transform. This is what guarantees the "pure geometric transpose":
    // there is no separately-maintained inverse-rotation formula to drift
    // out of sync with getPitchGroupTransform().
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = group.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())

    return fromSvg(svgPt.x, svgPt.y)
  }, [])

  // SVG pointerUp — handles tap-to-place (not drag)
  const handlePitchPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (disabled || draggingRef.current) return

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
    if (disabled) return
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
    if (!draggingRef.current) return

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

      // Flush collected waypoints (batch possession/carrier-path recording)
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

  const { width: viewBoxW, height: viewBoxH } = getViewBox(orientation)
  const groupTransform = getPitchGroupTransform(orientation)

  const defaultContainerClassName = orientation === 'vertical'
    ? 'relative w-full aspect-[1446/2332] bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden'
    : 'relative w-full aspect-[16/10] bg-gradient-to-br from-green-900/40 to-green-800/40 rounded-2xl overflow-hidden'

  return (
    <div
      ref={containerRef}
      className={containerClassName ?? defaultContainerClassName}
      style={{ position: 'relative' }}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
        className={disabled ? 'w-full h-full opacity-40 pointer-events-none' : 'w-full h-full cursor-pointer'}
        style={{ touchAction: 'none' }}
        onPointerUp={handlePitchPointerUp}
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* All pitch content lives in native (horizontal) pitch-space inside
            this single group — orientation is applied ONLY here, as a real
            SVG transform, never by re-deriving rotated coordinates by hand. */}
        <g ref={groupRef} transform={groupTransform}>
          {/* Background */}
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />

          {/* Use the EXACT pitch from the SVG file */}
          <image
            href="/pitch-svg.svg"
            width={PITCH.svgW}
            height={PITCH.svgH}
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Trail (rendered before ball) */}
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
              style={{ cursor: disabled ? 'default' : 'grab' }}
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

          {/* Optional overlay — rendered inside SVG so it scales/rotates with the pitch */}
          {svgOverlay && (
            <foreignObject x="30" y="25" width="1000" height="120">
              {svgOverlay}
            </foreignObject>
          )}

          {/* Gradient border — drawn inside SVG at the pitch edge */}
          {gradientBorder && (
            <>
              <defs>
                <linearGradient id="taggingPitchBorderGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#00E676" />
                  <stop offset="100%" stopColor="#00B0FF" />
                </linearGradient>
              </defs>
              <rect
                x="1" y="1" width={PITCH.svgW - 2} height={PITCH.svgH - 2} rx="8"
                fill="none"
                stroke="url(#taggingPitchBorderGradient)"
                strokeWidth="4"
                pointerEvents="none"
              />
            </>
          )}
        </g>
      </svg>
    </div>
  )
}
