/**
 * syncEngine.ts — Background sync engine for the outbox queue.
 *
 * Processes outbox items in strict FIFO order per match. Retries with
 * exponential backoff (2s → 60s). Handles carrier segment temp-ID
 * resolution. Singleton — only one sync loop runs at a time.
 *
 * Trigger conditions:
 *  - Called by offlineApi after every enqueue
 *  - Called by networkStatus when coming back online
 *  - Called by service worker background sync event
 */

import {
  getPendingItems,
  updateOutboxStatus,
  markLocalEventSynced,
  deleteOutboxItem,
  type OutboxItem,
} from './offlineDb'
import { isOnline, subscribe as subscribeNetwork } from './networkStatus'

// ── Carrier segment temp ID mapping ──────────────────────────────────────

/**
 * Maps temporary client-side segment IDs ("local-xxx") to real server IDs.
 * Persisted in memory — survives within a session. If page refreshes mid-sync,
 * carrier items referencing unknown temp IDs will fail gracefully (marked failed,
 * user can re-record if needed — extremely rare edge case).
 */
const tempIdMap = new Map<string, string>()

export function resolveTempId(tempId: string): string {
  return tempIdMap.get(tempId) || tempId
}

export function registerTempIdMapping(tempId: string, realId: string) {
  tempIdMap.set(tempId, realId)
}

// ── Sync state ───────────────────────────────────────────────────────────

type SyncListener = (state: SyncState) => void

export interface SyncState {
  isSyncing: boolean
  queueDepth: number
  lastSyncError: string | null
  lastSyncedAt: number | null
}

let syncState: SyncState = {
  isSyncing: false,
  queueDepth: 0,
  lastSyncError: null,
  lastSyncedAt: null,
}

const syncListeners = new Set<SyncListener>()
let syncScheduled = false
let syncRunning = false

function emitSync() {
  syncListeners.forEach(fn => {
    try { fn({ ...syncState }) } catch { /* noop */ }
  })
}

export function getSyncState(): SyncState {
  return { ...syncState }
}

export function subscribeSyncState(listener: SyncListener): () => void {
  syncListeners.add(listener)
  return () => { syncListeners.delete(listener) }
}

// ── Core sync loop ───────────────────────────────────────────────────────

const BASE_DELAY_MS = 2000
const MAX_DELAY_MS = 60000
const MAX_RETRIES = 10

function backoffDelay(retryCount: number): number {
  const delay = Math.min(BASE_DELAY_MS * Math.pow(2, retryCount), MAX_DELAY_MS)
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1)
  return Math.round(delay + jitter)
}

async function processItem(item: OutboxItem): Promise<boolean> {
  if (!item.id) return false

  await updateOutboxStatus(item.id, 'syncing')

  // Resolve any temp segment IDs in the endpoint and body
  let endpoint = item.endpoint
  const body = { ...item.body }

  if (item.tempSegmentId) {
    const realId = resolveTempId(item.tempSegmentId)
    if (realId.startsWith('local-')) {
      // Parent segment hasn't synced yet — can't process this item yet
      await updateOutboxStatus(item.id, 'pending')
      return false
    }
    // Replace temp ID in endpoint (e.g., /carrier-segments/local-xxx/path-points)
    endpoint = endpoint.replace(item.tempSegmentId, realId)
    // Replace in body if present
    if (body.segment_id === item.tempSegmentId) {
      body.segment_id = realId
    }
  }

  try {
    const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
    const url = `${baseUrl}${endpoint}`

    const fetchOpts: RequestInit = {
      method: item.method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    }
    if (item.method !== 'DELETE') {
      fetchOpts.body = JSON.stringify(body)
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    fetchOpts.signal = controller.signal

    const response = await fetch(url, fetchOpts)
    clearTimeout(timeout)

    if (response.ok) {
      const data = await response.json().catch(() => null)

      // Handle carrier segment ID mapping
      if (item.category === 'carrier' && item.endpoint.includes('start') && data?.id) {
        const tempId = body.client_segment_id as string
        if (tempId) registerTempIdMapping(tempId, data.id)
      }

      // Mark local event as synced with server ID
      if (item.category === 'event' && data?.id) {
        await markLocalEventSynced(item.clientEventId, data.id)
      }

      await updateOutboxStatus(item.id, 'synced')
      syncState.lastSyncedAt = Date.now()
      syncState.lastSyncError = null
      return true
    }

    // 4xx — client error, don't retry (bad data, validation error, not found)
    if (response.status >= 400 && response.status < 500) {
      // 409 Conflict = duplicate (already synced) — treat as success
      if (response.status === 409) {
        await updateOutboxStatus(item.id, 'synced')
        return true
      }
      // Unrecoverable — delete from outbox silently
      await deleteOutboxItem(item.id)
      return true // Move on to next item
    }

    // 5xx — server error, retry
    const errText = await response.text().catch(() => `HTTP ${response.status}`)
    await updateOutboxStatus(item.id, 'pending', errText)
    syncState.lastSyncError = errText
    return false
  } catch (err: unknown) {
    // Network error or timeout — mark pending for retry
    const msg = err instanceof Error ? err.message : 'Network error'
    await updateOutboxStatus(item.id, 'pending', msg)
    syncState.lastSyncError = msg
    return false
  }
}

async function runSyncLoop() {
  if (syncRunning) return
  syncRunning = true
  syncState.isSyncing = true
  emitSync()

  try {
    let consecutiveFailures = 0

    while (true) {
      if (!isOnline()) break

      const pending = await getPendingItems()
      syncState.queueDepth = pending.length
      emitSync()

      if (pending.length === 0) break

      // Process items that are ready (not exceeding retry limits)
      const item = pending[0]
      if (!item.id) break

      // Auto-purge items that exceeded retry limit — don't leave them stuck
      if (item.retryCount >= MAX_RETRIES) {
        await deleteOutboxItem(item.id)
        continue
      }

      const success = await processItem(item)

      if (success) {
        consecutiveFailures = 0
      } else {
        consecutiveFailures++
        // Back off after consecutive failures
        if (consecutiveFailures >= 3) {
          const delay = backoffDelay(consecutiveFailures - 3)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }
  } finally {
    syncRunning = false
    syncState.isSyncing = false
    const remaining = await getPendingItems()
    syncState.queueDepth = remaining.length
    emitSync()
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/** Trigger a sync attempt (debounced — safe to call frequently) */
export function triggerSync() {
  if (syncScheduled || syncRunning) return
  syncScheduled = true
  // Debounce 300ms — batch rapid enqueues
  setTimeout(() => {
    syncScheduled = false
    if (isOnline()) {
      runSyncLoop()
    }
  }, 300)
}

/** Force immediate sync (e.g. when coming back online) */
export function syncNow() {
  syncScheduled = false
  if (!syncRunning && isOnline()) {
    runSyncLoop()
  }
}

/** Initialize: subscribe to network status changes */
export function initSyncEngine() {
  subscribeNetwork((state) => {
    if (state.isOnline) {
      // Just came online — drain the queue
      syncNow()
    }
  })
}
