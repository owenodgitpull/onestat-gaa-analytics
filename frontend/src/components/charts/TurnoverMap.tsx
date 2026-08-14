import { useMemo, useState } from 'react'

const toSvgX = (pct: number) => (pct / 100) * 1960 + 183
const toSvgY = (pct: number) => (pct / 100) * 1167 + 123
const VB_W = 2332, VB_H = 1446

// 9 zones across full pitch: 3 thirds × 3 channels
interface Zone { id: string; xMin: number; xMax: number; yMin: number; yMax: number; svgX: number; svgY: number; label: string }

const ZONES: Zone[] = [
  { id:'def-l', xMin:0,  xMax:33, yMin:0,  yMax:33,  svgX:toSvgX(16.5), svgY:toSvgY(16.5), label:'Def' },
  { id:'def-c', xMin:0,  xMax:33, yMin:33, yMax:67,  svgX:toSvgX(16.5), svgY:toSvgY(50),   label:'Def' },
  { id:'def-r', xMin:0,  xMax:33, yMin:67, yMax:100, svgX:toSvgX(16.5), svgY:toSvgY(83.5), label:'Def' },
  { id:'mid-l', xMin:33, xMax:67, yMin:0,  yMax:33,  svgX:toSvgX(50),   svgY:toSvgY(16.5), label:'Mid' },
  { id:'mid-c', xMin:33, xMax:67, yMin:33, yMax:67,  svgX:toSvgX(50),   svgY:toSvgY(50),   label:'Mid' },
  { id:'mid-r', xMin:33, xMax:67, yMin:67, yMax:100, svgX:toSvgX(50),   svgY:toSvgY(83.5), label:'Mid' },
  { id:'atk-l', xMin:67, xMax:100,yMin:0,  yMax:33,  svgX:toSvgX(83.5), svgY:toSvgY(16.5), label:'Atk' },
  { id:'atk-c', xMin:67, xMax:100,yMin:33, yMax:67,  svgX:toSvgX(83.5), svgY:toSvgY(50),   label:'Atk' },
  { id:'atk-r', xMin:67, xMax:100,yMin:67, yMax:100, svgX:toSvgX(83.5), svgY:toSvgY(83.5), label:'Atk' },
]

const WON_TYPES  = new Set(['turnover_won','interception','block','tackle_won'])
// Was ['turnover_lost','our_unforced_error'] — the real event_type for an
// unforced error is 'unforced_error' (team is a separate column), so that
// half of "lost" bubbles never matched anything and unforced errors never
// showed on the map at all, even though they correctly counted in the
// Turnover Causes pills below (which check the right value).
const LOST_TYPES = new Set(['turnover_lost','unforced_error'])

function isOwn(e: any) { return e.team === 'own' || e.is_home_team === true }

type CauseKey = 'forced' | 'unforced' | 'blocked' | 'foul'

const CAUSES: Record<CauseKey, { label: string; color: string; match: (e: any) => boolean }> = {
  forced: {
    label: 'Forced',
    color: '#f43f5e', // rose — same as the default "lost" color
    match: (e) => e.event_type === 'turnover_lost' && isOwn(e),
  },
  unforced: {
    label: 'Unforced',
    color: '#f59e0b', // amber
    match: (e) => e.event_type === 'unforced_error' && isOwn(e),
  },
  blocked: {
    label: 'Blocked',
    color: '#a78bfa', // violet
    match: (e) => e.event_type === 'block' && !isOwn(e), // opposition blocked us
  },
  foul: {
    label: 'Foul',
    color: '#fb923c', // orange
    match: (e) => e.event_type === 'foul_committed' && isOwn(e),
  },
}

interface Props { events: any[]; teamName: string }

