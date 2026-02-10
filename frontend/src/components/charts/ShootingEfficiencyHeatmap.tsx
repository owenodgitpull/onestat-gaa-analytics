import { useMemo } from 'react'
import { Target } from 'lucide-react'
import type { ShotLocation } from '@/services/api'

interface Props {
  shots: ShotLocation[]
}

// Define pitch zones (6 zones: 3 across x 2 deep on attacking half)
const ZONES = [
  { id: 'close_left',  label: 'Close Left',  xMin: 65, xMax: 100, yMin: 0,  yMax: 33 },
  { id: 'close_center',label: 'Close Centre', xMin: 65, xMax: 100, yMin: 33, yMax: 67 },
  { id: 'close_right', label: 'Close Right', xMin: 65, xMax: 100, yMin: 67, yMax: 100 },
  { id: 'long_left',   label: 'Long Left',   xMin: 35, xMax: 65,  yMin: 0,  yMax: 33 },
  { id: 'long_center', label: 'Long Centre',  xMin: 35, xMax: 65,  yMin: 33, yMax: 67 },
  { id: 'long_right',  label: 'Long Right',  xMin: 35, xMax: 65,  yMin: 67, yMax: 100 },
]

function getZoneColor(pct: number): string {
  if (pct >= 70) return 'rgba(16, 185, 129, 0.7)'   // emerald - excellent
  if (pct >= 50) return 'rgba(245, 158, 11, 0.5)'    // amber - decent
  if (pct >= 30) return 'rgba(249, 115, 22, 0.5)'    // orange - poor
  return 'rgba(239, 68, 68, 0.5)'                     // red - very poor
}

function getZoneTextColor(pct: number): string {
  if (pct >= 70) return 'text-emerald-300'
  if (pct >= 50) return 'text-amber-300'
  if (pct >= 30) return 'text-orange-300'
  return 'text-red-300'
}

export default function ShootingEfficiencyHeatmap({ shots }: Props) {
  // Only use Dungloe shots for efficiency analysis
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

  // Find the worst zone for insight
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

  // SVG pitch dimensions
  const W = 600, H = 400
  const pitchPad = 20

  return (
    <div className="glass-card p-6 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Target size={20} />
          Shooting Efficiency
        </h3>
      </div>

      {dungloeShots.length === 0 ? (
        <div className="h-[300px] flex items-center justify-center text-white/40">
          No shot data available
        </div>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 340 }}>
            {/* Pitch background */}
            <rect x={pitchPad} y={pitchPad} width={W - pitchPad * 2} height={H - pitchPad * 2}
              fill="rgba(16, 185, 129, 0.08)" stroke="rgba(255,255,255,0.2)" strokeWidth="1" rx="4" />

            {/* Centre line */}
            <line x1={W / 2} y1={pitchPad} x2={W / 2} y2={H - pitchPad}
              stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4" />

            {/* Goal at right end */}
            <rect x={W - pitchPad - 4} y={H / 2 - 30} width={4} height={60}
              fill="rgba(255,255,255,0.3)" rx="2" />

            {/* Zone rectangles */}
            {zoneStats.map(zone => {
              // Map zone coords to SVG: x 0-100 → pitchPad to W-pitchPad, y 0-100 → pitchPad to H-pitchPad
              const pw = W - pitchPad * 2
              const ph = H - pitchPad * 2
              const sx = pitchPad + (zone.xMin / 100) * pw
              const sy = pitchPad + (zone.yMin / 100) * ph
              const sw = ((zone.xMax - zone.xMin) / 100) * pw
              const sh = ((zone.yMax - zone.yMin) / 100) * ph

              return (
                <g key={zone.id}>
                  <rect
                    x={sx} y={sy} width={sw} height={sh}
                    fill={zone.total === 0 ? 'rgba(255,255,255,0.03)' : getZoneColor(zone.pct)}
                    stroke="rgba(255,255,255,0.15)" strokeWidth="0.5"
                  />
                  {/* Conversion % */}
                  <text x={sx + sw / 2} y={sy + sh / 2 - 8}
                    textAnchor="middle" fill="white" fontSize="18" fontWeight="bold" opacity={zone.total > 0 ? 1 : 0.3}>
                    {zone.total > 0 ? `${zone.pct}%` : '-'}
                  </text>
                  {/* Shot count */}
                  <text x={sx + sw / 2} y={sy + sh / 2 + 12}
                    textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="11">
                    {zone.total > 0 ? `${zone.scored}/${zone.total} shots` : 'No shots'}
                  </text>
                  {/* Zone label */}
                  <text x={sx + sw / 2} y={sy + 14}
                    textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">
                    {zone.label}
                  </text>
                </g>
              )
            })}

            {/* Labels */}
            <text x={pitchPad + 4} y={H - 6} fill="rgba(255,255,255,0.3)" fontSize="9">
              Dungloe Goal
            </text>
            <text x={W - pitchPad - 4} y={H - 6} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end">
              Opponent Goal
            </text>
          </svg>

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
