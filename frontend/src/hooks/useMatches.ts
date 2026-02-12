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
export function useMatchStats(matchId: string | null) {
  return useQuery({
    queryKey: matchKeys.stats(matchId!),
    queryFn: () => api.matches.getStats(matchId!),
    enabled: !!matchId,
    refetchInterval: 60000, // Refresh every 60 seconds for possession updates
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

