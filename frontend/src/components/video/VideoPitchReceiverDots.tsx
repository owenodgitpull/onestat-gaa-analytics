import type { JerseyPlayer } from '../JerseyNumberStrip'
import { rankLikelyReceivers } from '@/utils/likelyReceivers'
import { toSvg } from '@/utils/pitchGeometry'

interface VideoPitchReceiverDotsProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  onSelect: (playerId: string, jerseyNumber: number | null) => void
  attackingRight: boolean
  ballPctX: number
  ballPctY: number
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  disabled?: boolean
  recentCarrierIds?: string[]
}

const LIKELY_COUNT = 5
const DOT_R_DIM = 38
const DOT_R_BRIGHT = 54

/**
 * Video Tagging's port of `PitchReceiverDots.tsx` — identical ranking,
 * thresholds and visuals, but reads pixel coordinates from
 * `pitchGeometry.ts`'s `toSvg()` instead of GAAPitch's own hardcoded
 * constants, since it's rendered inside `TaggingPitch`'s rotated `<g>`
 * (vertical orientation support) rather than GAAPitch's fixed-horizontal
 * viewBox. The two files' `PITCH` numbers are byte-for-byte identical
 * (see pitchGeometry.ts's header), so the on-pitch result is the same —
 * this port exists only so a fix to one doesn't have to be manually
 * mirrored into the other's different coordinate source.
 */
export default function VideoPitchReceiverDots({
  players,
  activeCarrierId,
  onSelect,
  attackingRight,
  ballPctX,
  ballPctY,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  disabled = false,
  recentCarrierIds = [],
}: VideoPitchReceiverDotsProps) {
  if (disabled) return null

  const ranked = rankLikelyReceivers(players, attackingRight, ballPctX, ballPctY)
  const likelyIds = new Set(
    rankLikelyReceivers(players, attackingRight, ballPctX, ballPctY, { activeCarrierId, recentCarrierIds })
      .slice(0, LIKELY_COUNT)
      .map(r => r.player.playerId)
  )

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <>
      {ranked.map((r) => {
        const isLikely = likelyIds.has(r.player.playerId)
        const isActive = r.player.playerId === activeCarrierId
        const hasJersey = r.player.jerseyNumber != null
        const { x: cx, y: cy } = toSvg(r.x, r.y)
        const radius = isLikely ? DOT_R_BRIGHT : DOT_R_DIM

        return (
          <g
            key={r.player.playerId}
            {...(isLikely
              ? {
                  onPointerDown: stop,
                  onPointerUp: (e: React.PointerEvent) => {
                    stop(e)
                    onSelect(r.player.playerId, r.player.jerseyNumber)
                  },
                  onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
                  style: { cursor: 'pointer', touchAction: 'none', transition: 'opacity 0.25s ease' },
                }
              : { style: { pointerEvents: 'none' as const, transition: 'opacity 0.25s ease' } })}
          >
            <circle
              cx={cx} cy={cy} r={radius}
              fill={isLikely ? teamPrimaryColor : 'rgba(6,14,10,0.55)'}
              stroke={isActive ? '#6ee7b7' : (isLikely ? teamSecondaryColor : 'rgba(255,255,255,0.3)')}
              strokeWidth={isActive ? 3.5 : 1.5}
              opacity={isLikely ? 1 : 0.38}
              style={{ transition: 'r 0.25s ease, opacity 0.25s ease, fill 0.25s ease' }}
            />
            <text
              x={cx} y={cy}
              textAnchor="middle" dominantBaseline="central"
              fill={isLikely ? '#fff' : 'rgba(234,255,243,0.6)'}
              fontWeight="700"
              fontSize={hasJersey ? (isLikely ? 38 : 27) : (isLikely ? 26 : 18)}
              opacity={isLikely ? 1 : 0.38}
              style={{ transition: 'opacity 0.25s ease, font-size 0.25s ease' }}
            >
              {hasJersey ? r.player.jerseyNumber : (r.player.positionLabel || '?')}
            </text>
          </g>
        )
      })}
    </>
  )
}
