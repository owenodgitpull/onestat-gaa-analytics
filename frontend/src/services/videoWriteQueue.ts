/**
 * Durable queue for Video Tagging event creates that could not be saved for a reason that is not the event's fault
 * (server down / restarting, network drop, 5xx). The event stays on screen and is re-sent until it saves — it is
 * never silently dropped. A request the server REJECTS (4xx) is not queued: that event is invalid and the user is told.
 *
 * Stored in localStorage (a few small JSON rows), so queued events survive a refresh. Saves are idempotent on the
 * server (video_events.client_event_id), so a re-send of an event that actually reached the server is harmless.
 */
import type { VideoEventCreateData } from './videoApi'

export interface QueuedWrite {
  clientEventId: string
  sessionId: string
  data: VideoEventCreateData
  tempId: string
  queuedAt: number
}

const KEY = 'vt-write-queue-v1'

function load(): QueuedWrite[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let items: QueuedWrite[] = load()
const listeners = new Set<() => void>()
const counts = new Map<string, number>()

function commit() {
  counts.clear()
  for (const i of items) counts.set(i.sessionId, (counts.get(i.sessionId) ?? 0) + 1)
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch { /* storage full/blocked — the in-memory queue still works for this tab */ }
  listeners.forEach(l => l())
}
commit()

export const writeQueue = {
  all: (): QueuedWrite[] => items,
  forSession: (sessionId: string): QueuedWrite[] => items.filter(i => i.sessionId === sessionId),
  add(item: QueuedWrite) {
    if (!items.some(i => i.clientEventId === item.clientEventId)) {
      items = [...items, item]
      commit()
    }
  },
  remove(clientEventId: string) {
    const next = items.filter(i => i.clientEventId !== clientEventId)
    if (next.length !== items.length) {
      items = next
      commit()
    }
  },
  count: (sessionId: string): number => counts.get(sessionId) ?? 0,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
}
