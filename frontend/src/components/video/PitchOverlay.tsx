/**
 * PitchOverlay — Pitch zone selector that overlays the video player.
 *
 * Renders a semi-transparent backdrop with the 18-zone SVG pitch centered.
 * User taps a zone → fires onZoneSelect → overlay dismisses.
 * Part of the three-tap flow: event → pitch zone → player number.
 */

import { useState } from 'react'
import { type PitchZone, TWO_POINTER_ZONES } from './PitchZoneSelector'

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

interface PitchOverlayProps {
  eventLabel: string
  onZoneSelect: (zone: PitchZone) => void
  onCancel: () => void
}

export default function PitchOverlay({ eventLabel, onZoneSelect, onCancel }: PitchOverlayProps) {
  const [hoveredZone, setHoveredZone] = useState<PitchZone | null>(null)

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-[3px]"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Instruction pill */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-emerald-500 text-white px-4 py-1.5 rounded-full text-xs font-bold shadow-lg shadow-emerald-500/30 z-10">
        Tap where it happened
      </div>

      {/* Event context */}
      <div className="absolute top-12 left-1/2 -translate-x-1/2 text-white/50 text-[11px] font-medium z-10">
        {eventLabel}
      </div>

      {/* Pitch SVG */}
      <div className="w-[88%] max-w-[720px]">
        <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full h-auto">
          {/* Background */}
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#1a3d0f" rx={16} />
          <image
            href="/pitch-svg.svg"
            width={PITCH.svgW}
            height={PITCH.svgH}
            preserveAspectRatio="xMidYMid meet"
          />

          {/* Zone overlays */}
          {ZONE_DEFS.map(zone => {
            const topLeft = toSvg(zone.xMin, zone.yMin)
            const bottomRight = toSvg(zone.xMax, zone.yMax)
            const w = bottomRight.x - topLeft.x
            const h = bottomRight.y - topLeft.y
            const cx = topLeft.x + w / 2
            const cy = topLeft.y + h / 2
            const isTwoPt = TWO_POINTER_ZONES.includes(zone.id)
            const isHovered = hoveredZone === zone.id

            let fill: string
            if (isHovered) {
              fill = 'rgba(16, 185, 129, 0.35)'
            } else if (isTwoPt) {
              fill = 'rgba(6, 182, 212, 0.08)'
            } else {
              fill = 'rgba(0, 0, 0, 0.1)'
            }

            return (
              <g
                key={zone.id}
                onClick={(e) => { e.stopPropagation(); onZoneSelect(zone.id) }}
                onMouseEnter={() => setHoveredZone(zone.id)}
                onMouseLeave={() => setHoveredZone(null)}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={topLeft.x}
                  y={topLeft.y}
                  width={w}
                  height={h}
                  fill={fill}
                  stroke={isHovered ? 'rgba(16, 185, 129, 0.6)' : 'rgba(255, 255, 255, 0.15)'}
                  strokeWidth={isHovered ? 3 : 2}
                  rx={4}
                />
                <text
                  x={cx}
                  y={cy + 8}
                  textAnchor="middle"
                  fill={isHovered ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.5)'}
                  fontSize={40}
                  fontWeight={isHovered ? 'bold' : 'normal'}
                  style={{ pointerEvents: 'none', textShadow: '0 1px 4px rgba(0,0,0,0.8)', userSelect: 'none' }}
                >
                  {ZONE_LABELS[zone.id]}
                </text>
              </g>
            )
          })}

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
