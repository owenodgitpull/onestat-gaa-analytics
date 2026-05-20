import { useMemo } from 'react'
import { Target } from 'lucide-react'
import type { ShotLocation } from '@/services/api'

interface Props {
  shots: ShotLocation[]
}

// ─── Pitch SVG constants ───────────────────────────────────────────────────
const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }
const toSvg = (xPct: number, yPct: number) => ({
  x: PITCH.left + (xPct / 100) * PITCH.playW,
  y: PITCH.top  + (yPct / 100) * PITCH.playH,
})

// ─── 40m arc geometry ─────────────────────────────────────────────────────
// Goal center in pitch-% coords: (100, 50). 40m radius as % of 145m pitch.
const ARC_R_PCT = (40 / 145) * 100          // ≈ 27.59 %
const GOAL_SVG_X = PITCH.left + PITCH.playW // = 2143
const GOAL_SVG_Y = PITCH.top + PITCH.playH / 2  // ≈ 706.5
const ARC_R_SVG  = (ARC_R_PCT / 100) * PITCH.playW // ≈ 541

// Arc endpoints on the goal line (the D-shape start/end)
const ARC_TOP_Y = GOAL_SVG_Y - ARC_R_SVG   // ≈ 165.5  (within pitch area)
const ARC_BOT_Y = GOAL_SVG_Y + ARC_R_SVG   // ≈ 1247.5 (within pitch area)

// SVG path for the D-shape (inside the 40m arc): arc sweeps left then closes
const INSIDE_ARC_PATH =
  `M ${GOAL_SVG_X} ${ARC_TOP_Y} A ${ARC_R_SVG} ${ARC_R_SVG} 0 0 0 ${GOAL_SVG_X} ${ARC_BOT_Y} Z`

// 20m line from opponent goal — outer boundary of the 2-point zone
// 20m from opponent's end = (145-20)/145 * 100 ≈ 86.21% from own goal
const X_20M_PCT = (125 / 145) * 100
const X_20M_SVG = PITCH.left + (X_20M_PCT / 100) * PITCH.playW  // ≈ 1873

const X65_SVG = PITCH.left + 0.65 * PITCH.playW   // ≈ 1457

// ─── Helpers ──────────────────────────────────────────────────────────────
function inArc(x: number, y: number) {
  return Math.hypot(x - 100, y - 50) <= ARC_R_PCT
}

// Higher-opacity, more distinct colours so they read clearly on dark green
function getColor(pct: number) {
  if (pct >= 70) return 'rgba(16,185,129,0.75)'   // emerald
  if (pct >= 50) return 'rgba(234,179,8,0.80)'    // bright yellow — clearly different from green
  if (pct >= 30) return 'rgba(249,115,22,0.75)'   // orange
  return 'rgba(239,68,68,0.75)'                    // red
}
function getTwoPointColor(pct: number) {
  if (pct >= 70) return 'rgba(16,185,129,0.65)'
  if (pct >= 50) return 'rgba(234,179,8,0.65)'
  if (pct >= 30) return 'rgba(249,115,22,0.65)'
  return 'rgba(239,68,68,0.65)'
}

// ─── Zone definitions ──────────────────────────────────────────────────────
// xMin/xMax/yMin/yMax define the bounding rect; arcBased applies the arc filter
interface ZoneDef {
  id: string; label: string
  xMin: number; xMax: number; yMin: number; yMax: number
  arcBased?: 'inside' | 'outside'
  twoPoint?: boolean
}

const ZONES: ZoneDef[] = [
  // Inside 40m arc — clipped to D-shape
  { id: 'close_left',   label: 'Close Left',   xMin: 65, xMax: 100, yMin: 0,  yMax: 33,  arcBased: 'inside' },
  { id: 'close_center', label: 'Close Centre',  xMin: 65, xMax: 100, yMin: 33, yMax: 67,  arcBased: 'inside' },
  { id: 'close_right',  label: 'Close Right',  xMin: 65, xMax: 100, yMin: 67, yMax: 100, arcBased: 'inside' },
  // Outside 40m arc, bounded by 20m line — crescent shape
  { id: 'two_point', label: '2-Point Zone', xMin: 65, xMax: X_20M_PCT, yMin: 0, yMax: 100, arcBased: 'outside', twoPoint: true },
  // Long range (rect, no arc constraint needed)
  { id: 'long_left',   label: 'Long Left',   xMin: 35, xMax: 65, yMin: 0,  yMax: 33  },
  { id: 'long_center', label: 'Long Centre',  xMin: 35, xMax: 65, yMin: 33, yMax: 67  },
  { id: 'long_right',  label: 'Long Right',  xMin: 35, xMax: 65, yMin: 67, yMax: 100 },
]

