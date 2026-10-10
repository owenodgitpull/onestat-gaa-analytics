/**
 * offlineApi.ts — Offline-first API wrapper for match recording.
 *
 * Mirrors the shape of the real API (matchEvents, possession, playerMovement).
 *
 * When online: POSTs directly to the server for immediate persistence.
 * When offline: writes to IndexedDB outbox, syncs when connectivity returns.
 *
 * The existing hooks (useMatchEvents, usePlayerMovement) call these instead of
 * the direct API — MatchRecording.tsx doesn't change.
 */

import {
  enqueueOutbox,
  putLocalEvent,
  deleteLocalEvent,
  findByClientEventId,
  deleteOutboxItem,
  type OutboxCategory,
} from './offlineDb'
import { triggerSync, resolveTempId } from './syncEngine'
import { isOnline } from './networkStatus'
import type { MatchEvent, PossessionEvent } from '../../types'

// ── Helpers ──────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

/**
 * Game-clock seconds at the moment of a tap (minute*60 + seconds as shown on the match clock).
 * The recording screen registers a getter once; every event / possession / carry written through
 * this file is stamped with it at call time — so the tap time survives offline queueing and no
 * call site has to pass it. Reads a ref: no extra render, no request, nothing awaited.
 */
let matchClockProvider: (() => number | null) | null = null

export function setMatchClockProvider(fn: (() => number | null) | null): void {
  matchClockProvider = fn
}

function clockNow(): { match_clock_s?: number } {
  try {
    const s = matchClockProvider ? matchClockProvider() : null
    return s != null && Number.isFinite(s) && s >= 0 ? { match_clock_s: Math.min(Math.round(s), 7500) } : {}
  } catch {
    return {}
  }
}

/**
 * Direct "try server first" fetches previously had no timeout — a hung
 * request (dead socket, cold-starting backend) would leave the await
 * pending forever, so the offline-queue fallback below it never ran and
 * the tap appeared to do nothing at all. Bound every direct attempt so a
 * hang always falls through to the outbox within a few seconds.
 */
const DIRECT_FETCH_TIMEOUT_MS = 8000

async function fetchWithTimeout(url: string, opts: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DIRECT_FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...opts, signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

async function enqueueAndSync(
  matchId: string,
  endpoint: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: Record<string, unknown>,
  category: OutboxCategory,
  tempSegmentId?: string,
  // Callers that already minted a clientEventId for their own bookkeeping
  // (e.g. offlineMatchEvents.create writes a putLocalEvent row under it
  // before this runs) must pass it here so the outbox item — and the
  // client_event_id actually POSTed to the server — use that SAME id.
  // Previously this always minted its own fresh id and silently overwrote
  // whatever the caller had put in `body`, so a caller's separately-stored
  // local record was keyed under an id the server never saw. That broke
  // markLocalEventSynced (it looks the local row up by the id the server
  // DID see) — the local row stayed "pending" forever, and the next page
  // refresh's resyncLocalEvents dutifully "recovered" it by resubmitting
  // it under yet another fresh id, creating a genuine duplicate event on
  // the server. Confirmed live 2026-09-07: every event recorded before a
  // mid-match refresh got re-logged a second time this way.
  clientEventId?: string,
): Promise<string> {
  const id = clientEventId ?? uuid()
  await enqueueOutbox({
    clientEventId: id,
    matchId,
    endpoint,
    method,
    body: { ...body, client_event_id: id },
    status: 'pending',
    createdAt: Date.now(),
    retryCount: 0,
    lastError: null,
    category,
    tempSegmentId,
  })
  triggerSync()
  return id
}

// ── Match Creation (try-online, fallback-local) ─────────────────────────

export const offlineMatch = {
  /**
   * Create a match — tries the server first. On network failure, creates locally
   * with a client-generated UUID and queues the server creation in the outbox.
   */
  create: async (
    matchData: Record<string, unknown>,
    apiFn: (data: Record<string, unknown>) => Promise<{ id: string; [key: string]: unknown }>,
  ): Promise<{ id: string; offline: boolean; data: Record<string, unknown> }> => {
    try {
      const result = await apiFn(matchData)
      return { id: result.id as string, offline: false, data: result }
    } catch (err: unknown) {
      // Only fall back to offline for network errors, not validation errors
      const isNetworkError =
        err instanceof TypeError || // Failed to fetch
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.message.includes('fetch'))

      if (!isNetworkError) throw err

      // Generate a client-side UUID — server will use this as the PK
      const localId = crypto.randomUUID()
      const clientEventId = crypto.randomUUID()

      await enqueueOutbox({
        clientEventId,
        matchId: localId,
        endpoint: '/matches/',
        method: 'POST',
        body: { ...matchData, id: localId, client_event_id: clientEventId },
        status: 'pending',
        createdAt: Date.now(),
        retryCount: 0,
        lastError: null,
        category: 'event', // match creation is a one-off event
      })
      triggerSync()

      return { id: localId, offline: true, data: { id: localId, ...matchData } }
    }
  },
}

