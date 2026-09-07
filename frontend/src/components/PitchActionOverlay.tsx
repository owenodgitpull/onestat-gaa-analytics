import { EventType } from '@/types'
import {
  CheckCircle, XCircle, Zap, Flag,
  Target, ArrowDownCircle, ArrowLeftRight, ArrowUpCircle, AlertTriangle, Move, Minus,
} from 'lucide-react'

type Variant = 'green' | 'red' | 'amber' | 'teal' | 'gray'

function variantCls(v: Variant, disabled = false): string {
  if (disabled) return 'opacity-25 cursor-not-allowed bg-white/5 border-white/10 text-white/30'
  switch (v) {
    case 'green': return 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200 hover:bg-emerald-500/30 hover:border-emerald-400/60 active:scale-[0.96]'
    case 'red':   return 'bg-rose-500/20 border-rose-400/40 text-rose-200 hover:bg-rose-500/30 hover:border-rose-400/60 active:scale-[0.96]'
    case 'amber': return 'bg-amber-500/20 border-amber-400/40 text-amber-200 hover:bg-amber-500/30 hover:border-amber-400/60 active:scale-[0.96]'
    case 'teal':  return 'bg-teal-500/20 border-teal-400/40 text-teal-200 hover:bg-teal-500/30 hover:border-teal-400/60 active:scale-[0.98]'
    case 'gray':  return 'bg-white/8 border-white/20 text-white/55 hover:bg-white/12 hover:border-white/30 active:scale-[0.98]'
  }
}

interface KickoutBtn { eventType: EventType; label: string; icon: any; variant: Variant; fullWidth?: boolean }

const OWN_KICKOUT: KickoutBtn[] = [
  { eventType: EventType.OWN_KICKOUT_WON,                   label: 'We Won',        icon: CheckCircle, variant: 'green' },
  { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON,        label: 'Opp Won',       icon: XCircle,     variant: 'red'   },
  { eventType: EventType.OWN_KICKOUT_WON_BREAK,             label: 'We Won Break',  icon: Zap,         variant: 'green' },
  { eventType: EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,  label: 'Opp Won Break', icon: XCircle,     variant: 'red'   },
  { eventType: EventType.OWN_KICKOUT_SIDELINE,              label: 'Over Sideline', icon: Flag,        variant: 'gray', fullWidth: true },
]

const OPP_KICKOUT: KickoutBtn[] = [
  { eventType: EventType.OPP_KICKOUT_WON,                   label: 'We Won',        icon: CheckCircle, variant: 'green' },
  { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON,        label: 'Opp Won',       icon: XCircle,     variant: 'red'   },
  { eventType: EventType.OPP_KICKOUT_WON_BREAK,             label: 'We Won Break',  icon: Zap,         variant: 'green' },
  { eventType: EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,  label: 'Opp Won Break', icon: XCircle,     variant: 'red'   },
  { eventType: EventType.OPP_KICKOUT_SIDELINE,              label: 'Over Sideline', icon: Flag,        variant: 'gray', fullWidth: true },
]

interface Props {
  awaitingKickout: boolean
  pendingFreeKick: boolean
  pendingFoul: 'own' | 'opponent' | null
  kickoutTab: string | null
  isIn2PointZone: boolean
  onAction: (eventType: EventType) => void
  onCancelFree: () => void
  onCancelKickout: () => void
  /** "Adjust Free Position" — hides this overlay momentarily so the pitch is
   *  visible/draggable to correct where the free is actually being taken from. */
  onAdjustFreePosition?: () => void
  /** Kickout-selection state only — collapses this overlay into a small pill
   *  elsewhere so the user can log a sub/card/correction without it in the
   *  way. Not offered for the free-kick outcome picker (out of scope here). */
  onMinimize?: () => void
}

