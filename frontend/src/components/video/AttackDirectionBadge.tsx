/**
 * AttackDirectionBadge — persistent "which way is our team attacking" label.
 *
 * Shown beside the tracking pitch for the whole match once direction + half
 * are known, so the user never loses track regardless of pitch orientation
 * (side/below layout) or which half is playing. Flips automatically at
 * half-time — pass the already-half-adjusted `attackingRight`.
 */

import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'

interface AttackDirectionBadgeProps {
  attackingRight: boolean
  teamName: string
  /** The pitch's own layout, not the badge's — a vertical (portrait) pitch
   * needs an up/down arrow along its length, not left/right, since "right"
   * on a vertical pitch isn't a real direction the ball moves in. */
  orientation: 'vertical' | 'horizontal'
  className?: string
}

export default function AttackDirectionBadge({ attackingRight, teamName, orientation, className = '' }: AttackDirectionBadgeProps) {
  const vertical = orientation === 'vertical'
  // On a vertical pitch: attackingRight (the underlying left/right convention
  // from Match.attacking_right_first_half) maps to up/down — "right" -> up,
  // "left" -> down. Arbitrary but consistent; all that matters is it flips
  // between halves, which the caller already handles via attackingRight.
  const Icon = vertical ? (attackingRight ? ArrowUp : ArrowDown) : (attackingRight ? ArrowRight : ArrowLeft)
  const directionLabel = vertical ? (attackingRight ? 'up' : 'down') : (attackingRight ? 'right' : 'left')

  // Spell the direction out in words — an arrow + team name alone wasn't
  // obvious what it meant.
  const plainLabel = vertical
    ? (attackingRight ? 'bottom to top' : 'top to bottom')
    : (attackingRight ? 'left to right' : 'right to left')

  return (
    <div
      className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-2 bg-slate-900/90 border border-emerald-500/40 rounded-xl px-3 py-1.5 text-xs font-semibold text-white whitespace-nowrap shadow-lg ${className}`}
      title={`${teamName} attacks ${directionLabel} this half`}
    >
      {!attackingRight && !vertical && <Icon size={16} className="text-emerald-400 flex-shrink-0" />}
      <span className={vertical ? '[writing-mode:vertical-rl]' : ''}>
        {teamName} attacking <span className="text-emerald-300">{plainLabel}</span>
      </span>
      {(attackingRight || vertical) && <Icon size={16} className="text-emerald-400 flex-shrink-0" />}
    </div>
  )
}
