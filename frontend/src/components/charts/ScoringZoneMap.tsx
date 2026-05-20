import { useState, useMemo } from 'react'

// Matches GAAPitch.tsx coordinate system exactly
const toSvgX = (pct: number) => (pct / 100) * 1960 + 183
const toSvgY = (pct: number) => (pct / 100) * 1167 + 123
const VB_W = 2332, VB_H = 1446

// 45m line from opponent's goal sits at pitch_x ≈ 69 (45/145 * 100)
// 6 zones: outside/inside 45m × left/center/right channel

interface Zone { id: string; xMin: number; xMax: number; yMin: number; yMax: number; svgX: number; svgY: number }

const OWN_ZONES: Zone[] = [
  { id:'o-l', xMin:50, xMax:69, yMin:0,  yMax:33,  svgX:toSvgX(59.5), svgY:toSvgY(16.5) },
  { id:'o-c', xMin:50, xMax:69, yMin:33, yMax:67,  svgX:toSvgX(59.5), svgY:toSvgY(50)   },
  { id:'o-r', xMin:50, xMax:69, yMin:67, yMax:100, svgX:toSvgX(59.5), svgY:toSvgY(83.5) },
  { id:'i-l', xMin:69, xMax:100,yMin:0,  yMax:33,  svgX:toSvgX(84.5), svgY:toSvgY(16.5) },
  { id:'i-c', xMin:69, xMax:100,yMin:33, yMax:67,  svgX:toSvgX(84.5), svgY:toSvgY(50)   },
  { id:'i-r', xMin:69, xMax:100,yMin:67, yMax:100, svgX:toSvgX(84.5), svgY:toSvgY(83.5) },
]

// 45m from own goal at pitch_x ≈ 31 (45/145 * 100)
const OPP_ZONES: Zone[] = [
  { id:'o-l', xMin:31, xMax:50, yMin:0,  yMax:33,  svgX:toSvgX(40.5), svgY:toSvgY(16.5) },
  { id:'o-c', xMin:31, xMax:50, yMin:33, yMax:67,  svgX:toSvgX(40.5), svgY:toSvgY(50)   },
  { id:'o-r', xMin:31, xMax:50, yMin:67, yMax:100, svgX:toSvgX(40.5), svgY:toSvgY(83.5) },
  { id:'i-l', xMin:0,  xMax:31, yMin:0,  yMax:33,  svgX:toSvgX(15.5), svgY:toSvgY(16.5) },
  { id:'i-c', xMin:0,  xMax:31, yMin:33, yMax:67,  svgX:toSvgX(15.5), svgY:toSvgY(50)   },
  { id:'i-r', xMin:0,  xMax:31, yMin:67, yMax:100, svgX:toSvgX(15.5), svgY:toSvgY(83.5) },
]

const SCORE_TYPES = new Set(['goal','point','two_point','point_free','two_point_free','forty_five','penalty_goal'])
const MISS_TYPES  = new Set(['wide','wide_free','saved','short','forty_five_missed','penalty_miss'])

function zoneColor(scores: number, total: number) {
  if (total === 0) return 'transparent'
  const p = scores / total
  if (p >= 0.7) return '#10b981'
  if (p >= 0.5) return '#06b6d4'
  if (p >= 0.3) return '#f59e0b'
  return '#f43f5e'
}

function isOwn(e: any) { return e.team === 'own' || e.is_home_team === true }

interface Props { events: any[]; teamName: string; opponent: string }

