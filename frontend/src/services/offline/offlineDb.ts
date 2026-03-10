/**
 * offlineDb.ts — IndexedDB schema and CRUD for offline-first match recording.
 *
 * Uses the `idb` library for a clean async API. Three object stores:
 * - outbox: queued API requests (events, possession, carrier, snapshots)
 * - localEvents: optimistic MatchEvent records for instant UI display
 * - matchState: persisted match timer/phase state (survives refresh/crash)
 */

import { openDB, type IDBPDatabase, type DBSchema } from 'idb'

// ── Types ────────────────────────────────────────────────────────────────

export type OutboxCategory = 'event' | 'possession' | 'carrier' | 'snapshot' | 'tactical'
export type OutboxStatus = 'pending' | 'syncing' | 'failed' | 'synced'

export interface OutboxItem {
  id?: number // auto-increment
  clientEventId: string
  matchId: string
  endpoint: string
  method: 'POST' | 'PUT' | 'DELETE'
  body: Record<string, unknown>
  status: OutboxStatus
  createdAt: number
  retryCount: number
  lastError: string | null
  category: OutboxCategory
  /** For carrier segment dependency chain — temp ID that needs resolving */
  tempSegmentId?: string
}

export interface LocalEvent {
  clientEventId: string
  matchId: string
  event_type: string
  minute: number
  half: number
  player_id?: string | null
  pitch_x?: number | null
  pitch_y?: number | null
  team: string
  notes?: string | null
  created_at: string
  /** True while in outbox, false once synced */
  pending: boolean
  /** Server-assigned ID, populated after sync */
  serverId?: string | number | null
}

export interface MatchState {
  matchId: string
  ballX: number
  ballY: number
  possession: string
  matchPhase: string
  currentHalf: number
  minute: number
  seconds: number
  isStopped: boolean
  activeCarrierId: string | null
  lastSavedAt: number
}

// ── DB Schema ────────────────────────────────────────────────────────────

interface OneStatOfflineDB extends DBSchema {
  outbox: {
    key: number
    value: OutboxItem
    indexes: {
      'by-match': string
      'by-status': OutboxStatus
      'by-created': number
      'by-match-status': [string, OutboxStatus]
    }
  }
  localEvents: {
    key: string // clientEventId
    value: LocalEvent
    indexes: {
      'by-match': string
    }
  }
  matchState: {
    key: string // matchId
    value: MatchState
  }
}

// ── Singleton DB instance ────────────────────────────────────────────────

const DB_NAME = 'onestat-offline'
const DB_VERSION = 1

let dbPromise: Promise<IDBPDatabase<OneStatOfflineDB>> | null = null

export function getDb(): Promise<IDBPDatabase<OneStatOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<OneStatOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        // Outbox store
        if (!db.objectStoreNames.contains('outbox')) {
          const outbox = db.createObjectStore('outbox', {
            keyPath: 'id',
            autoIncrement: true,
          })
          outbox.createIndex('by-match', 'matchId')
          outbox.createIndex('by-status', 'status')
          outbox.createIndex('by-created', 'createdAt')
          outbox.createIndex('by-match-status', ['matchId', 'status'])
        }

        // Local events store (optimistic display)
        if (!db.objectStoreNames.contains('localEvents')) {
          const events = db.createObjectStore('localEvents', {
            keyPath: 'clientEventId',
          })
          events.createIndex('by-match', 'matchId')
        }

        // Match state store (timer/phase persistence)
        if (!db.objectStoreNames.contains('matchState')) {
          db.createObjectStore('matchState', { keyPath: 'matchId' })
        }
      },
    })
  }
  return dbPromise
}

// ── Outbox CRUD ──────────────────────────────────────────────────────────

export async function enqueueOutbox(item: Omit<OutboxItem, 'id'>): Promise<number> {
  const db = await getDb()
  return db.add('outbox', item as OutboxItem)
}

export async function getPendingItems(matchId?: string): Promise<OutboxItem[]> {
  const db = await getDb()
  if (matchId) {
    const all = await db.getAllFromIndex('outbox', 'by-match-status', [matchId, 'pending'])
    return all.sort((a, b) => a.createdAt - b.createdAt)
  }
  const all = await db.getAllFromIndex('outbox', 'by-status', 'pending')
  return all.sort((a, b) => a.createdAt - b.createdAt)
}

export async function updateOutboxStatus(
  id: number,
  status: OutboxStatus,
  error?: string,
): Promise<void> {
  const db = await getDb()
  const item = await db.get('outbox', id)
  if (!item) return
  item.status = status
  if (error !== undefined) item.lastError = error
  if (status === 'failed') item.retryCount += 1
  await db.put('outbox', item)
}

export async function getOutboxItem(id: number): Promise<OutboxItem | undefined> {
  const db = await getDb()
  return db.get('outbox', id)
}

export async function deleteOutboxItem(id: number): Promise<void> {
  const db = await getDb()
  await db.delete('outbox', id)
}

export async function getQueueDepth(matchId?: string): Promise<number> {
  const db = await getDb()
  if (matchId) {
    const items = await db.getAllFromIndex('outbox', 'by-match-status', [matchId, 'pending'])
    return items.length
  }
  const items = await db.getAllFromIndex('outbox', 'by-status', 'pending')
  return items.length
}

/** Remove all synced items for a match (cleanup after match ends) */
export async function purgeSynced(matchId: string): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('outbox', 'readwrite')
  const index = tx.store.index('by-match-status')
  let cursor = await index.openCursor([matchId, 'synced'])
  while (cursor) {
    await cursor.delete()
    cursor = await cursor.continue()
  }
}

/** Clear all pending/failed items from the outbox */
export async function clearOutbox(): Promise<void> {
  const db = await getDb()
  await db.clear('outbox')
}

/** Find an outbox item by clientEventId (for delete-before-sync) */
export async function findByClientEventId(clientEventId: string): Promise<OutboxItem | undefined> {
  const db = await getDb()
  const all = await db.getAll('outbox')
  return all.find(item => item.clientEventId === clientEventId)
}

// ── Local Events CRUD ────────────────────────────────────────────────────

export async function putLocalEvent(event: LocalEvent): Promise<void> {
  const db = await getDb()
  await db.put('localEvents', event)
}

export async function getLocalEvents(matchId: string): Promise<LocalEvent[]> {
  const db = await getDb()
  const events = await db.getAllFromIndex('localEvents', 'by-match', matchId)
  return events.sort((a, b) => a.created_at.localeCompare(b.created_at))
}

export async function deleteLocalEvent(clientEventId: string): Promise<void> {
  const db = await getDb()
  await db.delete('localEvents', clientEventId)
}

export async function markLocalEventSynced(clientEventId: string, serverId: string | number): Promise<void> {
  const db = await getDb()
  const event = await db.get('localEvents', clientEventId)
  if (!event) return
  event.pending = false
  event.serverId = serverId
  await db.put('localEvents', event)
}

// ── Match State CRUD ─────────────────────────────────────────────────────

export async function saveMatchState(state: MatchState): Promise<void> {
  const db = await getDb()
  await db.put('matchState', state)
}

export async function getMatchState(matchId: string): Promise<MatchState | undefined> {
  const db = await getDb()
  return db.get('matchState', matchId)
}

export async function deleteMatchState(matchId: string): Promise<void> {
  const db = await getDb()
  await db.delete('matchState', matchId)
}
