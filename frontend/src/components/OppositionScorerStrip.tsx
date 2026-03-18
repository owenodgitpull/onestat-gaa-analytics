/**
 * OppositionScorerStrip — Inline strip shown after opponent scores.
 *
 * Shows opposition roster names as tappable pills with a prominent Skip button.
 * Auto-dismisses after selection or skip.
 */

import { SkipForward } from 'lucide-react'

interface OppositionScorerStripProps {
  players: string[]
  onSelect: (name: string) => void
  onSkip: () => void
  eventType: string
}

function surname(name: string) {
  const parts = name.trim().split(' ')
  return parts.length > 1 ? parts[parts.length - 1] : name
}

export default function OppositionScorerStrip({ players, onSelect, onSkip, eventType }: OppositionScorerStripProps) {
  const label = eventType === 'goal' ? 'Who scored the goal?' : 'Who scored?'

  return (
    <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl px-3 py-2 animate-fade-in">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-orange-300">{label}</span>
        <button
          onClick={onSkip}
          className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-white/60 hover:text-white text-xs font-medium transition-all"
        >
          <SkipForward size={12} />
          Skip
        </button>
      </div>
      <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
        {players.map((name) => (
          <button
            key={name}
            onClick={() => onSelect(name)}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-orange-500/20 border border-orange-400/30 text-orange-200 text-xs font-semibold hover:bg-orange-500/35 hover:border-orange-400/50 transition-all active:scale-95"
          >
            {surname(name)}
          </button>
        ))}
      </div>
    </div>
  )
}
