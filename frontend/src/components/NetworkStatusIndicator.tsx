/**
 * NetworkStatusIndicator — Minimal connection status for match recording.
 *
 * Two visible states:
 *  🟢  Online — all good (default, unobtrusive)
 *  🔴  Offline — events saving locally, will sync when back
 *
 * Sync queue is handled silently — users don't need to see it.
 */

import { useState, useEffect, useRef } from 'react'
import { Wifi, CloudOff } from 'lucide-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'

interface NetworkStatusIndicatorProps {
  /** Compact mode — just a dot, no text */
  compact?: boolean
}

export default function NetworkStatusIndicator({ compact = false }: NetworkStatusIndicatorProps) {
  const { isOnline } = useNetworkStatus()
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Show banner briefly when going offline
  const prevOnline = useRef(isOnline)
  useEffect(() => {
    if (prevOnline.current && !isOnline) {
      setShowOfflineBanner(true)
    }
    if (!prevOnline.current && isOnline) {
      // Went back online — show briefly then hide
      setShowOfflineBanner(true)
      bannerTimer.current = setTimeout(() => setShowOfflineBanner(false), 3000)
    }
    prevOnline.current = isOnline
    return () => { if (bannerTimer.current) clearTimeout(bannerTimer.current) }
  }, [isOnline])

  if (compact) {
    // Just a dot — green or red
    return (
      <div
        className="relative flex items-center justify-center w-8 h-8 rounded-full bg-white/5"
        title={isOnline ? 'Connected' : 'Offline — events saved locally'}
      >
        <span className="relative flex h-2.5 w-2.5">
          {!isOnline && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-emerald-500' : 'bg-red-500'}`} />
        </span>
      </div>
    )
  }

  // Non-compact: show status badge
  if (!isOnline) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-500/15 border border-red-500/30 text-red-300 backdrop-blur-sm">
        <CloudOff size={14} />
        <span className="text-xs font-semibold">Offline</span>
        <span className="text-[10px] text-red-200/70">events saved locally</span>
      </div>
    )
  }

  // Online — show briefly after reconnect, then just a minimal indicator
  if (showOfflineBanner) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 backdrop-blur-sm">
        <Wifi size={14} />
        <span className="text-xs font-semibold">Connected</span>
      </div>
    )
  }

  // Default online state — just a green dot, unobtrusive
  return (
    <div
      className="flex items-center justify-center w-8 h-8 rounded-full bg-white/5"
      title="Connected"
    >
      <span className="inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
    </div>
  )
}
