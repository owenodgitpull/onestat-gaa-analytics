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
  summary: (matchId: string) => ['possession-summary', matchId] as const,
};

/**
 * Possession totals (time split, counts, spells) from one cheap server-side
 * aggregate — what the stats panels need. Shared key, so every panel on the
 * page reuses a single request. Live Recording refreshes on a slow timer;
 * Video Tagging also invalidates this key whenever it saves a possession batch.
 */
export function usePossessionSummary(matchId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: possessionKeys.summary(matchId!),
    queryFn: () => api.possession.summary(matchId!),
    enabled: !!matchId && enabled,
    staleTime: 10_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: (failureCount, error) => {
      if (error instanceof TypeError && error.message === 'Failed to fetch') return false
      return failureCount < 1
    },
  });
}

// ============================================================================
// Match Event Queries
// ============================================================================

/**
 * Get all match events for a specific match.
 * Server-first; errors are swallowed when offline (stale data stays).
 */
/**
 * Pass `live: true` while actively recording. The events list only ever
 * updates via the optimistic setQueryData appended by useRecordEvent's
 * onSuccess — there's no periodic refetch (refetchInterval: 0) and it
 * inherits the app-wide 60s staleTime, so if that optimistic append is ever
 * skipped or overwritten by an in-flight fetch racing behind it, an event
 * that's genuinely saved server-side can be permanently missing from the
 * local list — the event map and events panel just never show it, on any
 * filter, until a hard refresh. Confirmed live on a match where a
 * turnover_lost was correctly saved (right coordinates, right team) but
 * never appeared under any Event Map filter combination. Same class of bug
 * as the scoreboard drift fixed earlier — see useMatch's `live` option.
 */
export function useMatchEvents(matchId: string | null, opts?: { live?: boolean }) {
  const live = opts?.live ?? false
  return useQuery({
    queryKey: matchEventKeys.byMatch(matchId!),
    queryFn: () => api.matchEvents.getByMatch(matchId!),
    enabled: !!matchId,
    ...(live
      ? { staleTime: 0, refetchInterval: 20_000, refetchOnWindowFocus: true, refetchOnMount: 'always' as const }
      : { refetchInterval: 0 }),
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
      kickout_target_player_id?: string;
      sub_in_player_id?: string;
      event_type: string;
      minute: number;
      half: number;
      x_coord?: number;
      y_coord?: number;
      /** Long kick pass / high ball landing spot (x_coord/y_coord = kicked from) */
      end_x?: number;
      end_y?: number;
      is_home_team: boolean;
      notes?: string;
      opponent_player_name?: string;
      sub_type?: string;
      opposition_player_id?: string;
      opposition_sub_in_player_id?: string;
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

      // Optimistically update match score in cache (server sync is async)
      const et = variables.event_type
      const isOwn = variables.is_home_team
      const goalTypes = ['goal', 'penalty_goal']
      const pointTypes = ['point', 'point_free', 'forty_five']
      const twoPointTypes = ['two_point', 'two_point_free']
      const isGoal = goalTypes.includes(et)
      const isPoint = pointTypes.includes(et)
      const isTwoPoint = twoPointTypes.includes(et)

      if (isGoal || isPoint || isTwoPoint) {
        queryClient.setQueryData(
          matchKeys.detail(variables.match_id),
          (old: any) => {
            if (!old) return old
            const updated = { ...old }
            if (isOwn) {
              if (isGoal) updated.team_goals = (updated.team_goals || 0) + 1
              else if (isTwoPoint) updated.team_points = (updated.team_points || 0) + 2
              else updated.team_points = (updated.team_points || 0) + 1
            } else {
              if (isGoal) updated.opponent_goals = (updated.opponent_goals || 0) + 1
              else if (isTwoPoint) updated.opponent_points = (updated.opponent_points || 0) + 2
              else updated.opponent_points = (updated.opponent_points || 0) + 1
            }
            return updated
          },
        )
      }

      // Stats refresh on their own 60s interval — no need to invalidate on every event
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
    onMutate: (variables) => {
      // Capture the event BEFORE deletion for score adjustment
      const cached = queryClient.getQueryData<{ events: any[] }>(
        matchEventKeys.byMatch(variables.matchId)
      )
      const deletedEvent = cached?.events?.find((e: any) => String(e.id) === variables.eventId)
      return { deletedEvent }
    },
    onSuccess: (_, variables, context) => {
      // Optimistically remove the single event from cache instead of refetching.
      // Refetching would lose unsynced events (the server may not have them yet).
      queryClient.setQueryData(
        matchEventKeys.byMatch(variables.matchId),
        (old: { events: any[]; total: number; page: number; page_size: number } | undefined) => {
          if (!old) return old
          const filtered = old.events.filter((e: any) => String(e.id) !== variables.eventId)
          return { ...old, events: filtered, total: filtered.length }
        },
      )

      // Optimistically update match score (subtract the deleted event's score)
      const deletedEvent = context?.deletedEvent
      if (deletedEvent) {
        const et = deletedEvent.event_type
        const isOwn = deletedEvent.is_home_team
        const goalTypes = ['goal', 'penalty_goal']
        const pointTypes = ['point', 'point_free', 'forty_five']
        const twoPointTypes = ['two_point', 'two_point_free']
        const isGoal = goalTypes.includes(et)
        const isPoint = pointTypes.includes(et)
        const isTwoPoint = twoPointTypes.includes(et)

        if (isGoal || isPoint || isTwoPoint) {
          queryClient.setQueryData(
            matchKeys.detail(variables.matchId),
            (old: any) => {
              if (!old) return old
              const updated = { ...old }
              if (isOwn) {
                if (isGoal) updated.team_goals = Math.max(0, (updated.team_goals || 0) - 1)
                else if (isTwoPoint) updated.team_points = Math.max(0, (updated.team_points || 0) - 2)
                else updated.team_points = Math.max(0, (updated.team_points || 0) - 1)
              } else {
                if (isGoal) updated.opponent_goals = Math.max(0, (updated.opponent_goals || 0) - 1)
                else if (isTwoPoint) updated.opponent_points = Math.max(0, (updated.opponent_points || 0) - 2)
                else updated.opponent_points = Math.max(0, (updated.opponent_points || 0) - 1)
              }
              return updated
            },
          )
        }
      }
    },
  });
}

// ============================================================================
// Possession Queries
// ============================================================================

/**
 * Get all possession events for a match — with offline tolerance.
 * No auto-poll: possession data is written locally (offline-first) so there
 * is no benefit in re-fetching thousands of rows from the server every few
 * seconds during a live match.
 */
export function usePossessionEvents(matchId: string | null) {
  return useQuery({
    queryKey: possessionKeys.byMatch(matchId!),
    queryFn: () => api.possession.getByMatch(matchId!),
    enabled: !!matchId,
    refetchInterval: 0,
    staleTime: 30_000,
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
 * No cache invalidation on success: possession data lives in IndexedDB and
 * the server-side query (5000 rows) should not be re-fetched on every tick.
 * Stats are not affected by possession ticks; they refresh on their own interval.
 */
export function useRecordPossession() {
  return useMutation({
    mutationFn: (data: {
      match_id: string;
      minute: number;
      half: number;
      is_home_team: boolean;
      x_coord: number;
      y_coord: number;
    }) => offlinePossession.create(data),
  });
}
