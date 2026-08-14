import { useMemo, useState } from 'react'
import { Users } from 'lucide-react'
import type { JerseyPlayer } from './JerseyNumberStrip'

interface BallCarrierPickerProps {
  players: JerseyPlayer[]
  activeCarrierId: string | null
  onSelect: (playerId: string, jerseyNumber: number | null) => void
  attackingRight: boolean
  teamPrimaryColor?: string
  teamSecondaryColor?: string
  disabled?: boolean
}

const LIKELY_COUNT = 5

/** Same formation slots as PitchPlayerSelector, kept local to avoid a cross-file dependency for 15 constants. */
const FORMATION_XY: Record<string, { x: number; y: number }> = {
  'gk': { x: 7, y: 50 },
  'fb-left': { x: 20, y: 18 }, 'fb-center': { x: 20, y: 50 }, 'fb-right': { x: 20, y: 82 },
  'hb-left': { x: 35, y: 18 }, 'hb-center': { x: 35, y: 50 }, 'hb-right': { x: 35, y: 82 },
  'mf-left': { x: 50, y: 35 }, 'mf-right': { x: 50, y: 65 },
  'hf-left': { x: 65, y: 18 }, 'hf-center': { x: 65, y: 50 }, 'hf-right': { x: 65, y: 82 },
  'ff-left': { x: 80, y: 18 }, 'ff-center': { x: 80, y: 50 }, 'ff-right': { x: 80, y: 82 },
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts[parts.length - 1] || name
}

/**
 * Persistent icon anchored to the ball (rendered inside GAAPitch's
 * ballAnchoredOverlay slot — a foreignObject in the pitch's own 2332x1446
 * SVG viewBox, so every size here is in SVG user units, not CSS px. They
 * get scaled down by the same factor as the rest of the pitch graphic, which
 * is why the numbers below look huge for what's meant to end up ~50-60px on
 * screen). Ball = 50%/50% of this component's local box. Tap the icon and
 * the likeliest 5 receivers — ranked by formation-slot distance from the
 * ball — bloom out in an arc. JerseyNumberStrip remains below as the full
 * squad fallback; this is the fast path for the common case.
 */
export default function BallCarrierPicker({
  players,
  activeCarrierId,
  onSelect,
  attackingRight,
  teamPrimaryColor = '#10B981',
  teamSecondaryColor = '#FFFFFF',
  disabled = false,
}: BallCarrierPickerProps) {
  const [open, setOpen] = useState(false)

  const onField = useMemo(() => players.filter(p => p.isOnField), [players])

  const ranked = useMemo(() => {
    // Ball sits at the center of this local box (50%, 50%) by construction —
    // rank each on-field player by distance from that center in the same
    // screen-space frame their formation slot renders in.
    return onField
      .map(p => {
        const slot = FORMATION_XY[p.positionId || ''] || { x: 50, y: 50 }
        const sx = attackingRight ? slot.x : 100 - slot.x
        const sy = slot.y
        const dist = Math.hypot(sx - 50, sy - 50)
        return { player: p, dist }
      })
      .sort((a, b) => a.dist - b.dist)
      .slice(0, LIKELY_COUNT)
      .map(r => r.player)
  }, [onField, attackingRight])

  if (onField.length === 0) return null

  const chipPos = (index: number, count: number) => {
    // Bloom in an upward-biased arc so chips stay clear of the ball icon
    // itself and lean toward open pitch rather than off the edge.
    const spread = 150
    const startAngle = -90 - spread / 2
    const step = count > 1 ? spread / (count - 1) : 0
    const angle = (startAngle + step * index) * (Math.PI / 180)
    const dist = 21 // % of local box
    const x = 50 + Math.cos(angle) * dist
    const y = 50 + Math.sin(angle) * dist
    return { left: `${Math.max(8, Math.min(92, x))}%`, top: `${Math.max(8, Math.min(92, y))}%` }
  }

  return (
    <>
      {/* Persistent icon, offset from the ball so it doesn't sit under it */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); if (!disabled) setOpen(o => !o) }}
        disabled={disabled}
        aria-label={open ? 'Close carrier picker' : 'Pick who has the ball'}
        style={{
          position: 'absolute',
          left: '59%',
          top: '28%',
          transform: `translate(-50%, -50%) scale(${open ? 1.08 : 1})`,
          width: 260, height: 260,
          borderRadius: '50%',
          background: open ? teamPrimaryColor : 'rgba(10,18,15,0.85)',
          border: `14px solid ${open ? teamSecondaryColor : 'rgba(255,255,255,0.55)'}`,
          color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: disabled ? 'default' : 'pointer',
          pointerEvents: 'auto',
          boxShadow: '0 6px 40px rgba(0,0,0,0.55)',
          transition: 'transform 0.15s ease, background 0.15s ease',
          zIndex: 8,
        }}
      >
        <Users size={110} strokeWidth={2.4} />
      </button>

      {open && (
        <>
          {/* Tap-away backdrop, invisible, just closes the bloom */}
          <div
            style={{ position: 'fixed', inset: 0, pointerEvents: 'auto', zIndex: 6 }}
            onClick={() => setOpen(false)}
          />
          {ranked.map((p, i) => {
            const pos = chipPos(i, ranked.length)
            const isActive = p.playerId === activeCarrierId
            const hasJersey = p.jerseyNumber != null
            return (
              <button
                key={p.playerId}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect(p.playerId, p.jerseyNumber)
                  setOpen(false)
                }}
                style={{
                  position: 'absolute',
                  left: pos.left,
                  top: pos.top,
                  transform: 'translate(-50%, -50%)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
                  pointerEvents: 'auto',
                  zIndex: 7,
                  animation: `bcpBloom 0.22s cubic-bezier(.2,.9,.3,1.3) ${i * 35}ms backwards`,
                  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 320, height: 320, borderRadius: '50%',
                    background: teamPrimaryColor,
                    border: `16px solid ${isActive ? '#6ee7b7' : teamSecondaryColor}`,
                    boxShadow: isActive
                      ? `0 0 0 20px rgba(110,231,183,0.3), 0 6px 40px rgba(0,0,0,0.55)`
                      : `0 6px 40px rgba(0,0,0,0.55)`,
                    color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 800, fontSize: hasJersey ? 120 : 78,
                    lineHeight: 1,
                  }}
                >
                  {hasJersey ? p.jerseyNumber : (p.positionLabel || '?')}
                </div>
                <span
                  style={{
                    fontSize: 70, fontWeight: 700, color: '#fff',
                    background: 'rgba(0,0,0,0.78)', padding: '8px 34px', borderRadius: 999,
                    whiteSpace: 'nowrap', maxWidth: 640, overflow: 'hidden', textOverflow: 'ellipsis',
                  }}
                >
                  {surname(p.playerName)}
                </span>
              </button>
            )
          })}
        </>
      )}
      <style>{`
        @keyframes bcpBloom {
          from { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }
      `}</style>
    </>
  )
}
