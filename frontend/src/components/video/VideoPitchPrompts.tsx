/**
 * VideoPitchPrompts — the on-pitch prompts Live Recording shows over its pitch
 * (foul type, turnover reason, unforced-error type, kickout landing, free
 * adjust, 45-line tap), rebuilt as overlays for Video Tagging's pitch panel so
 * the coach's eyes stay on the pitch exactly as they do when recording live.
 *
 * Everything here is positioned `absolute` and must be rendered inside the
 * pitch panel's `relative` container. Data (subtype lists, reason config) comes
 * from the shared constants file so Live Recording and Video Tagging can never
 * drift apart.
 */

import { useEffect, useRef, useState } from 'react'
import { MapPin } from 'lucide-react'
import {
  UNFORCED_ERROR_SUBTYPES, FOUL_SUBTYPES, DISPOSSESSION_SUBTYPES, OFFENSIVE_FOUL_SUBTYPES,
  type SubtypeOption, type TurnoverReason,
} from '../../constants/turnoverSubtypes'

function Scrim({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-3 overflow-y-auto">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
      />
      <div className="relative z-10 w-full flex justify-center">{children}</div>
    </div>
  )
}

// ── Foul / unforced-error subtype picker ─────────────────────────────────

interface SubtypePromptProps {
  title: string
  playerName?: string | null
  options: SubtypeOption[]
  /** Foul mode only — shows the "Tactical" checkbox (records sub_type 'tactical'). */
  tactical?: boolean
  onTacticalChange?: (v: boolean) => void
  onSelect: (subtype?: string) => void
}

export function SubtypePrompt({ title, playerName, options, tactical, onTacticalChange, onSelect }: SubtypePromptProps) {
  return (
    <Scrim>
      <div className="w-full max-w-sm bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl p-5">
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-bold text-white">{title}</p>
          {onTacticalChange && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={!!tactical} onChange={e => onTacticalChange(e.target.checked)} className="w-4 h-4 rounded" />
              <span className="text-xs text-white/70">Tactical</span>
            </label>
          )}
        </div>
        <p className="text-xs text-white/40 mb-4">{playerName ?? 'Player'} — tap to categorise or skip</p>
        <div className="flex flex-wrap gap-2 mb-4">
          {options.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onSelect(value)}
              className="px-3 py-1.5 rounded-full bg-white/10 hover:bg-emerald-600/30 border border-white/10 hover:border-emerald-500/40 text-white/80 hover:text-white text-xs font-medium transition-all"
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={() => onSelect(undefined)}
          className="w-full py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 text-xs transition-colors"
        >
          Skip categorisation
        </button>
      </div>
    </Scrim>
  )
}

export const FOUL_PROMPT_OPTIONS = FOUL_SUBTYPES
export const ERROR_PROMPT_OPTIONS = UNFORCED_ERROR_SUBTYPES

// ── "How was possession lost?" flat turnover-reason picker ───────────────

interface TurnoverReasonPromptProps {
  playerName?: string | null
  /** `tactical` only ever true for the "Tactical Foul" chip. */
  onSelect: (reason: TurnoverReason, subType?: string, tactical?: boolean) => void
  onSkip: () => void
}

const QUICK: Array<{ label: string; reason: TurnoverReason; sub?: string; hover: string }> = [
  { label: 'Overcarry', reason: 'offensive_foul', sub: 'overcarrying', hover: 'hover:bg-orange-600/30 hover:border-orange-500/40' },
  { label: 'Hard Pass', reason: 'dispossession', sub: 'forced_interception', hover: 'hover:bg-red-600/30 hover:border-red-500/40' },
  { label: 'Kick Pass', reason: 'unforced', sub: 'kick_over_sideline', hover: 'hover:bg-amber-600/30 hover:border-amber-500/40' },
  { label: 'Handling', reason: 'unforced', sub: 'dropped_ball', hover: 'hover:bg-amber-600/30 hover:border-amber-500/40' },
  { label: 'Tackled', reason: 'dispossession', sub: 'tackle', hover: 'hover:bg-red-600/30 hover:border-red-500/40' },
  { label: 'Foul', reason: 'offensive_foul', hover: 'hover:bg-orange-600/30 hover:border-orange-500/40' },
  { label: 'Stray Pass', reason: 'unforced', sub: 'stray_pass', hover: 'hover:bg-amber-600/30 hover:border-amber-500/40' },
  { label: 'Square', reason: 'unforced', sub: 'square_ball', hover: 'hover:bg-amber-600/30 hover:border-amber-500/40' },
  { label: 'Strip', reason: 'dispossession', sub: 'strip', hover: 'hover:bg-red-600/30 hover:border-red-500/40' },
]

