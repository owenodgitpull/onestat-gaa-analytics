/**
 * BlackCardTimer — Floating 10-minute countdown for GAA black card sin bin.
 *
 * Shows as a compact pill in the corner. Multiple timers can stack.
 * Each timer tracks a player name/number and counts down from 10:00.
 */

import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

export interface BlackCardEntry {
  id: string
  playerLabel: string  // e.g. "J. Murphy" or "#5"
  startedAt: number    // Date.now() when card was issued
}

interface BlackCardTimerProps {
  entries: BlackCardEntry[]
  onRemove: (id: string) => void
}

const SIN_BIN_MS = 10 * 60 * 1000 // 10 minutes

export default function BlackCardTimer({ entries, onRemove }: BlackCardTimerProps) {
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (entries.length === 0) return
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [entries.length])

  const formatRemaining = useCallback((entry: BlackCardEntry) => {
    const elapsed = now - entry.startedAt
    const remaining = Math.max(0, SIN_BIN_MS - elapsed)
    const mins = Math.floor(remaining / 60000)
    const secs = Math.floor((remaining % 60000) / 1000)
    return { text: `${mins}:${String(secs).padStart(2, '0')}`, expired: remaining <= 0 }
  }, [now])

  if (entries.length === 0) return null

  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry) => {
        const { text, expired } = formatRemaining(entry)
        return (
          <div
            key={entry.id}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border backdrop-blur-xl text-xs font-semibold transition-all ${
              expired
                ? 'bg-emerald-500/20 border-emerald-400/30 text-emerald-300'
                : 'bg-slate-900/80 border-white/15 text-white/90'
            }`}
          >
            {/* Black card icon */}
            <div className="w-3.5 h-4.5 rounded-sm bg-slate-800 border border-white/30 flex-shrink-0" />
            <span className="truncate max-w-[80px]">{entry.playerLabel}</span>
            <span className={`font-mono tabular-nums ${expired ? 'text-emerald-400' : 'text-amber-300'}`}>
              {expired ? 'BACK' : text}
            </span>
            <button
              onClick={() => onRemove(entry.id)}
              className="p-0.5 rounded hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
            >
              <X size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
