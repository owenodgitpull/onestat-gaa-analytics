/**
 * React Query hooks for Match data management
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api } from '../services/api';
import type { Match, MatchStats } from '../types';

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
 * Get match statistics.
 * live=true: SSE stream (server pushes every 5s) — for active recording.
 * live=false (default): one-time REST fetch — for completed match views.
 */
export function useMatchStats(matchId: string | null, half?: 1 | 2, live = false) {
  const [streamData, setStreamData] = useState<MatchStats | null>(null)
  const [streamLoading, setStreamLoading] = useState(true)
  const esRef = useRef<EventSource | null>(null)

  // SSE path — only used when live=true
  useEffect(() => {
    if (!live || !matchId) return

    const baseUrl = import.meta.env.VITE_API_URL || '/api/v1'
    const url = `${baseUrl}/matches/${matchId}/stats/stream${half ? `?half=${half}` : ''}`

    const connect = () => {
      const es = new EventSource(url, { withCredentials: true })
      esRef.current = es

      es.onmessage = (event) => {
        try {
          setStreamData(JSON.parse(event.data))
          setStreamLoading(false)
        } catch { /* ignore parse errors */ }
      }

      es.onerror = () => {
        es.close()
        esRef.current = null
        setTimeout(connect, 10000)
      }
    }

    connect()

    return () => {
      esRef.current?.close()
      esRef.current = null
    }
  }, [matchId, half, live])

  // REST path — used when live=false (completed match pages)
  const restQuery = useQuery({
    queryKey: [...matchKeys.stats(matchId!), half],
    queryFn: () => api.matches.getStats(matchId!, half),
    enabled: !live && !!matchId,
    staleTime: 1000 * 60 * 5,
  })

  if (live) {
    return { data: streamData, isLoading: streamLoading }
  }
  return { data: restQuery.data ?? null, isLoading: restQuery.isLoading }
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