// ── Match Events (online-first, offline fallback) ────────────────────────

export const offlineMatchEvents = {
  /**
   * Record a match event — always queues in IndexedDB first and syncs to
   * the server in the background, online or not. See the comment inline
   * below for why this must never block on a direct fetch.
   */
  create: async (data: {
    match_id: string
    player_id?: string
    kickout_target_player_id?: string
    sub_in_player_id?: string
    event_type: string
    minute: number
    half: number
    x_coord?: number
    y_coord?: number
    end_x?: number
    end_y?: number
    is_home_team: boolean
    notes?: string
    opponent_player_name?: string
    sub_type?: string
  }): Promise<MatchEvent> => {
    // end_x / end_y (long kick pass / high ball landing) ride along inside `rest`
    const { is_home_team, x_coord, y_coord, minute, opponent_player_name, sub_type, ...rest } = data
    const team = is_home_team ? 'own' : 'opponent'
    const clientEventId = uuid()
    const body = {
      ...rest,
      team,
      minute: Math.min(minute, 120),
      ...clockNow(),
      pitch_x: x_coord,
      pitch_y: y_coord,
      client_event_id: clientEventId,
      ...(opponent_player_name ? { opponent_player_name } : {}),
      ...(sub_type ? { sub_type } : {}),
    }

    // Always queue locally first and let the sync engine push it in the
    // background (debounced ~300ms). A "try server first, await the
    // response" branch used to live here — on a real stadium connection
    // that's "online" (navigator.onLine === true) but slow/high-latency,
    // that blocking fetch could take up to DIRECT_FETCH_TIMEOUT_MS (8s)
    // before ever falling back to this same offline path, which is why
    // score/wide taps and the kickout prompt that follows them could lag
    // by seconds on match day. Queueing immediately makes every tap resolve
    // in the time it takes to write to IndexedDB (milliseconds) regardless
    // of connection quality, while still syncing to the server within
    // ~300ms-2s when the network cooperates.
    await enqueueAndSync(
      data.match_id,
      '/match-events/',
      'POST',
      body,
      'event',
      undefined,
      clientEventId,
    )

    await putLocalEvent({
      clientEventId,
      matchId: data.match_id,
      event_type: data.event_type,
      minute: data.minute,
      half: data.half,
      player_id: data.player_id || null,
      pitch_x: x_coord || null,
      pitch_y: y_coord || null,
      team,
      notes: data.notes || null,
      created_at: now(),
      pending: true,
    })

    return {
      id: clientEventId as unknown as number,
      match_id: data.match_id,
      player_id: (data.player_id as unknown as number) || null,
      event_type: data.event_type,
      minute: data.minute,
      half: data.half,
      pitch_x: x_coord || null,
      pitch_y: y_coord || null,
      is_home_team: data.is_home_team,
      notes: data.notes || null,
      created_at: now(),
    }
  },

  /**
   * Quick score — online-first with offline fallback
   */
  quickScore: async (data: {
    match_id: string
    player_id: string
    event_type: 'GOAL' | 'POINT'
    minute: number
    half: number
  }): Promise<MatchEvent> => {
    const stamped = { ...data, ...clockNow() }
    if (isOnline()) {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        const response = await fetchWithTimeout(`${baseUrl}/match-events/quick-score`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(stamped),
        })
        if (response.ok) {
          const serverEvent = await response.json()
          return {
            id: serverEvent.id,
            match_id: data.match_id,
            player_id: data.player_id as unknown as number,
            event_type: data.event_type,
            minute: data.minute,
            half: data.half,
            pitch_x: null, pitch_y: null,
            is_home_team: true,
            notes: null,
            created_at: serverEvent.created_at || now(),
          }
        }
      } catch { /* fall through */ }
    }

    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/match-events/quick-score',
      'POST',
      stamped,
      'event',
    )

    await putLocalEvent({
      clientEventId,
      matchId: data.match_id,
      event_type: data.event_type,
      minute: data.minute,
      half: data.half,
      player_id: data.player_id,
      pitch_x: null, pitch_y: null,
      team: 'own',
      notes: null,
      created_at: now(),
      pending: true,
    })

    return {
      id: clientEventId as unknown as number,
      match_id: data.match_id,
      player_id: data.player_id as unknown as number,
      event_type: data.event_type,
      minute: data.minute,
      half: data.half,
      pitch_x: null, pitch_y: null,
      is_home_team: true,
      notes: null,
      created_at: now(),
    }
  },

  /**
   * Delete — try server directly when online, queue when offline.
   */
  delete: async (eventId: string, matchId: string): Promise<void> => {
    // Check if local-only (never synced)
    const outboxItem = await findByClientEventId(eventId)
    if (outboxItem && outboxItem.status === 'pending' && outboxItem.id) {
      await deleteOutboxItem(outboxItem.id)
      await deleteLocalEvent(eventId)
      return
    }

    // Try server directly
    if (isOnline()) {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        const response = await fetchWithTimeout(`${baseUrl}/match-events/${eventId}`, {
          method: 'DELETE',
          credentials: 'include',
        })
        if (response.ok || response.status === 204 || response.status === 404) {
          await deleteLocalEvent(eventId)
          return
        }
      } catch { /* fall through */ }
    }

    // Offline fallback
    await enqueueAndSync(matchId, `/match-events/${eventId}`, 'DELETE', {}, 'event')
    await deleteLocalEvent(eventId)
  },
}

