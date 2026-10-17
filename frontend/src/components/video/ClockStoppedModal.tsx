/**
 * Reminder shown when the match clock has been stopped for a while (the video is paused while it is open).
 * The tagger either resumes the clock, cancels the stop (it was pressed by mistake) or keeps it stopped.
 */
import { Timer } from 'lucide-react'

interface Props {
  open: boolean
  stoppedForSeconds: number
  onResume: () => void
  onCancelStop: () => void
  onKeepStopped: () => void
}

export default function ClockStoppedModal({ open, stoppedForSeconds, onResume, onCancelStop, onKeepStopped }: Props) {
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
            Keep it stopped (ask again in 20 seconds of video)
          </button>
        </div>
      </div>
    </div>
  )
}
