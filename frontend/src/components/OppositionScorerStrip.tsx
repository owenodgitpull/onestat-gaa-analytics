/**
 * OppositionScorerStrip — centered overlay shown after the opponent scores.
 *
 * Blocks the recording flow until resolved (the event isn't written to the DB
 * until select/skip fires), so it uses the same centered, unmissable overlay
 * treatment as the kickout/free-kick modals — not an easy-to-miss inline strip.
 */

import { AlertTriangle, SkipForward } from 'lucide-react'

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
    <>
      <style>{`
        @keyframes _ossi { from{opacity:0} to{opacity:1} }
        @keyframes _ossc { from{opacity:0;transform:scale(.9) translateY(14px)} to{opacity:1;transform:scale(1) translateY(0)} }
      `}</style>

      <div
        className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl overflow-hidden"
        style={{ animation: '_ossi .15s ease-out both' }}
      >
        <div
          className="absolute inset-0"
          style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(5px)', WebkitBackdropFilter: 'blur(5px)' }}
        />

        <div
          className="relative z-10 w-full mx-4 rounded-2xl overflow-hidden"
          style={{
            maxWidth: 340,
            background: 'linear-gradient(145deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.05) 55%, rgba(255,255,255,0.09) 100%)',
            border: '1px solid rgba(255,255,255,0.22)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.20)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            animation: '_ossc .22s cubic-bezier(.34,1.56,.64,1) both',
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between border-b border-orange-500/20"
            style={{ background: 'linear-gradient(90deg, rgba(249,115,22,0.22), rgba(234,88,12,0.10))' }}
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle size={14} className="text-orange-400" />
              <span className="text-sm font-bold text-orange-300">{label}</span>
            </div>
            <button
              onClick={onSkip}
              className="flex items-center gap-1 text-[11px] text-white/40 hover:text-white/70 px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 transition-colors"
            >
              <SkipForward size={11} />
              Skip
            </button>
          </div>

          <div className="p-3 grid grid-cols-2 gap-2 max-h-[50vh] overflow-y-auto">
            {players.map((name) => (
              <button
                key={name}
                onClick={() => onSelect(name)}
                className="py-3.5 rounded-xl border-2 font-semibold text-sm bg-orange-500/20 border-orange-400/40 text-orange-200 hover:bg-orange-500/30 hover:border-orange-400/60 active:scale-[0.96] transition-all"
              >
                {surname(name)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
