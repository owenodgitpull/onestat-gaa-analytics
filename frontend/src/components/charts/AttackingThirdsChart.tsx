import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { possessionAPI } from '@/services/api'
import { useClubName } from '@/contexts/ClubContext'

interface AttackingThirdsChartProps {
  matchId: string
  opponent: string
  /** Match events — used only to derive per-channel shots/scores for the threat colour (see below). */
  events?: any[]
  /** Poll interval in ms for live data (0 = no polling) */
  pollInterval?: number
  /** True = own team attacks toward x=100 in 1st half. Null = unknown (defaults to true). */
  attackingRightFirstHalf?: boolean | null
  halfDurationMins?: number
}

type ThreatBasis = 'scores' | 'shots' | 'volume'

// Same shot/score classification MatchRecording.tsx's shotLocations (feeding
// ShootingEfficiencyHeatmap) already uses — kept identical for consistency.
const SHOT_TYPES = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'wide', 'short', 'saved', 'point_free', 'two_point_free', 'wide_free', 'forty_five', 'forty_five_missed', 'penalty_miss'])
const SCORE_TYPES = new Set(['goal', 'penalty_goal', 'point', 'two_point', 'point_free', 'two_point_free', 'forty_five'])

type Channels = { left: number; centre: number; right: number }
const CHANNELS: { key: keyof Channels; label: string }[] = [
  { key: 'left', label: 'Left' },
  { key: 'centre', label: 'Centre' },
  { key: 'right', label: 'Right' },
]

const PITCH = { svgW: 2332, svgH: 1446, left: 183, top: 123, playW: 1960, playH: 1167 }
const THREAT_HUE = '239,68,68'
const THREAT_MIN_OPACITY = 0.12
const THREAT_MAX_OPACITY = 0.82

function threatOpacity(pct: number, min: number, max: number): number {
  if (max === min) return (THREAT_MIN_OPACITY + THREAT_MAX_OPACITY) / 2
  const t = (pct - min) / (max - min)
  return THREAT_MIN_OPACITY + t * (THREAT_MAX_OPACITY - THREAT_MIN_OPACITY)
}

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

/**
 * Match-level "Attacking Thirds" — of a team's possession INSIDE their
 * attacking third, what % flows through the Left / Centre / Right channel.
 * Self-contained (fetches its own possession events), same pattern as
 * PossessionTerritoryChart — usable both live (half-time) and post-match
 * (full-time) with an internal half filter. Needs continuous location
 * tracking, so it's intentionally never wired into Simple Scoring.
 */
