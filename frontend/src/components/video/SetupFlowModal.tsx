/**
 * SetupFlowModal — guided pre-tracking setup for Video Tagging.
 *
 * Replaces the old, separate throw-in-marker card + HalftimeMarker banner.
 * Those two were independent systems, and HalftimeMarker was only ever
 * wired into the page's normal-mode layout — invisible in fullscreen. This
 * component is rendered from inside the shared video area (see
 * VideoTagging.tsx), so it works identically in both layouts, and walks
 * the user through every mark needed before tracking can start: 1st-half
 * throw-in, half-time whistle, 2nd-half throw-in, full-time whistle/hooner,
 * then attack direction, ending in a clear "Start Match Tracking" CTA.
 */

import { useState } from 'react'
import { Loader2, SkipForward, ArrowLeftRight, ChevronDown } from 'lucide-react'

export type SetupStep = 'first_half' | 'half_time' | 'second_half' | 'full_time' | 'direction' | 'throw_in_winner' | 'ready'

interface SetupFlowModalProps {
  step: SetupStep
  currentTimeMs: number
  homeTeamName: string
  opponentName: string
  isSaving: boolean
  error?: string | null
  /** clockOffsetMs = match clock at the marked frame (0 / undefined = a real throw-in) */
  onMarkFirstHalf: (clockOffsetMs?: number) => void
  onMarkHalftime: () => void
  onSkipHalftime: () => void
  onMarkSecondHalf: () => void
  onSkipSecondHalf: () => void
  onMarkFullTime: () => void
  onSkipFullTime: () => void
  onSetDirection: (attackingRight: boolean) => void
  onSelectThrowInWinner: (winner: 'team_a' | 'team_b') => void
  onStartTracking: () => void
}

const STEP_ORDER: { key: SetupStep; label: string }[] = [
  { key: 'first_half', label: 'Throw-In' },
  { key: 'half_time', label: 'Half-Time' },
  { key: 'second_half', label: '2nd Half' },
  { key: 'full_time', label: 'Full-Time' },
  { key: 'direction', label: 'Direction' },
  { key: 'throw_in_winner', label: 'Possession' },
]

