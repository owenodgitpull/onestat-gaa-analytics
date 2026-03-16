/**
 * offlineApi.ts — Offline-first API wrapper for match recording.
 *
 * Mirrors the shape of the real API (matchEvents, possession, playerMovement)
 * but writes to IndexedDB first for instant response, then syncs in background.
 *
 * When online: writes locally + triggers background sync (near-instant server push).
 * When offline: writes locally, queued for sync when connectivity returns.
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
import type { MatchEvent, PossessionEvent } from '../../types'

// ── Helpers ──────────────────────────────────────────────────────────────

function uuid(): string {
  return crypto.randomUUID()
}

function now(): string {
  return new Date().toISOString()
}

async function enqueueAndSync(
  matchId: string,
  endpoint: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body: Record<string, unknown>,
  category: OutboxCategory,
  tempSegmentId?: string,
): Promise<string> {
  const clientEventId = uuid()
  await enqueueOutbox({
    clientEventId,
    matchId,
    endpoint,
    method,
    body: { ...body, client_event_id: clientEventId },
    status: 'pending',
    createdAt: Date.now(),
    retryCount: 0,
    lastError: null,
    category,
    tempSegmentId,
  })
  triggerSync()
  return clientEventId
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

// ── Match Events (offline-first) ─────────────────────────────────────────

export const offlineMatchEvents = {
  /**
   * Record a match event — writes to IndexedDB instantly, returns synthetic MatchEvent.
   * Background sync pushes to server.
   */
  create: async (data: {
    match_id: string
    player_id?: string
    event_type: string
    minute: number
    half: number
    x_coord?: number
    y_coord?: number
    is_home_team: boolean
    notes?: string
  }): Promise<MatchEvent> => {
    const { is_home_team, x_coord, y_coord, half, minute, ...rest } = data
    const team = is_home_team ? 'own' : 'opponent'

    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/match-events/',
      'POST',
      {
        ...rest,
        team,
        minute: Math.min(minute, 120),
        pitch_x: x_coord,
        pitch_y: y_coord,
      },
      'event',
    )

    // Store optimistic local event for instant UI display
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

    // Return synthetic MatchEvent — same shape as server response
    return {
      id: clientEventId as unknown as number, // Temp ID — replaced by server ID after sync
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
   * Quick score — same offline-first pattern
   */
  quickScore: async (data: {
    match_id: string
    player_id: string
    event_type: 'GOAL' | 'POINT'
    minute: number
    half: number
  }): Promise<MatchEvent> => {
    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/match-events/quick-score',
      'POST',
      data,
      'event',
    )

    await putLocalEvent({
      clientEventId,
      matchId: data.match_id,
      event_type: data.event_type,
      minute: data.minute,
      half: data.half,
      player_id: data.player_id,
      pitch_x: null,
      pitch_y: null,
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
      pitch_x: null,
      pitch_y: null,
      is_home_team: true,
      notes: null,
      created_at: now(),
    }
  },

  /**
   * Delete — if event hasn't synced yet, just remove from outbox.
   * Otherwise queue a server DELETE.
   */
  delete: async (eventId: string, matchId: string): Promise<void> => {
    // Check if this is a local-only event (clientEventId in outbox, never synced)
    const outboxItem = await findByClientEventId(eventId)
    if (outboxItem && outboxItem.status === 'pending' && outboxItem.id) {
      // Not yet on server — just remove from local stores
      await deleteOutboxItem(outboxItem.id)
      await deleteLocalEvent(eventId)
      return
    }

    // Already synced — queue a DELETE to server
    await enqueueAndSync(
      matchId,
      `/match-events/${eventId}`,
      'DELETE',
      {},
      'event',
    )
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
    x_coord: number
    y_coord: number
  }): Promise<PossessionEvent> => {
    const team = data.is_home_team ? 'own' : 'opponent'

    const clientEventId = await enqueueAndSync(
      data.match_id,
      '/possession-events/',
      'POST',
      {
        match_id: data.match_id,
        team,
        pitch_x: data.x_coord,
        pitch_y: data.y_coord,
        minute: Math.min(data.minute, 120),
      },
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
    waypoints: Array<{ x: number; y: number }>
  }): Promise<{ created: number }> => {
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
    // Generate a temp segment ID for the dependency chain
    const tempSegmentId = `local-${uuid()}`

    await enqueueAndSync(
      data.match_id,
      '/player-movement/carrier-segments',
      'POST',
      { ...data, client_event_id: tempSegmentId },
      'carrier',
    )

    // Return synthetic response with temp ID
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
    const realId = resolveTempId(segmentId)
    const isTemp = segmentId.startsWith('local-')

    await enqueueAndSync(
      '', // matchId not needed for endpoint
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
    const realId = resolveTempId(segmentId)
    const isTemp = segmentId.startsWith('local-')

    await enqueueAndSync(
      '', // matchId not needed
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
