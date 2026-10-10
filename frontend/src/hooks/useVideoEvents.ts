/**
 * React Query hooks for Video Event CRUD
 */

import { useEffect, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  videoEventsAPI,
  type VideoEvent,
  type VideoEventCreateData,
  type VideoEventUpdateData,
} from '../services/videoApi';
import api from '../services/api';
import { writeQueue } from '../services/videoWriteQueue';

export const videoEventKeys = {
  all: ['videoEvents'] as const,
  bySession: (sessionId: string) => ['videoEvents', sessionId] as const,
};

type EventList = { events: VideoEvent[]; total: number };

/** Mutation key shared by every event write — lets us tell when others are still in flight. */
const WRITE_KEY = ['videoEventWrite'] as const;

/** A failure that is not the event's fault: no response at all (network / timeout), a gateway or server error (5xx),
 *  request-timeout or rate-limit. Re-sending later is safe (saves are idempotent). A 4xx rejection is not retryable. */
function isRetryable(error: unknown): boolean {
  const status = (error as { status?: number } | null)?.status;
  return status === undefined || status >= 500 || status === 408 || status === 429;
}
const retryQuick = (failureCount: number, error: unknown) => failureCount < 2 && isRetryable(error);
/** Update / delete: unchanged behaviour — only gateway hiccups are retried, then the change is rolled back. */
const retryTransient = (failureCount: number, error: unknown) =>
  failureCount < 4 && /API Error: (502|503|504)/.test(String((error as Error)?.message ?? error));
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 6000);
/** Idempotency key per create call (keyed by the mutation's args object, which is stable across its retries). */
const clientIds = new WeakMap<object, string>();

/** Called when a QUEUED event is finally rejected by the server (so the user is told, once). */
let rejectHandler: ((error: Error, data: VideoEventCreateData) => void) | undefined;

// ── Background drain of the durable queue (events that could not be saved yet) ──
let drainTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;
let drainDelay = 3000;

function scheduleDrain(queryClient: ReturnType<typeof useQueryClient>, delay = drainDelay) {
  if (drainTimer || writeQueue.all().length === 0) return;
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drainQueue(queryClient);
  }, delay);
}

async function drainQueue(queryClient: ReturnType<typeof useQueryClient>) {
  if (draining) return;
  draining = true;
  const touched = new Set<string>();
  try {
    for (const item of writeQueue.all()) {   // oldest first
      try {
        await videoEventsAPI.create(item.sessionId, { ...item.data, client_event_id: item.clientEventId });
        writeQueue.remove(item.clientEventId);
        touched.add(item.sessionId);
        drainDelay = 3000;
      } catch (err) {
        if (isRetryable(err)) {
          drainDelay = Math.min(drainDelay * 2, 30000);
          return;                               // server still unwell — keep everything, try again later
        }
        writeQueue.remove(item.clientEventId);  // the server rejected this one: it will never save
        touched.add(item.sessionId);
        rejectHandler?.(err as Error, item.data);
      }
    }
  } finally {
    draining = false;
    touched.forEach(id => queryClient.invalidateQueries({ queryKey: videoEventKeys.bySession(id) }));
    scheduleDrain(queryClient);
  }
}

/** Number of this session's events saved locally but not yet on the server (drives the "saving…" pill). */
export function usePendingVideoWrites(sessionId: string | null): number {
  return useSyncExternalStore(writeQueue.subscribe, () => (sessionId ? writeQueue.count(sessionId) : 0));
}

/** Apply a change to the cached event list immediately (optimistic UI). */
function patchCache(
  queryClient: ReturnType<typeof useQueryClient>,
  sessionId: string,
  fn: (events: VideoEvent[]) => VideoEvent[],
) {
  queryClient.setQueryData<EventList>(videoEventKeys.bySession(sessionId), old => {
    const events = fn(old?.events ?? []);
    return { events, total: events.length };
  });
}

/** Only refetch once the last in-flight write settles — an earlier refetch would
 *  return server state that doesn't have the still-saving events yet and make
 *  them (and the scoreline) flicker. */