export function TurnoverReasonPrompt({ playerName, onSelect, onSkip }: TurnoverReasonPromptProps) {
  const chip = 'px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-white/70 hover:text-white text-xs transition-all active:scale-95'
  return (
    <Scrim>
      <div className="w-full max-w-md bg-[#0f1a1a] border border-white/10 rounded-2xl shadow-2xl p-4 max-h-full overflow-y-auto">
        <p className="text-sm font-bold text-white mb-1">How was possession lost?</p>
        <p className="text-xs text-white/40 mb-3">{playerName ?? 'Player'}</p>

        <div className="grid grid-cols-3 gap-2 mb-3">
          {QUICK.map(q => (
            <button
              key={q.label}
              onClick={() => onSelect(q.reason, q.sub)}
              className={`px-3 py-3 rounded-xl bg-white/10 border border-white/10 text-white text-xs font-semibold transition-all active:scale-95 ${q.hover}`}
            >
              {q.label}
            </button>
          ))}
        </div>

        <details className="mb-3">
          <summary className="text-xs text-white/50 hover:text-white/70 cursor-pointer mb-2 select-none">Advanced ▾</summary>
          <div className="flex flex-col gap-2 pl-2">
            <div>
              <p className="text-[10px] font-semibold text-red-400/60 uppercase tracking-wide mb-1">Active Dispossession</p>
              <div className="flex flex-wrap gap-1.5">
                {DISPOSSESSION_SUBTYPES.filter(s => !['tackle', 'strip', 'forced_interception'].includes(s.value)).map(({ value, label }) => (
                  <button key={value} onClick={() => onSelect('dispossession', value)} className={`${chip} hover:bg-red-600/20 hover:border-red-500/30`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-amber-400/60 uppercase tracking-wide mb-1">Unforced Error</p>
              <div className="flex flex-wrap gap-1.5">
                {UNFORCED_ERROR_SUBTYPES.filter(s => !['dropped_ball', 'kick_over_sideline', 'square_ball', 'stray_pass'].includes(s.value)).map(({ value, label }) => (
                  <button key={value} onClick={() => onSelect('unforced', value)} className={`${chip} hover:bg-amber-600/20 hover:border-amber-500/30`}>{label}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-orange-400/60 uppercase tracking-wide mb-1">Offensive Foul</p>
              <div className="flex flex-wrap gap-1.5">
                {OFFENSIVE_FOUL_SUBTYPES.filter(s => s.value !== 'overcarrying').map(({ value, label }) => (
                  <button key={value} onClick={() => onSelect('offensive_foul', value)} className={`${chip} hover:bg-orange-600/20 hover:border-orange-500/30`}>{label}</button>
                ))}
                <button onClick={() => onSelect('offensive_foul', undefined, true)} className={`${chip} hover:bg-orange-600/20 hover:border-orange-500/30`}>
                  Tactical Foul
                </button>
              </div>
            </div>
          </div>
        </details>

        <button
          onClick={onSkip}
          className="w-full py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 text-xs font-medium transition-colors"
        >
          Skip
        </button>
      </div>
    </Scrim>
  )
}

// ── Optional "aimed for" jersey chips for our own kickouts. Rendered in the
// button-bar kickout panel (off the pitch) so the pitch stays fully tappable.

export function AimedForChips({ players, selectedId, onToggle }: {
  players: Array<{ playerId: string; jerseyNumber: number | null }>
  selectedId?: string
  onToggle: (playerId: string) => void
}) {
  if (players.length === 0) return null
  return (
    <div className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 overflow-x-auto bg-black/30">
      <span className="text-white/50 text-[10px] font-semibold flex-shrink-0 pr-0.5">Aimed for (optional):</span>
      {players.map(p => (
        <button
          key={p.playerId}
          onClick={() => onToggle(p.playerId)}
          className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
            selectedId === p.playerId ? 'bg-emerald-400 text-black scale-110' : 'bg-white/10 text-white/60 hover:bg-white/20'
          }`}
        >
          {p.jerseyNumber ?? '?'}
        </button>
      ))}
    </div>
  )
}
/** Optional, non-blocking "how was the high ball won?" chips — shown for a few seconds after a
 *  High Ball's landing spot is tapped, then fade away. Ignoring them just means "not recorded". */
export function HighBallChips({
  onPick,
  onDismiss,
}: {
  onPick: (contact: 'clean' | 'break') => void
  onDismiss: () => void
}) {
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 8000)
    return () => clearTimeout(t)
  }, [])
  return (
    <div
      className="flex items-center gap-1.5 rounded-2xl px-3 py-2 animate-fade-in"
      style={{
        background: 'linear-gradient(90deg, rgba(14,34,42,0.82), rgba(8,20,26,0.74))',
        border: '1px solid rgba(217,119,6,0.4)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
      }}
    >
      <span className="text-[11px] font-semibold text-amber-200/80 mr-1">High ball:</span>
      <button
        onClick={() => onPick('clean')}
        className="text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white/5 border-white/15 text-white/80 hover:bg-emerald-500/20 hover:border-emerald-400/50 hover:text-white transition-colors"
      >
        Clean catch
      </button>
      <button
        onClick={() => onPick('break')}
        className="text-[11px] font-bold px-2.5 py-1 rounded-lg border bg-white/5 border-white/15 text-white/80 hover:bg-amber-500/20 hover:border-amber-400/50 hover:text-white transition-colors"
      >
        Break
      </button>
      <button onClick={onDismiss} className="text-white/40 hover:text-white text-xs px-1" title="Skip">✕</button>
    </div>
  )
}

/** Banner while an existing event is being moved on the pitch (Video Tagging event log). */
export function RepositionBanner({
  label,
  step,
  onCancel,
}: {
  label: string
  step: 'start' | 'end'
  onCancel: () => void
}) {
  return (
    <div className="absolute inset-x-3 top-3 z-20">
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
        style={{
          background: 'linear-gradient(90deg, rgba(168,85,247,0.28), rgba(99,102,241,0.14))',
          border: '1px solid rgba(168,85,247,0.45)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        }}
      >
        <span className="text-purple-100 text-sm font-semibold flex items-center gap-2">
          <MapPin size={14} className="flex-shrink-0" />
          {step === 'start' ? `Tap the pitch where the ${label} happened` : `Now tap where the ${label} landed`}
        </span>
        <button
          onClick={onCancel}
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-white/10 border border-white/20 text-white/80 hover:bg-white/20 transition-colors flex-shrink-0"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export type BroughtForwardReason = 'dissent' | 'interfering_set_piece' | 'breaching_mark'

const BROUGHT_FORWARD_REASONS: { value: BroughtForwardReason; label: string }[] = [
  { value: 'dissent', label: 'Dissent' },
  { value: 'interfering_set_piece', label: 'Blocking the free' },
  { value: 'breaching_mark', label: 'Breach of mark' },
]

/** Optional "why did the ref bring it forward?" chips — shown while the free's spot is
 *  being adjusted. Tapping one marks the free as brought forward for that reason (tap again
 *  to clear). Moving the ball without choosing a reason is just correcting the spot. */
export function BroughtForwardChips({
  reason,
  onChange,
}: {
  reason: BroughtForwardReason | null
  onChange: (r: BroughtForwardReason | null) => void
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-1.5 rounded-2xl px-3 py-2"
      style={{
        background: 'linear-gradient(90deg, rgba(14,34,42,0.78), rgba(8,20,26,0.7))',
        border: '1px solid rgba(255,255,255,0.12)',
        backdropFilter: 'blur(14px)',
        WebkitBackdropFilter: 'blur(14px)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
      }}
    >
      <span className="text-[11px] font-semibold text-white/60 mr-1">Ref brought it forward? Why:</span>
      {BROUGHT_FORWARD_REASONS.map(r => {
        const active = reason === r.value
        return (
          <button
            key={r.value}
            onClick={() => onChange(active ? null : r.value)}
            className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border transition-colors ${
              active
                ? 'bg-amber-500/30 border-amber-400/60 text-amber-100'
                : 'bg-white/5 border-white/15 text-white/70 hover:bg-white/10 hover:text-white'
            }`}
          >
            {r.label}
          </button>
        )
      })}
    </div>
  )
}

/** The brought-forward question is opt-in: moving a free is usually just placing it where the taker put it. */
export function BroughtForwardOptIn({
  reason,
  onChange,
}: {
  reason: BroughtForwardReason | null
  onChange: (r: BroughtForwardReason | null) => void
}) {
  const [open, setOpen] = useState(!!reason)
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
      >
        Ref brought it forward
      </button>
    )
  }
  return <BroughtForwardChips reason={reason} onChange={onChange} />
}

export function AdjustFreeBanner({
  onDone,
  reason,
  onReason,
}: {
  onDone: () => void
  reason?: BroughtForwardReason | null
  onReason?: (r: BroughtForwardReason | null) => void
}) {
  // Moving the ball is usually just placing it where the taker put it. The "why did the referee bring
  // it forward?" question only appears if the user says the ref did.
  const [refBroughtForward, setRefBroughtForward] = useState(!!reason)
  return (
    <div className="absolute inset-x-3 top-3 z-20 space-y-1.5">
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
        style={{
          background: 'linear-gradient(90deg, rgba(6,182,212,0.25), rgba(59,130,246,0.12))',
          border: '1px solid rgba(6,182,212,0.4)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        }}
      >
        <span className="text-cyan-200 text-sm font-semibold flex items-center gap-2">
          <MapPin size={14} className="flex-shrink-0" />
          Drag the ball to the free's real spot
        </span>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onReason && !refBroughtForward && (
            <button
              onClick={() => setRefBroughtForward(true)}
              className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/15 text-white/70 hover:bg-white/10 hover:text-white transition-colors"
            >
              Ref brought it forward
            </button>
          )}
          <button
            onClick={onDone}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/35 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
      {onReason && refBroughtForward && <BroughtForwardChips reason={reason ?? null} onChange={onReason} />}
    </div>
  )
}
