import { useState } from 'react'
import { Bell, Loader2 } from 'lucide-react'
import { usePushNotifications } from '../hooks/usePushNotifications'
import { useAuth } from '../contexts/AuthContext'

/**
 * Shown across every /player/* page until the player actually enables push
 * notifications — deliberately NOT dismissible (no X, no "later"). The
 * softer, dismiss-and-forget version of this ask already lives on
 * PlayerDashboard; this one exists because that wasn't getting anyone to
 * actually opt in. It goes away the moment — and only the moment — they
 * successfully subscribe.
 */
export default function EnableNotificationsBanner() {
  const { isSupported, isSubscribed, isLoading, subscribe } = usePushNotifications()
  const { previewPlayer } = useAuth()
  const [failed, setFailed] = useState(false)

  // An admin previewing a player's portal isn't that player — subscribing
  // here would register the admin's own account, which the match/GPS
  // notifiers wouldn't even push to (they only target role='player' users).
  // Nagging an admin to opt in to something that can't work for them isn't
  // useful, so this only shows for someone actually in their own portal.
  if (!isSupported || isSubscribed || previewPlayer) return null

  // Notification.requestPermission() silently no-ops once a player has
  // actually blocked it at the browser/OS level — no in-app prompt can
  // re-ask. Say so plainly rather than showing an "Enable" button that
  // quietly does nothing when tapped.
  const blocked = typeof Notification !== 'undefined' && Notification.permission === 'denied'

  const handleEnable = async () => {
    setFailed(false)
    const success = await subscribe()
    if (!success) setFailed(true)
  }

  return (
    <div
      className="sticky top-0 z-40 px-4 py-2.5 text-sm font-semibold shadow-lg"
      style={{
        background: 'linear-gradient(135deg, #00E676, #00B0FF)',
        color: '#0a1a10',
      }}
    >
      <div className="flex items-center justify-between gap-3 max-w-lg mx-auto">
        <span className="flex items-center gap-2 min-w-0">
          <Bell size={16} className="flex-shrink-0" />
          <span className="truncate">
            {blocked
              ? 'Notifications are blocked — enable them for OneStat in your device settings.'
              : 'Get pinged the moment your match report, GPS data, or fitness results are ready.'}
          </span>
        </span>
        {!blocked && (
          <button
            onClick={handleEnable}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900/15 hover:bg-slate-900/25 transition-colors flex-shrink-0 disabled:opacity-60"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : null}
            {isLoading ? 'Enabling…' : 'Enable Notifications'}
          </button>
        )}
      </div>
      {failed && !isLoading && (
        <p className="max-w-lg mx-auto mt-1 text-xs font-normal opacity-80">
          Didn't go through — tap Enable and choose "Allow" when your browser asks.
        </p>
      )}
    </div>
  )
}
