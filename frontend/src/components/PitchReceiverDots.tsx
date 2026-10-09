import type { JerseyPlayer } from './JerseyNumberStrip'
import { rankLikelyReceivers } from '@/utils/likelyReceivers'

interface PitchReceiverDotsProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  onSelect: (playerId: string, jerseyNumber: number | null) => void
  attackingRight: boolean
  ballPctX: number
  ballPctY: number
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  disabled?: boolean
  /** Players recently on the ball — biases the "likely" (bright/tappable) set
   * toward them. Optional so existing callers keep compiling. */
  recentCarrierIds?: string[]
}

const LIKELY_COUNT = 5
const DOT_R_DIM = 38
const DOT_R_BRIGHT = 54

const toSvgX = (pctX: number) => (pctX / 100) * 1960 + 183
const toSvgY = (pctY: number) => (pctY / 100) * 1167 + 123

/**
 * Faint markers at every on-field player's approximate formation position —
 * the 5 currently likeliest to receive the ball (ranked by proximity to its
 * live position, same ranking BallCarrierPicker's radial uses) brighten and
 * become tappable; everyone else stays a dim, non-interactive reference dot.
 * Purely additive alongside the radial and the jersey-number strip below —
 * three different ways to reach the exact same onSelect, none of them
 * exclusive of the others.
 */
export default function PitchReceiverDots({
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
}: PitchReceiverDotsProps) {
  if (disabled) return null

  // Full set — every on-field player gets a dot (bright or dim), including
  // the active carrier's own formation slot, so their marker doesn't vanish
  // from the pitch just because they can't be their own receiver.
  const ranked = rankLikelyReceivers(players, attackingRight, ballPctX, ballPctY)
  // "Likely" (bright/tappable) set — this is the one that excludes the
  // active carrier and applies the recency discount, since it's genuinely
  // about who's a good pass target right now.
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
        const cx = toSvgX(r.x)
        const cy = toSvgY(r.y)
        const radius = isLikely ? DOT_R_BRIGHT : DOT_R_DIM

        return (
          <g
            key={r.player.playerId}
            // Only the currently-likely dots are tap targets — dim ones are
            // pure visual context so they never compete with a normal tap
            // on the pitch elsewhere (e.g. to move the ball).
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
            {/* Forgiving hit area: a tap just beside a dot selects that player instead of teleporting the ball */}
            <circle cx={cx} cy={cy} r={radius + 34} fill="rgba(0,0,0,0.001)" />
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
