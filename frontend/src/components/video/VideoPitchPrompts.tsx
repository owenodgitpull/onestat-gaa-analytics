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

import { Minus, MapPin, Flag } from 'lucide-react'
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

// ── Banners (don't block the pitch — the pitch must stay tappable) ───────

interface LandingBannerProps {
  /** Sideline kickouts need the touchline tapped, so the banner moves to the top. */
  atTop?: boolean
  onCancel: () => void
  onMinimize?: () => void
  /** Own kickouts only: optional "aimed for" jersey chips. */
  aimedFor?: {
    players: Array<{ playerId: string; jerseyNumber: number | null }>
    selectedId?: string
    onToggle: (playerId: string) => void
  }
}

export function KickoutLandingBanner({ atTop, onCancel, onMinimize, aimedFor }: LandingBannerProps) {
  return (
    <div className={`absolute inset-x-3 z-20 space-y-1.5 ${atTop ? 'top-3' : 'bottom-3'}`}>
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
        style={{
          background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(234,179,8,0.10))',
          border: '1px solid rgba(245,158,11,0.38)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-amber-200 text-sm font-bold flex-shrink-0">Tap landing position</span>
          <span className="text-amber-300/60 text-xs hidden xl:block truncate">tap the pitch to mark where the ball landed</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {onMinimize && (
            <button
              onClick={onMinimize}
              title="Minimise"
              className="text-amber-400/60 hover:text-amber-300 p-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
            >
              <Minus size={13} />
            </button>
          )}
          <button
            onClick={onCancel}
            className="text-amber-400/60 hover:text-amber-300 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {aimedFor && aimedFor.players.length > 0 && (
        <div
          className="flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 overflow-x-auto"
          style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}
        >
          <span className="text-white/40 text-[10px] font-semibold flex-shrink-0 pr-0.5">Aimed for (optional):</span>
          {aimedFor.players.map(p => (
            <button
              key={p.playerId}
              onClick={() => aimedFor.onToggle(p.playerId)}
              className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                aimedFor.selectedId === p.playerId ? 'bg-amber-400 text-black scale-110' : 'bg-white/10 text-white/60 hover:bg-white/20'
              }`}
            >
              {p.jerseyNumber ?? '?'}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function FortyFiveTapBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="absolute inset-x-3 top-3 z-20">
      <div
        className="flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5"
        style={{
          background: 'linear-gradient(90deg, rgba(245,158,11,0.22), rgba(249,115,22,0.10))',
          border: '1px solid rgba(245,158,11,0.38)',
          backdropFilter: 'blur(14px)',
          WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 4px 24px rgba(0,0,0,0.45)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Flag size={14} className="text-amber-400 animate-pulse flex-shrink-0" />
          <span className="text-amber-200 text-sm font-bold">Tap the 45m line</span>
          <span className="text-amber-300/60 text-xs hidden xl:block truncate">level with where the ball went out</span>
        </div>
        <button onClick={onCancel} className="text-amber-400/60 hover:text-amber-300 text-xs px-2.5 py-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function AdjustFreeBanner({ onDone }: { onDone: () => void }) {
  return (
    <div className="absolute inset-x-3 top-3 z-20">
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
        <button
          onClick={onDone}
          className="text-xs font-bold px-3 py-1.5 rounded-lg bg-cyan-500/25 border border-cyan-400/50 text-cyan-200 hover:bg-cyan-500/35 transition-colors flex-shrink-0"
        >
          Done
        </button>
      </div>
    </div>
  )
}