function settle(queryClient: ReturnType<typeof useQueryClient>, sessionId: string) {
  if (queryClient.isMutating({ mutationKey: WRITE_KEY }) <= 1) {
    queryClient.invalidateQueries({ queryKey: videoEventKeys.bySession(sessionId) });
  }
}

/** List events for a video session. */
export function useVideoEvents(sessionId: string | null) {
  return useQuery({
    queryKey: videoEventKeys.bySession(sessionId!),
    queryFn: async () => {
      const list = await videoEventsAPI.list(sessionId!);
      // Events still waiting to be saved stay on screen (and in the scoreline) across refetches and reloads
      const waiting = writeQueue.forSession(sessionId!);
      if (!waiting.length) return list;
      const events = [...list.events, ...waiting.map(w => buildOptimistic(sessionId!, w.data, w.tempId))];
      return { events, total: events.length };
    },
    enabled: !!sessionId,
  });
}

/** The on-screen stand-in for an event that is saved (or waiting to be saved) in the background. */
function buildOptimistic(sessionId: string, data: VideoEventCreateData, tempId: string): VideoEvent {
  const now = new Date().toISOString();
  return {
        id: tempId,
        video_session_id: sessionId,
        match_id: '',
        event_type: data.event_type,
        sub_type: data.sub_type ?? null,
        team: data.team,
        half: data.half,
        match_minute: data.match_minute,
        match_second: data.match_second ?? 0,
        video_timestamp_ms: data.video_timestamp_ms ?? null,
        pitch_zone: data.pitch_zone ?? null,
        pitch_x: data.pitch_x ?? null,
        pitch_y: data.pitch_y ?? null,
        player_id: data.player_id ?? null,
        player_name: null,
        sub_in_player_id: data.sub_in_player_id ?? null,
        sub_in_player_name: null,
        assist_player_id: data.assist_player_id ?? null,
        assist_player_name: null,
        jersey_number: data.jersey_number ?? null,
        player_confidence: data.player_confidence ?? null,
        event_confidence: data.event_confidence ?? null,
        scoring_context: data.scoring_context ?? null,
        kickout_context: data.kickout_context ?? null,
        possession_chain_id: null,
        possession_team: data.possession_team ?? null,
        description: data.description ?? null,
        opponent_player_name: data.opponent_player_name ?? null,
        source: data.source ?? 'human_tag',
        is_verified: (data.source ?? 'human_tag') === 'human_tag',
        created_at: now,
        updated_at: now,
  } as VideoEvent;
}

/** Create a single video event. The event appears (and the scoreline moves)
 *  instantly; it's saved in the background with retries, and only removed again
 *  if the save finally fails. */
export function useCreateVideoEvent(opts?: {
  /** Called when the server rejects/fails an event — without it a rejected
   *  event (e.g. a 422 on an unknown type) just silently never appears. */
  onError?: (error: Error, data: VideoEventCreateData) => void;
}) {
  const queryClient = useQueryClient();
  rejectHandler = opts?.onError;

  // Resume anything left in the queue (e.g. after a refresh) and re-try as soon as the connection is back
  useEffect(() => {
    const kick = () => scheduleDrain(queryClient, 0);
    kick();
    window.addEventListener('online', kick);
    return () => window.removeEventListener('online', kick);
  }, [queryClient]);

  return useMutation({
    mutationKey: WRITE_KEY,
    // One idempotency key per tap, stable across this mutation's retries (the args object is the same each time)
    mutationFn: (args: { sessionId: string; data: VideoEventCreateData }) => {
      let id = clientIds.get(args);
      if (!id) { id = crypto.randomUUID(); clientIds.set(args, id); }
      return videoEventsAPI.create(args.sessionId, { ...args.data, client_event_id: id });
    },
    retry: retryQuick,
    retryDelay,
    onMutate: async ({ sessionId, data }) => {
      await queryClient.cancelQueries({ queryKey: videoEventKeys.bySession(sessionId) });
      const tempId = `temp-${crypto.randomUUID()}`;
      patchCache(queryClient, sessionId, events => [...events, buildOptimistic(sessionId, data, tempId)]);
      return { tempId };
    },
    onError: (error, variables, context) => {
      console.error('Failed to create video event:', error, variables.data);
      const clientId = clientIds.get(variables);
      if (isRetryable(error) && clientId && context?.tempId) {
        // Not the event's fault (server/network): keep it on screen and keep trying until it saves
        writeQueue.add({ clientEventId: clientId, sessionId: variables.sessionId, data: variables.data, tempId: context.tempId, queuedAt: Date.now() });
        scheduleDrain(queryClient);
        return;
      }
      // The server rejected this event — take it back off the screen and tell the user
      if (context?.tempId) {
        patchCache(queryClient, variables.sessionId, events => events.filter(e => e.id !== context.tempId));
      }
      opts?.onError?.(error as Error, variables.data);
    },
    onSettled: (_data, _error, variables) => settle(queryClient, variables.sessionId),
  });
}