function formatVideoTime(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`
}

/** "2:05" / "02:05" / "12:30" -> ms, or null if it isn't a valid mm:ss. */
function parseClock(text: string): number | null {
  const m = text.trim().match(/^(\d{1,3}):([0-5]\d)$/)
  if (!m) return null
  return (parseInt(m[1], 10) * 60 + parseInt(m[2], 10)) * 1000
}

export default function SetupFlowModal({
  step,
  currentTimeMs,
  homeTeamName,
  opponentName,
  isSaving,
  error,
  onMarkFirstHalf,
  onMarkHalftime,
  onSkipHalftime,
  onMarkSecondHalf,
  onSkipSecondHalf,
  onMarkFullTime,
  onSkipFullTime,
  onSetDirection,
  onSelectThrowInWinner,
  onStartTracking,
}: SetupFlowModalProps) {
  const stepIndex = STEP_ORDER.findIndex(s => s.key === step)
  // Optional: footage starts after the throw-in (e.g. broadcast cut in late)
  const [joinsMidMatch, setJoinsMidMatch] = useState(false)
  const [clockText, setClockText] = useState('')
  const clockMs = parseClock(clockText)
  const midMatchInvalid = joinsMidMatch && clockMs == null

  // Steps that need video interaction (scrubbing) vs steps that are pure choice
  const needsVideoInteraction = ['first_half', 'half_time', 'second_half', 'full_time'].includes(step)
  const showOverlay = !needsVideoInteraction // Overlay for direction, throw_in_winner, and ready

  return (
    <>
      {/* Dark overlay when user needs to focus on modal choice (not video scrubbing) */}
      {showOverlay && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-20 pointer-events-auto" />
      )}

      <div className={`absolute z-30 pointer-events-none ${
        showOverlay
          ? 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 max-h-[92%]' // Centered when overlay is active
          : 'top-3 left-3 bottom-3' // Top-left when video interaction needed; bottom-3 caps height to the video container
      }`}>
        {/* max-h-full + overflow-y-auto: the card never grows past the video container (the
            expanded "footage starts after the throw-in" scenarios used to get clipped) */}
        <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-xl border border-emerald-500/30 rounded-2xl px-5 py-4 w-[360px] max-w-full max-h-full overflow-y-auto overscroll-contain shadow-2xl shadow-emerald-500/10">
        {/* Step indicator */}
        {step !== 'ready' && (
          <div className="flex items-center gap-1 mb-3">
            {STEP_ORDER.map((s, i) => (
              <div
                key={s.key}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  i < stepIndex ? 'bg-emerald-500' : i === stepIndex ? 'bg-emerald-400' : 'bg-white/10'
                }`}
                title={s.label}
              />
            ))}
          </div>
        )}

        {step === 'first_half' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">
              {joinsMidMatch ? 'Mark Where You Can Read the Clock' : 'Mark 1st-Half Throw-In'}
            </h3>
            <p className="text-xs text-white/60 mb-3">
              {joinsMidMatch
                ? 'Scrub to a moment where the match clock is visible, enter it below, then mark it. The app clock carries on from there.'
                : 'Scrub the video to the exact moment the ball is thrown in to start the match, then mark it.'}
            </p>
            <VideoTimeReadout ms={currentTimeMs} />
            {currentTimeMs < 1000 && (
              <p className="text-xs text-amber-400/80 mb-2 flex items-center gap-1.5">
                <span>👆</span> {joinsMidMatch ? 'Scrub to a moment with the clock visible first' : 'Scrub to the throw-in moment first'}
              </p>
            )}

            <button
              type="button"
              onClick={() => setJoinsMidMatch(v => !v)}
              className="w-full flex items-center justify-between text-left text-xs text-emerald-300/90 hover:text-emerald-200 mb-2 transition-colors"
            >
              <span>{joinsMidMatch ? 'Back to normal throw-in marking' : 'Footage starts after the throw-in?'}</span>
              <ChevronDown size={14} className={`transition-transform ${joinsMidMatch ? 'rotate-180' : ''}`} />
            </button>

            {joinsMidMatch && (
              <div className="mb-3 rounded-xl border border-white/10 bg-white/[0.04] p-3 space-y-2.5">
                <label className="block">
                  <span className="text-[11px] text-white/60">Match clock at this moment (mm:ss)</span>
                  <input
                    value={clockText}
                    onChange={e => setClockText(e.target.value)}
                    placeholder="e.g. 2:05"
                    inputMode="numeric"
                    className={`mt-1 w-full rounded-lg bg-black/30 border px-3 py-2 text-sm font-mono text-white placeholder:text-white/25 outline-none ${
                      clockText && clockMs == null ? 'border-red-400/60' : 'border-white/15 focus:border-emerald-400/60'
                    }`}
                  />
                </label>
                <div className="text-[11px] leading-relaxed text-white/55 space-y-1.5">
                  <p className="text-white/70 font-semibold">Which one is you?</p>
                  <p>
                    <span className="text-emerald-300">TV broadcast with a clock graphic:</span> scrub to any
                    moment the clock is on screen, type what it shows (e.g. 2:05), and mark. Nothing else needed.
                  </p>
                  <p>
                    <span className="text-emerald-300">No clock, but you know roughly how far in it is</span>{' '}
                    (commentary, a score change): enter your best estimate. Event minutes will be only as
                    accurate as that guess.
                  </p>
                  <p>
                    <span className="text-emerald-300">Footage starts at the throw-in or earlier</span>{' '}
                    (warm-up, team walk-out): you don't need this. Switch back and mark the throw-in as normal.
                  </p>
                  <p className="text-white/40">
                    Anything before this moment has no events, as it isn't in the video.
                  </p>
                </div>
              </div>
            )}

            <ActionRow
              primaryLabel={joinsMidMatch && clockMs != null ? `Mark Start (clock ${clockText.trim()})` : joinsMidMatch ? 'Enter the clock to mark' : 'Mark Throw-In'}
              onPrimary={() => onMarkFirstHalf(joinsMidMatch ? clockMs ?? 0 : 0)}
              isSaving={isSaving}
              disabled={currentTimeMs < 1000 || midMatchInvalid}
            />
          </>
        )}

        {step === 'half_time' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Mark Half-Time Whistle</h3>
            <p className="text-xs text-white/60 mb-3">
              Scrub to the referee's half-time whistle so each half is timed correctly.
            </p>
            <VideoTimeReadout ms={currentTimeMs} />
            {currentTimeMs < 1000 && (
              <p className="text-xs text-amber-400/80 mb-2 flex items-center gap-1.5">
                <span>👆</span> Scrub to the half-time whistle first
              </p>
            )}
            <ActionRow
              primaryLabel="Mark Half-Time"
              onPrimary={onMarkHalftime}
              onSkip={onSkipHalftime}
              isSaving={isSaving}
              disabled={currentTimeMs < 1000}
            />
          </>
        )}

        {step === 'second_half' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Mark 2nd-Half Throw-In</h3>
            <p className="text-xs text-white/60 mb-3">
              Scrub to the restart after half-time, then mark it.
            </p>
            <VideoTimeReadout ms={currentTimeMs} />
            {currentTimeMs < 1000 && (
              <p className="text-xs text-amber-400/80 mb-2 flex items-center gap-1.5">
                <span>👆</span> Scrub to the 2nd half throw-in first
              </p>
            )}
            <ActionRow
              primaryLabel="Mark 2nd-Half Start"
              onPrimary={onMarkSecondHalf}
              onSkip={onSkipSecondHalf}
              skipLabel="Skip (single half)"
              isSaving={isSaving}
              disabled={currentTimeMs < 1000}
            />
          </>
        )}

        {step === 'full_time' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Mark Full-Time Whistle</h3>
            <p className="text-xs text-white/60 mb-3">
              Scrub to the full-time whistle/hooter. This lets tracking end automatically when the match does.
            </p>
            <VideoTimeReadout ms={currentTimeMs} />
            {currentTimeMs < 1000 && (
              <p className="text-xs text-amber-400/80 mb-2 flex items-center gap-1.5">
                <span>👆</span> Scrub to the full-time whistle first
              </p>
            )}
            <ActionRow
              primaryLabel="Mark Full-Time"
              onPrimary={onMarkFullTime}
              onSkip={onSkipFullTime}
              skipLabel="Skip for now"
              isSaving={isSaving}
              disabled={currentTimeMs < 1000}
            />
          </>
        )}

        {step === 'direction' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Attack Direction</h3>
            <p className="text-xs text-white/60 mb-3">
              Which way is <span className="text-white font-medium">{homeTeamName}</span> attacking in the 1st half?
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onSetDirection(false)}
                disabled={isSaving}
                className="flex-1 flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all disabled:opacity-40"
              >
                <ArrowLeftRight size={16} className="rotate-180 text-emerald-400" />
                <span className="text-xs font-semibold">Right → Left</span>
              </button>
              <button
                onClick={() => onSetDirection(true)}
                disabled={isSaving}
                className="flex-1 flex flex-col items-center gap-1 px-3 py-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white transition-all disabled:opacity-40"
              >
                <ArrowLeftRight size={16} className="text-emerald-400" />
                <span className="text-xs font-semibold">Left → Right</span>
              </button>
            </div>
          </>
        )}

        {step === 'throw_in_winner' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Who Won the Throw-In?</h3>
            <p className="text-xs text-white/60 mb-3">
              Whoever wins it starts with possession — you can always correct this later from the possession label.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => onSelectThrowInWinner('team_a')}
                disabled={isSaving}
                className="flex-1 px-3 py-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-200 text-xs font-semibold transition-all disabled:opacity-40 truncate"
              >
                {homeTeamName}
              </button>
              <button
                onClick={() => onSelectThrowInWinner('team_b')}
                disabled={isSaving}
                className="flex-1 px-3 py-3 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 text-orange-200 text-xs font-semibold transition-all disabled:opacity-40 truncate"
              >
                {opponentName}
              </button>
            </div>
          </>
        )}

        {step === 'ready' && (
          <>
            <h3 className="text-sm font-bold text-white mb-1">Ready to Track</h3>
            <p className="text-xs text-white/60 mb-3">
              Start jumps to the throw-in and begins playing. Events, ball movement and possession time are
              recorded only while the video is playing — pause any time and nothing is counted until you press
              play again.
            </p>
            <p className="text-xs text-white/40 mb-3">
              Possession also pauses automatically during frees, kickouts and 45s while you pick the outcome.
            </p>
            <button
              onClick={onStartTracking}
              disabled={isSaving}
              className="w-full px-4 py-3 rounded-xl text-sm font-bold transition-all animate-pulse hover:animate-none disabled:opacity-40"
              style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
            >
              {isSaving ? 'Starting…' : 'Start Match Tracking'}
            </button>
          </>
        )}

        {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      </div>
    </div>
    </>
  )
}

