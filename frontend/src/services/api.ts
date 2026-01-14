/**
 * API Service Layer
 * Handles all communication with the FastAPI backend
 */

import type { 
  Match, 
  Player, 
  MatchEvent, 
  PossessionEvent,
  PlayerMatchStats 
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1';

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generic fetch wrapper with error handling
 */
async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || `API Error: ${response.status} ${response.statusText}`
      );
    }

    return await response.json();
  } catch (error) {
    console.error(`API call failed: ${endpoint}`, error);
    throw error;
  }
}

// ============================================================================
// Player API
// ============================================================================

export const playersAPI = {
  /**
   * Get all players
   */
  getAll: async (): Promise<Player[]> => {
    return fetchAPI<Player[]>('/players/?limit=100');
  },

  /**
   * Get a single player by ID
   */
  getById: async (id: number): Promise<Player> => {
    return fetchAPI<Player>(`/players/${id}`);
  },

  /**
   * Create a new player
   */
  create: async (player: Omit<Player, 'id' | 'created_at' | 'updated_at'>): Promise<Player> => {
    return fetchAPI<Player>('/players/', {
      method: 'POST',
      body: JSON.stringify(player),
    });
  },

  /**
   * Update a player
   */
  update: async (id: number, player: Partial<Player>): Promise<Player> => {
    return fetchAPI<Player>(`/players/${id}`, {
      method: 'PUT',
      body: JSON.stringify(player),
    });
  },
};

// ============================================================================
// Match API
// ============================================================================

export const matchesAPI = {
  /**
   * Get all matches
   */
  getAll: async (): Promise<Match[]> => {
    return fetchAPI<Match[]>('/matches/');
  },

  /**
   * Get a single match by ID
   */
  getById: async (id: number): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${id}`);
  },

  /**
   * Create a new match
   */
  create: async (match: {
    opponent: string;
    match_date: string;
    venue: 'home' | 'away' | 'neutral';
    notes?: string | null;
  }): Promise<Match> => {
    return fetchAPI<Match>('/matches/', {
      method: 'POST',
      body: JSON.stringify(match),
    });
  },

  /**
   * Start a match (updates status to 'in_progress')
   */
  start: async (matchId: number): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/start`, {
      method: 'POST',
    });
  },

  /**
   * Complete a match (updates status to 'completed')
   */
  complete: async (matchId: number): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/complete`, {
      method: 'POST',
    });
  },

  /**
   * Get match statistics
   */
  getStats: async (matchId: number): Promise<{
    match: Match;
    events: MatchEvent[];
    possession_events: PossessionEvent[];
    player_stats: PlayerMatchStats[];
  }> => {
    return fetchAPI(`/matches/${matchId}/stats`);
  },
};

// ============================================================================
// Match Event API
// ============================================================================

export const matchEventsAPI = {
  /**
   * Record a match event (goal, point, turnover, etc.)
   */
  create: async (event: {
    match_id: number;
    player_id?: number;
    event_type: string;
    minute: number;
    half: number;
    x_coord?: number;
    y_coord?: number;
    is_home_team: boolean;
    notes?: string;
  }): Promise<MatchEvent> => {
    return fetchAPI<MatchEvent>('/match-events/', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  /**
   * Quick score recording (simplified endpoint)
   */
  quickScore: async (data: {
    match_id: number;
    player_id: number;
    event_type: 'GOAL' | 'POINT';
    minute: number;
    half: number;
  }): Promise<MatchEvent> => {
    return fetchAPI<MatchEvent>('/match-events/quick-score', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Get all events for a match
   */
  getByMatch: async (matchId: number): Promise<MatchEvent[]> => {
    return fetchAPI<MatchEvent[]>(`/match-events/?match_id=${matchId}`);
  },
};

// ============================================================================
// Possession Event API
// ============================================================================

export const possessionAPI = {
  /**
   * Record a possession event
   */
  create: async (event: {
    match_id: number;
    minute: number;
    half: number;
    is_home_team: boolean;
    x_coord: number;
    y_coord: number;
  }): Promise<PossessionEvent> => {
    return fetchAPI<PossessionEvent>('/possession-events/', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  },

  /**
   * Get all possession events for a match
   */
  getByMatch: async (matchId: number): Promise<PossessionEvent[]> => {
    return fetchAPI<PossessionEvent[]>(`/possession-events/?match_id=${matchId}`);
  },
};

// ============================================================================
// Combined Exports
// ============================================================================

export const api = {
  players: playersAPI,
  matches: matchesAPI,
  matchEvents: matchEventsAPI,
  possession: possessionAPI,
};

export default api;

