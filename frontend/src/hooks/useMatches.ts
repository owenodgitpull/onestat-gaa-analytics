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
  detail: (id: number) => ['matches', id] as const,
  stats: (id: number) => ['matches', id, 'stats'] as const,
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
export function useMatch(matchId: number | null) {
  return useQuery({
    queryKey: matchKeys.detail(matchId!),
    queryFn: () => api.matches.getById(matchId!),
    enabled: !!matchId,
  });
}

/**
 * Get match statistics (includes events, possession, player stats)
 */
export function useMatchStats(matchId: number | null) {
  return useQuery({
    queryKey: matchKeys.stats(matchId!),
    queryFn: () => api.matches.getStats(matchId!),
    enabled: !!matchId,
    refetchInterval: 5000, // Refresh every 5 seconds during live match
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
      venue: string;
      is_home: boolean;
      competition?: string;
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
    mutationFn: (matchId: number) => api.matches.start(matchId),
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
    mutationFn: (matchId: number) => api.matches.complete(matchId),
    onSuccess: (data) => {
      // Update the specific match in cache
      queryClient.setQueryData<Match>(matchKeys.detail(data.id), data);
      // Invalidate matches list
      queryClient.invalidateQueries({ queryKey: matchKeys.all });
    },
  });
}