function VideoTimeReadout({ ms }: { ms: number }) {
  return (
    <div className="text-center mb-3">
      <span className="text-lg font-mono text-emerald-400">{formatVideoTime(ms)}</span>
      <span className="text-xs text-white/30 ml-2">video time</span>
    </div>
  )
}

function ActionRow({
  primaryLabel,
  onPrimary,
  onSkip,
  skipLabel = 'Skip',
  isSaving,
  disabled = false,
}: {
  primaryLabel: string
  onPrimary: () => void
  onSkip?: () => void
  skipLabel?: string
  isSaving: boolean
  disabled?: boolean
}) {
  const isDisabled = isSaving || disabled
  return (
    <div className="flex gap-2">
      <button
        onClick={onPrimary}
        disabled={isDisabled}
        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: isDisabled ? 'rgba(255,255,255,0.1)' : 'var(--gradient-primary)',
          color: isDisabled ? 'rgba(255,255,255,0.3)' : '#0a1a10',
          border: '1px solid rgba(0,230,118,0.3)',
          boxShadow: isDisabled ? 'none' : '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
          animation: isDisabled ? 'none' : 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
        }}
      >
        {isSaving ? <Loader2 size={14} className="animate-spin mx-auto" /> : primaryLabel}
      </button>
      {onSkip && (
        <button
          onClick={onSkip}
          disabled={isSaving}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-white/10 text-white/60 hover:text-white text-sm transition-colors disabled:opacity-40"
        >
          <SkipForward size={12} />
          {skipLabel}
        </button>
      )}
    </div>
  )
}
