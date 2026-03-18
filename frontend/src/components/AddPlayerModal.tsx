import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, UserPlus } from 'lucide-react'

interface AddPlayerModalProps {
  isOpen: boolean
  onClose: () => void
  onAdd: (data: { name: string; position: string; date_of_birth: string | null }) => Promise<void>
}

const POSITIONS = [
  { value: 'goalkeeper', label: 'Goalkeeper' },
  { value: 'defender', label: 'Defender' },
  { value: 'midfielder', label: 'Midfielder' },
  { value: 'forward', label: 'Forward' },
]

export default function AddPlayerModal({ isOpen, onClose, onAdd }: AddPlayerModalProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState('forward')
  const [dob, setDob] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!firstName.trim() || !lastName.trim()) {
      setError('First and last name are required')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onAdd({
        name: `${firstName.trim()} ${lastName.trim()}`,
        position,
        date_of_birth: dob || null,
      })
      // Reset
      setFirstName('')
      setLastName('')
      setPosition('forward')
      setDob('')
      onClose()
    } catch (err: any) {
      setError(err.message || 'Failed to add player')
    } finally {
      setSaving(false)
    }
  }

  const handleClose = () => {
    setFirstName('')
    setLastName('')
    setPosition('forward')
    setDob('')
    setError(null)
    onClose()
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/90 backdrop-blur-md" onClick={handleClose} />

      <div className="relative w-full max-w-md bg-slate-900/95 backdrop-blur-xl border border-white/20 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-emerald-600/20 to-cyan-600/20">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-emerald-600/30">
              <UserPlus size={24} className="text-emerald-300" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Add Player</h2>
              <p className="text-sm text-white/60">Add to your squad</p>
            </div>
          </div>
          <button onClick={handleClose} className="p-2 rounded-lg hover:bg-white/10 transition-colors">
            <X size={24} className="text-white/60" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="add-first" className="block text-sm font-medium text-white mb-2">
                First Name <span className="text-red-400">*</span>
              </label>
              <input
                id="add-first"
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="e.g. Patrick"
                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all"
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="add-last" className="block text-sm font-medium text-white mb-2">
                Last Name <span className="text-red-400">*</span>
              </label>
              <input
                id="add-last"
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="e.g. McBrearty"
                className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all"
              />
            </div>
          </div>

          {/* Position */}
          <div>
            <label className="block text-sm font-medium text-white mb-3">Position</label>
            <div className="grid grid-cols-4 gap-2">
              {POSITIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setPosition(value)}
                  className={`py-2.5 rounded-xl border-2 transition-all text-xs font-semibold ${
                    position === value
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                      : 'border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 text-white/60'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Date of Birth */}
          <div>
            <label htmlFor="add-dob" className="block text-sm font-medium text-white mb-2">
              Date of Birth <span className="text-white/40 text-xs font-normal">(optional)</span>
            </label>
            <input
              id="add-dob"
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
              className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-transparent transition-all [color-scheme:dark]"
            />
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          {/* Actions */}
          <div className="flex space-x-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-6 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white font-medium transition-all border border-white/10"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-6 py-3 rounded-xl font-semibold transition-all shadow-lg disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, rgb(16,185,129), rgb(6,182,212))',
                color: '#fff',
                boxShadow: '0 4px 15px -3px rgba(16,185,129,0.3)',
              }}
            >
              {saving ? 'Adding...' : 'Add Player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