export default function TurnoverMap({ events, teamName }: Props) {
  // Which turnover cause is highlighted — null shows the default won/lost view.
  const [selectedCause, setSelectedCause] = useState<CauseKey | null>(null)

  const data = useMemo(() => {
    // A selected cause replaces the default won/lost split with just that
    // cause's events. Blocked events are tagged to the opposition (they made
    // the block against us), so this has to run against the full events list
    // rather than the own-team-only list the default view uses.
    if (selectedCause) {
      const matcher = CAUSES[selectedCause].match
      const matched = events.filter(matcher)
      return ZONES.map(zone => {
        const inZone = matched.filter(e => {
          const x = e.pitch_x, y = e.pitch_y
          if (x == null || y == null) return false
          return x >= zone.xMin && x < zone.xMax && y >= zone.yMin && y < zone.yMax
        })
        return { ...zone, won: 0, lost: inZone.length, total: inZone.length }
      })
    }

    const ownEvents = events.filter(isOwn)

    // Mirror own-team events that appear in wrong half due to second-half
    // recording where the team attacked toward x=0 instead of x=100.
    // Won turnovers in own "defensive" zone (x<33) that were recorded at x>67
    // after mirroring would show correctly. We mirror if x>50 for won events
    // and if x<50 for lost events — but since turnovers span the full pitch
    // we can't infer direction from coordinates alone. Instead, apply no mirroring
    // here (turnovers are full-pitch; zone accuracy is best-effort).

    return ZONES.map(zone => {
      const inZone = ownEvents.filter(e => {
        const x = e.pitch_x, y = e.pitch_y
        if (x == null || y == null) return false
        return x >= zone.xMin && x < zone.xMax && y >= zone.yMin && y < zone.yMax
      })
      const won  = inZone.filter(e => WON_TYPES.has(e.event_type)).length
      const lost = inZone.filter(e => LOST_TYPES.has(e.event_type)).length
      return { ...zone, won, lost, total: won + lost }
    })
  }, [events, selectedCause])

  const maxTotal = Math.max(...data.map(d => d.total), 1)
  const getR = (n: number) => n === 0 ? 0 : 55 + (n / maxTotal) * 110

  const totalWon  = data.reduce((s, d) => s + d.won, 0)
  const totalLost = data.reduce((s, d) => s + d.lost, 0)
  const lostColor = selectedCause ? CAUSES[selectedCause].color : '#f43f5e'

  return (
    <div className="glass-card p-4 flex flex-col gap-3 h-full">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-white">Possession Battle Map</h3>
          <p className="text-xs text-white/40 mt-0.5">
            {selectedCause
              ? <>Showing <span className="font-semibold" style={{ color: lostColor }}>{CAUSES[selectedCause].label}</span> only — {totalLost} across the pitch</>
              : <>{teamName.split(' ')[0]} — {totalWon} won · {totalLost} lost across the pitch</>}
          </p>
        </div>
        <div className="flex gap-2 text-xs shrink-0">
          {selectedCause ? (
            <button
              onClick={() => setSelectedCause(null)}
              className="text-white/50 hover:text-white transition-colors font-semibold"
            >
              Clear filter ×
            </button>
          ) : (
            <>
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Won
              </span>
              <span className="flex items-center gap-1 text-rose-400 font-semibold">
                <span className="w-2 h-2 rounded-full bg-rose-500 inline-block" /> Lost
              </span>
            </>
          )}
        </div>
      </div>

      <div className="relative">
        <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="w-full h-auto rounded-lg" style={{ background: '#2d5016' }}>
          <image href="/pitch-svg.svg" width={VB_W} height={VB_H} preserveAspectRatio="xMidYMid meet" />

          {/* Third dividers */}
          {[33, 67].map(xPct => (
            <line key={xPct} x1={toSvgX(xPct)} y1={toSvgY(0)} x2={toSvgX(xPct)} y2={toSvgY(100)}
              stroke="rgba(255,255,255,0.12)" strokeWidth={4} strokeDasharray="20 14" />
          ))}

          {/* Zone bubbles — won (left offset) and lost (right offset) side by side */}
          {data.map(zone => {
            const rWon  = getR(zone.won)
            const rLost = getR(zone.lost)
            const offset = Math.max(rWon, rLost, 55) + 20
            return (
              <g key={zone.id}>
                {/* Won bubble — hidden while a cause filter is active, all 4 causes are loss-side */}
                {zone.won > 0 && (
                  <g>
                    <circle cx={zone.svgX - offset} cy={zone.svgY} r={rWon}
                      fill="#10b981" opacity={0.85} />
                    <text x={zone.svgX - offset} y={zone.svgY + 26} textAnchor="middle"
                      fill="white" fontSize={72} fontWeight="bold" style={{ fontFamily: 'sans-serif' }}>
                      {zone.won}
                    </text>
                  </g>
                )}
                {/* Lost bubble — recolored to the selected cause when filtered */}
                {zone.lost > 0 && (
                  <g>
                    <circle cx={zone.svgX + offset} cy={zone.svgY} r={rLost}
                      fill={lostColor} opacity={0.85} />
                    <text x={zone.svgX + offset} y={zone.svgY + 26} textAnchor="middle"
                      fill="white" fontSize={72} fontWeight="bold" style={{ fontFamily: 'sans-serif' }}>
                      {zone.lost}
                    </text>
                  </g>
                )}
              </g>
            )
          })}

          {/* Zone third labels at top */}
          {[
            { label: 'Defensive', x: toSvgX(16.5) },
            { label: 'Midfield',  x: toSvgX(50)   },
            { label: 'Attacking', x: toSvgX(83.5)  },
          ].map(({ label, x }) => (
            <text key={label} x={x} y={toSvgY(0) - 20} textAnchor="middle"
              fill="rgba(255,255,255,0.4)" fontSize={52} style={{ fontFamily: 'sans-serif' }}>
              {label}
            </text>
          ))}
        </svg>

        {(totalWon + totalLost) === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-white/30 text-sm rounded-lg">
            {selectedCause ? 'No events for this cause with pitch coordinates yet' : 'No turnover/block data with pitch coordinates yet'}
          </div>
        )}
      </div>

      <p className="text-[11px] text-white/25 text-center">
        Includes turnovers won/lost, blocks, interceptions, tackles · bubble size = volume
      </p>

      <TurnoverCauses events={events} selectedCause={selectedCause} onSelectCause={setSelectedCause} />
    </div>
  )
}

