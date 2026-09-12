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

import { Loader2, SkipForward, ArrowLeftRight } from 'lucide-react'

export type SetupStep = 'first_half' | 'half_time' | 'second_half' | 'full_time' | 'direction' | 'throw_in_winner' | 'ready'

interface SetupFlowModalProps {
  step: SetupStep
  currentTimeMs: number
  homeTeamName: string
  opponentName: string
  isSaving: boolean
  error?: string | null
  onMarkFirstHalf: () => void
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

  return (
    <div className="absolute top-3 left-3 z-30 pointer-events-none">
      <div className="pointer-events-auto bg-slate-900/95 backdrop-blur-xl border border-emerald-500/30 rounded-2xl px-5 py-4 w-[360px] shadow-2xl shadow-emerald-500/10">
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
            <h3 className="text-sm font-bold text-white mb-1">Mark 1st-Half Throw-In</h3>
            <p className="text-xs text-white/60 mb-3">
              Scrub the video to the exact moment the ball is thrown in to start the match, then mark it.
            </p>
            <VideoTimeReadout ms={currentTimeMs} />
            <ActionRow
              primaryLabel="Mark Throw-In"
              onPrimary={onMarkFirstHalf}
              isSaving={isSaving}
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
            <ActionRow
              primaryLabel="Mark Half-Time"
              onPrimary={onMarkHalftime}
              onSkip={onSkipHalftime}
              isSaving={isSaving}
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
            <ActionRow
              primaryLabel="Mark 2nd-Half Start"
              onPrimary={onMarkSecondHalf}
              onSkip={onSkipSecondHalf}
              skipLabel="Skip (single half)"
              isSaving={isSaving}
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
            <ActionRow
              primaryLabel="Mark Full-Time"
              onPrimary={onMarkFullTime}
              onSkip={onSkipFullTime}
              skipLabel="Skip for now"
              isSaving={isSaving}
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
              Setup's done. Starting will jump to the throw-in — from there, play only controls the video; tracking
              (ball movement, possession, events) only records while you're actually playing.
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
}: {
  primaryLabel: string
  onPrimary: () => void
  onSkip?: () => void
  skipLabel?: string
  isSaving: boolean
}) {
  return (
    <div className="flex gap-2">
      <button
        onClick={onPrimary}
        disabled={isSaving}
        className="flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all animate-pulse hover:animate-none disabled:opacity-40"
        style={{ background: 'var(--gradient-primary)', color: '#0a1a10', border: '1px solid rgba(0,230,118,0.3)', boxShadow: '0 4px 15px -3px rgba(0,230,118,0.3), inset 0 1px 0 rgba(255,255,255,0.1)' }}
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
