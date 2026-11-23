import { useState } from 'react'
import { HelpCircle } from 'lucide-react'

/** A small "What is this?" under a season chart: one tap shows a sentence in place (no modal), tap again to hide it. */
export default function ChartWhatIsThis({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5 px-1">
      <button type="button" onClick={() => setOpen(v => !v)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 min-h-[32px] px-2 -ml-2 rounded-lg text-xs text-white/50 hover:text-white/80 hover:bg-white/5">
        <HelpCircle size={13} aria-hidden="true" /> {open ? 'Hide' : 'What is this?'}
      </button>
      {open && <p className="mt-1 text-xs text-white/65 leading-relaxed" role="note">{text}</p>}
    </div>
  )
}
