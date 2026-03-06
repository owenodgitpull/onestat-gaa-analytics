import { useState, useRef, useCallback, useEffect } from 'react'
import { useClubName } from '@/contexts/ClubContext'
import type { TerritoryDistributionData } from '@/services/api'

interface TerritoryDistributionProps {
  data: TerritoryDistributionData
}

export default function TerritoryDistribution({ data }: TerritoryDistributionProps) {
  const clubName = useClubName()
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')
  const [timeScope, setTimeScope] = useState<'season' | 'last_match'>('season')
  const [activeDot, setActiveDot] = useState<number | null>(null)
  const sparkRef = useRef<HTMLDivElement>(null)

  // Dismiss tooltip when tapping outside
  useEffect(() => {
    if (activeDot === null) return
    const handler = (e: PointerEvent) => {
      if (sparkRef.current && !sparkRef.current.contains(e.target as Node)) {
        setActiveDot(null)
      }
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [activeDot])

  const handleDotInteraction = useCallback((index: number) => {
    setActiveDot(prev => prev === index ? null : index)
  }, [])

  if (!data || !data.season_pcts) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Territory Distribution</h3>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No possession data recorded yet
        </div>
      </div>
    )
  }

  const totalPoss = sum(data.season_totals)
  const oppTotalPoss = sum(data.opponent_totals)
  const isEmpty = totalPoss === 0 && oppTotalPoss === 0

  if (isEmpty) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white">Territory Distribution</h3>
        </div>
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No possession data recorded yet
        </div>
      </div>
    )
  }

  // Derive last match data from per_match array
  const lastMatch = data.per_match.length > 0
    ? data.per_match[data.per_match.length - 1]
    : null
  const hasLastMatch = lastMatch !== null

  // Select the correct percentages based on both toggles
  const seasonPcts = selectedTeam === 'own' ? data.season_pcts : data.opponent_pcts
  const lastMatchPcts = lastMatch
    ? (selectedTeam === 'own' ? lastMatch.team_pcts : lastMatch.opponent_pcts)
    : null

  const pcts = timeScope === 'last_match' && lastMatchPcts ? lastMatchPcts : seasonPcts
  const possessionPct = timeScope === 'last_match' && lastMatch
    ? lastMatch.possession_pct
    : data.possession_pct

  const teamColor = selectedTeam === 'own' ? '#10b981' : '#f97316'

  // Determine which zone is dominant
  const maxZone = pcts.defensive >= pcts.midfield && pcts.defensive >= pcts.attacking
    ? 'defensive'
    : pcts.midfield >= pcts.attacking
      ? 'midfield'
      : 'attacking'

  // Insight text — comparison mode shows delta vs season average
  const getInsight = () => {
    if (timeScope === 'last_match' && lastMatchPcts && lastMatch) {
      // Compare last match to season average
      const atkDelta = Math.round(lastMatchPcts.attacking) - Math.round(seasonPcts.attacking)
      const defDelta = Math.round(lastMatchPcts.defensive) - Math.round(seasonPcts.defensive)

      if (selectedTeam === 'own') {
        if (Math.abs(atkDelta) >= 5) {
          const direction = atkDelta > 0 ? 'up' : 'down'
          return `Attacking third ${direction} ${Math.abs(atkDelta)}pp vs season avg (${Math.round(lastMatchPcts.attacking)}% vs ${Math.round(seasonPcts.attacking)}%). ${
            atkDelta < -10
              ? 'Struggled to get into the scoring zone.'
              : atkDelta > 10
                ? 'Dominated the attacking third.'
                : ''
          }`
        }
        if (Math.abs(defDelta) >= 5) {
          return `Defensive third ${defDelta > 0 ? 'up' : 'down'} ${Math.abs(defDelta)}pp vs season avg — ${
            defDelta > 0 ? 'under more pressure than usual' : 'breaking out better'
          }`
        }
      } else {
        if (Math.abs(atkDelta) >= 5) {
          return `Opposition attacking third ${atkDelta > 0 ? 'up' : 'down'} ${Math.abs(atkDelta)}pp vs season avg — ${
            atkDelta > 0 ? 'they spent more time in your half' : 'you kept them pinned back'
          }`
        }
      }
      return 'Territory distribution similar to season average'
    }

    // Season average insights (existing logic)
    if (selectedTeam === 'own') {
      if (pcts.midfield > 40 && pcts.attacking < 30) {
        return 'High midfield but low attacking % — sideways football, not penetrating the scoring zone'
      }
      if (pcts.attacking >= 40) {
        return 'Strong attacking territory — keeping the play in the opposition half'
      }
      if (pcts.defensive >= 40) {
        return 'Heavy defensive territory — struggling to break out of own half'
      }
    } else {
      if (pcts.attacking >= 40) {
        return 'Opponents spending lots of time in your defensive third'
      }
      if (pcts.defensive >= 40) {
        return 'Opponents pinned back in their own half — your press is working'
      }
    }
    return null
  }

  const insight = getInsight()

  // Calculate opacity for zone highlight
  const maxPct = Math.max(pcts.defensive, pcts.midfield, pcts.attacking, 1)
  const defOpacity = 0.55 - (pcts.defensive / maxPct) * 0.35
  const midOpacity = 0.55 - (pcts.midfield / maxPct) * 0.35
  const atkOpacity = 0.55 - (pcts.attacking / maxPct) * 0.35

  // Pitch SVG constants
  const pitchLeft = 183
  const pitchWidth = 1960
  const thirdWidth = pitchWidth / 3
  const pitchTop = 123
  const pitchHeight = 1167

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white">Territory Distribution</h3>
        <div className="flex items-center gap-2">
          <div className="flex bg-white/10 rounded-lg p-0.5">
            <button
              onClick={() => setSelectedTeam('own')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                selectedTeam === 'own'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              {clubName}
            </button>
            <button
              onClick={() => setSelectedTeam('opponent')}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                selectedTeam === 'opponent'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'text-white/60 hover:text-white'
              }`}
            >
              Opposition
            </button>
          </div>
        </div>
      </div>

      {/* Season Avg / Last Match Toggle */}
      {hasLastMatch && data.per_match.length > 1 && (
        <div className="flex items-center gap-2 mb-3">
          <div className="flex bg-white/10 rounded-lg p-0.5 flex-1">
            <button
              onClick={() => setTimeScope('season')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                timeScope === 'season'
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              Season Average
            </button>
            <button
              onClick={() => setTimeScope('last_match')}
              className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                timeScope === 'last_match'
                  ? 'bg-white/20 text-white shadow-sm'
                  : 'text-white/50 hover:text-white'
              }`}
            >
              Last Match
            </button>
          </div>
        </div>
      )}

      {/* Context label */}
      {timeScope === 'last_match' && lastMatch && (
        <div className="text-xs text-white/40 mb-2">
          vs {lastMatch.opponent} — {lastMatch.date ? new Date(lastMatch.date).toLocaleDateString() : ''}
        </div>
      )}

      {/* GAA Pitch with Territory Zones */}
      <div className="relative rounded-lg overflow-hidden">
        <svg viewBox="0 0 2332 1446" className="w-full h-auto" style={{ maxHeight: 300 }}>
          <image href="/pitch-svg.svg" width="2332" height="1446" />

          {/* Zone overlays */}
          <rect x={pitchLeft} y={pitchTop} width={thirdWidth} height={pitchHeight}
            fill="#000000" fillOpacity={defOpacity} />
          <rect x={pitchLeft + thirdWidth} y={pitchTop} width={thirdWidth} height={pitchHeight}
            fill="#000000" fillOpacity={midOpacity} />
          <rect x={pitchLeft + thirdWidth * 2} y={pitchTop} width={thirdWidth} height={pitchHeight}
            fill="#000000" fillOpacity={atkOpacity} />

          {/* Zone divider lines */}
          <line x1={pitchLeft + thirdWidth} y1={pitchTop} x2={pitchLeft + thirdWidth} y2={pitchTop + pitchHeight}
            stroke="rgba(255,255,255,0.3)" strokeWidth="3" strokeDasharray="12,8" />
          <line x1={pitchLeft + thirdWidth * 2} y1={pitchTop} x2={pitchLeft + thirdWidth * 2} y2={pitchTop + pitchHeight}
            stroke="rgba(255,255,255,0.3)" strokeWidth="3" strokeDasharray="12,8" />
        </svg>

        {/* Territory Percentage Badges */}
        <div className="absolute inset-0 flex items-center justify-around" style={{ paddingLeft: '12%', paddingRight: '12%' }}>
          {/* Defensive Zone */}
          <div className="flex flex-col items-center">
            <div
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg shadow-lg border-2 ${
                maxZone === 'defensive' ? 'border-white/40' : 'border-white/10'
              }`}
              style={{ backgroundColor: teamColor, color: 'white' }}
            >
              {Math.round(pcts.defensive)}%
            </div>
            <span className="text-[10px] sm:text-xs text-white/70 mt-1 font-semibold tracking-wide">DEF</span>
            {/* Delta vs season when in last match mode */}
            {timeScope === 'last_match' && lastMatchPcts && (() => {
              const delta = Math.round(lastMatchPcts.defensive) - Math.round(seasonPcts.defensive)
              if (delta === 0) return null
              return (
                <span className={`text-[10px] font-medium ${delta > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {delta > 0 ? '+' : ''}{delta}
                </span>
              )
            })()}
          </div>

          {/* Midfield Zone */}
          <div className="flex flex-col items-center">
            <div
              className={`w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center font-bold text-base sm:text-xl shadow-lg border-2 ${
                maxZone === 'midfield' ? 'border-white/40' : 'border-white/10'
              }`}
              style={{ backgroundColor: teamColor, color: 'white' }}
            >
              {Math.round(pcts.midfield)}%
            </div>
            <span className="text-[10px] sm:text-xs text-white/70 mt-1 font-semibold tracking-wide">MID</span>
            {timeScope === 'last_match' && lastMatchPcts && (() => {
              const delta = Math.round(lastMatchPcts.midfield) - Math.round(seasonPcts.midfield)
              if (delta === 0) return null
              return (
                <span className={`text-[10px] font-medium ${Math.abs(delta) < 3 ? 'text-white/40' : delta > 0 ? 'text-amber-400' : 'text-amber-400'}`}>
                  {delta > 0 ? '+' : ''}{delta}
                </span>
              )
            })()}
          </div>

          {/* Attacking Zone */}
          <div className="flex flex-col items-center">
            <div
              className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full flex items-center justify-center font-bold text-sm sm:text-lg shadow-lg border-2 ${
                maxZone === 'attacking' ? 'border-white/40' : 'border-white/10'
              }`}
              style={{ backgroundColor: teamColor, color: 'white' }}
            >
              {Math.round(pcts.attacking)}%
            </div>
            <span className="text-[10px] sm:text-xs text-white/70 mt-1 font-semibold tracking-wide">ATK</span>
            {timeScope === 'last_match' && lastMatchPcts && (() => {
              const delta = Math.round(lastMatchPcts.attacking) - Math.round(seasonPcts.attacking)
              if (delta === 0) return null
              return (
                <span className={`text-[10px] font-medium ${delta > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {delta > 0 ? '+' : ''}{delta}
                </span>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Possession Bar */}
      <div className="mt-4 pt-3 border-t border-white/10">
        <div className="flex items-center gap-2 text-xs">
          <span className="text-emerald-400 font-semibold w-10">{Math.round(possessionPct)}%</span>
          <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-white/10">
            <div
              className="bg-emerald-500 transition-all"
              style={{ width: `${possessionPct}%` }}
            />
            <div
              className="bg-orange-500 transition-all"
              style={{ width: `${100 - possessionPct}%` }}
            />
          </div>
          <span className="text-orange-400 font-semibold w-10 text-right">{Math.round(100 - possessionPct)}%</span>
        </div>
        <div className="flex justify-between text-[10px] text-white/40 mt-1 px-10">
          <span>
            {timeScope === 'last_match' && lastMatch
              ? `Possession vs ${lastMatch.opponent}`
              : 'Season Possession'
            }
          </span>
        </div>
      </div>

      {/* Insight */}
      {insight && (
        <div className="mt-3 bg-white/5 rounded-lg px-3 py-2 text-xs text-white/60">
          {insight}
        </div>
      )}

      {/* Per-match sparkline trend */}
      {data.per_match.length > 1 && (() => {
        const points = data.per_match.map((m) =>
          selectedTeam === 'own' ? m.team_pcts.attacking : m.opponent_pcts.attacking
        )
        const svgW = 300
        const svgH = 40
        const pad = 12
        const minVal = Math.min(...points) - 5
        const maxVal = Math.max(...points) + 5
        const range = maxVal - minVal || 1
        const coords = points.map((v, i) => ({
          x: pad + (i / (points.length - 1)) * (svgW - pad * 2),
          y: pad + (1 - (v - minVal) / range) * (svgH - pad * 2),
          val: v,
          opponent: data.per_match[i].opponent,
        }))
        const linePath = coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ')
        const areaPath = `${linePath} L${coords[coords.length - 1].x},${svgH} L${coords[0].x},${svgH} Z`

        // Highlight the last dot when in last_match mode
        const highlightLast = timeScope === 'last_match'

        return (
          <div className="mt-3 pt-3 border-t border-white/10" ref={sparkRef}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-white/40">Attacking Third % by Match</span>
              <span className="text-xs text-white/50">{Math.round(points[points.length - 1])}% latest</span>
            </div>
            <div className="relative">
              <svg viewBox={`0 0 ${svgW} ${svgH}`} className="w-full h-10" preserveAspectRatio="none">
                {/* Season average reference line */}
                {(() => {
                  const seasonAtk = selectedTeam === 'own'
                    ? data.season_pcts.attacking
                    : data.opponent_pcts.attacking
                  const avgY = pad + (1 - (seasonAtk - minVal) / range) * (svgH - pad * 2)
                  return (
                    <line
                      x1={pad} y1={avgY} x2={svgW - pad} y2={avgY}
                      stroke="rgba(255,255,255,0.15)"
                      strokeWidth="1"
                      strokeDasharray="4,4"
                    />
                  )
                })()}
                {/* Gradient fill under the line */}
                <defs>
                  <linearGradient id={`sparkGrad-${selectedTeam}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={teamColor} stopOpacity="0.3" />
                    <stop offset="100%" stopColor={teamColor} stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                <path d={areaPath} fill={`url(#sparkGrad-${selectedTeam})`} />
                <path d={linePath} fill="none" stroke={teamColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {/* Dots */}
                {coords.map((c, i) => {
                  const isLast = i === coords.length - 1
                  const isActive = activeDot === i
                  const isHighlighted = highlightLast && isLast
                  return (
                    <g key={i}>
                      <circle
                        cx={c.x} cy={c.y} r="12"
                        fill="transparent"
                        style={{ cursor: 'pointer' }}
                        onPointerDown={() => handleDotInteraction(i)}
                        onPointerEnter={() => setActiveDot(i)}
                        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setActiveDot(null) }}
                      />
                      <circle
                        cx={c.x} cy={c.y}
                        r={isActive ? 5 : isHighlighted ? 4.5 : 3}
                        fill={isActive ? 'white' : isHighlighted ? 'white' : teamColor}
                        stroke={teamColor}
                        strokeWidth={isHighlighted ? 2.5 : 2}
                        style={{ transition: 'r 0.15s, fill 0.15s', pointerEvents: 'none' }}
                      />
                    </g>
                  )
                })}
              </svg>

              {/* Custom tooltip */}
              {activeDot !== null && coords[activeDot] && (
                <div
                  className="absolute -top-9 pointer-events-none z-10 transition-all duration-150"
                  style={{
                    left: `${(coords[activeDot].x / svgW) * 100}%`,
                    transform: 'translateX(-50%)',
                  }}
                >
                  <div className="bg-slate-900/95 backdrop-blur-sm border border-white/20 rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
                    <div className="text-[11px] font-medium text-white">
                      vs {coords[activeDot].opponent}
                    </div>
                    <div className="text-[11px] font-bold" style={{ color: teamColor }}>
                      {Math.round(coords[activeDot].val)}% attacking
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function sum(zones: Record<string, number>): number {
  return Object.values(zones).reduce((a, b) => a + b, 0)
}
