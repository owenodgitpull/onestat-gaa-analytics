/**
 * PitchZoneSelector — 18-zone clickable GAA pitch SVG overlay for video tagging.
 *
 * Uses the same pitch-svg.svg background as ShootingEfficiencyHeatmap.
 * 6×3 grid: DEF/MID/HF/FWD/IF/SQ × LEFT/CENTRE/RIGHT.
 * DEF, MID, HF rows are two-pointer territory (outside 40m arc).
 *
 * Orientation: left = own goal (DEF), right = opponent goal (SQ).
 * x: 0=own goal → 100=opp goal, y: 0=left → 100=right.
 */

import { useState, useEffect } from 'react'

// ── Zone constants ───────────────────────────────────────────────────────

export const PITCH_ZONES = [
  'DEF_LEFT', 'DEF_CENTRE', 'DEF_RIGHT',
  'MID_LEFT', 'MID_CENTRE', 'MID_RIGHT',
  'HF_LEFT', 'HF_CENTRE', 'HF_RIGHT',
  'FWD_LEFT', 'FWD_CENTRE', 'FWD_RIGHT',
  'IF_LEFT', 'IF_CENTRE', 'IF_RIGHT',
  'SQ_LEFT', 'SQ_CENTRE', 'SQ_RIGHT',
] as const

export type PitchZone = typeof PITCH_ZONES[number]

export const TWO_POINTER_ZONES: PitchZone[] = [
  'DEF_LEFT', 'DEF_CENTRE', 'DEF_RIGHT',
  'MID_LEFT', 'MID_CENTRE', 'MID_RIGHT',
  'HF_LEFT', 'HF_CENTRE', 'HF_RIGHT',
]

/** Descriptive text for each zone */
const ZONE_DESCRIPTIONS: Record<PitchZone, string> = {
  DEF_LEFT: 'Defence, left side',
  DEF_CENTRE: 'Defence, centre',
  DEF_RIGHT: 'Defence, right side',
  MID_LEFT: 'Midfield, left side',
  MID_CENTRE: 'Midfield, centre',
  MID_RIGHT: 'Midfield, right side',
  HF_LEFT: 'Half Forward, left side',
  HF_CENTRE: 'Half Forward, centre',
  HF_RIGHT: 'Half Forward, right side',
  FWD_LEFT: 'Full Forward, left side',
  FWD_CENTRE: 'Full Forward, centre',
  FWD_RIGHT: 'Full Forward, right side',
  IF_LEFT: 'Inside 21m, left side',
  IF_CENTRE: 'Inside 21m, centre',
  IF_RIGHT: 'Inside 21m, right side',
  SQ_LEFT: 'Square, left side',
  SQ_CENTRE: 'Square, centre',
  SQ_RIGHT: 'Square, right side',
}

/** Short labels for the SVG overlay */
const ZONE_LABELS: Record<PitchZone, string> = {
  DEF_LEFT: 'DEF L', DEF_CENTRE: 'DEF', DEF_RIGHT: 'DEF R',
  MID_LEFT: 'MID L', MID_CENTRE: 'MID', MID_RIGHT: 'MID R',
  HF_LEFT: 'HF L', HF_CENTRE: 'HF', HF_RIGHT: 'HF R',
  FWD_LEFT: 'FWD L', FWD_CENTRE: 'FWD', FWD_RIGHT: 'FWD R',
  IF_LEFT: 'IF L', IF_CENTRE: 'IF', IF_RIGHT: 'IF R',
  SQ_LEFT: 'SQ L', SQ_CENTRE: 'SQ', SQ_RIGHT: 'SQ R',
}

// ── Zone coordinate mapping (0-100 scale) ────────────────────────────────
// x: 0 = own goal line → 100 = opponent goal line
// y: 0 = left sideline → 100 = right sideline

interface ZoneDef {
  id: PitchZone
  xMin: number; xMax: number
  yMin: number; yMax: number
}