function TurnoverCauses({
  events,
  selectedCause,
  onSelectCause,
}: {
  events: any[]
  selectedCause: CauseKey | null
  onSelectCause: (key: CauseKey | null) => void
}) {
  const causes = useMemo(() => {
    const counts: Record<CauseKey, number> = { forced: 0, unforced: 0, blocked: 0, foul: 0 }
    for (const e of events) {
      for (const key of Object.keys(CAUSES) as CauseKey[]) {
        if (CAUSES[key].match(e)) counts[key]++
      }
    }
    return counts
  }, [events])

  const total = causes.forced + causes.unforced + causes.blocked + causes.foul
  if (total === 0) return null

  const pills = (Object.keys(CAUSES) as CauseKey[])
    .map(key => ({ key, ...CAUSES[key], value: causes[key] }))
    .filter(p => p.value > 0)

  return (
    <div>
      <p className="text-xs text-white/40 font-medium mb-1.5">Turnover Causes — tap to highlight on the map</p>
      <div className="flex flex-wrap gap-2">
        {pills.map(p => {
          const active = selectedCause === p.key
          return (
            <button
              key={p.key}
              onClick={() => onSelectCause(active ? null : p.key)}
              className="px-2.5 py-1 rounded-full text-xs transition-all"
              style={{
                background: active ? `${p.color}33` : 'rgba(255,255,255,0.1)',
                border: `1px solid ${active ? p.color : 'transparent'}`,
                color: active ? '#fff' : 'rgba(255,255,255,0.6)',
              }}
            >
              {p.label}: <span className="text-white font-semibold">{p.value}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