// ── Possession Events (offline-first) ────────────────────────────────────

export const offlinePossession = {
  create: async (data: {
    match_id: string
    minute: number
    half: number
    is_home_team: boolean
    // Optional: Simple Scoring's "Possession Changed" button records a
    // possession change with no location step — pitch_x/pitch_y go through
    // as null in that case (still a valid PossessionEvent — team + duration
    // drive possession %, just no territorial breakdown).
    x_coord?: number | null
    y_coord?: number | null
  }): Promise<PossessionEvent> => {
    const team = data.is_home_team ? 'own' : 'opponent'
    const body = {
      match_id: data.match_id,
      team,
      pitch_x: data.x_coord,
      pitch_y: data.y_coord,
      minute: Math.min(data.minute, 120),
      ...clockNow(),
    }

    // Try server first when online
    if (isOnline()) {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        const response = await fetchWithTimeout(`${baseUrl}/possession-events/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (response.ok) {
          return {
            id: (await response.json().catch(() => ({ id: uuid() }))).id,
            match_id: data.match_id,
            minute: data.minute,
            half: data.half,
            is_home_team: data.is_home_team,
            x_coord: data.x_coord,
            y_coord: data.y_coord,
            created_at: now(),
          } as unknown as PossessionEvent
        }
      } catch { /* fall through */ }
    }

    // Offline fallback
    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/possession-events/',
      'POST',
      body,
      'possession',
    )

    return {
      id: clientEventId,
      match_id: data.match_id,
      minute: data.minute,
      half: data.half,
      is_home_team: data.is_home_team,
      x_coord: data.x_coord,
      y_coord: data.y_coord,
      created_at: now(),
    } as unknown as PossessionEvent
  },

  bulkCreate: async (data: {
    match_id: string
    team: 'own' | 'opponent'
    minute: number
    match_clock_s?: number
    waypoints: Array<{ x: number; y: number }>
  }): Promise<{ created: number }> => {
    data = { ...clockNow(), ...data }
    // Try server first
    if (isOnline()) {
      try {
        const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
        const response = await fetchWithTimeout(`${baseUrl}/possession-events/bulk`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(data),
        })
        if (response.ok) {
          return await response.json()
        }
      } catch { /* fall through */ }
    }

    // Offline fallback
    await enqueueAndSync(
      data.match_id,
      '/possession-events/bulk',
      'POST',
      data,
      'possession',
    )
    return { created: data.waypoints.length }
  },
}

// ── Player Movement (offline-first) ──────────────────────────────────────

export const offlinePlayerMovement = {
  startCarrierSegment: async (data: {
    match_id: string
    player_id: string
    jersey_number?: number | null
    team: string
    half: number
    minute: number
    start_x: number | null
    start_y: number | null
  }): Promise<{ id: string; [key: string]: unknown }> => {
    const clientEventId = uuid()

    // Always queue locally first (see the matching comment in
    // offlineMatchEvents.create above) — a blocking "try server first"
    // fetch here previously delayed every possession-swap / carrier-close
    // by up to DIRECT_FETCH_TIMEOUT_MS on a slow-but-online connection,
    // since onPossessionSwap awaits endSegment which awaits this call.
    const tempSegmentId = `local-${clientEventId}`
    // client_segment_id (distinct from client_event_id, which enqueueAndSync
    // overwrites with its own outbox-tracking UUID below) is how the sync
    // engine's processItem() learns which local temp ID this segment should
    // resolve to once the server confirms — see the matching read of
    // body.client_segment_id in syncEngine.ts. Without this, the temp ID
    // mapping is never registered, endCarrierSegment/appendPathPoints calls
    // for this segment can never resolve past "local-...", and their queued
    // updates sit in 'pending' forever — silently losing every carrier's end
    // position and ended_by reason. Confirmed broken (mapping never written)
    // even before this file stopped racing a direct fetch against the queue.
    await enqueueAndSync(
      data.match_id,
      '/player-movement/carrier-segments',
      'POST',
      { ...data, ...clockNow(), client_event_id: tempSegmentId, client_segment_id: tempSegmentId },
      'carrier',
    )

    return {
      id: tempSegmentId,
      match_id: data.match_id,
      player_id: data.player_id,
      jersey_number: data.jersey_number ?? null,
      team: data.team,
      half: data.half,
      minute: data.minute,
      start_x: data.start_x,
      start_y: data.start_y,
      path_points: data.start_x != null ? [{ x: data.start_x, y: data.start_y }] : [],
      sequence_number: 0,
      source: 'live',
    }
  },

  endCarrierSegment: async (
    segmentId: string,
    data: { end_x?: number; end_y?: number; ended_by?: string },
  ): Promise<void> => {
    // Always queue locally first — see comment in startCarrierSegment above.
    const realId = resolveTempId(segmentId)
    const isTemp = segmentId.startsWith('local-')
    await enqueueAndSync(
      '',
      `/player-movement/carrier-segments/${realId}`,
      'PUT',
      data,
      'carrier',
      isTemp ? segmentId : undefined,
    )
  },

  appendPathPoints: async (
    segmentId: string,
    points: Array<{ x: number; y: number }>,
  ): Promise<void> => {
    // Always queue locally first — see comment in startCarrierSegment above.
    const realId = resolveTempId(segmentId)
    const isTemp = segmentId.startsWith('local-')
    await enqueueAndSync(
      '',
      `/player-movement/carrier-segments/${realId}/path-points`,
      'POST',
      { points },
      'carrier',
      isTemp ? segmentId : undefined,
    )
  },

  createSnapshot: async (data: {
    match_id: string
    half: number
    minute?: number | null
    label?: string | null
    positions: Array<{ player_id?: string | null; jersey_number?: number | null; x: number; y: number; team?: string; player_name?: string | null }>
    source?: string
    video_timestamp_ms?: number | null
  }): Promise<{ id: string }> => {
    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/player-movement/snapshots',
      'POST',
      data,
      'snapshot',
    )
    return { id: clientEventId }
  },

  createTacticalTag: async (data: {
    match_id: string
    tag_type: string
    label?: string | null
    half: number
    minute?: number | null
    pitch_x?: number | null
    pitch_y?: number | null
    source?: string
  }): Promise<{ id: string }> => {
    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/player-movement/tactical-tags',
      'POST',
      data,
      'tactical',
    )
    return { id: clientEventId }
  },
}