export default function ScoringZoneMap({ events, teamName, opponent }: Props) {
  const [view, setView] = useState<'own' | 'opp'>('own')

  const data = useMemo(() => {
    const subset = view === 'own' ? events.filter(isOwn) : events.filter(e => !isOwn(e))
    const zones = view === 'own' ? OWN_ZONES : OPP_ZONES

    // Mirror coordinates that are in the wrong half — e.g. second-half recordings where
    // the team attacked toward x=0. A goal at x=5 is physically impossible for own team.
    const normalize = (e: any) => {
      if (e.pitch_x == null || e.pitch_y == null) return e
      if (view === 'own' && e.pitch_x < 50) return { ...e, pitch_x: 100 - e.pitch_x, pitch_y: 100 - e.pitch_y }
      if (view === 'opp' && e.pitch_x > 50) return { ...e, pitch_x: 100 - e.pitch_x, pitch_y: 100 - e.pitch_y }
      return e
    }

    return zones.map(zone => {
      const inZone = subset.map(normalize).filter(e => {
        const x = e.pitch_x, y = e.pitch_y
        if (x == null || y == null) return false
        return x >= zone.xMin && x < zone.xMax && y >= zone.yMin && y < zone.yMax
      })
      const scores = inZone.filter(e => SCORE_TYPES.has(e.event_type)).length
      const total  = scores + inZone.filter(e => MISS_TYPES.has(e.event_type)).length
      return { ...zone, scores, total }
    })
  }, [events, view])

  const maxTotal = Math.max(...data.map(d => d.total), 1)
  const getR = (n: number) => n === 0 ? 0 : 60 + (n / maxTotal) * 120
  const totalShots  = data.reduce((s, d) => s + d.total, 0)
  const totalScores = data.reduce((s, d) => s + d.scores, 0)

  // Highlight rect for attacking half
  const hlX = view === 'own' ? toSvgX(50) : toSvgX(0)
  const hlW = view === 'own' ? toSvgX(100) - toSvgX(50) : toSvgX(50) - toSvgX(0)

  return (
    <div className="glass-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Scoring Zone Map</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {totalShots > 0 ? `${totalScores}/${totalShots} shots converted` : 'No shot coordinates logged'}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={() => setView('own')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${view === 'own' ? 'bg-emerald-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/15'}`}>
            {teamName.split(' ')[0]}
          </button>
          <button onClick={() => setView('opp')}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${view === 'opp' ? 'bg-rose-600 text-white' : 'bg-white/10 text-white/50 hover:bg-white/15'}`}>
            {opponent.split(' ')[0]}
          </button>
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto rounded-lg" style={{ background: '#2d5016' }}>
          <image href="/pitch-svg.svg" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />

          {/* Attacking half highlight */}
          <rect x={hlX} y={toSvgY(0)} width={hlW} height={toSvgY(100) - toSvgY(0)}
            fill="rgba(255,255,255,0.05)" />

          {/* Zone divider lines */}
          {(view === 'own' ? [toSvgX(69)] : [toSvgX(31)]).map(lx => (
            <line key={lx} x1={lx} y1={toSvgY(0)} x2={lx} y2={toSvgY(100)}
              stroke="rgba(255,255,255,0.15)" strokeWidth={4} strokeDasharray="20 12" />
          ))}

          {/* Zone bubbles */}
          {data.map(zone => {
            const r = getR(zone.total)
            if (r === 0) return null
            const color = zoneColor(zone.scores, zone.total)
            const pct = Math.round((zone.scores / zone.total) * 100)
            return (
              <g key={zone.id}>
                <circle cx={zone.svgX} cy={zone.svgY} r={r} fill={color} opacity={0.85} />
                <text x={zone.svgX} y={zone.svgY + 20} textAnchor="middle"
                  fill="white" fontSize={72} fontWeight="bold" style={{ fontFamily: 'sans-serif' }}>
                  {pct}%
                </text>
                <text x={zone.svgX} y={zone.svgY + 80} textAnchor="middle"
                  fill="rgba(255,255,255,0.75)" fontSize={52} style={{ fontFamily: 'sans-serif' }}>
                  {zone.total} shot{zone.total !== 1 ? 's' : ''}
                </text>
              </g>
            )
          })}
        </svg>

        {totalShots === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm rounded-lg">
            No shot data with pitch coordinates yet
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[11px] text-white/35 justify-center flex-wrap">
        {[['#10b981','≥70%'],['#06b6d4','50–70%'],['#f59e0b','30–50%'],['#f43f5e','<30%']].map(([c,l]) => (
          <span key={l} className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
            {l}
          </span>
        ))}
        <span className="text-white/20">· bubble size = shot volume</span>
      </div>
    </div>
  )
}
