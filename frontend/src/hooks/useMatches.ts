/**
 * React Query hooks for Match data management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Match } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const matchKeys = {
  all: ['matches'] as const,
  detail: (id: string) => ['matches', id] as const,
  stats: (id: string) => ['matches', id, 'stats'] as const,
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all matches
 */
export function useMatches() {
  return useQuery({
    queryKey: matchKeys.all,
    queryFn: () => api.matches.getAll(),
  });
}

/**
 * Get a single match by ID
 */
export function useMatch(matchId: string | null) {
  return useQuery({
    queryKey: matchKeys.detail(matchId!),
    queryFn: () => api.matches.getById(matchId!),
    enabled: !!matchId,
  });
}

/**
 * Get match statistics (includes events, possession, player stats)
 */
export function useMatchStats(matchId: string | null, half?: 1 | 2) {
  return useQuery({
    queryKey: [...matchKeys.stats(matchId!), half ?? 'all'],
    queryFn: () => api.matches.getStats(matchId!, half),
    enabled: !!matchId,
    refetchInterval: 60000,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new match
 */
export function useCreateMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      opponent: string;
      match_date: string;
      venue: 'home' | 'away' | 'neutral';
      notes?: string | null;
      weather_condition?: string | null;
      temperature_celsius?: number | null;
      competition?: string | null;
      referee?: string | null;
      half_duration_mins?: number;
    }) => api.matches.create(data),
    onSuccess: () => {
      // Invalidate matches list to refetch
      queryClient.invalidateQueries({ queryKey: matchKeys.all });
    },
  });
}

/**
 * Start a match
 */
export function useStartMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (matchId: string) => api.matches.start(matchId),
    onSuccess: (data) => {
      // Update the specific match in cache
      queryClient.setQueryData<Match>(matchKeys.detail(data.id), data);
      // Invalidate matches list
      queryClient.invalidateQueries({ queryKey: matchKeys.all });
    },
  });
}

/**
 * Complete a match
 */
export function useCompleteMatch() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (matchId: string) => api.matches.complete(matchId),
    onSuccess: (data) => {
      // Update the specific match in cache
      queryClient.setQueryData<Match>(matchKeys.detail(data.id), data);
      // Invalidate matches list
      queryClient.invalidateQueries({ queryKey: matchKeys.all });
    },
  });
}

/**
 * Update match phase (for resumable recording)
 */
export function useUpdateMatchPhase() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ matchId, phase, attackingRightFirstHalf }: {
      matchId: string;
      phase: string;
      attackingRightFirstHalf?: boolean;
    }) => api.matches.updatePhase(matchId, phase, attackingRightFirstHalf),
    onSuccess: (data) => {
      queryClient.setQueryData<Match>(matchKeys.detail(data.id), data);
    },
  });
}

