import { useMemo } from 'react'
import { Target } from 'lucide-react'
import type { ShotLocation } from '@/services/api'

interface Props {
  shots: ShotLocation[]
}

// Zones mapped to GAA pitch coordinates (0-100 range matching shot_locations)
// x: 0=own goal line, 100=opponent goal line
// y: 0=left sideline, 100=right sideline
const ZONES = [
  { id: 'close_left',   label: 'Close Left',   xMin: 65, xMax: 100, yMin: 0,  yMax: 33 },
  { id: 'close_center', label: 'Close Centre',  xMin: 65, xMax: 100, yMin: 33, yMax: 67 },
  { id: 'close_right',  label: 'Close Right',  xMin: 65, xMax: 100, yMin: 67, yMax: 100 },
  { id: 'long_left',    label: 'Long Left',    xMin: 35, xMax: 65,  yMin: 0,  yMax: 33 },
  { id: 'long_center',  label: 'Long Centre',   xMin: 35, xMax: 65,  yMin: 33, yMax: 67 },
  { id: 'long_right',   label: 'Long Right',   xMin: 35, xMax: 65,  yMin: 67, yMax: 100 },
]

// GAA pitch SVG coordinate system (matching pitch-svg.svg)
const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,    // pitch play area starts
  top: 123,
  playW: 1960,  // pitch play area width
  playH: 1167,  // pitch play area height
}

function getZoneColor(pct: number): string {
  if (pct >= 70) return 'rgba(16, 185, 129, 0.55)'
  if (pct >= 50) return 'rgba(245, 158, 11, 0.45)'
  if (pct >= 30) return 'rgba(249, 115, 22, 0.45)'
  return 'rgba(239, 68, 68, 0.45)'
}

export default function ShootingEfficiencyHeatmap({ shots }: Props) {
  const dungloeShots = useMemo(() => shots.filter(s => s.team === 'dungloe'), [shots])

  const zoneStats = useMemo(() => {
    return ZONES.map(zone => {
      const zoneShots = dungloeShots.filter(
        s => s.x >= zone.xMin && s.x < zone.xMax && s.y >= zone.yMin && s.y < zone.yMax
      )
      const total = zoneShots.length
      const scored = zoneShots.filter(s => s.is_score).length
      const pct = total > 0 ? Math.round((scored / total) * 100) : -1
      return { ...zone, total, scored, pct }
    })
  }, [dungloeShots])

  const insight = useMemo(() => {
    const zonesWithShots = zoneStats.filter(z => z.total >= 3)
    if (zonesWithShots.length === 0) return null
    const worst = zonesWithShots.reduce((a, b) => a.pct < b.pct ? a : b)
    const best = zonesWithShots.reduce((a, b) => a.pct > b.pct ? a : b)
    if (worst.pct < 40) {
      return `Low conversion from ${worst.label.toLowerCase()} (${worst.pct}% from ${worst.total} shots). Best zone: ${best.label.toLowerCase()} at ${best.pct}%.`
    }
    return `Strongest from ${best.label.toLowerCase()} (${best.pct}% from ${best.total} shots).`
  }, [zoneStats])

  // Convert zone 0-100 coords to SVG coords on the GAA pitch
  const toSvg = (xPct: number, yPct: number) => ({
    x: PITCH.left + (xPct / 100) * PITCH.playW,
    y: PITCH.top + (yPct / 100) * PITCH.playH,
  })

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Target size={20} />
          Shooting Efficiency
        </h3>
      </div>

      {dungloeShots.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-white/40">
          No shot data available
        </div>
      ) : (
        <>
          <div className="relative rounded-xl overflow-hidden flex-1 min-h-0">
            <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full h-full">
              {/* GAA pitch background */}
              <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
              <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

              {/* Zone overlays */}
              {zoneStats.map(zone => {
                const topLeft = toSvg(zone.xMin, zone.yMin)
                const bottomRight = toSvg(zone.xMax, zone.yMax)
                const w = bottomRight.x - topLeft.x
                const h = bottomRight.y - topLeft.y
                const cx = topLeft.x + w / 2
                const cy = topLeft.y + h / 2

                return (
                  <g key={zone.id}>
                    <rect
                      x={topLeft.x} y={topLeft.y} width={w} height={h}
                      fill={zone.total === 0 ? 'rgba(0,0,0,0.25)' : getZoneColor(zone.pct)}
                      stroke="rgba(255,255,255,0.25)" strokeWidth="2"
                    />
                    {/* Conversion % */}
                    <text x={cx} y={cy - 30}
                      textAnchor="middle" fill="white" fontSize="72" fontWeight="bold"
                      opacity={zone.total > 0 ? 1 : 0.3}
                      style={{ textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}
                    >
                      {zone.total > 0 ? `${zone.pct}%` : '-'}
                    </text>
                    {/* Shot count */}
                    <text x={cx} y={cy + 30}
                      textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="42"
                      style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}
                    >
                      {zone.total > 0 ? `${zone.scored}/${zone.total}` : ''}
                    </text>
                    {/* Zone label */}
                    <text x={cx} y={topLeft.y + 50}
                      textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="36"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
                    >
                      {zone.label}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 mt-3 text-xs">
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(16, 185, 129, 0.7)' }} />
              <span className="text-white/60">70%+</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(245, 158, 11, 0.5)' }} />
              <span className="text-white/60">50-69%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(249, 115, 22, 0.5)' }} />
              <span className="text-white/60">30-49%</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-3 h-3 rounded" style={{ background: 'rgba(239, 68, 68, 0.5)' }} />
              <span className="text-white/60">&lt;30%</span>
            </div>
          </div>

          {/* Insight */}
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
