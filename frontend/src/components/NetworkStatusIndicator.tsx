/**
 * NetworkStatusIndicator — Compact status badge for match recording.
 *
 * Three states:
 *  🟢  Online, queue empty — all good
 *  🟡  Online, syncing N items — catching up
 *  🔴  Offline — events queuing locally, will sync when back
 *
 * Unobtrusive by default (just a dot). Expands on tap to show details.
 * Shows "Clear queue" button when items are stuck.
 */

import { useState, useEffect, useRef } from 'react'
import { Wifi, Cloud, CloudOff, Loader2, Trash2 } from 'lucide-react'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { clearOutbox, syncNow } from '../services/offline'

interface NetworkStatusIndicatorProps {
  /** Compact mode — just a dot, no text */
  compact?: boolean
}

export default function NetworkStatusIndicator({ compact = false }: NetworkStatusIndicatorProps) {
  const { isOnline, isSyncing, queueDepth } = useNetworkStatus()
  const [expanded, setExpanded] = useState(false)
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Auto-collapse after 5s (longer to allow clear button interaction)
  useEffect(() => {
    if (expanded) {
      collapseTimer.current = setTimeout(() => setExpanded(false), 5000)
      return () => { if (collapseTimer.current) clearTimeout(collapseTimer.current) }
    }
  }, [expanded])

  // Auto-expand briefly when going offline
  const prevOnline = useRef(isOnline)
  useEffect(() => {
    if (prevOnline.current && !isOnline) {
      setExpanded(true)
    }
    prevOnline.current = isOnline
  }, [isOnline])

  const handleClearQueue = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await clearOutbox()
    // Trigger a re-check of queue depth
    syncNow()
    setExpanded(false)
  }

  const status = !isOnline
    ? 'offline'
    : queueDepth > 0
      ? 'syncing'
      : 'online'

  const dotColor = {
    online: 'bg-emerald-500',
    syncing: 'bg-amber-500',
    offline: 'bg-red-500',
  }[status]

  const pulseColor = {
    online: 'bg-emerald-400',
    syncing: 'bg-amber-400',
    offline: 'bg-red-400',
  }[status]

  if (compact && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="relative flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 transition-all touch-manipulation"
        title={status === 'offline' ? 'Offline — events saved locally' : status === 'syncing' ? `Syncing ${queueDepth} events...` : 'Connected'}
      >
        <span className="relative flex h-2.5 w-2.5">
          {status !== 'online' && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${pulseColor} opacity-75`} />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${dotColor}`} />
        </span>
        {queueDepth > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-black px-0.5">
            {queueDepth}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all border backdrop-blur-sm touch-manipulation ${
          status === 'offline'
            ? 'bg-red-500/15 border-red-500/30 text-red-300'
            : status === 'syncing'
              ? 'bg-amber-500/15 border-amber-500/30 text-amber-300'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
        }`}
      >
        {status === 'offline' ? (
          <>
            <CloudOff size={14} />
            <span className="text-xs font-semibold">Offline</span>
            {queueDepth > 0 && (
              <span className="text-[10px] text-red-200/70">({queueDepth} queued)</span>
            )}
          </>
        ) : status === 'syncing' ? (
          <>
            {isSyncing ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
            <span className="text-xs font-semibold">{queueDepth} queued</span>
          </>
        ) : (
          <>
            <Wifi size={14} />
            <span className="text-xs font-semibold">Connected</span>
          </>
        )}
      </button>

      {/* Clear queue button — shown when expanded and items are stuck */}
      {expanded && queueDepth > 0 && (
        <button
          onClick={handleClearQueue}
          className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-red-500/20 border border-red-500/30 text-red-300 text-xs font-medium active:bg-red-500/40 transition-all touch-manipulation"
        >
          <Trash2 size={12} />
          Clear
        </button>
      )}
    </div>
  )
}
