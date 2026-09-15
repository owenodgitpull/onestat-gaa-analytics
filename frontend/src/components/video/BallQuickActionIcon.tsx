interface BallQuickActionIconProps {
  /** Ball's own SVG coordinates (already toSvgX/toSvgY'd by the caller) —
   *  same anchoring convention as BallCarrierPicker.tsx's radial icon, so
   *  this renders in the same render pass as the ball marker and can never
   *  lag or drift from it. */
  ballSvgX: number
  ballSvgY: number
  /** Direction this icon sits off the ball, in degrees, SVG y-down
   *  convention (e.g. -90 = straight up, -45 = up-right — the angle
   *  BallCarrierPicker's own radial-opener icon uses). Pick an angle at
   *  least ~45° away from any sibling icon so connecting lines/circles
   *  never overlap. */
  angleDeg: number
  /** Short label inside the circle (1-2 chars reads best at this radius). */
  label: string
  color?: string
  textColor?: string
  onTap: () => void
  title?: string
  disabled?: boolean
  /** Running count to badge onto the icon (e.g. passes so far this
   *  possession spell) — omit entirely for a plain icon with no counter.
   *  Badge is hidden at 0 and appears from the first tap onward; the whole
   *  icon "pops" via a brief scale animation every time this changes, so a
   *  tap always gets an immediate visual acknowledgement even if the event
   *  log is scrolled out of view. */
  count?: number
  /** TaggingPitch's current orientation — in 'vertical', this whole icon
   *  renders inside a 90°-rotated <g>, which would otherwise leave the
   *  label and count badge sideways. Both <text> elements get a
   *  counter-rotation around their own center so they always read
   *  upright, regardless of the icon's (correctly rotated) position. */
  orientation?: 'horizontal' | 'vertical'
  /** Two-tap "arm, then tap the pitch" actions (e.g. Long Kick) pass this
   *  instead of `count` — true from the moment the icon is tapped until the
   *  destination tap resolves it. Renders a continuously-looping pulse ring
   *  around the icon (distinct from `count`'s one-off pop) so it's obvious,
   *  without any banner/modal, that the very next pitch tap will be
   *  captured rather than behaving as a normal action. Tapping the icon
   *  again while armed is expected to cancel it (the caller's onTap should
   *  toggle, not just arm). */
  armed?: boolean
}

const ICON_DIST = 148
const ICON_R = 36

/**
 * A single-tap ball-anchored icon button — the same visual language as
 * BallCarrierPicker's persistent radial-opener icon (offset from the ball
 * by a fixed distance along a given angle, connected by a thin line), but
 * for actions that don't need a picker: one tap fires immediately. Used
 * for the opposition-only "Pass" quick-log and the "Long Kick" quick-log
 * (both teams), which sit at different angles from the ball than
 * BallCarrierPicker's own icon so none of them ever collide.
 */
export default function BallQuickActionIcon({
  ballSvgX,
  ballSvgY,
  angleDeg,
  label,
  color = '#0891b2',
  textColor = '#fff',
  onTap,
  title,
  disabled = false,
  count,
  orientation = 'horizontal',
  armed = false,
}: BallQuickActionIconProps) {
  const angle = angleDeg * (Math.PI / 180)
  const dx = Math.cos(angle) * ICON_DIST
  const dy = Math.sin(angle) * ICON_DIST
  const iconX = ballSvgX + dx
  const iconY = ballSvgY + dy
  const badgeX = iconX + ICON_R * 0.72
  const badgeY = iconY - ICON_R * 0.72

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()

  return (
    <g style={{ opacity: disabled ? 0.35 : 1, transition: 'opacity 0.2s ease' }}>
      <style>{`
        @keyframes bqai-pop { 0% { transform: scale(1.35); } 100% { transform: scale(1); } }
        @keyframes bqai-armed-ping { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(1.8); opacity: 0; } }
      `}</style>
      {armed && (
        <circle
          cx={iconX} cy={iconY} r={ICON_R}
          fill="none" stroke={color} strokeWidth={3}
          style={{ transformOrigin: `${iconX}px ${iconY}px`, animation: 'bqai-armed-ping 1.1s ease-out infinite' }}
        />
      )}
      <line
        x1={ballSvgX + Math.cos(angle) * 26}
        y1={ballSvgY + Math.sin(angle) * 26}
        x2={iconX - Math.cos(angle) * (ICON_R - 4)}
        y2={iconY - Math.sin(angle) * (ICON_R - 4)}
        stroke="rgba(255,255,255,0.5)"
        strokeWidth="2.5"
      />
      {/* key={count} remounts on every tap, restarting the pop animation —
          a tap always gets an immediate visual acknowledgement. */}
      <g
        key={count ?? 'static'}
        onPointerDown={stop}
        onPointerUp={(e) => { stop(e); if (!disabled) onTap() }}
        onContextMenu={(e) => e.preventDefault()}
        style={{
          cursor: disabled ? 'default' : 'pointer',
          touchAction: 'none',
          // The ancestor pitch <svg> sets pointer-events:none while the
          // video is paused (TaggingPitch's own `disabled` prop) — that's
          // right for ball drag/tap-to-place, but these are single-tap
          // quick-loggers meant to work at any paused moment too. `auto`
          // here explicitly overrides the inherited `none` from above.
          pointerEvents: disabled ? 'none' : 'auto',
          transformOrigin: `${iconX}px ${iconY}px`,
          animation: count ? 'bqai-pop 0.35s ease-out' : undefined,
        }}
      >
        {title && <title>{title}</title>}
        <circle
          cx={iconX} cy={iconY} r={ICON_R} fill={color}
          stroke={armed ? '#fef08a' : '#fff'}
          strokeWidth={armed ? 4 : 2.5}
        />
        <text
          x={iconX} y={iconY}
          textAnchor="middle" dominantBaseline="central"
          fill={textColor} fontWeight="800"
          fontSize={label.length > 1 ? 18 : 22}
          transform={orientation === 'vertical' ? `rotate(-90 ${iconX} ${iconY})` : undefined}
        >
          {label}
        </text>
        {!!count && count > 0 && (
          <>
            <circle cx={badgeX} cy={badgeY} r={18} fill="#f43f5e" stroke="#fff" strokeWidth={2.5} />
            <text
              x={badgeX} y={badgeY}
              textAnchor="middle" dominantBaseline="central"
              fill="#fff" fontWeight="800" fontSize={18}
              transform={orientation === 'vertical' ? `rotate(-90 ${badgeX} ${badgeY})` : undefined}
            >
              {count}
            </text>
          </>
        )}
      </g>
    </g>
  )
}
