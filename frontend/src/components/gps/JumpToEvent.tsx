import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'

/** A searchable "jump to" list: type to filter (by minute, event or player), arrow keys and Enter to pick, Escape to close. */
export default function JumpToEvent({ items, onPick, placeholder }: { items: { key: string; label: string }[]; onPick: (index: number) => void; placeholder: string }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return items.map((it, index) => ({ ...it, index })).filter(it => words.every(w => it.label.toLowerCase().includes(w)))
  }, [items, q])

  useEffect(() => { setActive(0) }, [q, open])
  useEffect(() => {
    const away = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const choose = (index: number) => { onPick(index); setOpen(false); setQ('') }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive(a => Math.min(a + 1, shown.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && open && shown[active]) { e.preventDefault(); choose(shown[active].index) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div ref={root} className="relative min-w-0 flex-1">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none" aria-hidden="true" />
      <input value={q} onChange={e => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} onKeyDown={onKey}
        placeholder={placeholder} role="combobox" aria-expanded={open} aria-controls="jump-list" aria-autocomplete="list" aria-label={placeholder}
        className="w-full bg-white/10 border border-white/15 rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/50" />
      {open && (
        <ul id="jump-list" role="listbox" className="absolute z-30 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-white/15 bg-slate-900 shadow-xl">
          {shown.length === 0 ? <li className="px-3 py-2 text-sm text-white/50">Nothing matches "{q}"</li> : shown.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === active}
              onMouseDown={e => { e.preventDefault(); choose(it.index) }} onMouseEnter={() => setActive(i)}
              className={`px-3 py-2 text-sm cursor-pointer ${i === active ? 'bg-emerald-500/20 text-white' : 'text-white/80'}`}>
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
