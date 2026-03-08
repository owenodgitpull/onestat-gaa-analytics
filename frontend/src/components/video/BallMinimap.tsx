/**
 * BallMinimap — Compact draggable ball tracker overlaid on the video player.
 *
 * A small pitch SVG (~300x185px) positioned over the video area.
 * User drags the ball or taps the pitch to place/move the ball.
 * Trail shows recent ball path as a zig-zag line with dots (~50 positions).
 * The whole minimap can be repositioned by dragging the grip handle at the top.
 * Flip button mirrors the pitch so it matches the camera angle.
 * DEF/ATT labels show which direction the team is attacking.
 */

import { useRef, useState, useCallback, useMemo } from 'react'
import { GripHorizontal, FlipHorizontal2 } from 'lucide-react'

const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,
  top: 123,
  playW: 1960,
  playH: 1167,
}

/** Convert pitch percentage (0-100) to SVG coordinates. */
const toSvg = (xPct: number, yPct: number) => ({
  x: PITCH.left + (xPct / 100) * PITCH.playW,
  y: PITCH.top + (yPct / 100) * PITCH.playH,
})

/** Convert SVG coordinates to pitch percentage (0-100), clamped. */
const fromSvg = (svgX: number, svgY: number) => ({
  x: Math.max(0, Math.min(100, ((svgX - PITCH.left) / PITCH.playW) * 100)),
  y: Math.max(0, Math.min(100, ((svgY - PITCH.top) / PITCH.playH) * 100)),
})

const MINIMAP_W = 300
const MINIMAP_H = 185
const HANDLE_H = 22

interface BallMinimapProps {
  ballPosition: { x: number; y: number } | null
  possession: 'team_a' | 'team_b'
  onBallMove: (x: number, y: number) => void
  trail: Array<{ x: number; y: number }>
  disabled?: boolean
}

