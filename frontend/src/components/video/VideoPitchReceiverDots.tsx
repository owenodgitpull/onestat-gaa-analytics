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
  /** TaggingPitch's current orientation — in 'vertical', everything here
   *  renders inside a 90°-rotated <g>, which would otherwise leave the
   *  jersey-number/position-label text sideways. Each <text> gets a
   *  counter-rotation around its own center so it always reads upright
   *  regardless of the dot's (correctly rotated) position. */
  orientation?: 'horizontal' | 'vertical'
}

const LIKELY_COUNT = 5
const DOT_R_DIM = 42
const DOT_R_BRIGHT = 60

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
  orientation = 'horizontal',
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
          // EVERY dot is selectable (not just the "likely" ones) — a short
          // hand-pass to a player who isn't near the ball must be one tap.
          // Selecting only sets the new carrier; the ball does NOT move, so
          // the coach can carry on dragging from where the pass was given.
          // Uses `click` (press AND release on the same dot): a drag that
          // starts on the ball is pointer-captured by the ball, and a drag
          // that starts on empty pitch and merely ends/passes over a dot
          // produces no click on it — so dragging never selects a player.
          <g
            key={r.player.playerId}
            onPointerDown={stop}
            onPointerUp={stop}
            onClick={(e) => {
              stop(e)
              onSelect(r.player.playerId, r.player.jerseyNumber)
            }}
            onContextMenu={(e: React.MouseEvent) => e.preventDefault()}
            style={{ cursor: 'pointer', touchAction: 'none', transition: 'opacity 0.25s ease' }}
          >
            {/* Lit (likely receiver): solid team colour, bigger. Dim (everyone
                else): dark disc with a team-colour ring + bold white number —
                clearly tappable but visibly less prominent than a lit one. */}
            {/* Forgiving hit area: a tap just beside a dot selects that player instead of teleporting the ball */}
            <circle cx={cx} cy={cy} r={radius + 34} fill="rgba(0,0,0,0.001)" />
            <circle
              cx={cx} cy={cy} r={radius}
              fill={isLikely ? teamPrimaryColor : 'rgba(14,22,24,0.78)'}
              stroke={isActive ? '#6ee7b7' : (isLikely ? teamSecondaryColor : teamPrimaryColor)}
              strokeWidth={isActive ? 3.5 : (isLikely ? 1.5 : 3.5)}
              opacity={isLikely ? 1 : 0.9}
              style={{ transition: 'r 0.25s ease, opacity 0.25s ease, fill 0.25s ease' }}
            />
            <text
              x={cx} y={cy}
              textAnchor="middle" dominantBaseline="central"
              fill="#fff"
              fontWeight="700"
              fontSize={hasJersey ? (isLikely ? 43 : 32) : (isLikely ? 29 : 22)}
              opacity={isLikely ? 1 : 0.92}
              transform={orientation === 'vertical' ? `rotate(-90 ${cx} ${cy})` : undefined}
              style={{ transition: 'opacity 0.25s ease, font-size 0.25s ease', pointerEvents: 'none' }}
            >
              {hasJersey ? r.player.jerseyNumber : (r.player.positionLabel || '?')}
            </text>
          </g>
        )
      })}
    </>
  )
}
