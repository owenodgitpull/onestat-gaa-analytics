import { useEffect, useMemo, useState } from 'react'
import type { JerseyPlayer } from './JerseyNumberStrip'
import { rankLikelyReceivers, rankAlternativeReceivers } from '@/utils/likelyReceivers'

interface BallCarrierPickerProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  onSelect: (playerId: string, jerseyNumber: number | null) => void
  attackingRight: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  disabled?: boolean
  /** Ball's own SVG coordinates (already toSvgX/toSvgY'd by the caller) — this
   * renders as pure SVG nested inside the ball's own <g>, in the same render
   * pass as the ball marker itself, so it's physically impossible for it to
   * lag or drift from the ball. */
  ballSvgX: number
  ballSvgY: number
  /** Ball's raw pitch-% position (0-100) — used to rank likely receivers by
   * actual proximity to the ball, not a fixed pitch-center bias. */
  ballPctX: number
  ballPctY: number
  /** Players recently on the ball — biases ranking toward them (see
   * rankLikelyReceivers). Optional so existing callers keep compiling. */
  recentCarrierIds?: string[]
  /** Fires whenever the radial opens/closes — lets the caller hide the
   * separate pitch-spread receiver dots while the radial is open, since
   * showing both "likely receiver" indicators at once is redundant. */
  onOpenChange?: (open: boolean) => void
}

const LIKELY_COUNT = 5

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

// Icon sits diagonally up-right of the ball, far enough out that it never
// reads as "part of" the ball, connected by a thin line so it still reads as
// attached to it. Trebled from the original offset per user feedback, then
// pulled back in 40% once that proved too far — this is now a single tap
// that opens the radial (a press-and-hold gesture triggered the browser's
// long-press context menu on tablets).
const ICON_DIST = 148
const ICON_ANGLE = -45 * (Math.PI / 180)
const ICON_DX = Math.cos(ICON_ANGLE) * ICON_DIST
const ICON_DY = Math.sin(ICON_ANGLE) * ICON_DIST
const ICON_R = 40

// Radial chip layout — bumped up again, spaced further out from the icon.
const CHIP_RADIUS = 215
const CHIP_R = 58

/**
 * Tap-to-open carrier picker. A single tap on the persistent icon opens the
 * radial; tap a chip to select. Deliberately NOT a press-and-hold gesture —
 * on tablets, holding a touch point fires the browser's native long-press
 * context menu before our own handler ever gets a chance to run, so any
 * hold-based interaction is unreliable there.
 *
 * The radial deliberately shows a DIFFERENT set of players than the pitch's
 * own lit-up nearest-to-ball dots (PitchReceiverDots) — it's meant to be the
 * quick route to someone who *isn't* already one tap away on the pitch, not
 * a second way to reach the same 5 names. See rankAlternativeReceivers.
 */