export default function PitchActionOverlay({
  awaitingKickout,
  pendingFreeKick,
  pendingFoul,
  kickoutTab,
  isIn2PointZone,
  onAction,
  onCancelFree,
  onCancelKickout,
  onAdjustFreePosition,
  onMinimize,
}: Props) {
  if (!awaitingKickout && !pendingFreeKick) return null

  const isOwnKickout = kickoutTab === 'our_kickouts'
  const kickoutBtns  = isOwnKickout ? OWN_KICKOUT : OPP_KICKOUT
  const kickoutTitle = isOwnKickout ? 'Our Kickout' : 'Opp Kickout'

  const isOurFoul = pendingFoul === 'own'
  const freeTitle = isOurFoul ? 'Opp Free — Select Outcome' : 'Our Free — Select Outcome'

  const freeBtns = [
    { eventType: EventType.POINT_FREE,     label: 'Point (Free)',    icon: Target,          variant: 'green' as Variant, disabled: isIn2PointZone  },
    { eventType: EventType.TWO_POINT_FREE, label: '2PT (Free)',      icon: Target,          variant: 'green' as Variant, disabled: !isIn2PointZone },
    { eventType: EventType.WIDE_FREE,      label: 'Wide (Free)',     icon: XCircle,         variant: 'red'   as Variant, disabled: false           },
    { eventType: EventType.SHORT,          label: 'Dropped Short',   icon: ArrowDownCircle, variant: 'amber' as Variant, disabled: false           },
  ]

  return (
    <>
      <style>{`
        @keyframes _poi { from{opacity:0} to{opacity:1} }
        @keyframes _poc { from{opacity:0;transform:scale(.9) translateY(14px)} to{opacity:1;transform:scale(1) translateY(0)} }
      `}</style>

      {/* Full overlay — covers pitch container (regular) or pitch div (fullscreen) */}
      <div
        className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl overflow-hidden"
        style={{ animation: '_poi .15s ease-out both' }}
      >
        {/* Scrim */}
        <div
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
        />

        {/* Glassmorphism card */}
        <div
          className="relative z-10 w-full mx-4 rounded-2xl overflow-hidden"
          style={{
            maxWidth: 340,
            background: 'linear-gradient(145deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.09) 100%)',
            border: '1px solid rgba(255,255,255,0.22)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.20)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            animation: '_poc .22s cubic-bezier(.34,1.56,.64,1) both',
          }}
        >
          {/* ── Header ── */}
          {awaitingKickout ? (
            <div
              className="px-4 py-3 flex items-center justify-between border-b border-amber-500/20"
              style={{ background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))' }}
            >
              <div className="flex items-center gap-2.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-sm font-bold text-amber-300">Awaiting {kickoutTitle}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {onMinimize && (
                  <button
                    onClick={onMinimize}
                    title="Minimise — log a sub, card, or correction first"
                    className="text-white/40 hover:text-white/70 p-1 rounded bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <Minus size={13} />
                  </button>
                )}
                <button
                  onClick={onCancelKickout}
                  className="text-[11px] text-white/40 hover:text-white/70 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div
              className="px-4 py-3 flex items-center justify-between border-b border-cyan-500/20"
              style={{ background: 'linear-gradient(90deg, rgba(6,182,212,0.22), rgba(59,130,246,0.10))' }}
            >
              <div className="flex items-center gap-2.5">
                <AlertTriangle size={14} className="text-cyan-400" />
                <span className="text-sm font-bold text-cyan-300">{freeTitle}</span>
              </div>
              <button
                onClick={onCancelFree}
                className="text-[11px] text-white/40 hover:text-white/70 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* ── Button grid ── */}
          <div className="p-3 grid grid-cols-2 gap-2">
            {awaitingKickout ? (
              kickoutBtns.map(btn => {
                const Icon = btn.icon
                return btn.fullWidth ? (
                  <button
                    key={btn.eventType}
                    onClick={() => onAction(btn.eventType)}
                    className={`col-span-2 py-2.5 rounded-xl border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-all ${variantCls(btn.variant)}`}
                  >
                    <Icon size={14} />
                    {btn.label}
                  </button>
                ) : (
                  <button
                    key={btn.eventType}
                    onClick={() => onAction(btn.eventType)}
                    className={`py-3.5 rounded-xl border-2 font-semibold flex flex-col items-center gap-1.5 transition-all ${variantCls(btn.variant)}`}
                  >
                    <Icon size={18} />
                    <span className="text-xs leading-tight text-center">{btn.label}</span>
                  </button>
                )
              })
            ) : (
              <>
                {freeBtns.map(btn => {
                  const Icon = btn.icon
                  return (
                    <button
                      key={btn.eventType}
                      onClick={() => !btn.disabled && onAction(btn.eventType)}
                      disabled={btn.disabled}
                      className={`py-3.5 rounded-xl border-2 font-semibold flex flex-col items-center gap-1.5 transition-all ${variantCls(btn.variant, btn.disabled)}`}
                    >
                      <Icon size={18} />
                      <span className="text-xs leading-tight text-center">{btn.label}</span>
                    </button>
                  )
                })}
                <button
                  onClick={() => onAction(EventType.FREE_SHORT_PASS)}
                  className={`py-2.5 rounded-xl border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-all ${variantCls('teal')}`}
                >
                  <ArrowLeftRight size={14} />
                  Short Pass
                </button>
                <button
                  onClick={() => onAction(EventType.FREE_HIGH_BALL)}
                  className={`py-2.5 rounded-xl border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-all ${variantCls('teal')}`}
                >
                  <ArrowUpCircle size={14} />
                  High Ball
                </button>
                {onAdjustFreePosition && (
                  <button
                    onClick={onAdjustFreePosition}
                    className={`col-span-2 py-2.5 rounded-xl border-2 font-semibold text-sm flex items-center justify-center gap-2 transition-all ${variantCls('gray')}`}
                  >
                    <Move size={14} />
                    Adjust Free Position
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
