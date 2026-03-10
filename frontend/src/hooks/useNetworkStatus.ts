/**
 * useNetworkStatus — React hook for online/offline state + sync queue status.
 *
 * Subscribes to both networkStatus (online/offline) and syncEngine (queue depth).
 * Lightweight — just pub/sub, no polling from React.
 */

import { useState, useEffect } from 'react'
import {
  getNetworkState,
  subscribeNetwork,
  getSyncState,
  subscribeSyncState,
  type SyncState,
} from '../services/offline'

export interface NetworkStatusInfo {
  isOnline: boolean
  lastOnlineAt: number
  isSyncing: boolean
  queueDepth: number
  lastSyncError: string | null
  lastSyncedAt: number | null
}

export function useNetworkStatus(): NetworkStatusInfo {
  const [info, setInfo] = useState<NetworkStatusInfo>(() => {
    const net = getNetworkState()
    const sync = getSyncState()
    return {
      isOnline: net.isOnline,
      lastOnlineAt: net.lastOnlineAt,
      isSyncing: sync.isSyncing,
      queueDepth: sync.queueDepth,
      lastSyncError: sync.lastSyncError,
      lastSyncedAt: sync.lastSyncedAt,
    }
  })

  useEffect(() => {
    const unsubNet = subscribeNetwork((netState) => {
      setInfo(prev => ({
        ...prev,
        isOnline: netState.isOnline,
        lastOnlineAt: netState.lastOnlineAt,
      }))
    })

    const unsubSync = subscribeSyncState((syncState: SyncState) => {
      setInfo(prev => ({
        ...prev,
        isSyncing: syncState.isSyncing,
        queueDepth: syncState.queueDepth,
        lastSyncError: syncState.lastSyncError,
        lastSyncedAt: syncState.lastSyncedAt,
      }))
    })

    return () => { unsubNet(); unsubSync() }
  }, [])

  return info
}