export default function ShootingEfficiencyHeatmap({ shots }: Props) {
  const teamShots = useMemo(() => shots.filter(s => s.team === 'own'), [shots])

  const zoneStats = useMemo(() => {
    return ZONES.map(zone => {
      const inBox = (s: ShotLocation) =>
        s.x >= zone.xMin && s.x < zone.xMax && s.y >= zone.yMin && s.y < zone.yMax
      const zoneShots = teamShots.filter(s => {
        if (!inBox(s)) return false
        if (zone.arcBased === 'inside')  return  inArc(s.x, s.y)
        if (zone.arcBased === 'outside') return !inArc(s.x, s.y)
        return true
      })
      const total  = zoneShots.length
      const scored = zoneShots.filter(s => s.is_score).length
      const pct    = total > 0 ? Math.round((scored / total) * 100) : -1
      return { ...zone, total, scored, pct }
    })
  }, [teamShots])

  const insight = useMemo(() => {
    const z = zoneStats.filter(z => z.total >= 3)
    if (!z.length) return null
    const best  = z.reduce((a, b) => a.pct > b.pct ? a : b)
    const worst = z.reduce((a, b) => a.pct < b.pct ? a : b)
    if (worst.pct < 40)
      return `Low conversion from ${worst.label.toLowerCase()} (${worst.pct}% from ${worst.total} shots). Best: ${best.label.toLowerCase()} at ${best.pct}%.`
    return `Strongest from ${best.label.toLowerCase()} (${best.pct}% from ${best.total} shots).`
  }, [zoneStats])

  // Centre SVG coords for a zone's bounding rect (for text placement)
  const zoneCentre = (z: ZoneDef) => {
    const tl = toSvg(z.xMin, z.yMin)
    const br = toSvg(z.xMax, z.yMax)
    return { cx: (tl.x + br.x) / 2, cy: (tl.y + br.y) / 2, tl, br }
  }

  const standardZones = zoneStats.filter(z => !z.twoPoint)
  const twoPointZone  = zoneStats.find(z => z.twoPoint)!

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Target size={20} />
          Shooting Efficiency
        </h3>
      </div>

      {teamShots.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40">No shot data available</div>
      ) : (
        <>
          <div className="relative rounded-xl overflow-hidden flex-1 min-h-0">
            <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full h-full">
              <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
              <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

              <defs>
                {/* D-shape clip — used only for close zones (inside the 40m arc) */}
                <clipPath id="seh-inside-arc">
                  <path d={INSIDE_ARC_PATH} />
                </clipPath>
              </defs>

              {/* ── RENDER ORDER: long → 2-pt orange → solid D backdrop → close zones → arc line → text ──
                   A solid pitch-green rect clipped to the D-shape sits between the orange and
                   the close zone fills, blocking any bleed-through from the semi-transparent
                   efficiency colours. No evenodd clip needed. ── */}

              {/* 1. Long zones (plain rects, no arc clipping needed) */}
              {standardZones.filter(z => !z.arcBased).map(zone => {
                const { tl, br } = zoneCentre(zone)
                return (
                  <rect key={zone.id}
                    x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                    fill={zone.total === 0 ? 'rgba(0,0,0,0.28)' : getColor(zone.pct)}
                    stroke="rgba(255,255,255,0.22)" strokeWidth="2"
                  />
                )
              })}

              {/* 2. 2-Point zone: simple full-height rect from 65% to 20m line.
                   Rendered BEFORE close zones so green covers the inside-arc portion. */}
              {(() => {
                const z = twoPointZone
                const x0 = PITCH.left + (z.xMin / 100) * PITCH.playW
                const w2 = X_20M_SVG - x0
                const fill = z.total === 0 ? 'rgba(251,191,36,0.12)' : getTwoPointColor(z.pct)
                return (
                  <g key="two-point-fill">
                    <rect x={x0} y={PITCH.top} width={w2} height={PITCH.playH} fill={fill} />
                    <rect x={x0} y={PITCH.top} width={w2} height={PITCH.playH}
                      fill="none" stroke="rgba(251,191,36,0.75)" strokeWidth="5" strokeDasharray="24 14" />
                  </g>
                )
              })()}

              {/* 3. Solid pitch-green backdrop inside D-shape — blocks orange from bleeding
                   through the semi-transparent close zone efficiency fills */}
              <g clipPath="url(#seh-inside-arc)">
                <rect x={PITCH.left} y={PITCH.top} width={PITCH.playW} height={PITCH.playH} fill="#2d5016" />
              </g>

              {/* 4. Close zones: clipped to inside-arc D-shape, rendered ON TOP of backdrop */}
              {standardZones.filter(z => z.arcBased === 'inside').map(zone => {
                const { tl, br } = zoneCentre(zone)
                return (
                  <g key={zone.id} clipPath="url(#seh-inside-arc)">
                    <rect
                      x={tl.x} y={tl.y} width={br.x - tl.x} height={br.y - tl.y}
                      fill={zone.total === 0 ? 'rgba(0,0,0,0.28)' : getColor(zone.pct)}
                      stroke="rgba(255,255,255,0.22)" strokeWidth="2"
                    />
                  </g>
                )
              })}

              {/* 4. 40m arc boundary line */}
              <path
                d={`M ${GOAL_SVG_X} ${ARC_TOP_Y} A ${ARC_R_SVG} ${ARC_R_SVG} 0 0 0 ${GOAL_SVG_X} ${ARC_BOT_Y}`}
                fill="none"
                stroke="rgba(251,191,36,0.70)" strokeWidth="5" strokeDasharray="18 10"
              />
              <text x={X65_SVG + 28} y={PITCH.top + 52}
                fill="rgba(251,191,36,0.55)" fontSize="30" fontStyle="italic">40m</text>

              {/* 5. All text rendered last — never clipped, always on top */}
              {standardZones.map(zone => {
                const { tl, cx, cy } = zoneCentre(zone)
                return (
                  <g key={`text-${zone.id}`}>
                    <text x={cx} y={cy - 28} textAnchor="middle" fill="white" fontSize="72" fontWeight="bold"
                      opacity={zone.total > 0 ? 1 : 0.3}>
                      {zone.total > 0 ? `${zone.pct}%` : '-'}
                    </text>
                    <text x={cx} y={cy + 32} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="42">
                      {zone.total > 0 ? `${zone.scored}/${zone.total}` : ''}
                    </text>
                    <text x={cx} y={tl.y + 52} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="36">
                      {zone.label}
                    </text>
                  </g>
                )
              })}
              {(() => {
                const z = twoPointZone
                const cx2 = (PITCH.left + (z.xMin / 100) * PITCH.playW + X_20M_SVG) / 2
                // Anchor text at the bottom of the crescent to keep clear of Close Left/Right labels at the top
                return (
                  <g key="text-two-point">
                    {z.total > 0 ? (
                      <>
                        <text x={cx2} y={ARC_BOT_Y - 210} textAnchor="middle" fill="white" fontSize="72" fontWeight="bold">
                          {z.pct}%
                        </text>
                        <text x={cx2} y={ARC_BOT_Y - 130} textAnchor="middle" fill="rgba(255,255,255,0.75)" fontSize="42">
                          {z.scored}/{z.total}
                        </text>
                      </>
                    ) : (
                      <text x={cx2} y={ARC_BOT_Y - 130} textAnchor="middle"
                        fill="rgba(251,191,36,0.35)" fontSize="44">No shots</text>
                    )}
                    <text x={cx2} y={ARC_BOT_Y - 55} textAnchor="middle"
                      fill="rgba(251,191,36,0.95)" fontSize="38" fontWeight="bold">
                      2-Point Zone
                    </text>
                  </g>
                )
              })()}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 text-xs flex-wrap">
            {[
              ['rgba(16,185,129,0.85)', '≥70%'],
              ['rgba(234,179,8,0.9)',   '50–69%'],
              ['rgba(249,115,22,0.85)', '30–49%'],
              ['rgba(239,68,68,0.85)',  '<30%'],
            ].map(([c, l]) => (
              <div key={l} className="flex items-center gap-1">
                <div className="w-3 h-3 rounded" style={{ background: c }} />
                <span className="text-white/60">{l}</span>
              </div>
            ))}
            <div className="flex items-center gap-1">
              <div className="w-4 h-2.5 rounded" style={{ border: '2px dashed rgba(251,191,36,0.7)' }} />
              <span className="text-white/60">2-Pt Zone</span>
            </div>
          </div>

          {insight && (
            <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10">
              <p className="text-sm text-white/80">{insight}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
