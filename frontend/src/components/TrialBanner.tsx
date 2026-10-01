// TEMPORARILY DISABLED FOR DEMO (2026-10-01)
// No trial/upgrade banners during demo
export default function TrialBanner() {
  return null
}

/* Original implementation (restore after demo):
import { useState } from 'react'
import { X, Zap } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'

const DISMISS_KEY = 'trial_banner_dismissed_at'

function wasDismissedToday(): boolean {
  try {
    const v = sessionStorage.getItem(DISMISS_KEY)
    return !!v
  } catch { return false }
}

function dismiss() {
  try { sessionStorage.setItem(DISMISS_KEY, '1') } catch {}
}

export default function TrialBanner() {
  const { user } = useAuth()
  const [dismissed, setDismissed] = useState(wasDismissedToday)

  if (!user) return null
  if (user.role === 'player') return null
  if (user.on_paid_plan) return null
  if (!user.trial_ends_at) return null
  if (user.trial_expired) return null
  const days = user.trial_days_remaining ?? 30
  if (days > 22) return null
  if (days > 14 && dismissed) return null

  const urgency =
    days <= 2 ? 'red' :
    days <= 6 ? 'orange' :
    days <= 14 ? 'amber' :
    'blue'

  const message =
    days === 0 ? 'Your free trial ends today.' :
    days === 1 ? '1 day left on your free trial.' :
    `${days} days left on your free trial.`

  const canDismiss = days > 14

  const colours = {
    blue:   { bar: 'bg-blue-500/10 border-blue-500/20', text: 'text-blue-300', btn: 'bg-blue-500 hover:bg-blue-400', icon: 'text-blue-400' },
    amber:  { bar: 'bg-amber-500/10 border-amber-500/20', text: 'text-amber-300', btn: 'bg-amber-500 hover:bg-amber-400 text-black', icon: 'text-amber-400' },
    orange: { bar: 'bg-orange-500/10 border-orange-500/20', text: 'text-orange-300', btn: 'bg-orange-500 hover:bg-orange-400 text-black', icon: 'text-orange-400' },
    red:    { bar: 'bg-red-500/10 border-red-500/20', text: 'text-red-300', btn: 'bg-red-500 hover:bg-red-400', icon: 'text-red-400' },
  }[urgency]

  const handleDismiss = () => {
    dismiss()
    setDismissed(true)
  }

  return (
    <div className={`border-b ${colours.bar} px-4 py-2`}>
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Zap size={14} className={`flex-shrink-0 ${colours.icon}`} />
          <span className={`text-sm font-medium ${colours.text}`}>{message}</span>
          <span className="text-white/40 text-xs hidden sm:inline">
            Upgrade to keep your match data, GPS analysis, and AI reports.
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <a
            href="mailto:owen@onestat.ai?subject=onestat.ai subscription"
            className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors ${colours.btn}`}
          >
            Upgrade
          </a>
          {canDismiss && (
            <button
              onClick={handleDismiss}
              className="text-white/30 hover:text-white/60 transition-colors p-0.5"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
*/