/** Update a video event — the change shows instantly, saved in the background. */
export function useUpdateVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: WRITE_KEY,
    mutationFn: (args: { eventId: string; sessionId: string; data: VideoEventUpdateData }) =>
      videoEventsAPI.update(args.eventId, args.data),
    retry: retryTransient,
    retryDelay,
    onMutate: async ({ eventId, sessionId, data }) => {
      await queryClient.cancelQueries({ queryKey: videoEventKeys.bySession(sessionId) });
      const previous = queryClient.getQueryData<EventList>(videoEventKeys.bySession(sessionId));
      patchCache(queryClient, sessionId, events =>
        events.map(e => (e.id === eventId ? ({ ...e, ...data } as VideoEvent) : e)),
      );
      return { previous };
    },
    onError: (error, variables, context) => {
      console.error('Failed to update video event:', error);
      if (context?.previous) {
        queryClient.setQueryData(videoEventKeys.bySession(variables.sessionId), context.previous);
      }
    },
    onSettled: (_data, _error, variables) => settle(queryClient, variables.sessionId),
  });
}

/** Delete a video event — it disappears instantly, saved in the background. */
export function useDeleteVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: WRITE_KEY,
    mutationFn: (args: { eventId: string; sessionId: string }) =>
      videoEventsAPI.delete(args.eventId),
    retry: retryTransient,
    retryDelay,
    onMutate: async ({ eventId, sessionId }) => {
      await queryClient.cancelQueries({ queryKey: videoEventKeys.bySession(sessionId) });
      const previous = queryClient.getQueryData<EventList>(videoEventKeys.bySession(sessionId));
      patchCache(queryClient, sessionId, events => events.filter(e => e.id !== eventId));
      return { previous };
    },
    onError: (error, variables, context) => {
      console.error('Failed to delete video event:', error);
      if (context?.previous) {
        queryClient.setQueryData(videoEventKeys.bySession(variables.sessionId), context.previous);
      }
    },
    onSettled: (_data, _error, variables) => settle(queryClient, variables.sessionId),
  });
}

/** Verify a video event. */
export function useVerifyVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; sessionId: string }) =>
      videoEventsAPI.verify(args.eventId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(variables.sessionId),
      });
    },
  });
}

/** Sync verified events to MatchEvent table (legacy). */
export function useSyncVideoEvents() {
  return useMutation({
    mutationFn: (sessionId: string) => videoEventsAPI.syncToMatch(sessionId),
  });
}

/** Preview sync deduplication. */
export function useSyncPreview() {
  return useMutation({
    mutationFn: (sessionId: string) => videoEventsAPI.syncPreview(sessionId),
  });
}

/** Confirm sync + trigger AI re-analysis. */
export function useSyncConfirm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) => videoEventsAPI.syncConfirm(sessionId),
    onSuccess: (_, sessionId) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(sessionId),
      });
    },
  });
}

/** Delete all video events after a timestamp (for undo-to-point). */
export function useDeleteVideoEventsAfter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { sessionId: string; timestampMs: number }) =>
      videoEventsAPI.deleteAfter(args.sessionId, args.timestampMs),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(variables.sessionId),
      });
    },
  });
}

/** Delete all ball carrier segments after a timestamp (for undo-to-point). */
export function useDeleteCarrierSegmentsAfter() {
  return useMutation({
    mutationFn: (args: { matchId: string; timestampMs: number }) =>
      api.playerMovement.deleteCarrierSegmentsAfter(args.matchId, args.timestampMs),
  });
}
