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
    const response = await fetchAPI<{ players: Player[]; total: number; page: number; page_size: number }>('/players/?limit=100');
    return response.players; // Extract just the players array
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
  getById: async (id: string): Promise<Match> => {
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
  start: async (matchId: string): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/start`, {
      method: 'POST',
      body: JSON.stringify({
        started_at: new Date().toISOString()
      })
    });
  },

  /**
   * Complete a match (updates status to 'completed')
   */
  complete: async (matchId: string): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/complete`, {
      method: 'POST',
      body: JSON.stringify({
        completed_at: new Date().toISOString()
      })
    });
  },

  /**
   * Get match statistics
   */
  getStats: async (matchId: string): Promise<MatchStats> => {
    return fetchAPI<MatchStats>(`/matches/${matchId}/stats`);
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
    match_id: string; // UUID
    player_id?: string; // UUID
    event_type: string;
    minute: number;
    half: number;
    x_coord?: number;
    y_coord?: number;
    is_home_team: boolean;
    notes?: string;
  }): Promise<MatchEvent> => {
    // Convert is_home_team to team field and x_coord/y_coord to pitch_x/pitch_y
    const { is_home_team, x_coord, y_coord, ...rest } = event;

    return fetchAPI<MatchEvent>('/match-events/', {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        team: is_home_team ? 'dungloe' : 'opponent',
        pitch_x: x_coord,
        pitch_y: y_coord
      }),
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
  getByMatch: async (matchId: string): Promise<{ events: MatchEvent[], total: number, page: number, page_size: number }> => {
    return fetchAPI<{ events: MatchEvent[], total: number, page: number, page_size: number }>(`/match-events/match/${matchId}`);
  },

  /**
   * Delete a match event
   */
  delete: async (eventId: string): Promise<void> => {
    return fetchAPI<void>(`/match-events/${eventId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Update a match event
   */
  update: async (eventId: string, data: Partial<{
    event_type: string;
    minute: number;
    half: number;
    player_id: string | null;
    x_coord: number | null;
    y_coord: number | null;
    notes: string | null;
  }>): Promise<MatchEvent> => {
    // Transform x_coord/y_coord to pitch_x/pitch_y for backend
    const { x_coord, y_coord, ...rest } = data;
    return fetchAPI<MatchEvent>(`/match-events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify({
        ...rest,
        pitch_x: x_coord,
        pitch_y: y_coord
      }),
    });
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
    match_id: string; // UUID
    minute: number;
    half: number;
    is_home_team: boolean;
    x_coord: number;
    y_coord: number;
  }): Promise<PossessionEvent> => {
    // Convert is_home_team to team field expected by backend
    const { is_home_team, half, ...rest } = event;
    return fetchAPI<PossessionEvent>('/possession-events/', {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        team: is_home_team ? 'dungloe' : 'opponent',
        pitch_x: rest.x_coord,
        pitch_y: rest.y_coord
      }),
    });
  },

  /**
   * Get all possession events for a match
   */
  getByMatch: async (matchId: string): Promise<PossessionEvent[]> => {
    return fetchAPI<PossessionEvent[]>(`/possession-events/?match_id=${matchId}`);
  },
};

// ============================================================================
// Match Lineups API
// ============================================================================

interface MatchLineupEntry {
  player_id: string;
  position_id: string;
  is_substitute: boolean;
}

interface MatchLineupResponse {
  id: string;
  match_id: string;
  player_id: string;
  position_id: string;
  is_substitute: boolean;
  is_on_field: boolean;
  player_name: string;
  player_jersey_number: number | null;
}

const matchLineupsAPI = {
  /**
   * Save lineup for a match
   */
  saveLineup: async (matchId: string, lineup: MatchLineupEntry[]): Promise<MatchLineupResponse[]> => {
    return fetchAPI<MatchLineupResponse[]>(`/match-lineups/matches/${matchId}/lineup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lineup),
    });
  },

  /**
   * Get lineup for a match
   */
  getLineup: async (matchId: string): Promise<MatchLineupResponse[]> => {
    return fetchAPI<MatchLineupResponse[]>(`/match-lineups/matches/${matchId}/lineup`);
  },

  /**
   * Update player field status (for substitutions)
   */
  updateFieldStatus: async (matchId: string, playerId: string): Promise<{ message: string; is_on_field: boolean }> => {
    return fetchAPI<{ message: string; is_on_field: boolean }>(`/match-lineups/matches/${matchId}/lineup/${playerId}/substitute`, {
      method: 'PATCH',
    });
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
  matchLineups: matchLineupsAPI,
};

export default api;

