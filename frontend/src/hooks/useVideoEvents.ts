/**
 * React Query hooks for Video Event CRUD
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  videoEventsAPI,
  type VideoEvent,
  type VideoEventCreateData,
  type VideoEventUpdateData,
} from '../services/videoApi';
import api from '../services/api';

export const videoEventKeys = {
  all: ['videoEvents'] as const,
  bySession: (sessionId: string) => ['videoEvents', sessionId] as const,
};

type EventList = { events: VideoEvent[]; total: number };

/** Mutation key shared by every event write — lets us tell when others are still in flight. */
const WRITE_KEY = ['videoEventWrite'] as const;

/** Gateway hiccups (server briefly unreachable / restarting): the request never
 *  reached the app, so retrying is safe and invisible to the user. */
function isTransient(error: unknown): boolean {
  return /API Error: (502|503|504)\b/.test(String((error as Error)?.message ?? error));
}
const retryTransient = (failureCount: number, error: unknown) => failureCount < 4 && isTransient(error);
const retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 6000);

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
    queryFn: () => videoEventsAPI.list(sessionId!),
    enabled: !!sessionId,
  });
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

  return useMutation({
    mutationKey: WRITE_KEY,
    mutationFn: (args: { sessionId: string; data: VideoEventCreateData }) =>
      videoEventsAPI.create(args.sessionId, args.data),
    retry: retryTransient,
    retryDelay,
    onMutate: async ({ sessionId, data }) => {
      await queryClient.cancelQueries({ queryKey: videoEventKeys.bySession(sessionId) });
      const now = new Date().toISOString();
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic = {
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
      patchCache(queryClient, sessionId, events => [...events, optimistic]);
      return { tempId };
    },
    onError: (error, variables, context) => {
      console.error('Failed to create video event:', error, variables.data);
      // Save finally failed — take the optimistic event back out
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
