/**
 * FormationSnapshotButton — camera icon that pulses at key moments
 * (after scores, before kickouts, during stoppages) to suggest
 * taking a formation snapshot.
 */

import { Camera } from 'lucide-react'

interface FormationSnapshotButtonProps {
  onClick: () => void
  shouldPulse?: boolean
  disabled?: boolean
  snapshotCount?: number
}

export default function FormationSnapshotButton({
  onClick,
  shouldPulse = false,
  disabled = false,
  snapshotCount = 0,
}: FormationSnapshotButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`
        relative p-2.5 rounded-xl border-2 transition-all
        ${disabled
          ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10'
          : shouldPulse
            ? 'bg-purple-500/20 border-purple-400/50 text-purple-300 hover:bg-purple-500/30 animate-pulse'
            : 'bg-white/10 border-white/20 text-white/70 hover:bg-white/20 hover:text-white'
        }
      `}
      title="Take formation snapshot"
    >
      <Camera size={18} />
      {snapshotCount > 0 && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-purple-500 text-white text-[10px] font-bold flex items-center justify-center">
          {snapshotCount}
        </span>
      )}
    </button>
  )
}
