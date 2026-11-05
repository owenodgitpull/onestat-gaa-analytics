/**
 * Reminder shown when the match clock has been stopped for a while (the video is paused while it is open).
 * The tagger either resumes the clock, cancels the stop (it was pressed by mistake) or keeps it stopped.
 */
import { Timer } from 'lucide-react'

/** Choices for how long a stopped clock waits before it asks. */
export const CLOCK_REMIND_OPTIONS_S = [10, 20, 30, 60, 120]
const optionLabel = (s: number) => (s >= 60 ? `${s / 60} min` : `${s} sec`)

interface Props {
  open: boolean
  stoppedForSeconds: number
  onResume: () => void
  onCancelStop: () => void
  onKeepStopped: () => void
  remindSeconds: number
  remindOptions: number[]
  onChangeRemind: (s: number) => void
}

export default function ClockStoppedModal({ open, stoppedForSeconds, onResume, onCancelStop, onKeepStopped, remindSeconds, remindOptions, onChangeRemind }: Props) {
  if (!open) return null
  const mins = Math.floor(stoppedForSeconds / 60)
  const secs = Math.round(stoppedForSeconds % 60)
  const length = mins > 0 ? `${mins}m ${String(secs).padStart(2, '0')}s` : `${secs}s`
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md glass-card p-5">
        <div className="flex items-start gap-3">
          <Timer className="text-amber-400 flex-shrink-0 mt-0.5" size={22} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">The match clock is stopped</h2>
            <p className="mt-1 text-sm text-white/70">
              It has been stopped for {length} of video time. Do you want to start it again?
            </p>
            <p className="mt-2 text-xs text-white/45">
              Time while the clock is stopped doesn't count towards the match minutes. If you stopped it by mistake, cancel the stop
              and nothing is lost.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2">
          <button onClick={onResume} className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
            Start the clock now
          </button>
          <button onClick={onCancelStop} className="w-full px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white/85 text-sm font-semibold">
            I stopped it by mistake - cancel the stop
          </button>
          <button onClick={onKeepStopped} className="w-full px-4 py-2 rounded-xl bg-transparent hover:bg-white/5 text-white/55 text-xs font-medium">
            Keep it stopped (ask again in {optionLabel(remindSeconds)} of video)
          </button>
        </div>
        <div className="mt-4 pt-3 border-t border-white/10">
          <div className="text-xs text-white/50 mb-2">Ask me when the clock has been stopped for:</div>
          <div className="flex flex-wrap gap-1.5">
            {remindOptions.map(s => (
              <button
                key={s}
                onClick={() => onChangeRemind(s)}
                aria-pressed={s === remindSeconds}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${s === remindSeconds ? 'bg-amber-500 text-black' : 'bg-white/10 text-white/75 hover:bg-white/15'}`}
              >
                {optionLabel(s)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
