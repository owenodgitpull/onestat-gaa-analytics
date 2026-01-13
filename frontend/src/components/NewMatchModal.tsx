import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Home, Bus, Globe, Football } from 'lucide-react'

interface NewMatchModalProps {
  isOpen: boolean
  onClose: () => void
  onCreate: (data: { opponent: string; venue: 'home' | 'away' | 'neutral' }) => void
}

export default function NewMatchModal({ isOpen, onClose, onCreate }: NewMatchModalProps) {
  const [opponent, setOpponent] = useState('')
  const [venue, setVenue] = useState<'home' | 'away' | 'neutral'>('home')
  const [errors, setErrors] = useState<{ opponent?: string }>({})

  if (!isOpen) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validation
    const newErrors: { opponent?: string } = {}
    if (!opponent.trim()) {
      newErrors.opponent = 'Opponent name is required'
    }
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }
    
    // Create match
    onCreate({ opponent: opponent.trim(), venue })
    
    // Reset form
    setOpponent('')
    setVenue('home')
    setErrors({})
  }

  const handleClose = () => {
    setOpponent('')
    setVenue('home')
    setErrors({})
    onClose()
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/90 backdrop-blur-md"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-indigo-600/20 to-purple-600/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-indigo-600/30">
              <Football size={24} className="text-indigo-300" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">New Match</h2>
              <p className="text-sm text-white/60">Configure match details to begin tracking</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={24} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Opponent Name */}
          <div>
            <label htmlFor="opponent" className="block text-sm font-medium text-white mb-2">
              Opponent Team <span className="text-red-400">*</span>
            </label>
            <input
              id="opponent"
              type="text"
              value={opponent}
              onChange={(e) => setOpponent(e.target.value)}
              placeholder="Enter opponent name (e.g., Glenties)"
              className={`w-full px-4 py-3 rounded-lg bg-white/5 border ${
                errors.opponent ? 'border-red-500/50' : 'border-white/10'
              } text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-transparent transition-all`}
              autoFocus
            />
            {errors.opponent && (
              <p className="mt-1 text-sm text-red-400">{errors.opponent}</p>
            )}
          </div>

          {/* Venue Selection */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">
              Match Venue
            </label>
            <div className="grid grid-cols-3 gap-3">
              <button
                type="button"
                onClick={() => setVenue('home')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'home'
                    ? 'border-indigo-500 bg-indigo-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Home size={24} className={`mx-auto mb-2 ${venue === 'home' ? 'text-indigo-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Home</div>
              </button>
              
              <button
                type="button"
                onClick={() => setVenue('away')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'away'
                    ? 'border-indigo-500 bg-indigo-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Bus size={24} className={`mx-auto mb-2 ${venue === 'away' ? 'text-indigo-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Away</div>
              </button>
              
              <button
                type="button"
                onClick={() => setVenue('neutral')}
                className={`p-4 rounded-xl border-2 transition-all ${
                  venue === 'neutral'
                    ? 'border-indigo-500 bg-indigo-500/20 scale-105'
                    : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20'
                }`}
              >
                <Globe size={24} className={`mx-auto mb-2 ${venue === 'neutral' ? 'text-indigo-400' : 'text-white/60'}`} />
                <div className="text-sm font-medium text-white">Neutral</div>
              </button>
            </div>
          </div>

          {/* Actions */}
          <div className="flex space-x-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="flex-1 px-6 py-3 rounded-xl bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-700 hover:to-cyan-700 text-white font-medium transition-all shadow-lg hover:shadow-xl"
            >
              Create Match
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

