/**
 * Single-match kickout landing zones chart.
 * Computes zone stats directly from match events (no backend aggregation needed).
 */
import { useState, useMemo } from 'react'
import { Crosshair } from 'lucide-react'

interface Props {
  events: any[]
}

type KickoutMode = 'own' | 'opponent'

const PITCH = {
  svgW: 2332, svgH: 1446,
  left: 183, top: 123,
  playW: 1960, playH: 1167,
}

function toSvg(xPct: number, yPct: number) {
  return {
    x: PITCH.left + (xPct / 100) * PITCH.playW,
    y: PITCH.top + (yPct / 100) * PITCH.playH,
  }
}

const ZONE_DEFS = [
  { id: 'Short_Left',   xMin: 0,  xMax: 14, yMin: 0,  yMax: 33,  label: 'Short L' },
  { id: 'Short_Centre', xMin: 0,  xMax: 14, yMin: 33, yMax: 67,  label: 'Short C' },
  { id: 'Short_Right',  xMin: 0,  xMax: 14, yMin: 67, yMax: 100, label: 'Short R' },
  { id: 'Mid_Left',     xMin: 14, xMax: 31, yMin: 0,  yMax: 33,  label: 'Mid L' },
  { id: 'Mid_Centre',   xMin: 14, xMax: 31, yMin: 33, yMax: 67,  label: 'Mid C' },
  { id: 'Mid_Right',    xMin: 14, xMax: 31, yMin: 67, yMax: 100, label: 'Mid R' },
  { id: 'Long_Left',    xMin: 31, xMax: 65, yMin: 0,  yMax: 33,  label: 'Long L' },
  { id: 'Long_Centre',  xMin: 31, xMax: 65, yMin: 33, yMax: 67,  label: 'Long C' },
  { id: 'Long_Right',   xMin: 31, xMax: 65, yMin: 67, yMax: 100, label: 'Long R' },
]

// Classify event type into own/opponent kickout and whether we won it
const OWN_WON = new Set(['own_kickout_won', 'own_kickout_won_break'])
const OWN_LOST = new Set(['own_kickout_opposition_won', 'own_kickout_opposition_won_break'])
const OPP_WON = new Set(['opp_kickout_opposition_won', 'opp_kickout_opposition_won_break'])
const OPP_LOST = new Set(['opp_kickout_won', 'opp_kickout_won_break'])
// Legacy types
const LEGACY_WON = new Set(['kickout_won', 'breaking_ball_won'])
const LEGACY_LOST = new Set(['kickout_lost', 'breaking_ball_lost'])

interface ParsedKickout {
  isOwn: boolean
  won: boolean
  pitch_x: number
  pitch_y: number
}

