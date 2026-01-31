/**
 * React Query hooks for Player data management
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../services/api';
import type { Player } from '../types';

// ============================================================================
// Query Keys
// ============================================================================

export const playerKeys = {
  all: ['players'] as const,
  detail: (id: string) => ['players', id] as const,
};

// ============================================================================
// Queries
// ============================================================================

/**
 * Get all players
 */
export function usePlayers() {
  return useQuery({
    queryKey: playerKeys.all,
    queryFn: () => api.players.getAll(),
    staleTime: 1000 * 60 * 5, // Consider data fresh for 5 minutes
  });
}

/**
 * Get a single player by ID
 */
export function usePlayer(playerId: string | null) {
  return useQuery({
    queryKey: playerKeys.detail(playerId!),
    queryFn: () => api.players.getById(playerId!),
    enabled: !!playerId,
  });
}

// ============================================================================
// Mutations
// ============================================================================

/**
 * Create a new player
 */
export function useCreatePlayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: Omit<Player, 'id' | 'created_at' | 'updated_at'>) => 
      api.players.create(data),
    onSuccess: () => {
      // Invalidate players list to refetch
      queryClient.invalidateQueries({ queryKey: playerKeys.all });
    },
  });
}

/**
 * Update a player
 */
export function useUpdatePlayer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Player> }) =>
      api.players.update(id, data),
    onSuccess: (data) => {
      // Update the specific player in cache
      queryClient.setQueryData<Player>(playerKeys.detail(data.id), data);
      // Invalidate players list
      queryClient.invalidateQueries({ queryKey: playerKeys.all });
    },
  });
}