export default function BallMinimap({
  ballPosition,
  possession,
  onBallMove,
  trail,
  disabled = false,
}: BallMinimapProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingBallRef = useRef(false)

  // Widget position — null = default CSS position (bottom-14 right-2)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const widgetDragRef = useRef(false)
  const widgetDragStart = useRef({ mouseX: 0, mouseY: 0, elX: 0, elY: 0 })

  // Pitch orientation — when flipped, x-axis is mirrored so left=ATT, right=DEF
  const [flipped, setFlipped] = useState(false)

  const ballColor = possession === 'team_a' ? '#10b981' : '#f59e0b'

  /** Apply flip to x coordinate: when flipped, 0↔100 */
  const flipX = useCallback((x: number) => flipped ? 100 - x : x, [flipped])

  // ── Ball interactions ──────────────────────────────────────────────────

  const getSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current
    if (!svg) return null
    const pt = svg.createSVGPoint()
    pt.x = clientX
    pt.y = clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return null
    const svgPt = pt.matrixTransform(ctm.inverse())
    const raw = fromSvg(svgPt.x, svgPt.y)
    // Un-flip so the stored coordinate is always in canonical space (0=DEF, 100=ATT)
    return { x: flipX(raw.x), y: raw.y }
  }, [flipX])

  const handleBallPointerDown = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    draggingBallRef.current = true
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }, [disabled])

  const handleBallPointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingBallRef.current || disabled) return
    e.preventDefault()
    const coords = getSvgCoords(e.clientX, e.clientY)
    if (coords) {
      onBallMove(coords.x, coords.y)
    }
  }, [disabled, getSvgCoords, onBallMove])

  const handleBallPointerUp = useCallback((e: React.PointerEvent) => {
    if (!draggingBallRef.current) return
    draggingBallRef.current = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }, [])

  // Tap on pitch background to place ball
  const handlePitchTap = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    const coords = getSvgCoords(e.clientX, e.clientY)
    if (coords) {
      onBallMove(coords.x, coords.y)
    }
  }, [disabled, getSvgCoords, onBallMove])

  // ── Widget drag (handle) ───────────────────────────────────────────────

  const handleWidgetDragStart = useCallback((e: React.PointerEvent) => {
    if (disabled) return
    e.preventDefault()
    e.stopPropagation()
    widgetDragRef.current = true
    ;(e.target as Element).setPointerCapture(e.pointerId)

    const container = containerRef.current
    const parent = container?.parentElement
    if (!container || !parent) return

    const parentRect = parent.getBoundingClientRect()
    const elRect = container.getBoundingClientRect()

    const currentX = elRect.left - parentRect.left
    const currentY = elRect.top - parentRect.top

    widgetDragStart.current = {
      mouseX: e.clientX,
      mouseY: e.clientY,
      elX: currentX,
      elY: currentY,
    }
  }, [disabled])

  const handleWidgetDragMove = useCallback((e: React.PointerEvent) => {
    if (!widgetDragRef.current) return
    e.preventDefault()

    const parent = containerRef.current?.parentElement
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()

    const dx = e.clientX - widgetDragStart.current.mouseX
    const dy = e.clientY - widgetDragStart.current.mouseY

    const newX = Math.max(0, Math.min(parentRect.width - MINIMAP_W, widgetDragStart.current.elX + dx))
    const newY = Math.max(0, Math.min(parentRect.height - (MINIMAP_H + HANDLE_H), widgetDragStart.current.elY + dy))

    setPosition({ x: newX, y: newY })
  }, [])

  const handleWidgetDragEnd = useCallback((e: React.PointerEvent) => {
    if (!widgetDragRef.current) return
    widgetDragRef.current = false
    ;(e.target as Element).releasePointerCapture(e.pointerId)
  }, [])

  // ── Trail rendering ────────────────────────────────────────────────────

  // Display coordinates: apply flip for visual rendering
  const displayBall = ballPosition ? toSvg(flipX(ballPosition.x), ballPosition.y) : null

  const trailSvgPoints = useMemo(
    () => trail.map(pos => toSvg(flipX(pos.x), pos.y)),
    [trail, flipX],
  )

  const trailPath = useMemo(() => {
    if (trailSvgPoints.length < 2) return ''
    return trailSvgPoints.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x},${pt.y}`).join(' ')
  }, [trailSvgPoints])

  // ── Direction labels ───────────────────────────────────────────────────

  const leftLabel = flipped ? 'ATT' : 'DEF'
  const rightLabel = flipped ? 'DEF' : 'ATT'
  const leftColor = flipped ? 'rgba(239, 68, 68, 0.6)' : 'rgba(16, 185, 129, 0.5)'
  const rightColor = flipped ? 'rgba(16, 185, 129, 0.5)' : 'rgba(239, 68, 68, 0.6)'

  // ── Positioning ────────────────────────────────────────────────────────

  const positionStyle: React.CSSProperties = position
    ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' }
    : {}

  const positionClass = position ? '' : 'top-10 right-2'

  return (
    <div
      ref={containerRef}
      className={`absolute z-20 flex flex-col rounded-lg border border-white/15 overflow-hidden shadow-lg transition-opacity ${
        disabled ? 'opacity-40 pointer-events-none' : 'opacity-80 hover:opacity-95'
      } ${positionClass}`}
      style={{ width: MINIMAP_W, ...positionStyle }}
    >
      {/* Drag handle + flip button */}
      <div
        className="flex items-center justify-between bg-white/[0.06] hover:bg-white/[0.12] transition-colors select-none"
        style={{ height: HANDLE_H, touchAction: 'none' }}
      >
        {/* Spacer for centering grip */}
        <div style={{ width: 28 }} />

        {/* Grip (draggable area) */}
        <div
          className="flex-1 flex items-center justify-center cursor-grab active:cursor-grabbing h-full"
          onPointerDown={handleWidgetDragStart}
          onPointerMove={handleWidgetDragMove}
          onPointerUp={handleWidgetDragEnd}
        >
          <GripHorizontal size={14} className="text-white/30" />
        </div>

        {/* Flip button */}
        <button
          onClick={(e) => { e.stopPropagation(); setFlipped(f => !f) }}
          className={`flex items-center justify-center gap-1 px-2 h-full rounded-l-md text-[9px] font-bold uppercase tracking-wide transition-all ${
            flipped
              ? 'text-amber-300 bg-amber-500/25 border-l border-amber-400/30'
              : 'text-white/70 bg-white/10 border-l border-white/10 hover:bg-white/20 hover:text-white'
          }`}
          title="Flip pitch orientation"
        >
          <FlipHorizontal2 size={13} />
          Flip
        </button>
      </div>

      {/* Pitch SVG */}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`}
        className="w-full"
        style={{ height: MINIMAP_H, touchAction: 'none' }}
        onPointerUp={handlePitchTap}
      >
        {/* Pitch background */}
        <rect width={PITCH.svgW} height={PITCH.svgH} fill="#1a3d0f" />
        <image
          href="/pitch-svg.svg"
          width={PITCH.svgW}
          height={PITCH.svgH}
          preserveAspectRatio="xMidYMid meet"
          style={{ pointerEvents: 'none' }}
        />

        {/* Direction labels — DEF / ATT on each end */}
        <text
          x={PITCH.left + 60}
          y={PITCH.top + PITCH.playH / 2 + 14}
          textAnchor="middle"
          fill={leftColor}
          fontSize={70}
          fontWeight="bold"
          style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '4px' }}
        >
          {leftLabel}
        </text>
        <text
          x={PITCH.left + PITCH.playW - 60}
          y={PITCH.top + PITCH.playH / 2 + 14}
          textAnchor="middle"
          fill={rightColor}
          fontSize={70}
          fontWeight="bold"
          style={{ pointerEvents: 'none', userSelect: 'none', letterSpacing: '4px' }}
        >
          {rightLabel}
        </text>

        {/* Arrow showing attacking direction */}
        <text
          x={flipped ? PITCH.left + 160 : PITCH.left + PITCH.playW - 160}
          y={PITCH.top + PITCH.playH / 2 + 50}
          textAnchor="middle"
          fill={flipped ? 'rgba(239, 68, 68, 0.35)' : 'rgba(239, 68, 68, 0.35)'}
          fontSize={50}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {flipped ? '← →' : '→'}
        </text>

        {/* Trail — connecting zig-zag line */}
        {trailPath && (
          <path
            d={trailPath}
            fill="none"
            stroke={ballColor}
            strokeWidth={6}
            strokeOpacity={0.35}
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Trail — dots at each position, fading from old to new */}
        {trailSvgPoints.map((pt, i) => {
          const t = (i + 1) / trailSvgPoints.length  // 0→1 (oldest→newest)
          const opacity = 0.15 + t * 0.55             // 0.15 → 0.70
          const r = 14 + t * 14                       // 14 → 28
          return (
            <circle
              key={i}
              cx={pt.x}
              cy={pt.y}
              r={r}
              fill={ballColor}
              opacity={opacity}
              style={{ pointerEvents: 'none' }}
            />
          )
        })}

        {/* Ball */}
        {displayBall && (
          <circle
            cx={displayBall.x}
            cy={displayBall.y}
            r={55}
            fill={ballColor}
            stroke="white"
            strokeWidth={8}
            style={{ cursor: disabled ? 'default' : 'grab', touchAction: 'none' }}
            onPointerDown={handleBallPointerDown}
            onPointerMove={handleBallPointerMove}
            onPointerUp={handleBallPointerUp}
          />
        )}
      </svg>
    </div>
  )
}
