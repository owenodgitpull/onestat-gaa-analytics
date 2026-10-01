import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { useClubName } from '@/contexts/ClubContext'
import type { AttackingThirdsData, AttackingThirdsChannelPcts } from '@/services/api'

// Shown below the header whenever one or more matches in the current filter
// scope were recorded with Simple Scoring (tap-only, no continuous ball
// tracking) — those matches are excluded from this chart's calculation
// entirely, same reasoning as TerritoryDistribution.tsx's own note.
function ExcludedMatchesNote({ excludedCount, totalInView }: { excludedCount: number; totalInView: number }) {
  if (!excludedCount) return null
  return (
    <p className="text-white/40 text-xs -mt-2 mb-4">
      {excludedCount} of {totalInView} games did not have precise location tracking on, so attacking channels cannot be derived for these.
    </p>
  )
}

// ─── Pitch SVG constants (same geometry as every other pitch chart) ───────
const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }

// Threat colour: a single, team-agnostic red hue whose opacity carries the
// signal — "transparent to dark" per the brief — rather than a team-branded
// colour, since threat is a property of the channel, not of who's toggled.
const THREAT_HUE = '239,68,68' // red-500
const THREAT_MIN_OPACITY = 0.12
const THREAT_MAX_OPACITY = 0.82

function threatOpacity(pct: number, min: number, max: number): number {
  if (max === min) return (THREAT_MIN_OPACITY + THREAT_MAX_OPACITY) / 2
  const t = (pct - min) / (max - min)
  return THREAT_MIN_OPACITY + t * (THREAT_MAX_OPACITY - THREAT_MIN_OPACITY)
}

// Builds a rightward-pointing arrow (shaft + head) filling a horizontal band,
// pointing toward the goal line at the right edge of the attacking third.
function arrowPath(x0: number, y0: number, x1: number, y1: number): string {
  const bandH = y1 - y0
  const cy = (y0 + y1) / 2
  const headW = (x1 - x0) * 0.32
  const shaftEnd = x1 - headW
  const shaftH = bandH * 0.26
  const headH = bandH * 0.62
  return [
    `M ${x0} ${cy - shaftH / 2}`,
    `L ${shaftEnd} ${cy - shaftH / 2}`,
    `L ${shaftEnd} ${cy - headH / 2}`,
    `L ${x1} ${cy}`,
    `L ${shaftEnd} ${cy + headH / 2}`,
    `L ${shaftEnd} ${cy + shaftH / 2}`,
    `L ${x0} ${cy + shaftH / 2}`,
    'Z',
  ].join(' ')
}

interface AttackingThirdsProps {
  data: AttackingThirdsData
  matchesInView?: number
}

const CHANNELS: { key: keyof AttackingThirdsChannelPcts; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'centre', label: 'Centre' },
  { key: 'right', label: 'Right' },
]

