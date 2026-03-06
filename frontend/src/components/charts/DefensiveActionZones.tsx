import { useState, useMemo } from 'react'
import { Shield } from 'lucide-react'
import type { DefensiveActionZonesData } from '@/services/api'

interface Props {
  data: DefensiveActionZonesData
}

const PITCH = {
  svgW: 2332,
  svgH: 1446,
  left: 183,
  top: 123,
  playW: 1960,
  playH: 1167,
}

function toSvg(xPct: number, yPct: number) {
  return {
    x: PITCH.left + (xPct / 100) * PITCH.playW,
    y: PITCH.top + (yPct / 100) * PITCH.playH,
  }
}

const ACTION_COLORS: Record<string, string> = {
  interception: '#3b82f6',
  block: '#f59e0b',
  turnover_won: '#ef4444',
}

const ZONE_DEFS = [
  { id: 'DEF_LEFT', xMin: 0, xMax: 35, yMin: 0, yMax: 50, label: 'DEF L' },
  { id: 'DEF_RIGHT', xMin: 0, xMax: 35, yMin: 50, yMax: 100, label: 'DEF R' },
  { id: 'MID_LEFT', xMin: 35, xMax: 65, yMin: 0, yMax: 50, label: 'MID L' },
  { id: 'MID_RIGHT', xMin: 35, xMax: 65, yMin: 50, yMax: 100, label: 'MID R' },
  { id: 'ATK_LEFT', xMin: 65, xMax: 100, yMin: 0, yMax: 50, label: 'ATK L' },
  { id: 'ATK_RIGHT', xMin: 65, xMax: 100, yMin: 50, yMax: 100, label: 'ATK R' },
]

export default function DefensiveActionZones({ data }: Props) {
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(['interception', 'block', 'turnover_won'])
  )

  const toggleType = (t: string) => {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) {
        if (next.size > 1) next.delete(t)
      } else {
        next.add(t)
      }
      return next
    })
  }

  const filteredEvents = useMemo(
    () => data.events.filter(e => activeTypes.has(e.action_type) && e.pitch_x != null && e.pitch_y != null),
    [data.events, activeTypes]
  )

  // Zone density for shading
  const maxZoneCount = useMemo(() => {
    return Math.max(1, ...Object.values(data.zones).map(z => z.total))
  }, [data.zones])

  const totalActions = data.totals.interceptions + data.totals.blocks + data.totals.turnovers_won

  // Zone split percentages
  const defTotal = (data.zones.DEF_LEFT?.total || 0) + (data.zones.DEF_RIGHT?.total || 0)
  const midTotal = (data.zones.MID_LEFT?.total || 0) + (data.zones.MID_RIGHT?.total || 0)
  const atkTotal = (data.zones.ATK_LEFT?.total || 0) + (data.zones.ATK_RIGHT?.total || 0)
  const defPct = totalActions > 0 ? Math.round(defTotal / totalActions * 100) : 0
  const midPct = totalActions > 0 ? Math.round(midTotal / totalActions * 100) : 0
  const atkPct = totalActions > 0 ? Math.round(atkTotal / totalActions * 100) : 0

  if (data.events.length === 0) {
    return (
      <div className="glass-card p-6 h-full flex items-center justify-center text-white/40">
        No defensive action data available
      </div>
    )
  }

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xl font-bold flex items-center gap-2 text-white">
          <Shield size={20} />
          Defensive Zones
        </h3>
      </div>

      {/* Type toggles */}
      <div className="flex gap-2 mb-3">
        {[
          { key: 'interception', label: 'INT', color: ACTION_COLORS.interception },
          { key: 'block', label: 'BLK', color: ACTION_COLORS.block },
          { key: 'turnover_won', label: 'T/O', color: ACTION_COLORS.turnover_won },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => toggleType(t.key)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
              activeTypes.has(t.key)
                ? 'border-white/30 text-white'
                : 'border-white/10 text-white/30'
            }`}
            style={activeTypes.has(t.key) ? { backgroundColor: t.color + '30' } : {}}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: t.color }} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Pitch SVG */}
      <div className="relative rounded-xl overflow-hidden flex-1 min-h-0">
        <svg viewBox={`0 0 ${PITCH.svgW} ${PITCH.svgH}`} className="w-full h-full">
          <rect width={PITCH.svgW} height={PITCH.svgH} fill="#2d5016" />
          <image href="/pitch-svg.svg" width={PITCH.svgW} height={PITCH.svgH} preserveAspectRatio="xMidYMid meet" />

          {/* Zone overlays */}
          {ZONE_DEFS.map(zone => {
            const zoneData = data.zones[zone.id]
            const count = zoneData?.total || 0
            const opacity = count > 0 ? 0.1 + (count / maxZoneCount) * 0.35 : 0
            const tl = toSvg(zone.xMin, zone.yMin)
            const br = toSvg(zone.xMax, zone.yMax)
            const w = br.x - tl.x
            const h = br.y - tl.y

            return (
              <g key={zone.id}>
                <rect
                  x={tl.x} y={tl.y} width={w} height={h}
                  fill={`rgba(16, 185, 129, ${opacity})`}
                  stroke="rgba(255,255,255,0.15)"
                  strokeWidth="2"
                />
                <text
                  x={tl.x + w / 2} y={tl.y + 50}
                  textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="36"
                  style={{ textShadow: '0 1px 4px rgba(0,0,0,0.8)' }}
                >
                  {zone.label}
                </text>
                {count > 0 && (
                  <>
                    <circle
                      cx={tl.x + w / 2} cy={tl.y + h / 2}
                      r={40}
                      fill="none"
                      stroke="rgba(255,255,255,0.6)"
                      strokeWidth="3"
                    />
                    <text
                      x={tl.x + w / 2} y={tl.y + h / 2 + 15}
                      textAnchor="middle" fill="white" fontSize="52" fontWeight="bold"
                      style={{ textShadow: '0 2px 6px rgba(0,0,0,0.8)' }}
                    >
                      {count}
                    </text>
                  </>
                )}
              </g>
            )
          })}

          {/* Event markers */}
          {filteredEvents.map((e, i) => {
            const pos = toSvg(e.pitch_x!, e.pitch_y!)
            return (
              <circle
                key={i}
                cx={pos.x}
                cy={pos.y}
                r={18}
                fill={ACTION_COLORS[e.action_type] || '#888'}
                opacity={0.7}
                stroke="white"
                strokeWidth={1.5}
              />
            )
          })}
        </svg>
      </div>

      {/* Metric pills */}
      <div className="flex flex-wrap gap-2 mt-3">
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          Total: <span className="text-white font-medium">{totalActions}</span>
        </span>
        <span className="px-2.5 py-1 rounded-full bg-white/10 text-xs text-white/70">
          DEF {defPct}% / MID {midPct}% / ATK {atkPct}%
        </span>
      </div>
    </div>
  )
}
