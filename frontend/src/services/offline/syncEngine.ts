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
  incrementOutboxRetry,
  markLocalEventSynced,
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

      // Handle carrier segment ID mapping — registers the temp local ID
      // (client_segment_id, set only on the segment-creation request body)
      // against the real server ID, so a later end-segment/path-point
      // update for the same segment can resolve it. Previously gated on
      // `item.endpoint.includes('start')`, but the creation endpoint is
      // just POST /player-movement/carrier-segments — no "start" substring
      // ever appears in it — so that check was always false and this
      // mapping never registered. Every carrier segment's end position
      // (end_x/end_y) and ended_by reason silently failed to save as a
      // result, for every match, confirmed via a 2026-09-07 match report
      // that couldn't compute territory-gained-per-carry despite ~98% of
      // carries being logged live. `body.client_segment_id` is only ever
      // present on the creation request, so checking for it directly (and
      // dropping the broken endpoint substring check) is sufficient.
      if (item.category === 'carrier' && body.client_segment_id && data?.id) {
        const tempId = body.client_segment_id as string
        registerTempIdMapping(tempId, data.id)
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

    // 4xx — client error
    if (response.status >= 400 && response.status < 500) {
      // 409 Conflict = duplicate (already synced) — treat as success
      if (response.status === 409) {
        await updateOutboxStatus(item.id, 'synced')
        return true
      }
      // Log the error for debugging — do NOT silently delete
      const errBody = await response.text().catch(() => `HTTP ${response.status}`)
      console.error(`[Sync] 4xx error for ${item.method} ${endpoint}: ${response.status}`, errBody)
      await updateOutboxStatus(item.id, 'pending', `${response.status}: ${errBody.slice(0, 200)}`)
      await incrementOutboxRetry(item.id)
      syncState.lastSyncError = `${response.status}: ${errBody.slice(0, 100)}`
      return false // Retry later
    }

    // 5xx — server error, retry
    const errText = await response.text().catch(() => `HTTP ${response.status}`)
    await updateOutboxStatus(item.id, 'pending', errText)
    await incrementOutboxRetry(item.id)
    syncState.lastSyncError = errText
    return false
  } catch (err: unknown) {
    // Network error or timeout — mark pending for retry
    const msg = err instanceof Error ? err.message : 'Network error'
    await updateOutboxStatus(item.id, 'pending', msg)
    await incrementOutboxRetry(item.id)
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
    while (true) {
      if (!isOnline()) break

      const pending = await getPendingItems()
      syncState.queueDepth = pending.length
      emitSync()

      if (pending.length === 0) break

      // Walk the FULL pending list in order (oldest first) instead of
      // retrying only pending[0] forever — a single permanently-failing
      // item must not block every event queued behind it.
      let progressed = false

      for (const item of pending) {
        if (!isOnline()) break
        if (!item.id) continue

        // Stop auto-retrying items that have exceeded the retry limit, but
        // NEVER silently delete match-recording data — mark it 'failed' so
        // it's visible/inspectable instead of vanishing.
        if (item.retryCount >= MAX_RETRIES) {
          if (item.status !== 'failed') {
            await updateOutboxStatus(item.id, 'failed', item.lastError || 'Max retries exceeded')
            console.error(`[Sync] Giving up on item ${item.id} (${item.endpoint}) after ${MAX_RETRIES} retries`)
          }
          continue
        }

        const success = await processItem(item)
        if (success) progressed = true
      }

      if (!progressed) {
        // Nothing in this pass got through — back off before trying the whole set again
        await new Promise(resolve => setTimeout(resolve, backoffDelay(1)))
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

/** Re-queue unsynced local events back into the outbox for retry */
export async function resyncLocalEvents(matchId: string): Promise<number> {
  const { getLocalEvents, enqueueOutbox, markLocalEventSynced } = await import('./offlineDb')
  const localEvents = await getLocalEvents(matchId)
  const pending = localEvents.filter(e => e.pending)
  if (pending.length === 0) return 0

  // Before blindly resubmitting anything still marked "pending," check
  // whether the server already has a matching event. A historical bug
  // (fixed 2026-09-07 — see the comment on enqueueAndSync in offlineApi.ts)
  // could leave a local record stuck "pending" even though it had already
  // synced, under a DIFFERENT client_event_id than the one stored here —
  // resubmitting it verbatim would create a genuine duplicate on the
  // server, exactly as happened live that day. Match on content
  // (type/team/minute/position/player) rather than id, since the id this
  // local record carries was never actually the one sent to the server.
  let serverEvents: Array<{ event_type: string; team: string; minute: number | null; pitch_x: number | null; pitch_y: number | null; player_id: string | null }> = []
  try {
    const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
    const res = await fetch(`${baseUrl}/match-events/match/${matchId}?limit=1000`, { credentials: 'include' })
    if (res.ok) {
      const data = await res.json()
      serverEvents = (data.events || []).map((e: any) => ({
        event_type: e.event_type,
        team: e.team,
        minute: e.minute,
        pitch_x: e.pitch_x,
        pitch_y: e.pitch_y,
        player_id: e.player_id ?? null,
      }))
    }
  } catch {
    // Couldn't reach the server to check — fall through to the old
    // (still correct, just noisier if this bug ever recurs) requeue below.
  }

  const closeEnough = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return true
    if (a == null || b == null) return false
    return Math.abs(a - b) < 0.001
  }
  const alreadyOnServer = (local: (typeof pending)[number]) =>
    serverEvents.some(se =>
      se.event_type === local.event_type &&
      se.team === local.team &&
      se.minute === local.minute &&
      closeEnough(se.pitch_x, local.pitch_x) &&
      closeEnough(se.pitch_y, local.pitch_y) &&
      (se.player_id ?? null) === (local.player_id ?? null)
    )

  let requeued = 0
  let reconciled = 0

  for (const event of pending) {
    if (serverEvents.length > 0 && alreadyOnServer(event)) {
      // Already on the server (under some other id) — just clear the
      // stuck-pending flag locally instead of sending a duplicate.
      await markLocalEventSynced(event.clientEventId, event.clientEventId)
      reconciled++
      continue
    }
    // Genuinely never synced — re-queue it
    await enqueueOutbox({
      clientEventId: event.clientEventId,
      matchId: event.matchId,
      endpoint: '/match-events/',
      method: 'POST',
      body: {
        match_id: event.matchId,
        event_type: event.event_type,
        team: event.team,
        minute: Math.min(event.minute || 0, 120),
        pitch_x: event.pitch_x,
        pitch_y: event.pitch_y,
        player_id: event.player_id,
        notes: event.notes,
        client_event_id: event.clientEventId,
      },
      status: 'pending',
      createdAt: Date.now(),
      retryCount: 0,
      lastError: null,
      category: 'event',
    })
    requeued++
  }

  if (reconciled > 0) {
    console.log(`[Sync] Reconciled ${reconciled} already-synced events for match ${matchId} (no resend)`)
  }
  if (requeued > 0) {
    console.log(`[Sync] Re-queued ${requeued} unsynced events for match ${matchId}`)
    triggerSync()
  }

  return requeued
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
