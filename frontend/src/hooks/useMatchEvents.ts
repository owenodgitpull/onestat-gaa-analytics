/**
 * React Query hooks for Match Events and Possession
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { MatchEvent, PossessionEvent } from '../types';
import { matchKeys } from './useMatches';

// ============================================================================
// Query Keys
// ============================================================================

export const matchEventKeys = {
  all: ['match-events'] as const,
  byMatch: (matchId: number) => ['match-events', 'match', matchId] as const,
};

export const possessionKeys = {
  all: ['possession'] as const,
  byMatch: (matchId: number) => ['possession', 'match', matchId] as const,
};

// ============================================================================
// Match Event Queries
// ============================================================================

/**
 * Get all match events for a specific match
 */
export function useMatchEvents(matchId: number | null) {
  return useQuery({
    queryKey: matchEventKeys.byMatch(matchId!),
    queryFn: () => api.matchEvents.getByMatch(matchId!),
    enabled: !!matchId,
    refetchInterval: 3000, // Refresh every 3 seconds during live match
  });
}

// ============================================================================
// Match Event Mutations
// ============================================================================

/**
 * Record a match event (goal, point, turnover, etc.)
 */
export function useRecordEvent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: number;
      player_id?: number;
      event_type: string;
      minute: number;
      half: number;
      x_coord?: number;
      y_coord?: number;
      is_home_team: boolean;
      notes?: string;
    }) => api.matchEvents.create(data),
    onSuccess: (data, variables) => {
      // Invalidate match events to refetch
      queryClient.invalidateQueries({ 
        queryKey: matchEventKeys.byMatch(variables.match_id) 
      });
      
      // Invalidate match stats to update score and statistics
      queryClient.invalidateQueries({ 
        queryKey: matchKeys.stats(variables.match_id) 
      });
      
      // Invalidate the match itself to update scores
      queryClient.invalidateQueries({ 
        queryKey: matchKeys.detail(variables.match_id) 
      });
    },
  });
}

/**
 * Quick score recording (simplified)
 */
export function useQuickScore() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: number;
      player_id: number;
      event_type: 'GOAL' | 'POINT';
      minute: number;
      half: number;
    }) => api.matchEvents.quickScore(data),
    onSuccess: (data, variables) => {
      // Same invalidation as regular event recording
      queryClient.invalidateQueries({ 
        queryKey: matchEventKeys.byMatch(variables.match_id) 
      });
      queryClient.invalidateQueries({ 
        queryKey: matchKeys.stats(variables.match_id) 
      });
      queryClient.invalidateQueries({ 
        queryKey: matchKeys.detail(variables.match_id) 
      });
    },
  });
}

// ============================================================================
// Possession Queries
// ============================================================================

/**
 * Get all possession events for a specific match
 */
export function usePossessionEvents(matchId: number | null) {
  return useQuery({
    queryKey: possessionKeys.byMatch(matchId!),
    queryFn: () => api.possession.getByMatch(matchId!),
    enabled: !!matchId,
    refetchInterval: 5000, // Refresh every 5 seconds
  });
}

// ============================================================================
// Possession Mutations
// ============================================================================

/**
 * Record a possession event
 */
export function useRecordPossession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      match_id: number;
      minute: number;
      half: number;
      is_home_team: boolean;
      x_coord: number;
      y_coord: number;
    }) => api.possession.create(data),
    onSuccess: (data, variables) => {
      // Invalidate possession events to refetch
      queryClient.invalidateQueries({ 
        queryKey: possessionKeys.byMatch(variables.match_id) 
      });
      
      // Invalidate match stats to update possession percentage
      queryClient.invalidateQueries({ 
        queryKey: matchKeys.stats(variables.match_id) 
      });
    },
  });
}

