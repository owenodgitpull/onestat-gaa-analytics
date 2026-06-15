/**
 * Single-match kickout landing zones chart.
 * Computes zone stats directly from match events (no backend aggregation needed).
 */
import { useState, useMemo } from 'react'
import { Crosshair } from 'lucide-react'

interface Props {
  events: any[]
  attackingRightFirstHalf?: boolean | null
  teamName?: string
  opponentName?: string
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

// GAA pitch ~145m: our 20m=14%, our 45m=31%, midfield=50%, opp 45m=69%, opp 20m=86%
// Short = our 20m to our 45m (14–31%), Mid = our 45m to opp 45m (31–69%), Long = beyond opp 45m (69–100%)
const ZONE_DEFS = [
  { id: 'Short_Left',   xMin: 14, xMax: 31,  yMin: 0,  yMax: 33,  label: 'Short L' },
  { id: 'Short_Centre', xMin: 14, xMax: 31,  yMin: 33, yMax: 67,  label: 'Short C' },
  { id: 'Short_Right',  xMin: 14, xMax: 31,  yMin: 67, yMax: 100, label: 'Short R' },
  { id: 'Mid_Left',     xMin: 31, xMax: 69,  yMin: 0,  yMax: 33,  label: 'Mid L',  circleCenterXPct: 50 },
  { id: 'Mid_Centre',   xMin: 31, xMax: 69,  yMin: 33, yMax: 67,  label: 'Mid C',  circleCenterXPct: 50 },
  { id: 'Mid_Right',    xMin: 31, xMax: 69,  yMin: 67, yMax: 100, label: 'Mid R',  circleCenterXPct: 50 },
  { id: 'Long_Left',    xMin: 69, xMax: 100, yMin: 0,  yMax: 33,  label: 'Long L', circleCenterXPct: 82 },
  { id: 'Long_Centre',  xMin: 69, xMax: 100, yMin: 33, yMax: 67,  label: 'Long C', circleCenterXPct: 82 },
  { id: 'Long_Right',   xMin: 69, xMax: 100, yMin: 67, yMax: 100, label: 'Long R', circleCenterXPct: 82 },
]

// Classify event type into own/opponent kickout and whether we won it (includes sideline events)
const OWN_WON = new Set(['own_kickout_won', 'own_kickout_won_break'])
const OWN_LOST = new Set(['own_kickout_opposition_won', 'own_kickout_opposition_won_break', 'own_kickout_sideline'])
const OPP_WON = new Set(['opp_kickout_opposition_won', 'opp_kickout_opposition_won_break'])
const OPP_LOST = new Set(['opp_kickout_won', 'opp_kickout_won_break', 'opp_kickout_sideline'])
// Legacy types
const LEGACY_WON = new Set(['kickout_won', 'breaking_ball_won'])
const LEGACY_LOST = new Set(['kickout_lost', 'breaking_ball_lost'])

interface ParsedKickout {
  isOwn: boolean
  won: boolean
  pitch_x: number | null
  pitch_y: number | null
}

function parseKickoutEvents(events: any[]): ParsedKickout[] {
  const results: ParsedKickout[] = []
  for (const e of events) {
    const t = e.event_type
    const team = e.team || (e.is_home_team ? 'own' : 'opponent')
    const x = e.pitch_x ?? null
    const y = e.pitch_y ?? null

    if (OWN_WON.has(t)) results.push({ isOwn: true, won: true, pitch_x: x, pitch_y: y })
    else if (OWN_LOST.has(t)) results.push({ isOwn: true, won: false, pitch_x: x, pitch_y: y })
    else if (OPP_WON.has(t)) results.push({ isOwn: false, won: true, pitch_x: x, pitch_y: y })
    else if (OPP_LOST.has(t)) results.push({ isOwn: false, won: false, pitch_x: x, pitch_y: y })
    else if (LEGACY_WON.has(t)) results.push({ isOwn: team === 'own', won: true, pitch_x: x, pitch_y: y })
    else if (LEGACY_LOST.has(t)) results.push({ isOwn: team === 'own', won: false, pitch_x: x, pitch_y: y })
  }
  return results
}

export default function MatchKickoutZones({ events, attackingRightFirstHalf, teamName = 'Our', opponentName = 'Opp' }: Props) {
  const [mode, setMode] = useState<KickoutMode>('own')

  const allKickouts = useMemo(() => parseKickoutEvents(events), [events])
  const filtered = useMemo(() => allKickouts.filter(k => mode === 'own' ? k.isOwn : !k.isOwn), [allKickouts, mode])

  const zoneStats = useMemo(() => {
    const stats: Record<string, { total: number; won: number; lost: number; win_pct: number }> = {}
    for (const zone of ZONE_DEFS) stats[zone.id] = { total: 0, won: 0, lost: 0, win_pct: 0 }

    for (const k of filtered) {
      // Only place in a zone if we have pitch coordinates
      if (k.pitch_x == null || k.pitch_y == null) continue

      // For own kickouts: measure distance from OWN goal
      // For opp kickouts: measure distance from OPPONENT goal
      // attackingRightFirstHalf=true means own goal at x=0, opp goal at x=100
      // attackingRightFirstHalf=false means own goal at x=100, opp goal at x=0
      const ownGoalX = attackingRightFirstHalf === false ? 100 : 0
      const oppGoalX = attackingRightFirstHalf === false ? 0 : 100
      const goalX = k.isOwn ? ownGoalX : oppGoalX
      // Distance from the kicking team's goal (0-100 scale)
      const distFromGoal = Math.abs(k.pitch_x - goalX)

      let xZone: string
      if (distFromGoal < 31) xZone = 'Short'       // our 20m–45m corridor
      else if (distFromGoal < 69) xZone = 'Mid'    // midfield (our 45m to opp 45m)
      else xZone = 'Long'                           // beyond opp 45m arc
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
  const totalKickouts = filtered.length  // includes sidelines / events without coords
  const totalKickoutsWon = filtered.filter(k => k.won).length
  const retentionPct = totalKickouts > 0 ? Math.round(totalKickoutsWon / totalKickouts * 100) : 0

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
              {m === 'own' ? `${teamName} K/O` : `${opponentName} K/O`}
            </button>
          ))}
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden">
        <svg viewBox={`-100 -100 ${PITCH.svgW + 200} ${PITCH.svgH + 380}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          <rect x={-100} y={-100} width={PITCH.svgW + 200} height={PITCH.svgH + 380} fill="#1a1a2e" />
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" rx="20" />
          <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

          {ZONE_DEFS.map(zone => {
            const stats = zoneStats[zone.id]
            const count = stats?.total || 0
            const tl = toSvg(zone.xMin, zone.yMin)
            const br = toSvg(zone.xMax, zone.yMax)
            const w = br.x - tl.x
            const h = br.y - tl.y
            // Use circleCenterXPct override if set (e.g. Mid zones pushed past the 45m arc)
            const circleSvgX = 'circleCenterXPct' in zone
              ? toSvg(zone.circleCenterXPct as number, 0).x
              : tl.x + w / 2
            const cx = circleSvgX
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
          Retention: <span className="text-white font-medium">{totalKickoutsWon}/{totalKickouts} ({retentionPct}%)</span>
        </span>
        {totalKickouts > 0 && (shortTotal + midTotal + longTotal) > 0 && (
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