export default function AttackingThirds({ data, matchesInView = 0 }: AttackingThirdsProps) {
  const clubName = useClubName()
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')

  const totalOwn = data ? Object.values(data.season_totals || {}).reduce((a, b) => a + b, 0) : 0
  const totalOpp = data ? Object.values(data.opponent_totals || {}).reduce((a, b) => a + b, 0) : 0
  const isEmpty = !data || (totalOwn === 0 && totalOpp === 0)

  if (isEmpty) {
    return (
      <div className="glass-card p-6 h-full flex flex-col">
        <h3 className="text-lg font-bold text-white mb-3">Attacking Thirds</h3>
        <ExcludedMatchesNote excludedCount={data?.excluded_match_count ?? 0} totalInView={matchesInView} />
        <div className="h-[200px] flex items-center justify-center text-white/40">
          No attacking-third possession data recorded yet
        </div>
      </div>
    )
  }

  const pcts = selectedTeam === 'own' ? data.season_pcts : data.opponent_pcts
  const threat = selectedTeam === 'own' ? data.season_threat : data.opponent_threat
  const threatBasis = selectedTeam === 'own' ? data.season_threat_basis : data.opponent_threat_basis
  const threatValues = CHANNELS.map(c => threat[c.key])
  const min = Math.min(...threatValues)
  const max = Math.max(...threatValues)

  const dominantVolume = CHANNELS.reduce((a, b) => (pcts[a.key] >= pcts[b.key] ? a : b))
  const dominantThreat = CHANNELS.reduce((a, b) => (threat[a.key] >= threat[b.key] ? a : b))
  const subject = selectedTeam === 'own' ? clubName : 'The opposition'
  const threatLabel = threatBasis === 'scores' ? 'scoring' : threatBasis === 'shots' ? 'shot' : 'possession'
  const insight = threatBasis === 'volume'
    ? `${subject} attack${selectedTeam === 'own' ? '' : 's'} through the ${dominantVolume.label.toLowerCase()} channel most often (${Math.round(pcts[dominantVolume.key])}% of attacking-third play). No shot-location data yet to show real threat.`
    : `${subject} ${threatBasis === 'scores' ? 'score' : 'shoot'} most from the ${dominantThreat.label.toLowerCase()} channel (${Math.round(threat[dominantThreat.key])}% of ${threatLabel} output) — used ${Math.round(pcts[dominantThreat.key])}% of the time.`

  const thirdWidth = PITCH.playW / 3
  const zoneX0 = PITCH.left + thirdWidth * 2
  const zoneX1 = PITCH.left + PITCH.playW
  const bandH = PITCH.playH / 3

  return (
    <div className="glass-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <ArrowRight size={18} />
          Attacking Thirds
        </h3>
        <div className="flex bg-white/10 rounded-lg p-0.5">
          <button
            onClick={() => setSelectedTeam('own')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              selectedTeam === 'own' ? 'bg-red-600 text-white shadow-sm' : 'text-white/60 hover:text-white'
            }`}
          >
            {clubName}
          </button>
          <button
            onClick={() => setSelectedTeam('opponent')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
              selectedTeam === 'opponent' ? 'bg-red-600 text-white shadow-sm' : 'text-white/60 hover:text-white'
            }`}
          >
            Opposition
          </button>
        </div>
      </div>

      <p className="text-white/40 text-xs -mt-1 mb-3">
        % = share of attacking-third play by channel. Colour = actual scoring output from that channel, not just volume — a channel can be heavily used but rarely convert.
      </p>

      <ExcludedMatchesNote excludedCount={data.excluded_match_count ?? 0} totalInView={matchesInView} />

      <div className="relative rounded-lg overflow-hidden">
        <svg viewBox="0 0 2332 1446" className="w-full h-auto" style={{ maxHeight: 300 }}>
          <image href="/pitch-svg.svg" width="2332" height="1446" />

          {/* Dim everything outside the attacking third so the eye goes straight to the channels */}
          <rect x={PITCH.left} y={PITCH.top} width={thirdWidth * 2} height={PITCH.playH} fill="#000000" fillOpacity={0.45} />

          {CHANNELS.map((c, i) => {
            const y0 = PITCH.top + bandH * i
            const y1 = y0 + bandH
            const opacity = threatOpacity(threat[c.key], min, max)
            return (
              <g key={c.key}>
                <rect x={zoneX0} y={y0} width={zoneX1 - zoneX0} height={bandH}
                  fill={`rgba(${THREAT_HUE},${opacity})`} stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                <path d={arrowPath(zoneX0 + 20, y0 + 14, zoneX1 - 24, y1 - 14)}
                  fill="rgba(255,255,255,0.22)" />
              </g>
            )
          })}

          {/* Divider lines between channel bands */}
          <line x1={zoneX0} y1={PITCH.top + bandH} x2={zoneX1} y2={PITCH.top + bandH} stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
          <line x1={zoneX0} y1={PITCH.top + bandH * 2} x2={zoneX1} y2={PITCH.top + bandH * 2} stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
          {/* Attacking-third boundary */}
          <line x1={zoneX0} y1={PITCH.top} x2={zoneX0} y2={PITCH.top + PITCH.playH} stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeDasharray="12,8" />

          {/* % labels + channel labels — both drawn in the same SVG coordinate
              space as the bands themselves (not an absolutely-positioned HTML
              overlay), so they're always pinned to their own band regardless
              of how the svg gets scaled/letterboxed inside the card. */}
          {CHANNELS.map((c, i) => {
            const y0 = PITCH.top + bandH * i
            return (
              <g key={`label-${c.key}`}>
                <rect x={zoneX0 + 14} y={y0 + 14} width={150} height={64} rx={12} fill="rgba(0,0,0,0.5)" />
                <text x={zoneX0 + 30} y={y0 + 56} fill="white" fontSize="48" fontWeight="bold">
                  {Math.round(pcts[c.key])}%
                </text>
                <rect x={zoneX1 - 160} y={y0 + 5} width={150} height={60} rx={8} fill="rgba(0,0,0,0.70)" />
                <text x={zoneX1 - 85} y={y0 + 44} fill="rgba(255,255,255,1)" fontSize="52" fontWeight="800" textAnchor="middle" letterSpacing="1.5">
                  {c.label.toUpperCase()}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Threat legend */}
      <div className="flex items-center gap-2 mt-3 text-[10px] text-white/40">
        <span>Threat level ({threatBasis === 'scores' ? 'scores' : threatBasis === 'shots' ? 'shots' : 'possession'} per channel):</span>
        <span>Low</span>
        <div className="flex-1 h-2 rounded-full" style={{
          background: `linear-gradient(to right, rgba(${THREAT_HUE},${THREAT_MIN_OPACITY}), rgba(${THREAT_HUE},${THREAT_MAX_OPACITY}))`,
        }} />
        <span>High</span>
      </div>

      <div className="mt-3 bg-white/5 rounded-lg px-3 py-2 text-xs text-white/60">
        {insight}
      </div>
    </div>
  )
}
