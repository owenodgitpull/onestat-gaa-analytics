/**
 * "What type of foul?" as a sideline chip for an OPPOSITION foul (our own fouls get the full prompt). Non-blocking: the
 * foul is already logged, so ignoring it just leaves the type blank. Includes the offensive fouls (overcarrying, picked
 * off the ground) since an opposition player can concede a free that way too.
 */
import { X } from 'lucide-react'
import { FOUL_SUBTYPES, OFFENSIVE_FOUL_SUBTYPES } from '../constants/turnoverSubtypes'

interface Props {
  teamName: string
  when?: string
  onSelect: (subType: string) => void
  onDismiss: () => void
}

export default function FoulTypeChip({ teamName, when, onSelect, onDismiss }: Props) {
  const options = [...OFFENSIVE_FOUL_SUBTYPES, ...FOUL_SUBTYPES]
  return (
    <div
      className="absolute bottom-2 left-2 right-52 z-30 rounded-xl px-2.5 py-2 animate-fade-in"
      style={{ background: 'rgba(15,23,42,0.92)', border: '1px solid rgba(251,191,36,0.6)', backdropFilter: 'blur(10px)' }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-xs font-bold text-white">
          What type of foul? <span className="text-white/50 font-medium">· {teamName}{when ? ` · ${when}` : ''}</span>
        </span>
        <button onClick={onDismiss} className="ml-auto text-white/40 hover:text-white p-0.5" aria-label="Skip">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1">
        {options.map(o => (
          <button
            key={o.value}
            onClick={() => onSelect(o.value)}
            className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white bg-white/10 hover:bg-amber-500/30 active:scale-95 transition"
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