function parseKickoutEvents(events: any[]): ParsedKickout[] {
  const results: ParsedKickout[] = []
  for (const e of events) {
    if (e.pitch_x == null || e.pitch_y == null) continue
    const t = e.event_type
    const team = e.team || (e.is_home_team ? 'own' : 'opponent')

    if (OWN_WON.has(t)) results.push({ isOwn: true, won: true, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
    else if (OWN_LOST.has(t)) results.push({ isOwn: true, won: false, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
    else if (OPP_WON.has(t)) results.push({ isOwn: false, won: true, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
    else if (OPP_LOST.has(t)) results.push({ isOwn: false, won: false, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
    else if (LEGACY_WON.has(t)) results.push({ isOwn: team === 'own', won: true, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
    else if (LEGACY_LOST.has(t)) results.push({ isOwn: team === 'own', won: false, pitch_x: e.pitch_x, pitch_y: e.pitch_y })
  }
  return results
}

export default function MatchKickoutZones({ events }: Props) {
  const [mode, setMode] = useState<KickoutMode>('own')

  const allKickouts = useMemo(() => parseKickoutEvents(events), [events])
  const filtered = useMemo(() => allKickouts.filter(k => mode === 'own' ? k.isOwn : !k.isOwn), [allKickouts, mode])

  const zoneStats = useMemo(() => {
    const stats: Record<string, { total: number; won: number; lost: number; win_pct: number }> = {}
    for (const zone of ZONE_DEFS) stats[zone.id] = { total: 0, won: 0, lost: 0, win_pct: 0 }

    for (const k of filtered) {
      let xZone: string
      if (k.pitch_x < 14) xZone = 'Short'
      else if (k.pitch_x < 31) xZone = 'Mid'
      else xZone = 'Long'
      let yZone: string
      if (k.pitch_y < 33) yZone = 'Left'
      else if (k.pitch_y < 67) yZone = 'Centre'
      else yZone = 'Right'
      const key = `${xZone}_${yZone}`
      if (stats[key]) {
        stats[key].total++
        if (k.won) stats[key].won++
        else stats[key].lost++
      }
    }
    for (const s of Object.values(stats)) {
      s.win_pct = s.total > 0 ? Math.round(s.won / s.total * 100) : 0
    }
    return stats
  }, [filtered])

  const maxCount = useMemo(() => Math.max(1, ...Object.values(zoneStats).map(z => z.total)), [zoneStats])
  const totalKickouts = filtered.length

  if (allKickouts.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40 text-sm">
        No kickout data with pitch coordinates
      </div>
    )
  }

  const shortTotal = ZONE_DEFS.filter(z => z.id.startsWith('Short')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)
  const midTotal = ZONE_DEFS.filter(z => z.id.startsWith('Mid')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)
  const longTotal = ZONE_DEFS.filter(z => z.id.startsWith('Long')).reduce((s, z) => s + (zoneStats[z.id]?.total || 0), 0)

  return (
    <div className="glass-card p-5 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-base font-bold flex items-center gap-2 text-white">
          <Crosshair size={18} />
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

      <div className="relative rounded-xl overflow-hidden">
        <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
          <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

          {ZONE_DEFS.map(zone => {
            const stats = zoneStats[zone.id]
            const count = stats?.total || 0
            const tl = toSvg(zone.xMin, zone.yMin)
            const br = toSvg(zone.xMax, zone.yMax)
            const w = br.x - tl.x
            const h = br.y - tl.y
            const cx = tl.x + w / 2
            const cy = tl.y + h / 2
            const opacity = count > 0 ? 0.08 + (count / maxCount) * 0.2 : 0

            return (
              <g key={zone.id}>
                <rect x={tl.x} y={tl.y} width={w} height={h}
                  fill={`rgba(255,255,255,${opacity})`}
                  stroke="rgba(255,255,255,0.12)" strokeWidth="2"
                />
                {count > 0 ? (
                  <>
                    {(() => {
                      const radius = 75 + (count / maxCount) * 70
                      const wonAngle = (stats.won / count) * 2 * Math.PI
                      return (
                        <>
                          <circle cx={cx} cy={cy} r={radius} fill="rgba(34,211,238,0.55)" />
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
                                fill="rgba(239,68,68,0.6)"
                              />
                            )
                          })()}
                          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth="3.5" />
                        </>
                      )
                    })()}
                    <text x={cx} y={cy - 6} textAnchor="middle" fill="white" fontSize="66" fontWeight="bold"
                      style={{ textShadow: '0 2px 6px rgba(0,0,0,0.9)' }}>{stats.win_pct}%</text>
                    <text x={cx} y={cy + 44} textAnchor="middle" fill="rgba(255,255,255,0.8)" fontSize="44"
                      style={{ textShadow: '0 1px 4px rgba(0,0,0,0.9)' }}>{stats.won}/{count}</text>
                  </>
                ) : (
                  <text x={cx} y={cy + 5} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="40">-</text>
                )}
                {(() => {
                  const pillW = zone.label.length * 19 + 24
                  const pillH = 42
                  const pillY = tl.y + 16
                  return (
                    <>
                      <rect x={cx - pillW / 2} y={pillY} width={pillW} height={pillH} rx={10} ry={10} fill="rgba(0,0,0,0.55)" />
                      <text x={cx} y={pillY + 30} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="30" fontWeight="600">{zone.label}</text>
                    </>
                  )
                })()}
              </g>
            )
          })}
        </svg>
      </div>

      {/* Legend + summary */}
      <div className="flex items-center justify-center gap-4 mt-2 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(34,211,238,0.7)' }} />
          <span className="text-white/50">Won</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full" style={{ background: 'rgba(239,68,68,0.7)' }} />
          <span className="text-white/50">Lost</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 mt-2">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Total: <span className="text-white font-medium">{totalKickouts}</span>
        </span>
        {totalKickouts > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
            Short {Math.round(shortTotal / totalKickouts * 100)}% /
            Mid {Math.round(midTotal / totalKickouts * 100)}% /
            Long {Math.round(longTotal / totalKickouts * 100)}%
          </span>
        )}
      </div>
    </div>
  )
}