export default function AttackingThirdsChart({
  matchId,
  opponent,
  events = [],
  pollInterval = 0,
  attackingRightFirstHalf,
  halfDurationMins = 30,
}: AttackingThirdsChartProps) {
  const clubName = useClubName()
  const [selectedTeam, setSelectedTeam] = useState<'own' | 'opponent'>('own')
  const [selectedHalf, setSelectedHalf] = useState<'all' | '1st' | '2nd'>('all')

  const { data: possessionEvents } = useQuery({
    queryKey: ['possession-events', matchId],
    queryFn: () => possessionAPI.getByMatch(matchId),
    enabled: !!matchId,
    refetchInterval: pollInterval || false,
  })

  const channels = useMemo(() => {
    const totals = {
      own: { left: 0, centre: 0, right: 0 } as Channels,
      opponent: { left: 0, centre: 0, right: 0 } as Channels,
    }

    const getEffectiveX = (px: number, minute: number, forOwnTeam: boolean): number => {
      const hdm = halfDurationMins ?? 30
      const isFirstHalf = minute <= hdm
      const ownAttackingRight = attackingRightFirstHalf != null
        ? (isFirstHalf ? attackingRightFirstHalf : !attackingRightFirstHalf)
        : true
      const teamAttackingRight = forOwnTeam ? ownAttackingRight : !ownAttackingRight
      return teamAttackingRight ? px : 100 - px
    }

    // Raw pitch_y, never mirrored — matches ShootingEfficiencyHeatmap's
    // Left/Centre/Right convention (shot locations only normalise x).
    const channelFor = (y: number): keyof Channels => {
      if (y < 33.33) return 'left'
      if (y < 66.67) return 'centre'
      return 'right'
    }

    ;(possessionEvents || []).forEach((e: any) => {
      const px = e.pitch_x
      const py = e.pitch_y
      if (px == null || py == null) return

      const minute = e.minute || 0
      const hdm = e.half_duration_mins ?? halfDurationMins ?? 30
      if (selectedHalf === '1st' && minute > hdm) return
      if (selectedHalf === '2nd' && minute <= hdm) return

      const team = e.team || (e.is_home_team ? 'own' : 'opponent')
      if (team !== 'own' && team !== 'opponent') return

      const effectiveX = getEffectiveX(px, minute, team === 'own')
      if (effectiveX < 65) return // only attacking-third possession counts

      const weight = e.duration_seconds || 1
      totals[team as 'own' | 'opponent'][channelFor(py)] += weight
    })

    const toPcts = (t: Channels): Channels => {
      const total = t.left + t.centre + t.right
      if (total === 0) return { left: 0, centre: 0, right: 0 }
      return {
        left: Math.round((t.left / total) * 100),
        centre: Math.round((t.centre / total) * 100),
        right: Math.round((t.right / total) * 100),
      }
    }

    return {
      own: toPcts(totals.own),
      opponent: toPcts(totals.opponent),
      ownHasData: totals.own.left + totals.own.centre + totals.own.right > 0,
      opponentHasData: totals.opponent.left + totals.opponent.centre + totals.opponent.right > 0,
    }
  }, [possessionEvents, selectedHalf, attackingRightFirstHalf, halfDurationMins])

  // Threat colour — a separate signal from the volume % above. Prefers
  // scores per channel, falls back to shot attempts if no scores yet, falls
  // back to volume if there's no shot-location data at all. Not gated by
  // half filter or attacking-third membership — a shot is inherently an
  // attacking event regardless, same convention as ShootingEfficiencyHeatmap.
  const threatByTeam = useMemo(() => {
    const shots = { own: { left: 0, centre: 0, right: 0 } as Channels, opponent: { left: 0, centre: 0, right: 0 } as Channels }
    const scores = { own: { left: 0, centre: 0, right: 0 } as Channels, opponent: { left: 0, centre: 0, right: 0 } as Channels }
    const channelFor = (y: number): keyof Channels => (y < 33.33 ? 'left' : y < 66.67 ? 'centre' : 'right')

    events.forEach((e: any) => {
      if (!SHOT_TYPES.has(e.event_type) || e.pitch_y == null) return
      const team = e.team === 'own' || e.is_home_team ? 'own' : 'opponent'
      const channel = channelFor(e.pitch_y)
      shots[team][channel] += 1
      if (SCORE_TYPES.has(e.event_type)) scores[team][channel] += 1
    })

    const toThreat = (s: Channels, sc: Channels, volumePcts: Channels): { pcts: Channels; basis: ThreatBasis } => {
      const scoreTotal = sc.left + sc.centre + sc.right
      if (scoreTotal > 0) {
        return { pcts: { left: Math.round(sc.left / scoreTotal * 100), centre: Math.round(sc.centre / scoreTotal * 100), right: Math.round(sc.right / scoreTotal * 100) }, basis: 'scores' }
      }
      const shotTotal = s.left + s.centre + s.right
      if (shotTotal > 0) {
        return { pcts: { left: Math.round(s.left / shotTotal * 100), centre: Math.round(s.centre / shotTotal * 100), right: Math.round(s.right / shotTotal * 100) }, basis: 'shots' }
      }
      return { pcts: volumePcts, basis: 'volume' }
    }

    return {
      own: toThreat(shots.own, scores.own, channels.own),
      opponent: toThreat(shots.opponent, scores.opponent, channels.opponent),
    }
  }, [events, channels])

  const hasAnyPossessionData = !!possessionEvents && possessionEvents.length > 0
  const pcts = selectedTeam === 'own' ? channels.own : channels.opponent
  const hasData = selectedTeam === 'own' ? channels.ownHasData : channels.opponentHasData
  const { pcts: threat, basis: threatBasis } = selectedTeam === 'own' ? threatByTeam.own : threatByTeam.opponent

  const threatValues = CHANNELS.map(c => threat[c.key])
  const min = Math.min(...threatValues)
  const max = Math.max(...threatValues)
  const dominantVolume = CHANNELS.reduce((a, b) => (pcts[a.key] >= pcts[b.key] ? a : b))
  const dominantThreat = CHANNELS.reduce((a, b) => (threat[a.key] >= threat[b.key] ? a : b))
  const threatLabel = threatBasis === 'scores' ? 'scoring' : threatBasis === 'shots' ? 'shot' : 'possession'

  const thirdWidth = PITCH.playW / 3
  const zoneX0 = PITCH.left + thirdWidth * 2
  const zoneX1 = PITCH.left + PITCH.playW
  const bandH = PITCH.playH / 3

  return (
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <ArrowRight size={18} />
          Attacking Thirds
        </h3>
        <div className="flex gap-1 bg-white/5 rounded-lg p-0.5">
          {(['all', '1st', '2nd'] as const).map(half => (
            <button
              key={half}
              onClick={() => setSelectedHalf(half)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                selectedHalf === half ? 'bg-white/20 text-white' : 'text-white/50 hover:text-white/80'
              }`}
            >
              {half === 'all' ? 'All' : half}
            </button>
          ))}
        </div>
      </div>

      <p className="text-white/40 text-xs mb-2">
        % = share of attacking-third play by channel. Colour = actual scoring output from that channel, not just volume.
      </p>

      <div className="flex bg-white/10 rounded-lg p-0.5 mb-3 w-fit">
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
          {opponent}
        </button>
      </div>

      {!hasAnyPossessionData ? (
        <div className="h-[200px] flex items-center justify-center text-white/40 text-sm text-center px-6">
          No possession tracking data for this match — Attacking Thirds needs continuous location tracking.
        </div>
      ) : !hasData ? (
        <div className="h-[200px] flex items-center justify-center text-white/40 text-sm">
          No attacking-third possession recorded {selectedTeam === 'own' ? `for ${clubName}` : `for ${opponent}`} yet
        </div>
      ) : (
        <>
          <div className="relative rounded-lg overflow-hidden">
            <svg viewBox="0 0 2332 1446" className="w-full h-auto" style={{ maxHeight: 300 }}>
              <image href="/pitch-svg.svg" width="2332" height="1446" />
              <rect x={PITCH.left} y={PITCH.top} width={thirdWidth * 2} height={PITCH.playH} fill="#000000" fillOpacity={0.45} />

              {CHANNELS.map((c, i) => {
                const y0 = PITCH.top + bandH * i
                const y1 = y0 + bandH
                const opacity = threatOpacity(threat[c.key], min, max)
                return (
                  <g key={c.key}>
                    <rect x={zoneX0} y={y0} width={zoneX1 - zoneX0} height={bandH}
                      fill={`rgba(${THREAT_HUE},${opacity})`} stroke="rgba(255,255,255,0.15)" strokeWidth="2" />
                    <path d={arrowPath(zoneX0 + 20, y0 + 14, zoneX1 - 24, y1 - 14)} fill="rgba(255,255,255,0.22)" />
                  </g>
                )
              })}

              <line x1={zoneX0} y1={PITCH.top + bandH} x2={zoneX1} y2={PITCH.top + bandH} stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
              <line x1={zoneX0} y1={PITCH.top + bandH * 2} x2={zoneX1} y2={PITCH.top + bandH * 2} stroke="rgba(255,255,255,0.3)" strokeWidth="3" />
              <line x1={zoneX0} y1={PITCH.top} x2={zoneX0} y2={PITCH.top + PITCH.playH} stroke="rgba(255,255,255,0.35)" strokeWidth="3" strokeDasharray="12,8" />

              {CHANNELS.map((c, i) => {
                const y0 = PITCH.top + bandH * i
                return (
                  <g key={`label-${c.key}`}>
                    <rect x={zoneX0 + 14} y={y0 + 14} width={150} height={64} rx={12} fill="rgba(0,0,0,0.5)" />
                    <text x={zoneX0 + 30} y={y0 + 56} fill="white" fontSize="48" fontWeight="bold">
                      {pcts[c.key]}%
                    </text>
                    {/* Channel label — drawn in the same SVG coordinate space as
                        everything else here (not an absolutely-positioned HTML
                        overlay) so it's always pinned to its own band regardless
                        of how the svg itself gets scaled/letterboxed inside the
                        card. Sits top-right of the band, clear of the arrow. */}
                    <rect x={zoneX1 - 160} y={y0 + 5} width={150} height={60} rx={8} fill="rgba(0,0,0,0.70)" />
                    <text x={zoneX1 - 85} y={y0 + 44} fill="rgba(255,255,255,1)" fontSize="52" fontWeight="800" textAnchor="middle" letterSpacing="1.5">
                      {c.label.toUpperCase()}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          <div className="flex items-center gap-2 mt-3 text-[10px] text-white/40">
            <span>Threat level ({threatBasis === 'scores' ? 'scores' : threatBasis === 'shots' ? 'shots' : 'possession'} per channel):</span>
            <span>Low</span>
            <div className="flex-1 h-2 rounded-full" style={{
              background: `linear-gradient(to right, rgba(${THREAT_HUE},${THREAT_MIN_OPACITY}), rgba(${THREAT_HUE},${THREAT_MAX_OPACITY}))`,
            }} />
            <span>High</span>
          </div>

          <div className="mt-3 bg-white/5 rounded-lg px-3 py-2 text-xs text-white/60">
            {threatBasis === 'volume' ? (
              <>{selectedTeam === 'own' ? clubName : opponent} attack{selectedTeam === 'own' ? '' : 's'} through the {dominantVolume.label.toLowerCase()} channel most ({pcts[dominantVolume.key]}% of attacking-third play). No shot-location data yet to show real threat.</>
            ) : (
              <>{selectedTeam === 'own' ? clubName : opponent} {threatBasis === 'scores' ? 'score' : 'shoot'}{selectedTeam === 'own' ? '' : 's'} most from the {dominantThreat.label.toLowerCase()} channel ({threat[dominantThreat.key]}% of {threatLabel} output) — used {pcts[dominantThreat.key]}% of the time.</>
            )}
          </div>
        </>
      )}
    </div>
  )
}
