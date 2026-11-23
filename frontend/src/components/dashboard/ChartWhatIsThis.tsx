import { useState } from 'react'
import { HelpCircle } from 'lucide-react'

/** "What is this?" inside the bottom-left corner of a season chart card: one tap shows a sentence in place (no modal),
 *  tap again to hide it. Sits on a solid chip so it reads over any chart. */
export default function ChartWhatIsThis({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="absolute bottom-2 left-2 right-14 z-10 flex flex-col items-start gap-1.5 pointer-events-none">
      {open && (
        <p role="note" className="pointer-events-auto w-full rounded-lg bg-slate-900/95 border border-white/15 px-3 py-2 text-xs text-white/80 leading-relaxed shadow-lg">{text}</p>
      )}
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="pointer-events-auto inline-flex items-center gap-1.5 min-h-[32px] px-2.5 rounded-lg bg-slate-900/90 border border-white/10 text-xs text-white/70 hover:text-white hover:bg-slate-800">
        <HelpCircle size={13} aria-hidden="true" /> {open ? 'Hide' : 'What is this?'}
      </button>
    </div>
  )
}
