/**
 * PitchOverlay — Pitch location selector that overlays the video player.
 *
 * Renders a semi-transparent backdrop with the full SVG pitch centered.
 * User taps anywhere on the pitch to pinpoint exact location → fires
 * onZoneSelect with zone + precise x,y coordinates → overlay dismisses.
 * Zone grid lines shown for reference but tapping is free-form.
 * Part of the three-tap flow: event → pitch location → player number.
 */

import { useRef, useCallback } from 'react'
import { type PitchZone, TWO_POINTER_ZONES } from './PitchZoneSelector'
import { xyToZone } from './PitchZoneSelector'

const ZONE_LABELS: Record<PitchZone, string> = {
  DEF_LEFT: 'DEF L', DEF_CENTRE: 'DEF', DEF_RIGHT: 'DEF R',
  MID_LEFT: 'MID L', MID_CENTRE: 'MID', MID_RIGHT: 'MID R',
  HF_LEFT: 'HF L', HF_CENTRE: 'HF', HF_RIGHT: 'HF R',
  FWD_LEFT: 'FWD L', FWD_CENTRE: 'FWD', FWD_RIGHT: 'FWD R',
  IF_LEFT: 'IF L', IF_CENTRE: 'IF', IF_RIGHT: 'IF R',
  SQ_LEFT: 'SQ L', SQ_CENTRE: 'SQ', SQ_RIGHT: 'SQ R',
}

interface ZoneDef {
  id: PitchZone
  xMin: number; xMax: number
  yMin: number; yMax: number
}

const ZONE_DEFS: ZoneDef[] = [
  { id: 'DEF_LEFT',   xMin: 0,  xMax: 17, yMin: 0,  yMax: 33 },
  { id: 'DEF_CENTRE', xMin: 0,  xMax: 17, yMin: 33, yMax: 67 },
  { id: 'DEF_RIGHT',  xMin: 0,  xMax: 17, yMin: 67, yMax: 100 },
  { id: 'MID_LEFT',   xMin: 17, xMax: 33, yMin: 0,  yMax: 33 },
  { id: 'MID_CENTRE', xMin: 17, xMax: 33, yMin: 33, yMax: 67 },
  { id: 'MID_RIGHT',  xMin: 17, xMax: 33, yMin: 67, yMax: 100 },
  { id: 'HF_LEFT',    xMin: 33, xMax: 50, yMin: 0,  yMax: 33 },
  { id: 'HF_CENTRE',  xMin: 33, xMax: 50, yMin: 33, yMax: 67 },
  { id: 'HF_RIGHT',   xMin: 33, xMax: 50, yMin: 67, yMax: 100 },
  { id: 'FWD_LEFT',   xMin: 50, xMax: 67, yMin: 0,  yMax: 33 },
  { id: 'FWD_CENTRE', xMin: 50, xMax: 67, yMin: 33, yMax: 67 },
  { id: 'FWD_RIGHT',  xMin: 50, xMax: 67, yMin: 67, yMax: 100 },
  { id: 'IF_LEFT',    xMin: 67, xMax: 83, yMin: 0,  yMax: 33 },
  { id: 'IF_CENTRE',  xMin: 67, xMax: 83, yMin: 33, yMax: 67 },
  { id: 'IF_RIGHT',   xMin: 67, xMax: 83, yMin: 67, yMax: 100 },
  { id: 'SQ_LEFT',    xMin: 83, xMax: 100, yMin: 0,  yMax: 33 },
  { id: 'SQ_CENTRE',  xMin: 83, xMax: 100, yMin: 33, yMax: 67 },
  { id: 'SQ_RIGHT',   xMin: 83, xMax: 100, yMin: 67, yMax: 100 },
]

const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,
  top: 123,
  playW: 1960,
  playH: 1167,
}

const toSvg = (xPct: number, yPct: number) => ({
  x: PITCH.left + (xPct / 100) * PITCH.playW,
  y: PITCH.top + (yPct / 100) * PITCH.playH,
})

/** Convert SVG coordinates to pitch percentage (0-100), clamped. */
const fromSvg = (svgX: number, svgY: number) => ({
  x: Math.max(0, Math.min(100, ((svgX - PITCH.left) / PITCH.playW) * 100)),
  y: Math.max(0, Math.min(100, ((svgY - PITCH.top) / PITCH.playH) * 100)),
})

interface PitchOverlayProps {
  eventLabel: string
  onZoneSelect: (zone: PitchZone, pitchX?: number, pitchY?: number) => void
  onCancel: () => void
  suggestedZone?: string
}

