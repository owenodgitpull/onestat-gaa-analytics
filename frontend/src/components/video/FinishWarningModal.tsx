/**
 * Shown when "Finish" is pressed while tagging looks unfinished (tracking stopped before full time, or items still
 * need attention). It never blocks: "Finish anyway" goes on to the normal finish step.
 */
import { AlertTriangle } from 'lucide-react'

interface Props {
  open: boolean
  lines: string[]
  issueCount: number
  onKeepTagging: () => void
  onReviewIssues: () => void
  onFinishAnyway: () => void
}

export default function FinishWarningModal({ open, lines, issueCount, onKeepTagging, onReviewIssues, onFinishAnyway }: Props) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onKeepTagging}>
      <div className="w-full max-w-md glass-card p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <AlertTriangle className="text-amber-400 flex-shrink-0 mt-0.5" size={22} />
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white">This match doesn't look finished</h2>
            <ul className="mt-2 space-y-1.5 text-sm text-white/70 list-disc pl-4">
              {lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
            <p className="mt-3 text-xs text-white/45">
              Finishing adds the match to your season stats and generates the report from the data tagged so far.
            </p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          {issueCount > 0 && (
            <button onClick={onReviewIssues} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/80 text-sm font-semibold">
              Review items
            </button>
          )}
          <button onClick={onFinishAnyway} className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-white/70 text-sm font-semibold">
            Finish anyway
          </button>
          <button onClick={onKeepTagging} className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold">
            Keep tagging
          </button>
        </div>
      </div>
    </div>
  )
}
