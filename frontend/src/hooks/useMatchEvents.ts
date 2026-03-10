/**
 * React Query hooks for Match Events and Possession.
 *
 * All mutations route through the offline-first API layer (IndexedDB → background sync).
 * Queries still hit the server but fall back gracefully when offline.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import { offlineMatchEvents, offlinePossession } from '../services/offline';
import { matchKeys } from './useMatches';

// ============================================================================
// Query Keys
// ============================================================================

export const matchEventKeys = {
  all: ['match-events'] as const,
  byMatch: (matchId: string) => ['match-events', 'match', matchId] as const,
};

export const possessionKeys = {
  all: ['possession'] as const,
  byMatch: (matchId: string) => ['possession', 'match', matchId] as const,
};

// ============================================================================
// Match Event Queries
// ============================================================================

/**
 * Get all match events for a specific match.
 * Server-first; errors are swallowed when offline (stale data stays).
 */
export function useMatchEvents(matchId: string | null) {
  return useQuery({
    queryKey: matchEventKeys.byMatch(matchId!),
    queryFn: () => api.matchEvents.getByMatch(matchId!),
    enabled: !!matchId,
    refetchInterval: 0,
    // Keep stale data when offline — don't clear cache on error
    retry: (failureCount, error) => {
      // Don't retry network errors (offline) — just keep stale data
      if (error instanceof TypeError && error.message === 'Failed to fetch') return false
      return failureCount < 1
    },
  });
}

// ============================================================================
// Match Event Mutations — OFFLINE-FIRST
// ============================================================================

/**
 * Record a match event — writes to IndexedDB instantly, syncs in background.
 * UI never blocks on network. Returns synthetic MatchEvent immediately.
 */
export function useRecordEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: string;
      player_id?: string;
      event_type: string;
      minute: number;
      half: number;
      x_coord?: number;
      y_coord?: number;
      is_home_team: boolean;
      notes?: string;
    }) => offlineMatchEvents.create(data),
    onSuccess: (result, variables) => {
      // Optimistically add the event to the cache (no refetch needed)
      queryClient.setQueryData(
        matchEventKeys.byMatch(variables.match_id),
        (old: { events: unknown[]; total: number; page: number; page_size: number } | undefined) => {
          if (!old) return old
          return {
            ...old,
            events: [...old.events, result],
            total: old.total + 1,
          }
        },
      )

      // Invalidate stats (these are computed server-side, will refetch when online)
      queryClient.invalidateQueries({
        queryKey: matchKeys.stats(variables.match_id)
      });
      queryClient.invalidateQueries({
        queryKey: matchKeys.detail(variables.match_id)
      });
    },
  });
}

/**
 * Quick score recording — offline-first
 */
export function useQuickScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: string;
      player_id: string;
      event_type: 'GOAL' | 'POINT';
      minute: number;
      half: number;
    }) => offlineMatchEvents.quickScore(data),
    onSuccess: (result, variables) => {
      queryClient.setQueryData(
        matchEventKeys.byMatch(variables.match_id),
        (old: { events: unknown[]; total: number; page: number; page_size: number } | undefined) => {
          if (!old) return old
          return {
            ...old,
            events: [...old.events, result],
            total: old.total + 1,
          }
        },
      )
      queryClient.invalidateQueries({ queryKey: matchKeys.stats(variables.match_id) });
      queryClient.invalidateQueries({ queryKey: matchKeys.detail(variables.match_id) });
    },
  });
}

/**
 * Delete a match event — handles both local-only and synced events.
 */
export function useDeleteEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { eventId: string; matchId: string }) =>
      offlineMatchEvents.delete(data.eventId, data.matchId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: matchEventKeys.byMatch(variables.matchId)
      });
      queryClient.invalidateQueries({
        queryKey: matchKeys.stats(variables.matchId)
      });
      queryClient.invalidateQueries({
        queryKey: matchKeys.detail(variables.matchId)
      });
    },
  });
}

// ============================================================================
// Possession Queries
// ============================================================================

/**
 * Get all possession events for a match — with offline tolerance.
 */
export function usePossessionEvents(matchId: string | null) {
  return useQuery({
    queryKey: possessionKeys.byMatch(matchId!),
    queryFn: () => api.possession.getByMatch(matchId!),
    enabled: !!matchId,
    refetchInterval: 5000,
    retry: (failureCount, error) => {
      if (error instanceof TypeError && error.message === 'Failed to fetch') return false
      return failureCount < 1
    },
  });
}

// ============================================================================
// Possession Mutations — OFFLINE-FIRST
// ============================================================================

/**
 * Record a possession event — offline-first.
 */
export function useRecordPossession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: string;
      minute: number;
      half: number;
      is_home_team: boolean;
      x_coord: number;
      y_coord: number;
    }) => offlinePossession.create(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: possessionKeys.byMatch(variables.match_id)
      });
      queryClient.invalidateQueries({
        queryKey: matchKeys.stats(variables.match_id)
      });
    },
  });
}