export default function PitchOverlay({ eventLabel, onZoneSelect, onCancel, suggestedZone }: PitchOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  const handlePitchClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current
    if (!svg) return

    // Convert click to SVG coordinates
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return
    const svgPt = pt.matrixTransform(ctm.inverse())

    // Convert to pitch percentage
    const coords = fromSvg(svgPt.x, svgPt.y)

    // Derive zone from coordinates
    const zone = xyToZone(coords.x, coords.y)

    onZoneSelect(zone, coords.x, coords.y)
  }, [onZoneSelect])

  // Compute suggested zone marker position (centre of zone)
  const suggestedDef = suggestedZone ? ZONE_DEFS.find(z => z.id === suggestedZone) : null

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[3px]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Instruction pill */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-emerald-500/30 z-10">
        Tap exact location
      </div>

      {/* Event context */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 text-white/50 text-[11px] font-medium z-10">
        {eventLabel}
      </div>

      {/* Pitch SVG */}
      <div className="w-[88%] max-w-[720px]">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`}
          className="w-full h-auto"
          onClick={handlePitchClick}
          style={{ cursor: 'crosshair' }}
        >
          {/* Background */}
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#1a3d0f" rx={16} />
          <image
            href="/pitch-svg.svg"
            width={PITCH.svgW}
            height={PITCH.svgH}
            preserveAspectRatio="xMidYMid meet"
            style={{ pointerEvents: 'none' }}
          />

          {/* Zone grid lines + labels (reference only, not clickable) */}
          {ZONE_DEFS.map(zone => {
            const topLeft = toSvg(zone.xMin, zone.yMin)
            const bottomRight = toSvg(zone.xMax, zone.yMax)
            const w = bottomRight.x - topLeft.x
            const h = bottomRight.y - topLeft.y
            const cx = topLeft.x + w / 2
            const cy = topLeft.y + h / 2
            const isTwoPt = TWO_POINTER_ZONES.includes(zone.id)
            const isSuggested = suggestedZone === zone.id

            return (
              <g key={zone.id} style={{ pointerEvents: 'none' }}>
                <rect
                  x={topLeft.x}
                  y={topLeft.y}
                  width={w}
                  height={h}
                  fill={isSuggested ? 'rgba(16, 185, 129, 0.15)' : isTwoPt ? 'rgba(6, 182, 212, 0.05)' : 'transparent'}
                  stroke="rgba(255, 255, 255, 0.08)"
                  strokeWidth={1.5}
                  rx={4}
                />
                <text
                  x={cx}
                  y={cy + 8}
                  textAnchor="middle"
                  fill="rgba(255,255,255,0.25)"
                  fontSize={36}
                  fontWeight="normal"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)', userSelect: 'none' }}
                >
                  {ZONE_LABELS[zone.id]}
                </text>
              </g>
            )
          })}

          {/* Suggested position marker (pulsing dot at centre of suggested zone) */}
          {suggestedDef && (() => {
            const cx = (suggestedDef.xMin + suggestedDef.xMax) / 2
            const cy = (suggestedDef.yMin + suggestedDef.yMax) / 2
            const pt = toSvg(cx, cy)
            return (
              <g style={{ pointerEvents: 'none' }}>
                <circle cx={pt.x} cy={pt.y} r={30} fill="rgba(16, 185, 129, 0.3)">
                  <animate attributeName="r" values="30;45;30" dur="1.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
                </circle>
                <circle cx={pt.x} cy={pt.y} r={12} fill="#10b981" />
              </g>
            )
          })()}

          {/* End labels */}
          <text
            x={PITCH.left - 20}
            y={PITCH.top + PITCH.playH / 2}
            textAnchor="middle"
            fill="rgba(16, 185, 129, 0.5)"
            fontSize={36}
            fontWeight="bold"
            transform={`rotate(-90, ${PITCH.left - 20}, ${PITCH.top + PITCH.playH / 2})`}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            OWN GOAL
          </text>
          <text
            x={PITCH.left + PITCH.playW + 20}
            y={PITCH.top + PITCH.playH / 2}
            textAnchor="middle"
            fill="rgba(239, 68, 68, 0.5)"
            fontSize={36}
            fontWeight="bold"
            transform={`rotate(90, ${PITCH.left + PITCH.playW + 20}, ${PITCH.top + PITCH.playH / 2})`}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            ATTACKING
          </text>
        </svg>
      </div>

      {/* Cancel button */}
      <button
        onClick={onCancel}
        className="absolute bottom-4 right-4 px-4 py-2 rounded-lg border border-white/20 bg-slate-800/80 text-white/60 text-xs font-semibold hover:bg-slate-700/80 transition-colors"
      >
        Cancel (Esc)
      </button>
    </div>
  )
}