export default function BallCarrierPicker({
  players,
  activeCarrierId,
  onSelect,
  attackingRight,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  disabled = false,
  ballSvgX,
  ballSvgY,
  ballPctX,
  ballPctY,
  recentCarrierIds = [],
  onOpenChange,
}: BallCarrierPickerProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])

  const onField = useMemo(() => players.filter(p => p.isOnField), [players])

  // The radial is meant to be a quick way to reach someone who ISN'T already
  // lit up as one of the nearest-to-ball pitch dots — showing the same 5
  // names again would make it pointless. So: first work out who the dots are
  // currently highlighting (identical call PitchReceiverDots makes), then
  // rank everyone else with rankAlternativeReceivers, which favours recent
  // ball-carriers and wing-back/wing-forward "runner" positions over pure
  // proximity — the players a nearest-to-ball snapshot can't see coming.
  const alreadyLitIds = useMemo(
    () => new Set(
      rankLikelyReceivers(players, attackingRight, ballPctX, ballPctY, { activeCarrierId, recentCarrierIds })
        .slice(0, LIKELY_COUNT)
        .map(r => r.player.playerId)
    ),
    [players, attackingRight, ballPctX, ballPctY, activeCarrierId, recentCarrierIds]
  )

  const ranked = useMemo(
    () => rankAlternativeReceivers(players, attackingRight, ballPctX, ballPctY, {
      activeCarrierId, recentCarrierIds, excludeIds: [...alreadyLitIds],
    })
      .slice(0, LIKELY_COUNT)
      .map(r => r.player),
    [players, attackingRight, ballPctX, ballPctY, activeCarrierId, recentCarrierIds, alreadyLitIds]
  )

  if (onField.length === 0) return null

  const iconX = ballSvgX + ICON_DX
  const iconY = ballSvgY + ICON_DY

  const chipPos = (index: number, count: number) => {
    const spread = 150
    const startAngle = -90 - spread / 2
    const step = count > 1 ? spread / (count - 1) : 0
    const angle = (startAngle + step * index) * (Math.PI / 180)
    return { x: iconX + Math.cos(angle) * CHIP_RADIUS, y: iconY + Math.sin(angle) * CHIP_RADIUS }
  }

  const chips = ranked.map((p, i) => ({ player: p, pos: chipPos(i, ranked.length) }))

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  // Selection lives on pointerUp, not click. The pitch's own "tap ahead of
  // the ball to pass there" gesture is wired to onPointerUp on the <svg>
  // root, and pointerup bubbles independently of the synthesized click
  // event — stopping propagation on pointerDown alone (to block the ball's
  // own drag-start) was NOT enough, the pointerUp was still reaching the
  // pitch handler underneath and moving the ball to wherever this icon sits.
  // Acting directly on pointerUp (and stopping it here) closes that hole.
  const handleIconPointerUp = (e: React.PointerEvent) => {
    stop(e)
    if (disabled) return
    setOpen(o => !o)
  }

  const handleChipPointerUp = (e: React.PointerEvent, player: JerseyPlayer) => {
    stop(e)
    onSelect(player.playerId, player.jerseyNumber)
    setOpen(false)
  }

  const handleBackdropDown = (e: React.PointerEvent) => {
    stop(e)
    setOpen(false)
  }

  return (
    <>
      {/* Tap-away backdrop — covers the whole pitch so any tap outside the
          icon/chips closes the radial without falling through to the ball's
          own drag handler. */}
      {open && (
        <rect
          x={-2000} y={-2000} width={6000} height={6000}
          fill="transparent"
          onPointerDown={handleBackdropDown}
          onPointerUp={stop}
        />
      )}

      {/* Connecting line — reads as "attached to the ball", not a floating button */}
      <line
        x1={ballSvgX + Math.cos(ICON_ANGLE) * 26}
        y1={ballSvgY + Math.sin(ICON_ANGLE) * 26}
        x2={iconX - Math.cos(ICON_ANGLE) * (ICON_R - 4)}
        y2={iconY - Math.sin(ICON_ANGLE) * (ICON_R - 4)}
        stroke="rgba(255,255,255,0.55)"
        strokeWidth="2.5"
      />

      {/* Persistent icon — single tap opens/closes the radial */}
      <g
        onPointerDown={stop}
        onPointerUp={handleIconPointerUp}
        onContextMenu={(e) => e.preventDefault()}
        style={{ cursor: disabled ? 'default' : 'pointer', touchAction: 'none' }}
      >
        <circle
          cx={iconX} cy={iconY} r={ICON_R}
          fill={open ? teamPrimaryColor : 'rgba(10,18,15,0.9)'}
          stroke={open ? teamSecondaryColor : 'rgba(255,255,255,0.65)'}
          strokeWidth="3"
        />
        {/* Simple two-head "people" glyph — plain SVG shapes, no icon font/nested svg */}
        <circle cx={iconX - 10} cy={iconY - 4.5} r="7.2" fill="#fff" />
        <circle cx={iconX + 10} cy={iconY - 4.5} r="7.2" fill="#fff" />
        <path
          d={`M ${iconX - 21} ${iconY + 17} Q ${iconX - 21} ${iconY} ${iconX - 10} ${iconY} Q ${iconX} ${iconY} ${iconX} ${iconY + 13}`}
          fill="#fff"
        />
        <path
          d={`M ${iconX + 21} ${iconY + 17} Q ${iconX + 21} ${iconY} ${iconX + 10} ${iconY} Q ${iconX} ${iconY} ${iconX} ${iconY + 13}`}
          fill="#fff"
        />
      </g>

      {open && (
        <>
          {chips.map((c) => {
            const isActive = c.player.playerId === activeCarrierId
            const hasJersey = c.player.jerseyNumber != null
            return (
              <g
                key={c.player.playerId}
                onPointerDown={stop}
                onPointerUp={(e) => handleChipPointerUp(e, c.player)}
                onContextMenu={(e) => e.preventDefault()}
                style={{ cursor: 'pointer', touchAction: 'none' }}
              >
                <circle
                  cx={c.pos.x} cy={c.pos.y} r={CHIP_R}
                  fill={teamPrimaryColor}
                  stroke={isActive ? '#6ee7b7' : teamSecondaryColor}
                  strokeWidth={isActive ? 4 : 2.5}
                />
                <text
                  x={c.pos.x} y={c.pos.y}
                  textAnchor="middle" dominantBaseline="central"
                  fill="#fff"
                  fontWeight="800" fontSize={hasJersey ? 34 : 24}
                >
                  {hasJersey ? c.player.jerseyNumber : (c.player.positionLabel || '?')}
                </text>
                <rect
                  x={c.pos.x - 64} y={c.pos.y + CHIP_R + 7} width="128" height="29" rx="14.5"
                  fill="rgba(0,0,0,0.82)"
                />
                <text
                  x={c.pos.x} y={c.pos.y + CHIP_R + 22}
                  textAnchor="middle" dominantBaseline="central"
                  fill="#fff" fontWeight="700" fontSize="18"
                >
                  {surname(c.player.playerName)}
                </text>
              </g>
            )
          })}
        </>
      )}
    </>
  )
}
