import { Smartphone } from 'lucide-react'

interface SimpleScoringConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
}

/**
 * Confirmation shown before switching a match to Simple Scoring — the
 * phone-first, tap-only recording mode for coaches without a tablet. Styled
 * to match the app's other glass-card confirm modals (see ConfirmationModal).
 */
export default function SimpleScoringConfirmModal({
  isOpen,
  onClose,
  onConfirm,
}: SimpleScoringConfirmModalProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-md glass-card p-8">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="p-4 rounded-full bg-blue-500/10 text-blue-400">
            <Smartphone size={48} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white text-center mb-3">
          Simple Scoring
        </h2>

        {/* Body */}
        <p className="text-white/70 text-center mb-4 leading-relaxed">
          You'll still log scores, wides, turnovers, frees, cards and kickouts as normal — tap the
          pitch to mark where each one happened, so shot maps, kickout charts and season stats all
          still work.
        </p>

        {/* What's missing */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 mb-4">
          <p className="text-white/80 text-sm font-semibold mb-2">This match won't have:</p>
          <ul className="space-y-1.5 text-white/60 text-sm list-disc list-inside">
            <li>Territorial possession on the season chart</li>
            <li>Ball-carrying, passing patterns and attacking-play breakdowns in the AI match report</li>
          </ul>
        </div>

        <p className="text-white/70 text-center mb-8 leading-relaxed">
          Everything else works exactly as normal.
        </p>

        {/* Action Buttons */}
        <div className="flex space-x-4">
          <button onClick={onClose} className="flex-1 btn-glass">
            Go Back
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="flex-1 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
          >
            Use Simple Scoring
          </button>
        </div>
      </div>
    </div>
  )
}
