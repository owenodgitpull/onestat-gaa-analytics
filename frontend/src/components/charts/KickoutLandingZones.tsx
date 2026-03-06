import { useState, useMemo } from 'react'
import { Crosshair } from 'lucide-react'
import type { KickoutLandingZonesData } from '@/services/api'

interface Props {
  data: KickoutLandingZonesData
}

type KickoutMode = 'own' | 'opponent'

// Full GAA pitch SVG coordinate system (matching pitch-svg.svg)
// Same constants used by ShootingEfficiencyHeatmap and DefensiveActionZones
const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,    // pitch play area starts
  top: 123,
  playW: 1960,  // pitch play area width
  playH: 1167,  // pitch play area height
}

// Convert 0-100 pitch coordinates to SVG coordinates
function toSvg(xPct: number, yPct: number) {
  return {
    x: PITCH.left + (xPct / 100) * PITCH.playW,
    y: PITCH.top + (yPct / 100) * PITCH.playH,
  }
}

// Crop viewBox: goal line → just past opposition 45m arc, trimmed vertically
// Cuts the grass border above/below the pitch for a tighter zoom
const HALF_VIEW = (() => {
  const pad = 30 // small breathing room
  const left = PITCH.left - pad
  const top = PITCH.top - pad
  const right = PITCH.left + PITCH.playW * 0.69 + pad // through midfield, cropping opp markings
  const bottom = PITCH.top + PITCH.playH + pad
  return `${left} ${top} ${right - left} ${bottom - top}`
})()

// 9 zones mapped to pitch coordinates (0-100 system)
// Short = inside 20m (~14%), Mid = 20m to 45m (~14% to 31%), Long = 45m+ (~31% to 65%)
// GAA pitch is ~145m so: 20m ≈ 14%, 45m ≈ 31%, midfield = 50%, opp 45 ≈ 69%
const ZONE_DEFS = [
  { id: 'Short_Left',    xMin: 0,  xMax: 14, yMin: 0,  yMax: 33, label: 'Short L' },
  { id: 'Short_Centre',  xMin: 0,  xMax: 14, yMin: 33, yMax: 67, label: 'Short C' },
  { id: 'Short_Right',   xMin: 0,  xMax: 14, yMin: 67, yMax: 100, label: 'Short R' },
  { id: 'Mid_Left',      xMin: 14, xMax: 31, yMin: 0,  yMax: 33, label: 'Mid L' },
  { id: 'Mid_Centre',    xMin: 14, xMax: 31, yMin: 33, yMax: 67, label: 'Mid C' },
  { id: 'Mid_Right',     xMin: 14, xMax: 31, yMin: 67, yMax: 100, label: 'Mid R' },
  { id: 'Long_Left',     xMin: 31, xMax: 65, yMin: 0,  yMax: 33, label: 'Long L' },
  { id: 'Long_Centre',   xMin: 31, xMax: 65, yMin: 33, yMax: 67, label: 'Long C' },
  { id: 'Long_Right',    xMin: 31, xMax: 65, yMin: 67, yMax: 100, label: 'Long R' },
]

