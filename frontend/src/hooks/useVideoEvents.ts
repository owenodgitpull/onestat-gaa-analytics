/**
 * React Query hooks for Video Event CRUD
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  videoEventsAPI,
  type VideoEventCreateData,
  type VideoEventUpdateData,
} from '../services/videoApi';
import api from '../services/api';

export const videoEventKeys = {
  all: ['videoEvents'] as const,
  bySession: (sessionId: string) => ['videoEvents', sessionId] as const,
};

/** List events for a video session. */
export function useVideoEvents(sessionId: string | null) {
  return useQuery({
    queryKey: videoEventKeys.bySession(sessionId!),
    queryFn: () => videoEventsAPI.list(sessionId!),
    enabled: !!sessionId,
  });
}

/** Create a single video event. */
export function useCreateVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { sessionId: string; data: VideoEventCreateData }) =>
      videoEventsAPI.create(args.sessionId, args.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(variables.sessionId),
      });
    },
  });
}

/** Update a video event. */
export function useUpdateVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; sessionId: string; data: VideoEventUpdateData }) =>
      videoEventsAPI.update(args.eventId, args.data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(variables.sessionId),
      });
    },
  });
}

/** Delete a video event. */
export function useDeleteVideoEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (args: { eventId: string; sessionId: string }) =>
      videoEventsAPI.delete(args.eventId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: videoEventKeys.bySession(variables.sessionId),
      });
    },
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
