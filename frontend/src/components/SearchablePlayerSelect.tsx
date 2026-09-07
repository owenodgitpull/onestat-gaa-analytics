import { useState, useRef, useEffect, useMemo } from 'react'

interface SearchablePlayerOption {
  id: string
  name: string
  jerseyNumber?: number | null
}

interface SearchablePlayerSelectProps {
  players: SearchablePlayerOption[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Combobox-style player picker — type to filter by name or jersey number, click/tap to select. */
export default function SearchablePlayerSelect({
  players,
  value,
  onChange,
  placeholder = 'Select player...',
  disabled = false,
}: SearchablePlayerSelectProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const selected = players.find(p => p.id === value) || null

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return players
    return players.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.jerseyNumber != null && String(p.jerseyNumber).includes(q))
    )
  }, [players, query])

  const selectedLabel = selected ? `${selected.jerseyNumber != null ? `#${selected.jerseyNumber} ` : ''}${selected.name}` : ''
  const displayValue = open ? query : selectedLabel

  return (
    <div className="relative" ref={containerRef}>
      <input
        type="text"
        disabled={disabled}
        value={displayValue}
        onFocus={() => { setOpen(true); setQuery('') }}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={selectedLabel && !open ? undefined : placeholder}
        className="w-full bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
      />
      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto rounded-xl border border-white/20 bg-slate-800 shadow-xl">
          {filtered.length === 0 ? (
            <div className="px-4 py-3 text-white/40 text-sm">No players found</div>
          ) : (
            filtered.map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => { onChange(p.id); setOpen(false); setQuery('') }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 transition-colors ${
                  p.id === value ? 'bg-emerald-600/20 text-emerald-300' : 'text-white'
                }`}
              >
                {p.jerseyNumber != null ? `#${p.jerseyNumber} ` : ''}{p.name}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