const ZONE_DEFS: ZoneDef[] = [
  // Row 1: DEF (x 0–17)
  { id: 'DEF_LEFT',   xMin: 0,  xMax: 17, yMin: 0,  yMax: 33 },
  { id: 'DEF_CENTRE', xMin: 0,  xMax: 17, yMin: 33, yMax: 67 },
  { id: 'DEF_RIGHT',  xMin: 0,  xMax: 17, yMin: 67, yMax: 100 },
  // Row 2: MID (x 17–33)
  { id: 'MID_LEFT',   xMin: 17, xMax: 33, yMin: 0,  yMax: 33 },
  { id: 'MID_CENTRE', xMin: 17, xMax: 33, yMin: 33, yMax: 67 },
  { id: 'MID_RIGHT',  xMin: 17, xMax: 33, yMin: 67, yMax: 100 },
  // Row 3: HF (x 33–50)
  { id: 'HF_LEFT',    xMin: 33, xMax: 50, yMin: 0,  yMax: 33 },
  { id: 'HF_CENTRE',  xMin: 33, xMax: 50, yMin: 33, yMax: 67 },
  { id: 'HF_RIGHT',   xMin: 33, xMax: 50, yMin: 67, yMax: 100 },
  // Row 4: FWD (x 50–67)
  { id: 'FWD_LEFT',   xMin: 50, xMax: 67, yMin: 0,  yMax: 33 },
  { id: 'FWD_CENTRE', xMin: 50, xMax: 67, yMin: 33, yMax: 67 },
  { id: 'FWD_RIGHT',  xMin: 50, xMax: 67, yMin: 67, yMax: 100 },
  // Row 5: IF (x 67–83)
  { id: 'IF_LEFT',    xMin: 67, xMax: 83, yMin: 0,  yMax: 33 },
  { id: 'IF_CENTRE',  xMin: 67, xMax: 83, yMin: 33, yMax: 67 },
  { id: 'IF_RIGHT',   xMin: 67, xMax: 83, yMin: 67, yMax: 100 },
  // Row 6: SQ (x 83–100)
  { id: 'SQ_LEFT',    xMin: 83, xMax: 100, yMin: 0,  yMax: 33 },
  { id: 'SQ_CENTRE',  xMin: 83, xMax: 100, yMin: 33, yMax: 67 },
  { id: 'SQ_RIGHT',   xMin: 83, xMax: 100, yMin: 67, yMax: 100 },
]

// ── SVG pitch constants (matching pitch-svg.svg) ─────────────────────────

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

// ── Component ────────────────────────────────────────────────────────────

interface PitchZoneSelectorProps {
  selectedZone: PitchZone | null
  onZoneSelect: (zone: PitchZone) => void
  highlightTwoPointer?: boolean
}

export default function PitchZoneSelector({
  selectedZone,
  onZoneSelect,
  highlightTwoPointer = true,
}: PitchZoneSelectorProps) {
  const [toastText, setToastText] = useState<string | null>(null)
  const [hoveredZone, setHoveredZone] = useState<PitchZone | null>(null)

  const isTwoPointer = selectedZone ? TWO_POINTER_ZONES.includes(selectedZone) : false

  // Auto-clear toast
  useEffect(() => {
    if (!toastText) return
    const timer = setTimeout(() => setToastText(null), 2000)
    return () => clearTimeout(timer)
  }, [toastText])

  const handleZoneClick = (zone: PitchZone) => {
    onZoneSelect(zone)
    setToastText(ZONE_DESCRIPTIONS[zone])
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-white/50 uppercase tracking-wider">Pitch Zone</span>
        {isTwoPointer && (
          <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-0.5 rounded-full font-medium">
            2pt Zone
          </span>
        )}
      </div>

      {/* SVG Pitch with zone overlays */}
      <div className="relative rounded-lg overflow-hidden border border-white/10">
        <svg
          viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`}
          className="w-full h-auto"
        >
          {/* GAA pitch background */}
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#1a3d0f" />
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

            const isSelected = selectedZone === zone.id
            const isHovered = hoveredZone === zone.id
            const isTwoPt = TWO_POINTER_ZONES.includes(zone.id)

            let fill: string
            if (isSelected) {
              fill = 'rgba(16, 185, 129, 0.5)'  // emerald
            } else if (isHovered) {
              fill = isTwoPt && highlightTwoPointer
                ? 'rgba(6, 182, 212, 0.3)'   // cyan hover
                : 'rgba(255, 255, 255, 0.15)'
            } else if (isTwoPt && highlightTwoPointer) {
              fill = 'rgba(6, 182, 212, 0.1)'   // cyan tint
            } else {
              fill = 'rgba(0, 0, 0, 0.15)'
            }

            const strokeColor = isSelected
              ? 'rgba(16, 185, 129, 0.8)'
              : 'rgba(255, 255, 255, 0.2)'
            const strokeWidth = isSelected ? 4 : 2

            return (
              <g
                key={zone.id}
                onClick={() => handleZoneClick(zone.id)}
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
                  stroke={strokeColor}
                  strokeWidth={strokeWidth}
                  rx={4}
                />
                <text
                  x={cx}
                  y={cy + 8}
                  textAnchor="middle"
                  fill={isSelected ? 'white' : 'rgba(255,255,255,0.6)'}
                  fontSize={40}
                  fontWeight={isSelected ? 'bold' : 'normal'}
                  style={{
                    pointerEvents: 'none',
                    textShadow: '0 1px 4px rgba(0,0,0,0.8)',
                    userSelect: 'none',
                  }}
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
            fill="rgba(16, 185, 129, 0.6)"
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
            fill="rgba(239, 68, 68, 0.6)"
            fontSize={36}
            fontWeight="bold"
            transform={`rotate(90, ${PITCH.left + PITCH.playW + 20}, ${PITCH.top + PITCH.playH / 2})`}
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            ATTACKING
          </text>
        </svg>
      </div>

      {/* Descriptive toast */}
      {toastText && (
        <div className="text-center text-xs text-white/60 bg-white/5 rounded-lg py-1.5 px-3 animate-fade-in">
          {toastText}
          {isTwoPointer && <span className="ml-1.5 text-cyan-400 font-bold">2pt zone</span>}
        </div>
      )}
    </div>
  )
}
