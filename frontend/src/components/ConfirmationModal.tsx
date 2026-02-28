import { AlertTriangle, Info, AlertCircle } from 'lucide-react'

interface ConfirmationModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm?: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info'
}

export default function ConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning'
}: ConfirmationModalProps) {
  if (!isOpen) return null

  const variantColors = {
    danger: 'text-red-400',
    warning: 'text-amber-400',
    info: 'text-blue-400'
  }

  const variantBgColors = {
    danger: 'bg-red-500/10',
    warning: 'bg-amber-500/10',
    info: 'bg-blue-500/10'
  }

  const variantButtonColors = {
    danger: 'bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800',
    warning: 'bg-gradient-to-r from-amber-600 to-amber-700 hover:from-amber-700 hover:to-amber-800',
    info: 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800'
  }

  const IconComponent = variant === 'info' ? Info : variant === 'danger' ? AlertCircle : AlertTriangle

  // Alert-only mode: no onConfirm → just a dismiss button
  const alertOnly = !onConfirm

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md glass-card p-8">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className={`p-4 rounded-full ${variantBgColors[variant]} ${variantColors[variant]}`}>
            <IconComponent size={48} />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-2xl font-bold text-white text-center mb-3">
          {title}
        </h2>

        {/* Message */}
        <p className="text-white/70 text-center mb-8 leading-relaxed">
          {message}
        </p>

        {/* Action Buttons */}
        {alertOnly ? (
          <button
            onClick={onClose}
            className={`w-full text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 ${variantButtonColors[variant]}`}
          >
            OK
          </button>
        ) : (
          <div className="flex space-x-4">
            <button
              onClick={onClose}
              className="flex-1 btn-glass"
            >
              {cancelText}
            </button>
            <button
              onClick={() => {
                onConfirm()
                onClose()
              }}
              className={`flex-1 text-white px-6 py-3 rounded-xl font-semibold transition-all duration-300 shadow-lg hover:shadow-xl active:scale-95 ${variantButtonColors[variant]}`}
            >
              {confirmText}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