export default function KickoutLandingZones({ data }: Props) {
  const [mode, setMode] = useState<KickoutMode>('own')

  const events = mode === 'own' ? data.own_events : data.opp_events
  const eventsWithCoords = useMemo(
    () => events.filter(e => e.pitch_x != null && e.pitch_y != null),
    [events]
  )

  // Compute per-zone stats from filtered events
  const zoneStats = useMemo(() => {
    const stats: Record<string, { total: number; won: number; lost: number; win_pct: number }> = {}
    for (const zone of ZONE_DEFS) {
      stats[zone.id] = { total: 0, won: 0, lost: 0, win_pct: 0 }
    }
    for (const e of eventsWithCoords) {
      const x = e.pitch_x!
      const y = e.pitch_y!
      let xZone: string
      if (x < 14) xZone = 'Short'
      else if (x < 31) xZone = 'Mid'
      else xZone = 'Long' // 31%+ includes midfield and beyond
      let yZone: string
      if (y < 33) yZone = 'Left'
      else if (y < 67) yZone = 'Centre'
      else yZone = 'Right'
      const key = `${xZone}_${yZone}`
      if (stats[key]) {
        stats[key].total += 1
        if (e.won) stats[key].won += 1
        else stats[key].lost += 1
      }
    }
    for (const s of Object.values(stats)) {
      s.win_pct = s.total > 0 ? Math.round(s.won / s.total * 100) : 0
    }
    return stats
  }, [eventsWithCoords])

  const maxCount = useMemo(
    () => Math.max(1, ...Object.values(zoneStats).map(z => z.total)),
    [zoneStats]
  )

  const totalKickouts = Object.values(zoneStats).reduce((s, z) => s + z.total, 0)

  const shortTotal = ZONE_DEFS.filter(z => z.id.startsWith('Short')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)
  const midTotal = ZONE_DEFS.filter(z => z.id.startsWith('Mid')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)
  const longTotal = ZONE_DEFS.filter(z => z.id.startsWith('Long')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)

  const qualified = Object.entries(zoneStats).filter(([, v]) => v.total >= 2)
  const bestZone = qualified.length > 0 ? qualified.reduce((a, b) => a[1].win_pct > b[1].win_pct ? a : b)[0].replace('_', ' ') : '-'
  const worstZone = qualified.length > 0 ? qualified.reduce((a, b) => a[1].win_pct < b[1].win_pct ? a : b)[0].replace('_', ' ') : '-'

  if (data.events.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40">
        No kickout landing data available
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Crosshair size={20} />
          Kickout Zones
        </h3>
        <div className="flex rounded-lg overflow-hidden border border-white/10">
          {(['own', 'opponent'] as KickoutMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                mode === m ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/70'
              }`}
            >
              {m === 'own' ? 'Our Kickouts' : 'Opp Kickouts'}
            </button>
          ))}
        </div>
      </div>

      {/* Half-pitch using real GAA pitch SVG */}
      <div className="relative rounded-xl overflow-hidden flex-1 min-h-0 max-h-[360px]">
        <svg viewBox={HALF_VIEW} className="w-full h-full" preserveAspectRatio="xMinYMid meet">
          {/* Real pitch background — cropped to own half */}
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
          <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

          {/* Zone overlays with shading */}
          {ZONE_DEFS.map(zone => {
            const stats = zoneStats[zone.id]
            const count = stats?.total || 0
            const tl = toSvg(zone.xMin, zone.yMin)
            const br = toSvg(zone.xMax, zone.yMax)
            const w = br.x - tl.x
            const h = br.y - tl.y
            const cx = tl.x + w / 2
            const cy = tl.y + h / 2

            // Background shading by density
            const opacity = count > 0 ? 0.08 + (count / maxCount) * 0.2 : 0

            return (
              <g key={zone.id}>
                {/* Zone background */}
                <rect
                  x={tl.x} y={tl.y} width={w} height={h}
                  fill={`rgba(255, 255, 255, ${opacity})`}
                  stroke="rgba(255,255,255,0.12)"
                  strokeWidth="2"
                />

                {count > 0 ? (
                  <>
                    {/* Won/lost split circle */}
                    {(() => {
                      const radius = 75 + (count / maxCount) * 70
                      const wonAngle = (stats.won / count) * 2 * Math.PI
                      // Draw green (won) arc, then red (lost) arc
                      return (
                        <>
                          {/* Cyan base circle (won) */}
                          <circle cx={cx} cy={cy} r={radius} fill="rgba(34, 211, 238, 0.55)" />
                          {/* Red arc overlay (lost) */}
                          {stats.lost > 0 && (() => {
                            const startAngle = wonAngle - Math.PI / 2
                            const endAngle = 2 * Math.PI - Math.PI / 2
                            const x1 = cx + radius * Math.cos(startAngle)
                            const y1 = cy + radius * Math.sin(startAngle)
                            const x2 = cx + radius * Math.cos(endAngle)
                            const y2 = cy + radius * Math.sin(endAngle)
                            const largeArc = stats.lost / count > 0.5 ? 1 : 0
                            return (
                              <path
                                d={`M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                                fill="rgba(239, 68, 68, 0.6)"
                              />
                            )
                          })()}
                          {/* White ring border */}
                          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="3.5" />
                        </>
                      )
                    })()}

                    {/* Win % */}
                    <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="66" fontWeight="bold"
                      style={{ textShadow: '0 2px 6px rgba(0,0,0,0.9)' }}>
                      {stats.win_pct}%
                    </text>
                    {/* Won/total count */}
                    <text x={cx} y={cy + 44} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="44"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>
                      {stats.won}/{count}
                    </text>
                  </>
                ) : (
                  /* Empty zone label */
                  <text x={cx} y={cy + 5} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="40">
                    -
                  </text>
                )}

                {/* Zone label pill at top */}
                {(() => {
                  const pillW = zone.label.length * 19 + 24
                  const pillH = 42
                  const pillY = tl.y + 16
                  return (
                    <>
                      <rect
                        x={cx - pillW / 2} y={pillY}
                        width={pillW} height={pillH}
                        rx={10} ry={10}
                        fill="rgba(0,0,0,0.55)"
                      />
                      <text x={cx} y={pillY + 30} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="30" fontWeight="600">
                        {zone.label}
                      </text>
                    </>
                  )
                })()}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(34, 211, 238, 0.7)' }} />
          <span className="text-white/50">Won</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(239, 68, 68, 0.7)' }} />
          <span className="text-white/50">Lost</span>
        </div>
      </div>

      {/* Metric pills */}
      <div className="flex flex-wrap gap-2 mt-2">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Total: <span className="text-white font-medium">{totalKickouts}</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Short {totalKickouts > 0 ? Math.round(shortTotal / totalKickouts * 100) : 0}% /
          Mid {totalKickouts > 0 ? Math.round(midTotal / totalKickouts * 100) : 0}% /
          Long {totalKickouts > 0 ? Math.round(longTotal / totalKickouts * 100) : 0}%
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Best: <span className="text-emerald-400 font-medium">{bestZone}</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Worst: <span className="text-red-400 font-medium">{worstZone}</span>
        </span>
      </div>
    </div>
  )
}
