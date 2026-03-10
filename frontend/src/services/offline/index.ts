/**
 * Offline-first infrastructure — barrel export.
 *
 * Initialize once at app startup via initOffline().
 */

export { startNetworkMonitor, stopNetworkMonitor, startActiveMonitoring, stopActiveMonitoring, isOnline, getNetworkState, subscribe as subscribeNetwork } from './networkStatus'
export { initSyncEngine, triggerSync, syncNow, getSyncState, subscribeSyncState } from './syncEngine'
export { offlineMatch, offlineMatchEvents, offlinePossession, offlinePlayerMovement } from './offlineApi'
export { getMatchState, saveMatchState, deleteMatchState, getQueueDepth, purgeSynced, clearOutbox } from './offlineDb'
export type { MatchState } from './offlineDb'
export type { SyncState } from './syncEngine'

import { startNetworkMonitor } from './networkStatus'
import { initSyncEngine, syncNow } from './syncEngine'
import { getQueueDepth } from './offlineDb'

let initialized = false

/** Call once at app startup (e.g., in App.tsx or main.tsx) */
export function initOffline() {
  if (initialized) return
  initialized = true
  startNetworkMonitor()
  initSyncEngine()
  // Attempt to drain any leftover queue from previous session (only if items pending)
  setTimeout(async () => {
    const depth = await getQueueDepth()
    if (depth > 0) syncNow()
  }, 2000)

  // Listen for service worker background sync messages (guarded against duplicate registration)
  if ('serviceWorker' in navigator && !swListenerRegistered) {
    swListenerRegistered = true
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'SYNC_OUTBOX') {
        syncNow()
      }
    })
  }
}

let swListenerRegistered = false
