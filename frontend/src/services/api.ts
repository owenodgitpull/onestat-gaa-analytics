/**
 * API Service Layer
 * Handles all communication with the FastAPI backend
 */

import type {
  Match,
  Player,
  MatchEvent,
  PossessionEvent,
  PossessionSummary,
  MatchStats,
  FixturePreview,
  FormResult,
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

/** Exported for contexts that need direct fetch (e.g. ClubContext) */
export const API_BASE = API_BASE_URL;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generic fetch wrapper with error handling.
 *
 * Authentication is handled via httpOnly cookies — no Authorization header.
 * All requests include `credentials: 'include'` so cookies are sent cross-origin.
 *
 * `timeoutMs` (optional) bounds how long we'll wait before giving up and
 * throwing — plain `fetch()` has no timeout of its own, so a slow backend
 * call (or a reverse proxy that holds the connection open instead of
 * cleanly erroring, as Vercel's edge rewrite to the Fly backend can do past
 * ~30s) would otherwise leave a caller's loading state spinning forever
 * with nothing in the console to explain why. Only pass this for endpoints
 * known to be genuinely slow (AI generation) — everything else keeps the
 * previous unbounded behavior.
 */
export async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit & { timeoutMs?: number } = {}
): Promise<T> {
  const { timeoutMs, ...fetchOptions } = options;
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  // Admin "preview as player" — attach the target player id so player-portal
  // reads resolve to them instead of the admin's own (usually absent) player
  // link. Scoped to player-portal endpoints only; harmless elsewhere since the
  // backend ignores the header outside that dependency, but no reason to send
  // it more broadly.
  if (endpoint.startsWith('/player-portal')) {
    const previewPlayerId = sessionStorage.getItem('gaa_preview_player_id');
    if (previewPlayerId) {
      defaultHeaders['X-Preview-Player-Id'] = previewPlayerId;
    }
  }

  const controller = timeoutMs ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      credentials: 'include',
      headers: {
        ...defaultHeaders,
        ...fetchOptions.headers,
      },
      signal: controller ? controller.signal : fetchOptions.signal,
    });

    if (!response.ok) {
      // 401 = session expired → clear local state and redirect to login
      if (response.status === 401 && !endpoint.startsWith('/auth/')) {
        sessionStorage.removeItem('gaa_user');
        window.location.href = '/login';
        throw new Error('Session expired');
      }

      const errorData = await response.json().catch(() => ({}));
      // `status` lets callers tell a transient server failure (5xx) from a rejected request (4xx)
      throw Object.assign(
        new Error(errorData.detail || errorData.error || `API Error: ${response.status} ${response.statusText}`),
        { status: response.status },
      );
    }

    // 204 No Content (every DELETE route in this app) has no body — response.json()
    // throws on an empty body, which silently failed the whole call (including its
    // onSuccess handler) even though the server-side delete succeeded.
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return undefined as T;
    }

    return await response.json();
  } catch (error) {
    if (controller?.signal.aborted) {
      const timeoutError = new Error('This is taking longer than expected — please try again.');
      console.error(`API call timed out after ${timeoutMs}ms: ${endpoint}`);
      throw timeoutError;
    }
    console.error(`API call failed: ${endpoint}`, error);
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ============================================================================
// Match Analytics Types
// ============================================================================

export interface ScoreOriginsData {
  own: { own_kickout: number; opp_kickout: number; turnover: number; free: number; open_play: number; total: number }
  opp: { own_kickout: number; opp_kickout: number; turnover: number; free: number; open_play: number; total: number }
}

export interface ScoreableFreesData {
  fouls_total: number
  fouls_in_scoring_range: number
  fouls_out_of_range: number
  opponent_conversions: number
  conversion_rate_pct: number
  foul_locations: Array<{ pitch_x: number; pitch_y: number; in_range: boolean; converted: boolean }>
}

export interface AttackEfficiencyData {
  own: { attacks: number; shots: number; attack_to_shot_pct: number }
  opp: { attacks: number; shots: number; attack_to_shot_pct: number }
  estimated?: boolean
}

export interface SeasonBenchmarkData {
  current: { scores: number; conceded: number; shots: number; wides: number; turnovers_won: number; turnovers_lost: number; kickout_retention_pct: number }
  season_avg: { scores: number; conceded: number; shots: number; wides: number; turnovers_won: number; turnovers_lost: number; kickout_retention_pct: number }
  match_count: number
  trend: Array<{ match_id: string; opponent: string; date: string; scores: number; conceded: number; shots: number; wides: number; turnovers_won: number; turnovers_lost: number; kickout_retention_pct: number }>
}

// ============================================================================
// Player Comparison Types
// ============================================================================

export interface ComparisonPlayerStats {
  player_id: string;
  player_name: string;
  goals: number;
  points: number;
  two_pointers: number;
  total_score_value: number;
  accuracy_pct: number | null;
  turnovers_won: number;
  turnovers_lost: number;
  blocks: number;
  interceptions: number;
  matches_played: number;
  avg_distance_km: number | null;
  avg_sprints: number | null;
  avg_max_speed_ms: number | null;
  attendance_rate: number | null;
}

export interface PlayerComparisonData {
  player_a: ComparisonPlayerStats;
  player_b: ComparisonPlayerStats;
}

// ============================================================================
// Player API
// ============================================================================

export const playersAPI = {
  /**
   * Get all players
   */
  getAll: async (): Promise<Player[]> => {
    const response = await fetchAPI<{ players: Player[]; total: number; page: number; page_size: number }>('/players/?page_size=100&active_only=false');
    return response.players; // Extract just the players array
  },

  /**
   * Get a single player by ID
   */
  getById: async (id: string): Promise<Player> => {
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
  update: async (id: string, player: Partial<Player>): Promise<Player> => {
    return fetchAPI<Player>(`/players/${id}`, {
      method: 'PUT',
      body: JSON.stringify(player),
    });
  },

  /**
   * Delete a player (hard delete by default)
   */
  delete: async (id: string, hardDelete = true): Promise<void> => {
    const url = `${API_BASE_URL}/players/${id}?hard_delete=${hardDelete}`;
    const response = await fetch(url, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || `Delete failed: ${response.status}`);
    }
  },

  /**
   * Compare two players side-by-side (manager view)
   */
  comparePlayers: async (playerAId: string, playerBId: string): Promise<PlayerComparisonData> => {
    return fetchAPI<PlayerComparisonData>(`/players/compare/${playerAId}/${playerBId}`);
  },

  /**
   * Preview a roster file (CSV/XLSX) before importing
   */
  previewImport: async (file: File, nameColumn?: string) => {
    const formData = new FormData();
    formData.append('file', file);
    const params = nameColumn ? `?name_column=${encodeURIComponent(nameColumn)}` : '';
    const url = `${API_BASE_URL}/players/import/preview${params}`;
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
    if (!res.ok) throw new Error('Failed to parse roster file');
    return res.json();
  },

  /**
   * Confirm roster import with upsert (match by name, update existing, create new)
   */
  confirmImport: async (players: Array<{ name: string; position?: string; jersey_number?: number; date_of_birth?: string }>) => {
    return fetchAPI<{ created: number; updated: number; unchanged: number; details: Array<{ name: string; action: string }> }>('/players/import/confirm', {
      method: 'POST',
      body: JSON.stringify({ players }),
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
    const response = await fetchAPI<{ matches: Match[] }>('/matches/');
    return response.matches;
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
    weather_condition?: string | null;
    weather_conditions?: string[] | null;
    temperature_celsius?: number | null;
    competition?: string | null;
    stage?: string | null;
    referee?: string | null;
    half_duration_mins?: number;
    pitch_length_m?: number | null;
    pitch_width_m?: number | null;
  }): Promise<Match> => {
    return fetchAPI<Match>('/matches/', {
      method: 'POST',
      body: JSON.stringify(match),
    });
  },

  /**
   * Update a match (partial update)
   */
  update: async (id: string, data: Partial<Match>): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete a match (soft delete)
   */
  delete: async (id: string): Promise<void> => {
    await fetchAPI<void>(`/matches/${id}`, { method: 'DELETE' });
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
   * Update match score
   */
  updateScore: async (matchId: string, score: {
    team_goals: number;
    team_points: number;
    opponent_goals: number;
    opponent_points: number;
  }): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/score`, {
      method: 'PUT',
      body: JSON.stringify(score),
    });
  },

  /**
   * Get match statistics
   */
  getStats: async (matchId: string, half?: 1 | 2): Promise<MatchStats> => {
    const q = half ? `?half=${half}` : ''
    return fetchAPI<MatchStats>(`/matches/${matchId}/stats${q}`);
  },

  /**
   * Update match phase (for resumable recording)
   */
  updatePhase: async (matchId: string, phase: string, attackingRightFirstHalf?: boolean): Promise<Match> => {
    return fetchAPI<Match>(`/matches/${matchId}/phase`, {
      method: 'POST',
      body: JSON.stringify({
        phase,
        ...(attackingRightFirstHalf !== undefined && { attacking_right_first_half: attackingRightFirstHalf }),
      }),
    });
  },

  /**
   * Get next scheduled match (earliest by date)
   */
  getNextScheduled: async (): Promise<Match | null> => {
    try {
      // upcoming_only filters server-side — a club can accumulate old
      // "scheduled" fixtures that were never marked completed/cancelled
      // (e.g. an imported season fixture list left unreconciled against
      // matches actually recorded), and those can fill up a small limit()
      // entirely before reaching a genuinely upcoming match. Previously this
      // relied on a client-side date filter over just the first 10 results,
      // which silently returned "no fixture" once the backlog grew past 10.
      const response = await fetchAPI<{ matches: Match[] }>('/matches/?status=scheduled&sort=asc&limit=1&upcoming_only=true');
      return response.matches[0] ?? null;
    } catch {
      return null;
    }
  },

  /**
   * Get in-progress match (if any)
   */
  getInProgress: async (): Promise<Match | null> => {
    try {
      const response = await fetchAPI<{ matches: Match[] }>('/matches/?status=in_progress&limit=1');
      return response.matches.length > 0 ? response.matches[0] : null;
    } catch {
      return null;
    }
  },

  /**
   * Distinct competition names already used across every match for this
   * club (scheduled + completed) — powers the Competition field's
   * autocomplete on match/fixture creation so names stay consistent
   * instead of being retyped slightly differently each time.
   */
  getCompetitions: async (): Promise<string[]> => {
    try {
      return await fetchAPI<string[]>('/matches/competitions');
    } catch {
      return [];
    }
  },

  /**
   * Get pitch path visualizations for a match (traces possession chains from events)
   */
  getPitchPaths: async (matchId: string, outcomes?: string[]): Promise<PitchPathsResponse> => {
    const params = outcomes ? `?outcomes=${outcomes.join(',')}` : '';
    return fetchAPI<PitchPathsResponse>(`/matches/${matchId}/pitch-paths${params}`);
  },

  /**
   * Get team- and player-level Expected Points (xP) for a match
   */
  getExpectedPoints: async (matchId: string): Promise<ExpectedPointsResponse> => {
    return fetchAPI<ExpectedPointsResponse>(`/matches/${matchId}/expected-points`);
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
    under_pressure?: boolean;
    opposition_foot?: string;
  }): Promise<MatchEvent> => {
    // Convert is_home_team to team field and x_coord/y_coord to pitch_x/pitch_y
    const { is_home_team, x_coord, y_coord, ...rest } = event;

    return fetchAPI<MatchEvent>('/match-events/', {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        team: is_home_team ? 'own' : 'opponent',
        pitch_x: x_coord,
        pitch_y: y_coord
      }),
    });
  },

  /**
   * Quick score recording (simplified endpoint)
   */
  quickScore: async (data: {
    match_id: string;
    player_id: string;
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
    return fetchAPI<{ events: MatchEvent[], total: number, page: number, page_size: number }>(`/match-events/match/${matchId}?limit=500`);
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
   * Reset all match events and restart match
   */
  resetMatch: async (matchId: string): Promise<{ deleted_events: number }> => {
    return fetchAPI<{ deleted_events: number }>(`/match-events/reset/${matchId}`, {
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
    assist_player_id: string | null;
    x_coord: number | null;
    y_coord: number | null;
    notes: string | null;
    under_pressure: boolean | null;
    opposition_foot: string | null;
    brought_forward: boolean;
    brought_forward_reason: string | null;
    advanced_position_x: number | null;
    advanced_position_y: number | null;
    // Where a shot that dropped short / was saved / hit the post ended up
    end_x: number | null;
    end_y: number | null;
    // Long kick pass / high ball outcome + who came away with it
    sub_type: string | null;
    kickout_target_player_id: string | null;
  }>): Promise<MatchEvent> => {
    // Transform x_coord/y_coord to pitch_x/pitch_y for backend
    const { x_coord, y_coord, ...rest } = data;
    const body = JSON.stringify({
      ...rest,
      pitch_x: x_coord,
      pitch_y: y_coord
    });
    // Live Recording is offline-first: the id handed back for a just-recorded event is the
    // client-generated one, and the event may not have reached the server yet. The server
    // resolves either id; if it simply hasn't synced yet, retry a few times with backoff.
    let lastError: unknown;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await fetchAPI<MatchEvent>(`/match-events/${eventId}`, { method: 'PUT', body });
      } catch (err) {
        lastError = err;
        if (!/not found/i.test(String((err as Error)?.message ?? err))) throw err;
        await new Promise(resolve => setTimeout(resolve, 800 * 2 ** attempt));
      }
    }
    throw lastError;
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
    /** Video Tagging only — possession time in video time; see backend
     *  PossessionEventCreate.duration_seconds. */
    duration_seconds?: number;
  }): Promise<PossessionEvent> => {
    // Convert is_home_team to team field expected by backend
    const { is_home_team, half, ...rest } = event;
    return fetchAPI<PossessionEvent>('/possession-events/', {
      method: 'POST',
      body: JSON.stringify({
        ...rest,
        team: is_home_team ? 'own' : 'opponent',
        pitch_x: rest.x_coord,
        pitch_y: rest.y_coord
      }),
    });
  },

  /**
   * Bulk-record possession waypoints from a drag path (single request)
   */
  bulkCreate: async (data: {
    match_id: string;
    team: 'own' | 'opponent';
    minute: number;
    /** Game-clock seconds at the tap (minute*60 + seconds) */
    match_clock_s?: number;
    /** Half the tap was recorded in */
    half?: number;
    waypoints: Array<{ x: number; y: number }>;
  }): Promise<{ created: number }> => {
    return fetchAPI<{ created: number }>('/possession-events/bulk', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Video Tagging: batched video-time possession points (explicit durations,
   * one request for many points — see backend create_video_batch).
   */
  videoBatch: async (data: {
    match_id: string;
    points: Array<{
      team: 'own' | 'opponent';
      pitch_x?: number | null;
      pitch_y?: number | null;
      minute?: number | null;
      match_clock_s?: number | null;
      half?: number | null;
      duration_seconds: number;
      /** Video time (ms) the point was recorded at — lets Undo to Point cut possession exactly */
      video_ms?: number | null;
    }>;
  }): Promise<{ created: number }> => {
    return fetchAPI<{ created: number }>('/possession-events/video-batch', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /** Video Tagging Undo to Point: delete possession recorded after a video time. */
  deleteAfterVideo: async (matchId: string, timestampMs: number, minute: number): Promise<{ deleted_count: number; team_at_point?: string | null; ball_x?: number | null; ball_y?: number | null; carrier?: { player_id: string; jersey_number: number | null } | null }> => {
    return fetchAPI<{ deleted_count: number; team_at_point?: string | null; ball_x?: number | null; ball_y?: number | null; carrier?: { player_id: string; jersey_number: number | null } | null }>(
      `/possession-events/match/${matchId}/after-video/${Math.round(timestampMs)}?minute=${Math.max(0, Math.floor(minute))}`,
      { method: 'DELETE' },
    );
  },

  /**
   * Possession totals for a match, computed server-side (~6 numbers). Use this
   * for stats panels instead of downloading every row.
   */
  /** Live Recording: the ball went idle — close the open possession so idle time isn't counted. */
  freeze: async (matchId: string): Promise<void> => {
    await fetchAPI<void>(`/possession-events/freeze/${matchId}`, { method: 'POST' });
  },

  summary: async (matchId: string): Promise<PossessionSummary> => {
    return fetchAPI<PossessionSummary>(`/possession-events/summary?match_id=${matchId}`);
  },

  /**
   * Get all possession events for a match
   */
  getByMatch: async (matchId: string): Promise<PossessionEvent[]> => {
    // 10000 = the backend's max. Oldest-first + a cap silently drops the NEWEST
    // events once a long match's drag waypoints exceed it, skewing possession.
    return fetchAPI<PossessionEvent[]>(`/possession-events/?match_id=${matchId}&limit=10000`);
  },
};

// ============================================================================
// Match Lineups API
// ============================================================================

interface MatchLineupEntry {
  player_id: string;
  position_id: string;
  is_substitute: boolean;
  jersey_number?: number | null;
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
  match_jersey_number: number | null;
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
   * Get the last match's lineup (for quick re-use)
   */
  getLastLineup: async (): Promise<MatchLineupResponse[]> => {
    return fetchAPI<MatchLineupResponse[]>(`/match-lineups/last-lineup`);
  },

  /**
   * Update player field status (for substitutions)
   */
  updateFieldStatus: async (matchId: string, playerId: string, newPositionId?: string): Promise<{ message: string; is_on_field: boolean }> => {
    return fetchAPI<{ message: string; is_on_field: boolean }>(`/match-lineups/matches/${matchId}/lineup/${playerId}/substitute`, {
      method: 'PATCH',
      ...(newPositionId ? {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_position_id: newPositionId }),
      } : {}),
    });
  },
};

// ============================================================================
// Analytics API
// ============================================================================

export interface SeasonSummary {
  matches_played: number;
  wins: number;
  losses: number;
  draws: number;
  win_rate: number;
  total_goals_scored: number;
  total_points_scored: number;
  total_goals_conceded: number;
  total_points_conceded: number;
  avg_score_per_match: number;
  avg_conceded_per_match: number;
}

export interface TopScorer {
  player_id: string;
  player_name: string;
  goals: number;
  points: number;
  two_pointers: number;
  total_score: number;
  matches_played: number;
}

export interface TopTurnover {
  player_id: string;
  player_name: string;
  turnovers_won: number;
  turnovers_lost: number;
  net_turnovers: number;
}

export interface ShotLocation {
  x: number;
  y: number;
  event_type: string;
  is_score: boolean;
  team: string;
  match_id: string;
}

export interface PossessionZone {
  zone: string;
  turnovers_lost: number;
  turnovers_won: number;
  unforced_errors: number;
}

export interface MatchTrend {
  match_id: string;
  opponent: string;
  match_date: string;
  team_score: number;
  opponent_score: number;
  result: string;
}

export interface DashboardData {
  season_summary: SeasonSummary;
  top_scorers: TopScorer[];
  top_turnovers: TopTurnover[];
  shot_locations: ShotLocation[];
  possession_zones: PossessionZone[];
  match_trends: MatchTrend[];
}

// Season Dashboard types
export interface PossessionFunnelTotals {
  possessions: number;
  attacks: number;
  shots: number;
  scores: number;
}

export interface PossessionFunnelMatch {
  match_id: string;
  opponent: string;
  date: string;
  possessions: number;
  attacks: number;
  shots: number;
  scores: number;
}

export interface PossessionFunnelData {
  season_totals: PossessionFunnelTotals;
  opponent_totals: PossessionFunnelTotals;
  per_match: PossessionFunnelMatch[];
  attack_rate: number;
  shot_rate: number;
  score_rate: number;
  opponent_attack_rate: number;
  opponent_shot_rate: number;
  opponent_score_rate: number;
  insight?: string;
  excluded_match_count?: number;
}

export interface KickoutTrendMatch {
  match_id: string;
  opponent: string;
  date: string;
  won_clean: number;
  won_break: number;
  lost_clean: number;
  lost_break: number;
  won_clean_pct: number;
  won_break_pct: number;
  lost_clean_pct: number;
  lost_break_pct: number;
}

export interface TurnoverSourcePlayer {
  player_id: string;
  player_name: string;
  interceptions: number;
  blocks: number;
  turnovers_won: number;
  total: number;
}

export interface RedZonePlayer {
  player_id: string;
  player_name: string;
  latest_dsl: number;
  avg_dsl_4wk: number;
  pct_above: number;
  last_match_opponent: string;
}

export interface WorkhorseRadarData {
  metrics: string[];
  season_avg: number[];
  last_game: number[];
  last_game_opponent: string;
}

export interface TerritoryZonePcts {
  defensive: number;
  midfield: number;
  attacking: number;
}

export interface TerritoryMatchData {
  match_id: string;
  opponent: string;
  date: string;
  team_pcts: TerritoryZonePcts;
  opponent_pcts: TerritoryZonePcts;
  possession_pct: number;
}

export interface TerritoryDistributionData {
  season_totals: Record<string, number>;
  season_pcts: TerritoryZonePcts;
  opponent_totals: Record<string, number>;
  opponent_pcts: TerritoryZonePcts;
  per_match: TerritoryMatchData[];
  possession_pct: number;
  excluded_match_count?: number;
}

export interface AttackingThirdsChannelPcts {
  left: number;
  centre: number;
  right: number;
}

export interface AttackingThirdsMatchData {
  match_id: string;
  opponent: string;
  date: string;
  team_pcts: AttackingThirdsChannelPcts;
  opponent_pcts: AttackingThirdsChannelPcts;
}

export interface AttackingThirdsData {
  season_totals: Record<string, number>;
  season_pcts: AttackingThirdsChannelPcts;
  opponent_totals: Record<string, number>;
  opponent_pcts: AttackingThirdsChannelPcts;
  /** Colour-driving signal — scores per channel, falling back to shots, falling back to volume. See season_threat_basis. */
  season_threat: AttackingThirdsChannelPcts;
  opponent_threat: AttackingThirdsChannelPcts;
  season_threat_basis: 'scores' | 'shots' | 'volume';
  opponent_threat_basis: 'scores' | 'shots' | 'volume';
  per_match: AttackingThirdsMatchData[];
  excluded_match_count?: number;
}

export interface KPICardItem {
  key: string;
  label: string;
  value: number;
  format: string;
  color: string;
  insight?: string;
  trend?: {
    direction: 'up' | 'down' | 'stable';
    window: number;
    season: number;
    recent: number;
  };
}

export interface KPIMetadata {
  matches_played: number;
  win_rate: number;
  wins: number;
  losses: number;
  draws: number;
}

export interface KPICards {
  metadata: KPIMetadata;
  cards: KPICardItem[];
}

// Score Timeline types
export interface ScoreTimelineEvent {
  minute: number;
  team: string;
  event_type: string;
  value: number;
  cumulative_diff: number;
  is_from_play: boolean;
}

export interface ScoreTimelineMatch {
  opponent: string;
  date: string;
  events: ScoreTimelineEvent[];
}

export interface ScoreTimelineSummary {
  avg_ht_lead: number;
  longest_drought_mins: number;
  scores_final_10: number;
  best_period: string;
}

export interface ScoreTimelineData {
  per_match: Record<string, ScoreTimelineMatch>;
  summary: ScoreTimelineSummary;
}

// Dead Ball Breakdown types
export interface FromPlayBreakdown {
  goals: number;
  points: number;
  two_ptrs: number;
}

export interface DeadBallCategory {
  scored: number;
  missed: number;
}

export interface MatchDeadBallBreakdown {
  from_play: FromPlayBreakdown;
  frees: DeadBallCategory;
  forty_fives: DeadBallCategory;
  penalties: DeadBallCategory;
}

export interface DeadBallMatchData {
  opponent: string;
  date: string;
  own: MatchDeadBallBreakdown;
  opp: MatchDeadBallBreakdown;
}

export interface DeadBallBreakdownData {
  per_match: Record<string, DeadBallMatchData>;
  season_totals: { own: MatchDeadBallBreakdown; opponent: MatchDeadBallBreakdown };
  from_play_pct: number;
}

// Defensive Action Zones types
export interface DefensiveEvent {
  match_id: string;
  minute: number | null;
  player_name: string | null;
  action_type: string;
  pitch_x: number | null;
  pitch_y: number | null;
}

export interface DefensiveZoneStats {
  interceptions: number;
  blocks: number;
  turnovers_won: number;
  total: number;
}

export interface DefensiveActionZonesData {
  events: DefensiveEvent[];
  zones: Record<string, DefensiveZoneStats>;
  totals: { interceptions: number; blocks: number; turnovers_won: number };
}

// Kickout Landing Zones types
export interface KickoutLandingEvent {
  match_id: string;
  minute: number | null;
  event_type: string;
  is_own_kickout: boolean;
  won: boolean;
  pitch_x: number | null;
  pitch_y: number | null;
}

export interface KickoutZoneStats {
  total: number;
  won: number;
  lost: number;
  win_pct: number;
}

export interface KickoutLandingSummary {
  total: number;
  short_pct: number;
  mid_pct: number;
  long_pct: number;
  best_zone: string;
  worst_zone: string;
}

export interface KickoutLandingZonesData {
  zones: Record<string, KickoutZoneStats>;
  events: KickoutLandingEvent[];
  own_events: KickoutLandingEvent[];
  opp_events: KickoutLandingEvent[];
  summary: KickoutLandingSummary;
}

// KPI Sparkline Grid types
export interface KPISparklineValue {
  match_id: string;
  value: number;
}

export interface KPISparklineRow {
  id: string;
  name: string;
  category: string;
  values: KPISparklineValue[];
  season_avg: number;
  last_match: number;
  trend: 'up' | 'down' | 'stable';
  min: number;
  max: number;
}

export interface KPISparklineGridData {
  rows: KPISparklineRow[];
}


export interface SeasonHMLDMatch {
  match_id: string;
  opponent: string;
  date: string;
  hmld_density: number | null;
  total_hml_m: number | null;
  hsr_m: number | null;
  sprint_m: number | null;
  player_count: number;
  is_estimate: boolean;
}

export interface SeasonHMLDData {
  per_match: SeasonHMLDMatch[];
  season_avg: {
    hmld_density: number | null;
    total_hml_m: number | null;
    hsr_m: number | null;
    sprint_m: number | null;
  };
  peak_match: { opponent: string; hmld_density: number } | null;
  trend_pct: number | null;
}

export interface TransitionSpeedMatch {
  match_id: string;
  opponent: string;
  date: string;
  ball_recovery_min: number | null;
  turnover_to_shot_sec: number | null;
}

export interface TransitionSpeedData {
  per_match: TransitionSpeedMatch[];
  season_avg: {
    ball_recovery_min: number | null;
    turnover_to_shot_sec: number | null;
  };
}

export interface PressTriggerMatch {
  match_id: string;
  opponent: string;
  date: string;
  press_count: number;
  win_back_rate: number;
  avg_passes_allowed: number;
  avg_duration_min: number;
}

export interface PressTriggerData {
  per_match: PressTriggerMatch[];
  season_avg: {
    press_count: number;
    win_back_rate: number;
    avg_passes_allowed: number;
    avg_duration_min: number;
  };
}

export interface SeasonDashboardData {
  possession_funnel: PossessionFunnelData;
  kickout_trends: KickoutTrendMatch[];
  turnover_leaderboard: TurnoverSourcePlayer[];
  red_zone_players: RedZonePlayer[];
  workhorse_radar: WorkhorseRadarData;
  territory_distribution: TerritoryDistributionData;
  kpi_cards?: KPICards;
  score_timeline?: ScoreTimelineData;
  dead_ball_breakdown?: DeadBallBreakdownData;
  defensive_action_zones?: DefensiveActionZonesData;
  kickout_landing_zones?: KickoutLandingZonesData;
  kpi_sparkline_grid?: KPISparklineGridData;
  season_hmld?: SeasonHMLDData;
  attacking_thirds?: AttackingThirdsData;
  transition_speed?: TransitionSpeedData;
  press_trigger?: PressTriggerData;
  expected_points_season?: SeasonExpectedPointsData;
  available_competitions: string[];
  available_stages: string[];
  matches_in_view: number;
}

export interface SeasonDashboardFilters {
  competition?: string;
  stage?: string;
  lastN?: number;
}

// Fixed dropdown of match stages — mirrors MATCH_STAGE_OPTIONS in
// backend/app/models/match.py. Kept in sync manually since it's a short,
// rarely-changing list; not worth a round trip to fetch it.
export const MATCH_STAGE_OPTIONS = [
  'Preliminary Round',
  ...Array.from({ length: 15 }, (_, i) => `Round ${i + 1}`), // league fixtures run a round per matchday, up to ~15 in a season
  'Group Stage',
  'Last 16',
  'Quarter-Final',
  'Semi-Final',
  'Final',
];

// Season-long Expected Points (xP)
export interface SeasonExpectedPointsMatch {
  match_id: string;
  opponent: string;
  match_date: string | null;
  team_expected_points: number;
  team_actual_points: number;
  opponent_expected_points: number;
  opponent_actual_points: number;
}

export interface SeasonExpectedPointsPlayer {
  player_id: string;
  player_name: string;
  shots: number;
  total_pts: number;
  expected_points: number;
  under_over: number;
}

export interface SeasonExpectedPointsData {
  season_team_expected_points: number;
  season_team_actual_points: number;
  season_opponent_expected_points: number;
  season_opponent_actual_points: number;
  per_match: SeasonExpectedPointsMatch[];
  players: SeasonExpectedPointsPlayer[];
}

// Training Analytics types
export interface LeaderboardPlayer {
  player_id: string;
  player_name: string;
  avg_total_distance_m: number | null;
  avg_max_speed_ms: number | null;
  avg_high_speed_running_m: number | null;
  avg_sprint_count: number | null;
  avg_dynamic_stress_load: number | null;
  sessions_count: number;
}

export interface PeakPerformancePoint {
  session_date: string;
  avg_distance: number;
  avg_max_speed: number;
  session_label?: string;
}

export interface ReadinessPlayer {
  player_id: string;
  player_name: string;
  readiness_score: number;
  status: 'optimal' | 'fatigued' | 'high_risk';
  insight: string;
}

export interface SpeedZoneBucket {
  session_date: string;
  low_m: number;
  hsr_m: number;
  sprint_m: number;
  low_pct: number;
  hsr_pct: number;
  sprint_pct: number;
  total_m: number;
}

export interface MonotonyPoint {
  session_date: string;
  avg_dsl: number;
  avg_duration_mins: number;
  session_label?: string;
}

export interface TrainingOverviewKPIs {
  squad_availability: string;
  untracked_players: number;
  top_speed_player: string | null;
  top_speed_value: number | null;
  hmld_density: number | null;
  hmld_is_estimate: boolean;
  team_balance_left_pct: number;
}

export interface TrainingOverviewData {
  leaderboard: LeaderboardPlayer[];
  squad_averages: Record<string, number>;
  peak_performance: PeakPerformancePoint[];
  readiness: ReadinessPlayer[];
  speed_zones: SpeedZoneBucket[];
  monotony: MonotonyPoint[];
  overview_kpis: TrainingOverviewKPIs;
}

// ============================================================================
// Reports Hub Types
// ============================================================================

export interface MatchReportScorer {
  player_id: string | null;
  player_name: string;
  goals: number;
  points: number;
  two_pointers: number;
  total: number;
  is_from_play: boolean;
}

export interface MatchReportKeyStats {
  team_shots: number;
  team_wides: number;
  team_turnovers_won: number;
  team_turnovers_lost: number;
  team_possession_pct: number;
  opp_shots: number;
  opp_wides: number;
  opp_turnovers_won: number;
  opp_turnovers_lost: number;
  own_kickouts_won_pct: number;
  opp_kickouts_won_pct: number;
}

export interface ScoringTimelinePoint {
  minute: number;
  team_cumulative: number;
  opp_cumulative: number;
}

export interface MatchReportGPSSummary {
  player_id: string;
  player_name: string;
  total_distance_km: number | null;
  high_speed_running_m: number | null;
  sprint_count: number | null;
  max_speed_ms: number | null;
  dynamic_stress_load: number | null;
}

export interface MatchReportPlayerRating {
  player_id: string;
  player_name: string;
  goals: number;
  points: number;
  two_pointers: number;
  turnovers_won: number;
  turnovers_lost: number;
  score_value: number;
}

export interface MatchReportData {
  match_id: string;
  opponent: string;
  match_date: string;
  venue: string;
  is_home: boolean;
  competition: string | null;
  team_goals: number;
  team_points: number;
  opponent_goals: number;
  opponent_points: number;
  team_total: number;
  opponent_total: number;
  result: string;
  scorers: MatchReportScorer[];
  key_stats: MatchReportKeyStats;
  scoring_timeline: ScoringTimelinePoint[];
  top_players: MatchReportPlayerRating[];
  gps_summary: MatchReportGPSSummary[];
  ai_analysis: string | null;
}

export interface PlayerFormMatchRow {
  match_id: string;
  opponent: string;
  match_date: string;
  result: string;
  team_score: string;
  opp_score: string;
  goals: number;
  points: number;
  two_pointers: number;
  score_contribution: number;
  turnovers_won: number;
  turnovers_lost: number;
  gps_distance_km: number | null;
}

export interface PlayerFormRadar {
  scoring: number;
  defence: number;
  workload: number;
  attendance: number;
  fitness: number;
  scoring_squad_avg: number;
  defence_squad_avg: number;
  workload_squad_avg: number;
  attendance_squad_avg: number;
  fitness_squad_avg: number;
}

export interface PlayerFormData {
  player_id: string;
  player_name: string;
  position: string;
  form_trend: 'up' | 'stable' | 'down';
  last_5_matches: PlayerFormMatchRow[];
  radar: PlayerFormRadar;
  match_ready: boolean;
  attendance_rate_pct: number;
}

export interface DisciplinePlayerRow {
  player_id: string;
  player_name: string;
  yellow_cards: number;
  black_cards: number;
  red_cards: number;
  fouls_committed: number;
  total_card_value: number;
}

export interface DisciplineMatchRow {
  match_id: string;
  opponent: string;
  match_date: string;
  result: string;
  yellow_cards: number;
  black_cards: number;
  red_cards: number;
  fouls_committed: number;
  opp_yellow_cards: number;
  opp_red_cards: number;
}

export interface DisciplineSummaryData {
  players: DisciplinePlayerRow[];
  per_match: DisciplineMatchRow[];
  season_totals: {
    yellow_cards: number;
    black_cards: number;
    red_cards: number;
    fouls_committed: number;
  };
}

export interface KickoutMatchRow {
  match_id: string;
  opponent: string;
  match_date: string;
  result: string;
  own_won: number;
  own_total: number;
  own_won_pct: number;
  opp_won: number;
  opp_total: number;
  opp_won_pct: number;
}

export interface KickoutSummaryData {
  per_match: KickoutMatchRow[];
  season_own_won_pct: number;
  season_opp_won_pct: number;
  best_own_match: string | null;
  worst_own_match: string | null;
  correlation_note: string;
}

export interface TrainingLoadSessionRow {
  session_id: string;
  session_date: string;
  session_type: string;
  location: string | null;
  present_count: number;
  total_invited: number;
  attendance_pct: number;
  absent_players: string[];
}

export interface TrainingLoadPlayerRow {
  player_id: string;
  player_name: string;
  total_distance_km: number | null;
  high_speed_running_m: number | null;
  sprint_count: number | null;
  dynamic_stress_load: number | null;
  sessions_attended: number;
}

export interface TrainingLoadData {
  sessions: TrainingLoadSessionRow[];
  player_loads: TrainingLoadPlayerRow[];
  date_from: string;
  date_to: string;
}

const analyticsAPI = {
  getDashboard: async (): Promise<DashboardData> => {
    return fetchAPI<DashboardData>('/analytics/dashboard');
  },

  getSeasonDashboard: async (filters?: SeasonDashboardFilters): Promise<SeasonDashboardData> => {
    const params = new URLSearchParams();
    if (filters?.competition) params.set('competition', filters.competition);
    if (filters?.stage) params.set('stage', filters.stage);
    if (filters?.lastN) params.set('last_n', String(filters.lastN));
    const qs = params.toString();
    return fetchAPI<SeasonDashboardData>(`/analytics/season-dashboard${qs ? `?${qs}` : ''}`);
  },

  getSeasonSummary: async (): Promise<SeasonSummary> => {
    return fetchAPI<SeasonSummary>('/analytics/season-summary');
  },

  getTopScorers: async (limit: number = 10): Promise<TopScorer[]> => {
    return fetchAPI<TopScorer[]>(`/analytics/top-scorers?limit=${limit}`);
  },

  getShotLocations: async (team?: string): Promise<ShotLocation[]> => {
    const params = team ? `?team=${team}` : '';
    return fetchAPI<ShotLocation[]>(`/analytics/shot-locations${params}`);
  },

  getTrainingOverview: async (): Promise<TrainingOverviewData> => {
    return fetchAPI<TrainingOverviewData>('/analytics/training-overview');
  },

  // ─── Reports Hub endpoints ─────────────────────────────────────────────────

  getMatchReport: async (matchId: string): Promise<MatchReportData> => {
    return fetchAPI<MatchReportData>(`/analytics/match-report/${matchId}`);
  },

  getPlayerForm: async (playerId: string): Promise<PlayerFormData> => {
    return fetchAPI<PlayerFormData>(`/analytics/player-form/${playerId}`);
  },

  getDisciplineSummary: async (): Promise<DisciplineSummaryData> => {
    return fetchAPI<DisciplineSummaryData>('/analytics/discipline-summary');
  },

  getKickoutSummary: async (): Promise<KickoutSummaryData> => {
    return fetchAPI<KickoutSummaryData>('/analytics/kickout-summary');
  },

  getTrainingLoad: async (dateFrom?: string, dateTo?: string): Promise<TrainingLoadData> => {
    const params = new URLSearchParams();
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    const qs = params.toString();
    return fetchAPI<TrainingLoadData>(`/analytics/training-load${qs ? `?${qs}` : ''}`);
  },
};

// ============================================================================
// AI Analysis API
// ============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AnalysisResponse {
  analysis: string;
  match_id?: string;
}

export interface ChatResponse {
  response: string;
}

export interface ChartInsights {
  possession?: string;
  scoring?: string;
  shooting?: string;
}

export interface PostMatchReport {
  match: {
    opponent: string;
    date: string;
    venue: string;
    status: string;
  };
  score: {
    team: string;
    team_total: number;
    opponent: string;
    opponent_total: number;
    result: string;
  };
  analysis: string;
  insights?: ChartInsights;
  generated_at: string;
  gps_included?: boolean;
  version?: number;
}

export interface GPSAlert {
  type: 'recovery' | 'injury_risk' | 'fatigue' | 'overload' | 'underperformance';
  severity: 'high' | 'medium' | 'low';
  player: string;
  message: string;
  metric: string;
}

export interface GPSPattern {
  insight: string;
  recommendation: string;
}

export interface GPSTopPerformer {
  player: string;
  highlight: string;
}

export interface GPSInsights {
  overall_intensity: 'championship' | 'good' | 'moderate' | 'low';
  intensity_summary: string;
  alerts: GPSAlert[];
  patterns: GPSPattern[];
  top_performers: GPSTopPerformer[];
  recovery_recommendations: {
    full_recovery_needed: string[];
    light_session_only: string[];
    normal_training: string[];
  };
}

export interface GPSAnalysisResponse {
  success: boolean;
  insights?: GPSInsights;
  error?: string;
  generated_at?: string;
  cached?: boolean;
}

export interface ChartRecommendation {
  chart_type: string;
  priority: number;
  reason: string;
}

export interface ChartRecommendationsResponse {
  recommendations: {
    recommended_charts: ChartRecommendation[];
    insights: string;
    suggested_new_charts?: {
      description: string;
      when_relevant: string;
    }[];
  };
  season_state: {
    total_matches: number;
    completed_matches: number;
    total_events: number;
    event_types: string[];
    has_player_data: boolean;
    has_location_data: boolean;
  };
  generated_at: string;
}

export interface ChartAnalysisResponse {
  analysis: string;
  chart_type: string;
}

export interface AgenticChartResponse {
  success: boolean;
  chart?: {
    chart_type: string;
    title: string;
    subtitle?: string;
    data: unknown[];
    config: {
      xKey: string;
      yKeys: string[];
      colors: string[];
      legend?: boolean;
      stacked?: boolean;
    };
    insights: string;
  };
  error?: string;
  generated_code?: string;
}

export interface CustomInsightResponse {
  question: string;
  chart_suggestion: string;
  chart: AgenticChartResponse;
}

// Dashboard Charts - AI-generated Recharts specs
export interface ChartConfig {
  xKey?: string;
  dataKeys?: string[];
  colors?: string[];
  stacked?: boolean;
  showLegend?: boolean;
}

export interface AIChartSpec {
  id: string;
  type: 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'composed' | 'pitch' | 'lineup';
  title: string;
  trend?: 'improving' | 'declining' | 'stable';
  insight: string;
  data: Record<string, unknown>[];
  config: ChartConfig;
}

export interface DataTable {
  title: string
  columns: { key: string; label: string }[]
  data: Record<string, unknown>[]
}

export interface DashboardChartsResponse {
  success: boolean;
  charts: AIChartSpec[];
  summary?: string;
  error?: string;
  generated_at?: string;
}

export interface SingleChartResponse {
  success: boolean;
  chart?: AIChartSpec;
  error?: string;
}

export interface OutlierSuggestion {
  id: string;
  title: string;
  teaser: string;
  type: 'line' | 'bar' | 'area' | 'pie';
  insight: string;
  data: Record<string, unknown>[];
  config: ChartConfig;
  outlier_category: string;
  outlier_description: string;
}

export interface OutlierSuggestionsResponse {
  success: boolean;
  suggestions: OutlierSuggestion[];
  error?: string;
  generated_at?: string;
}

// Weekly Brief types
export interface WeeklyBrief {
  headline?: string;
  form_watch?: {
    summary: string;
    hot_players: { name: string; detail: string }[];
    cold_players: { name: string; detail: string }[];
  };
  physical_state?: {
    summary: string;
    workload_flags: { player: string; acwr: number; risk: string }[];
    recovery_notes: string;
  };
  tactical_insight?: string;
  upcoming_prep?: {
    opponent: string;
    date: string;
    key_considerations: string[];
  };
}

export interface WeeklyBriefResponse {
  success: boolean;
  brief: WeeklyBrief | null;
  error?: string;
  generated_at?: string;
}

// Insight Alert types
export interface InsightAlert {
  id: string;
  category: 'warning' | 'positive' | 'tactical' | 'workload';
  source: 'training_gps' | 'match_gps' | 'manual';
  title: string;
  message: string;
  severity: 'info' | 'watch' | 'action';
  session_id?: string | null;
  match_id?: string | null;
  dashboard: 'season' | 'training' | 'both';
  is_dismissed: boolean;
  created_at: string;
}

// Pitch Paths types
export interface PitchPath {
  label: string;
  outcome: string;
  minute: number;
  player: string | null;
  opponent: string;
  started_by: string | null;
  started_with: string | null;
  points: { x: number; y: number }[];
  carriers?: string[];
  /** Move metrics, measured in OUR attacking frame (pitch 145m x 90m) */
  metres_total?: number;
  metres_gained?: number;
  directness_pct?: number | null;
  start_third?: string;
  end_third?: string;
  origin?: string;
  touches?: number;
  /** The tagged events that make up the move, in order (kicks carry their landing spot as end_x/end_y) */
  nodes?: { x: number; y: number; type: string; player: string | null; minute: number; end_x?: number; end_y?: number }[];
}

export interface PitchPathsResponse {
  paths: PitchPath[];
  insight: string;
  title?: string;
  attacking_right_first_half?: boolean;
}

// Expected Points (xP) types
export interface ExpectedPointsPlayerRow {
  player_id: string | null;
  player_name: string;
  shots: number;
  goals: number;
  two_pts: number;
  pts: number;
  total_pts: number;
  expected_points: number;
  under_over: number;
  avg_shot_quality: number;
}

export interface ExpectedPointsResponse {
  team_expected_points: number;
  opponent_expected_points: number;
  team_actual_points: number;
  opponent_actual_points: number;
  team_under_over: number;
  opponent_under_over: number;
  expected_result_margin: number;
  actual_result_margin: number;
  players: ExpectedPointsPlayerRow[];
  model_sample_size: Record<string, number>;
}

// Chat Session types
export interface ChatSessionSummary {
  id: string;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionDetail {
  id: string;
  title: string;
  messages: Array<{
    role: string;
    content: string;
    visualizations?: Array<{ kind: 'chart' | 'table'; data: any }>;
    created_at: string;
  }>;
  created_at: string;
  updated_at: string;
}

export interface StreamChatCallbacks {
  onThinking: (tool: string) => void;
  onText: (chunk: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
  onChart?: (chart: AIChartSpec) => void;
  onTable?: (table: DataTable) => void;
  onSessionCreated?: (sessionId: string) => void;
  onSessionTitle?: (title: string) => void;
}

const aiAPI = {
  /**
   * Streaming chat via SSE — progressive text delivery with tool-use thinking indicators
   */
  streamChat: async (
    conversationHistory: ChatMessage[],
    message: string,
    callbacks: StreamChatCallbacks,
    sessionId?: string
  ): Promise<void> => {
    const url = `${API_BASE_URL}/ai/chat/stream`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_history: conversationHistory,
        message,
        ...(sessionId && { session_id: sessionId }),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      callbacks.onError(errorData.detail || `API Error: ${response.status}`);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      callbacks.onError('No response stream available');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE lines from buffer
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // keep incomplete line in buffer

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        try {
          const payload = JSON.parse(trimmed.slice(6));
          switch (payload.type) {
            case 'thinking':
              callbacks.onThinking(payload.tool);
              break;
            case 'text':
              callbacks.onText(payload.content);
              break;
            case 'done':
              callbacks.onDone();
              break;
            case 'chart':
              callbacks.onChart?.(payload.chart);
              break;
            case 'table':
              callbacks.onTable?.(payload.table);
              break;
            case 'session_created':
              callbacks.onSessionCreated?.(payload.session_id);
              break;
            case 'session_title':
              callbacks.onSessionTitle?.(payload.title);
              break;
            case 'error':
              callbacks.onError(payload.message);
              break;
          }
        } catch {
          // skip malformed SSE lines
        }
      }
    }
  },

  analyzeMatch: async (matchId: string, question?: string): Promise<AnalysisResponse> => {
    return fetchAPI<AnalysisResponse>('/ai/analyze-match', {
      method: 'POST',
      body: JSON.stringify({ match_id: matchId, question }),
    });
  },

  getLiveInsight: async (matchId: string, recentEvents: object[]): Promise<AnalysisResponse> => {
    return fetchAPI<AnalysisResponse>('/ai/live-insight', {
      method: 'POST',
      body: JSON.stringify({ match_id: matchId, recent_events: recentEvents }),
    });
  },

  chat: async (conversationHistory: ChatMessage[], message: string): Promise<ChatResponse> => {
    return fetchAPI<ChatResponse>('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ conversation_history: conversationHistory, message }),
    });
  },

  getPostMatchReport: async (matchId: string): Promise<PostMatchReport> => {
    return fetchAPI<PostMatchReport>(`/ai/post-match-report/${matchId}`);
  },

  regeneratePostMatchReport: async (matchId: string, excludeBallCarry = false): Promise<PostMatchReport> => {
    return fetchAPI<PostMatchReport>(`/ai/post-match-report/${matchId}?force_regenerate=true&exclude_ball_carry=${excludeBallCarry}`);
  },

  analyzeGps: async (gpsData: any[], matchInfo?: any, forceRefresh = false): Promise<GPSAnalysisResponse> => {
    return fetchAPI<GPSAnalysisResponse>('/ai/analyze-gps', {
      method: 'POST',
      body: JSON.stringify({ gps_data: gpsData, match_info: matchInfo, force_refresh: forceRefresh }),
    });
  },

  healthCheck: async (): Promise<{ status: string; message: string }> => {
    return fetchAPI<{ status: string; message: string }>('/ai/health');
  },

  /**
   * Get AI-powered chart recommendations
   * The LLM decides which charts are most relevant based on current season data
   */
  getChartRecommendations: async (): Promise<ChartRecommendationsResponse> => {
    return fetchAPI<ChartRecommendationsResponse>('/ai/chart-recommendations');
  },

  /**
   * Get AI analysis for a specific chart
   * Provides contextual insights using knowledge base proactively
   */
  analyzeChart: async (chartType: string, chartData: object): Promise<ChartAnalysisResponse> => {
    return fetchAPI<ChartAnalysisResponse>('/ai/chart-analysis', {
      method: 'POST',
      body: JSON.stringify({ chart_type: chartType, chart_data: chartData }),
    });
  },

  /**
   * Agentic chart generation
   * LLM writes Python code to transform data into Recharts JSON
   */
  generateChart: async (request: string): Promise<AgenticChartResponse> => {
    return fetchAPI<AgenticChartResponse>('/ai/generate-chart', {
      method: 'POST',
      body: JSON.stringify({ request }),
    });
  },

  /**
   * Generate custom insight visualization from natural language
   */
  customInsight: async (question: string): Promise<CustomInsightResponse> => {
    return fetchAPI<CustomInsightResponse>('/ai/custom-insight', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  },

  /**
   * Get AI-generated dashboard charts with actual Recharts specs
   * Returns charts ready to render, not just recommendations
   */
  getDashboardCharts: async (
    excludedChartIds: string[] = [],
    numCharts: number = 4,
    forceRefresh: boolean = false,
    // "Load More" only — appends the newly generated charts to whatever's
    // already cached server-side instead of replacing it, so the result is
    // there waiting even if this tab is long gone by the time it finishes
    // (see generate_dashboard_charts). Leave false for "Regenerate All".
    mergeWithCache: boolean = false
  ): Promise<DashboardChartsResponse> => {
    return fetchAPI<DashboardChartsResponse>('/ai/dashboard-charts', {
      method: 'POST',
      body: JSON.stringify({
        excluded_chart_ids: excludedChartIds,
        num_charts: numCharts,
        force_refresh: forceRefresh,
        merge_with_cache: mergeWithCache,
      }),
      // Uncached (force_refresh) generation is a real agentic LLM run —
      // observed taking ~80s in production for just 2 charts. Bounded so
      // "Generate More" can never spin forever; comfortably above any
      // legitimate run, but still resolves the UI's loading state either way.
      // The generation itself isn't cancelled server-side by this timeout —
      // it keeps running and caches its result regardless, which is what
      // lets a caller safely give up waiting and check back later.
      timeoutMs: forceRefresh ? 150_000 : undefined,
    });
  },

  /**
   * Generate a single replacement chart when one is dismissed
   */
  getReplacementChart: async (excludedChartIds: string[] = []): Promise<SingleChartResponse> => {
    return fetchAPI<SingleChartResponse>('/ai/generate-replacement-chart', {
      method: 'POST',
      body: JSON.stringify({ excluded_chart_ids: excludedChartIds }),
      timeoutMs: 150_000,
    });
  },

  getOutlierSuggestions: async (): Promise<OutlierSuggestionsResponse> => {
    return fetchAPI<OutlierSuggestionsResponse>('/ai/outlier-suggestions');
  },

  getWeeklyBrief: async (forceRefresh = false): Promise<WeeklyBriefResponse> => {
    return fetchAPI<WeeklyBriefResponse>(`/ai/weekly-brief?force_refresh=${forceRefresh}`);
  },

  // Chat session CRUD
  listSessions: async (limit = 50): Promise<ChatSessionSummary[]> => {
    return fetchAPI<ChatSessionSummary[]>(`/ai/chat/sessions?limit=${limit}`);
  },

  getSession: async (id: string): Promise<ChatSessionDetail> => {
    return fetchAPI<ChatSessionDetail>(`/ai/chat/sessions/${id}`);
  },

  deleteSession: async (id: string): Promise<{ success: boolean }> => {
    return fetchAPI<{ success: boolean }>(`/ai/chat/sessions/${id}`, {
      method: 'DELETE',
    });
  },

  renameSession: async (id: string, title: string): Promise<{ success: boolean }> => {
    return fetchAPI<{ success: boolean }>(`/ai/chat/sessions/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  getInsightAlerts: async (dashboard?: string, includeDismissed = false, limit = 20): Promise<InsightAlert[]> => {
    const params = new URLSearchParams();
    if (dashboard) params.set('dashboard', dashboard);
    if (includeDismissed) params.set('include_dismissed', 'true');
    params.set('limit', String(limit));
    return fetchAPI<InsightAlert[]>(`/ai/insight-alerts?${params.toString()}`);
  },

  dismissInsightAlert: async (alertId: string): Promise<{ success: boolean; id: string }> => {
    return fetchAPI<{ success: boolean; id: string }>(`/ai/insight-alerts/${alertId}/dismiss`, {
      method: 'PATCH',
    });
  },
};

// ============================================================================
// Live Insights API
// ============================================================================

export interface LiveInsight {
  id: string;
  match_id: string;
  minute: number;
  half: number;
  trigger: string;
  insight: string;
  trigger_context: string | null;
  created_at: string;
}

export interface InsightsListResponse {
  insights: LiveInsight[];
  count: number;
}

export interface TriggerInsightResponse {
  generated: boolean;
  insight: LiveInsight | null;
  message: string;
}

const liveInsightsAPI = {
  /**
   * Get all insights for a match
   */
  getInsights: async (matchId: string, limit: number = 20): Promise<InsightsListResponse> => {
    return fetchAPI<InsightsListResponse>(`/live-insights/${matchId}?limit=${limit}`);
  },

  /**
   * Get the latest insight for a match
   */
  getLatest: async (matchId: string): Promise<LiveInsight | null> => {
    return fetchAPI<LiveInsight | null>(`/live-insights/${matchId}/latest`);
  },

  /**
   * Trigger an insight check (called periodically or after significant events)
   */
  triggerCheck: async (matchId: string, minute: number, half: number = 1): Promise<TriggerInsightResponse> => {
    return fetchAPI<TriggerInsightResponse>(`/live-insights/${matchId}/check`, {
      method: 'POST',
      body: JSON.stringify({ minute, half }),
    });
  },

  /**
   * Trigger half-time analysis
   */
  triggerHalfTime: async (matchId: string): Promise<LiveInsight> => {
    return fetchAPI<LiveInsight>(`/live-insights/${matchId}/half-time`, {
      method: 'POST',
    });
  },
};

// ============================================================================
// Combined Exports
// ============================================================================

// ============================================================================
// RAG Knowledge Base API
// ============================================================================

export interface RAGSearchResult {
  id: string;
  source_file: string;
  doc_type: string;
  section: string | null;
  content: string;
  score: number;
  keywords_matched: string[];
}

export interface RAGSearchResponse {
  query: string;
  results: RAGSearchResult[];
  total_found: number;
}

export interface RAGSyncResponse {
  processed: string[];
  skipped: string[];
  errors: { file: string; error: string }[];
}

export interface RAGStatsResponse {
  total_documents: number;
  total_chunks: number;
  by_type: Record<string, { chunk_count: number; total_chars: number }>;
  documents: {
    file: string;
    chunks: number;
    method: string;
    processed_at: string;
  }[];
}

const ragAPI = {
  /**
   * Sync knowledge base documents to the RAG index
   */
  sync: async (): Promise<RAGSyncResponse> => {
    return fetchAPI<RAGSyncResponse>('/rag/sync', {
      method: 'POST',
    });
  },

  /**
   * Search the knowledge base
   */
  search: async (query: string, docTypes?: string[], limit: number = 5): Promise<RAGSearchResponse> => {
    return fetchAPI<RAGSearchResponse>('/rag/search', {
      method: 'POST',
      body: JSON.stringify({ query, doc_types: docTypes, limit }),
    });
  },

  /**
   * Get RAG index statistics
   */
  getStats: async (): Promise<RAGStatsResponse> => {
    return fetchAPI<RAGStatsResponse>('/rag/stats');
  },
};

// ============================================================================
// Squad Health API
// ============================================================================

export interface HealthAlert {
  id: string;
  player_id: string;
  player_name: string;
  alert_type: string;
  severity: string;
  title: string;
  message: string;
  recommendation: string | null;
  created_at: string;
}

export interface PlayerWorkload {
  player_id: string;
  player_name: string;
  acwr: number | null;
  acute_load: number | null;
  chronic_load: number | null;
  today_load: number;
  status: 'unknown' | 'undertrained' | 'optimal' | 'elevated' | 'high_risk';
}

export interface SquadHealthSummary {
  alerts: {
    critical: HealthAlert[];
    high: HealthAlert[];
    medium: HealthAlert[];
    low: HealthAlert[];
    info: HealthAlert[];
  };
  total_alerts: number;
  critical_count: number;
  high_count: number;
  player_workloads: PlayerWorkload[];
  generated_at: string;
}

const squadHealthAPI = {
  /**
   * Get AI-generated squad health summary (1-2 sentences)
   */
  getAISummary: async (): Promise<{ summary: string | null; generated_at: string | null }> => {
    return fetchAPI<{ summary: string | null; generated_at: string | null }>('/squad-health/ai-summary');
  },

  /**
   * Get squad-wide health summary
   */
  getSummary: async (): Promise<SquadHealthSummary> => {
    return fetchAPI<SquadHealthSummary>('/squad-health/summary');
  },

  /**
   * Get all health alerts
   */
  getAlerts: async (severity?: string, activeOnly: boolean = true): Promise<HealthAlert[]> => {
    const params = new URLSearchParams();
    if (severity) params.append('severity', severity);
    params.append('active_only', String(activeOnly));
    return fetchAPI<HealthAlert[]>(`/squad-health/alerts?${params}`);
  },

  /**
   * Get player-specific health data
   */
  getPlayerHealth: async (playerId: string): Promise<{ player_id: string; active_alerts: HealthAlert[]; new_alerts_generated: number }> => {
    return fetchAPI<{ player_id: string; active_alerts: HealthAlert[]; new_alerts_generated: number }>(`/squad-health/player/${playerId}`);
  },

  /**
   * Acknowledge an alert
   */
  acknowledgeAlert: async (alertId: string): Promise<{ status: string; alert_id: string }> => {
    return fetchAPI<{ status: string; alert_id: string }>(`/squad-health/alerts/${alertId}/acknowledge`, {
      method: 'POST',
    });
  },

  /**
   * Dismiss an alert
   */
  dismissAlert: async (alertId: string): Promise<{ status: string; alert_id: string }> => {
    return fetchAPI<{ status: string; alert_id: string }>(`/squad-health/alerts/${alertId}/dismiss`, {
      method: 'POST',
    });
  },

  /**
   * Dismiss a specific set of alerts in one call (e.g. every alert
   * currently visible in one UI section).
   */
  dismissAlertsBulk: async (alertIds: string[]): Promise<{ status: string; count: number }> => {
    return fetchAPI<{ status: string; count: number }>('/squad-health/alerts/dismiss-bulk', {
      method: 'POST',
      body: JSON.stringify({ alert_ids: alertIds }),
    });
  },

  /**
   * Trigger manual squad analysis
   */
  analyzeSquad: async (): Promise<{ players_analyzed: number; total_alerts_generated: number }> => {
    return fetchAPI<{ players_analyzed: number; total_alerts_generated: number }>('/squad-health/analyze/squad', {
      method: 'POST',
    });
  },
};

// ============================================================================
// Fitness Tests API
// ============================================================================

export interface FitnessTest {
  id: string;
  player_id: string;
  player_name?: string;
  test_date: string;
  weight_kg?: number;
  body_fat_percentage?: number;
  ktw_right_cm?: number;
  ktw_left_cm?: number;
  overhead_squat_score?: number;
  cmj_cm?: number;
  squat_jump_cm?: number;
  press_ups_60s?: number;
  pull_ups_60s?: number;
  sprint_0_10m_sec?: number;
  bronco_test_min?: number;
  eur_calculated?: number;
  mas_100_percent?: number;
  mas_120_percent?: number;
  ai_analysis?: {
    strengths?: string[];
    weaknesses?: string[];
    injury_risk_score?: number;
    injury_risk_factors?: string[];
    recommendations?: string[];
    position_fit?: string[];
    training_focus?: string[];
  };
  injury_risk_score?: number;
  created_at: string;
}

export interface FitnessTestCreate {
  player_id: string;
  test_date: string;
  weight_kg?: number;
  body_fat_percentage?: number;
  ktw_right_cm?: number;
  ktw_left_cm?: number;
  overhead_squat_score?: number;
  cmj_cm?: number;
  squat_jump_cm?: number;
  press_ups_60s?: number;
  pull_ups_60s?: number;
  sprint_0_10m_sec?: number;
  bronco_test_min?: number;
}

export interface FitnessTestComparison {
  player_id: string;
  player_name: string;
  previous_test?: FitnessTest;
  current_test: FitnessTest;
  changes: Record<string, { previous: number | null; current: number | null; change_pct: number | null }>;
}

export interface SquadFitnessSummary {
  total_players: number;
  players_tested: number;
  last_test_date: string | null;
  averages: Record<string, number>;
  top_performers: Record<string, { player: string; value: number }>;
  concerns: Array<{ player: string; player_id: string; issues: string[] }>;
  squad_fitness_score: number;
}

export interface PlayerFitnessCard {
  player_id: string;
  player_name: string;
  jersey_number: number | null;
  position: string | null;
  latest_test_date: string | null;
  fitness_score: number | null;
  injury_risk: number | null;
  key_metrics: Record<string, number>;
  status: 'optimal' | 'needs_attention' | 'elevated_workload' | 'no_data';
}

const fitnessTestsAPI = {
  /**
   * Create a single fitness test
   */
  create: async (data: FitnessTestCreate): Promise<FitnessTest> => {
    return fetchAPI<FitnessTest>('/fitness-tests/', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  /**
   * Bulk create fitness tests (for team testing day)
   */
  bulkCreate: async (testDate: string, tests: FitnessTestCreate[]): Promise<FitnessTest[]> => {
    return fetchAPI<FitnessTest[]>('/fitness-tests/bulk', {
      method: 'POST',
      body: JSON.stringify({ test_date: testDate, tests }),
    });
  },

  /**
   * List all fitness tests with optional filters
   */
  list: async (playerId?: string, dateFrom?: string, dateTo?: string): Promise<FitnessTest[]> => {
    const params = new URLSearchParams();
    if (playerId) params.append('player_id', playerId);
    if (dateFrom) params.append('date_from', dateFrom);
    if (dateTo) params.append('date_to', dateTo);
    return fetchAPI<FitnessTest[]>(`/fitness-tests/?${params}`);
  },

  /**
   * Get a single fitness test by ID
   */
  get: async (testId: string): Promise<FitnessTest> => {
    return fetchAPI<FitnessTest>(`/fitness-tests/${testId}`);
  },

  /**
   * Update a fitness test
   */
  update: async (testId: string, data: Partial<FitnessTestCreate>): Promise<FitnessTest> => {
    return fetchAPI<FitnessTest>(`/fitness-tests/${testId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  /**
   * Delete a fitness test
   */
  delete: async (testId: string): Promise<void> => {
    return fetchAPI<void>(`/fitness-tests/${testId}`, {
      method: 'DELETE',
    });
  },

  /**
   * Get most recent test for a player
   */
  getPlayerLatest: async (playerId: string): Promise<FitnessTest | null> => {
    try {
      return await fetchAPI<FitnessTest>(`/fitness-tests/player/${playerId}/latest`);
    } catch {
      return null;
    }
  },

  /**
   * Get player test history
   */
  getPlayerHistory: async (playerId: string): Promise<FitnessTest[]> => {
    return fetchAPI<FitnessTest[]>(`/fitness-tests/player/${playerId}/history`);
  },

  /**
   * Compare latest vs previous test for a player
   */
  getPlayerComparison: async (playerId: string): Promise<FitnessTestComparison | null> => {
    try {
      return await fetchAPI<FitnessTestComparison>(`/fitness-tests/player/${playerId}/comparison`);
    } catch {
      return null;
    }
  },

  /**
   * Get list of test sessions (dates) with player count
   */
  getTestSessions: async (): Promise<Array<{ test_date: string; player_count: number }>> => {
    return fetchAPI<Array<{ test_date: string; player_count: number }>>('/fitness-tests/squad/sessions');
  },

  /**
   * Get latest test for each player (squad view)
   */
  getSquadLatest: async (): Promise<FitnessTest[]> => {
    return fetchAPI<FitnessTest[]>('/fitness-tests/squad/latest');
  },

  /**
   * Get squad fitness summary with AI analysis
   */
  getSquadSummary: async (): Promise<SquadFitnessSummary> => {
    return fetchAPI<SquadFitnessSummary>('/fitness-tests/squad/summary');
  },

  /**
   * Get fitness status cards for all active players
   */
  getSquadCards: async (): Promise<PlayerFitnessCard[]> => {
    return fetchAPI<PlayerFitnessCard[]>('/fitness-tests/squad/cards');
  },

  /**
   * Import fitness test data from any file format (XLSX, DOCX, CSV, PDF).
   * Uses AI to extract structured data. Returns preview for confirmation.
   */
  importFile: async (file: File, fallbackDate?: string): Promise<{
    test_sessions: Array<{
      test_date: string;
      players: Array<{
        name: string;
        matched_player: { id: string; name: string } | null;
        metrics: Record<string, number>;
      }>;
    }>;
  }> => {
    const formData = new FormData();
    formData.append('file', file);
    if (fallbackDate) formData.append('fallback_date', fallbackDate);

    const url = `${API_BASE_URL}/fitness-tests/import-file`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
      // No Content-Type header — browser sets multipart boundary automatically
    });

    if (!response.ok) {
      if (response.status === 401) {
        sessionStorage.removeItem('gaa_user');
        window.location.href = '/login';
        throw new Error('Session expired');
      }
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Import failed: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Trigger AI analysis for a specific test
   */
  analyze: async (testId: string): Promise<FitnessTest> => {
    return fetchAPI<FitnessTest>(`/fitness-tests/${testId}/analyze`, {
      method: 'POST',
    });
  },
};

// ============================================================================
// Match GPS API
// ============================================================================

export interface MatchGPSData {
  id: string;
  match_id: string;
  player_id: string;
  player_name?: string;
  opponent?: string;
  match_date?: string;
  total_distance_m?: number;
  high_speed_running_m?: number;
  sprint_distance_m?: number;
  hml_distance_m?: number;
  max_speed_ms?: number;
  avg_speed_ms?: number;
  sprint_count?: number;
  acceleration_count?: number;
  deceleration_count?: number;
  dynamic_stress_load?: number;
  player_load?: number;
  avg_heart_rate?: number;
  max_heart_rate?: number;
  time_in_red_zone_mins?: number;
  playing_minutes?: number;
  started_as_sub?: boolean;
  duration_mins?: number;
  notes?: string;
  created_at: string;
}

export interface MatchGPSUploadResponse {
  upload_id: string;
  match_id: string;
  filename: string;
  status: string;
  message: string;
}

export interface GPSUploadStatus {
  id: string;
  match_id?: string;
  status: string;
  filename: string;
  records_processed?: number;
  players_matched?: number;
  players_unmatched?: number;
  error_message?: string;
  created_at: string;
  processed_at?: string;
}

export interface GPSPlayerMatch {
  csv_name: string
  player_id: string | null
  player_name: string | null
  match_type: string
  gps_data: Record<string, unknown>
}

export interface GPSPreviewData {
  matched: GPSPlayerMatch[]
  unmatched: GPSPlayerMatch[]
  lineup_players: { id: string; name: string }[]
  all_players: { id: string; name: string }[]
}

export interface GPSConfirmEntry {
  player_id: string
  gps_data: Record<string, unknown>
}

const matchGpsAPI = {
  /**
   * Upload GPS data file for a completed match
   */
  uploadGps: async (matchId: string, file: File): Promise<MatchGPSUploadResponse> => {
    const formData = new FormData();
    formData.append('file', file);

    const url = `${API_BASE_URL}/matches/${matchId}/gps/upload`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || 'Failed to upload GPS data');
    }

    return response.json();
  },

  /**
   * Get all GPS data for a match
   */
  getMatchGps: async (matchId: string): Promise<MatchGPSData[]> => {
    return fetchAPI<MatchGPSData[]>(`/matches/${matchId}/gps`);
  },

  /**
   * Get GPS upload status
   */
  getUploadStatus: async (matchId: string, uploadId: string): Promise<GPSUploadStatus> => {
    return fetchAPI<GPSUploadStatus>(`/matches/${matchId}/gps/upload/${uploadId}`);
  },

  /**
   * Get player's match GPS history
   */
  getPlayerMatchHistory: async (playerId: string, limit: number = 10): Promise<MatchGPSData[]> => {
    return fetchAPI<MatchGPSData[]>(`/matches/player/${playerId}/match-gps?limit=${limit}`);
  },

  /**
   * Manually add GPS data for players in a match
   */
  addManualGps: async (matchId: string, data: Partial<MatchGPSData>[]): Promise<MatchGPSData[]> => {
    return fetchAPI<MatchGPSData[]>(`/matches/${matchId}/gps/manual`, {
      method: 'POST',
      body: JSON.stringify({ entries: data }),
    });
  },

  /**
   * Delete all GPS data for a match
   */
  deleteMatchGps: async (matchId: string): Promise<void> => {
    await fetchAPI<void>(`/matches/${matchId}/gps`, {
      method: 'DELETE',
    });
  },

  /**
   * Preview GPS file — parse and match players without saving
   */
  previewGps: async (matchId: string, file: File): Promise<GPSPreviewData> => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE_URL}/matches/${matchId}/gps/preview`;
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.detail || 'Failed to parse GPS file');
    }
    return response.json();
  },

  /**
   * Confirm GPS assignments and save
   */
  confirmGps: async (matchId: string, entries: GPSConfirmEntry[]): Promise<{ status: string; players_saved: number }> => {
    return fetchAPI(`/matches/${matchId}/gps/confirm`, {
      method: 'POST',
      body: JSON.stringify({ entries }),
    });
  },
};

// ============================================================================
// Onboarding API
// ============================================================================

const onboardingAPI = {
  createClub: (data: {
    name: string;
    short_name?: string;
    county?: string;
    province?: string;
    home_ground?: string;
    primary_colour?: string;
    secondary_colour?: string;
  }) => fetchAPI<any>('/onboarding/club', {
    method: 'POST',
    body: JSON.stringify(data),
  }),

  uploadLogo: async (clubId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE_URL}/onboarding/club/${clubId}/logo`;
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
    if (!res.ok) throw new Error('Failed to upload logo');
    return res.json();
  },

  previewPlayers: async (clubId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const url = `${API_BASE_URL}/onboarding/club/${clubId}/players/preview`;
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData });
    if (!res.ok) throw new Error('Failed to parse player file');
    return res.json();
  },

  confirmPlayers: (clubId: string, players: Array<{
    name: string;
    position?: string;
    jersey_number?: number;
    date_of_birth?: string;
  }>) => fetchAPI<any>(`/onboarding/club/${clubId}/players/confirm`, {
    method: 'POST',
    body: JSON.stringify({ players }),
  }),

  completeOnboarding: (clubId: string) =>
    fetchAPI<any>(`/onboarding/club/${clubId}/complete`, { method: 'PATCH' }),
};

// ============================================================================
// Fixtures API
// ============================================================================

export interface CsvImportResult {
  created: number
  skipped: number
  cleared?: number
  errors: string[]
  message: string
}

export const fixturesAPI = {
  getAll: () => fetchAPI<Match[]>('/fixtures/'),

  getPreview: (matchId: string) =>
    fetchAPI<FixturePreview>(`/fixtures/${matchId}/preview`),
  fetchOpponentForm: (matchId: string, force = false) =>
    fetchAPI<{ results: any[]; fetched_at: string; dismissed: boolean }>(`/fixtures/${matchId}/opponent-form/fetch${force ? '?force=true' : ''}`, { method: 'POST' }),
  dismissOpponentForm: (matchId: string) =>
    fetchAPI<{ ok: boolean }>(`/fixtures/${matchId}/opponent-form`, { method: 'DELETE' }),

  sync: () =>
    fetchAPI<{ status: string; message: string }>('/fixtures/sync', { method: 'POST' }),

  getOpponentForm: (name: string) =>
    fetchAPI<FormResult[]>(`/fixtures/opponent/${encodeURIComponent(name)}/form`),

  importFile: async (file: File, mode: 'add' | 'replace' = 'add', selectedTeam?: string): Promise<CsvImportResult> => {
    const formData = new FormData()
    formData.append('file', file)
    const params = new URLSearchParams({ mode })
    if (selectedTeam) params.set('selected_team', selectedTeam)
    const url = `${API_BASE_URL}/fixtures/import?${params}`
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to import fixtures')
    }
    return res.json()
  },

  previewTeams: async (file: File): Promise<{ teams: string[] }> => {
    const formData = new FormData()
    formData.append('file', file)
    const url = `${API_BASE_URL}/fixtures/preview-teams`
    const res = await fetch(url, { method: 'POST', credentials: 'include', body: formData })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.detail || 'Failed to preview teams')
    }
    return res.json()
  },
};

// ============================================================================
// Knowledge Base API (document management)
// ============================================================================

export const knowledgeBaseAPI = {
  listDocuments: () =>
    fetchAPI('/knowledge-base/documents'),

  initiateUpload: (data: { filename: string; content_type: string; doc_type: string }) =>
    fetchAPI('/knowledge-base/documents/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  confirmUpload: (documentId: string) =>
    fetchAPI('/knowledge-base/documents/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ document_id: documentId }),
    }),

  deleteDocument: (documentId: string) =>
    fetchAPI(`/knowledge-base/documents/${documentId}`, {
      method: 'DELETE',
    }),
};

// ============================================================================
// Club Members API (user management)
// ============================================================================

export const clubMembersAPI = {
  listMembers: () =>
    fetchAPI('/club/members'),

  changeRole: (userId: string, role: string) =>
    fetchAPI(`/club/members/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    }),

  deactivateUser: (userId: string) =>
    fetchAPI(`/club/members/${userId}/deactivate`, {
      method: 'PATCH',
    }),

  reactivateUser: (userId: string) =>
    fetchAPI(`/club/members/${userId}/reactivate`, {
      method: 'PATCH',
    }),

  inviteAdmin: (email: string, name: string, role: string = 'club_admin') =>
    fetchAPI('/club/members/invite-admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, role }),
    }),

  listInvitations: () =>
    fetchAPI('/club/members/invitations'),

  resendInvitation: (invitationId: string) =>
    fetchAPI(`/club/members/invitations/${invitationId}/resend`, { method: 'POST' }),

  deleteInvitation: (invitationId: string) =>
    fetchAPI(`/club/members/invitations/${invitationId}`, { method: 'DELETE' }),

  getInviteCode: () =>
    fetchAPI<{ invite_code: string }>('/auth/invite-code'),

  regenerateInviteCode: () =>
    fetchAPI<{ invite_code: string }>('/auth/invite-code/generate', { method: 'POST' }),
};

// ============================================================================
// Player Movement API
// ============================================================================

export interface BallCarrierSegment {
  id: string;
  match_id: string;
  player_id: string;
  jersey_number: number | null;
  team: string;
  half: number;
  minute: number | null;
  path_points: Array<{ x: number; y: number }> | null;
  start_x: number | null;
  start_y: number | null;
  end_x: number | null;
  end_y: number | null;
  start_time_ms: number | null;
  end_time_ms: number | null;
  ended_by: string | null;
  source: string;
  sequence_number: number;
  created_at: string;
  player_name: string | null;
}

export interface TacticalTagData {
  id: string;
  match_id: string;
  tag_type: string;
  label: string | null;
  half: number;
  minute: number | null;
  pitch_x: number | null;
  pitch_y: number | null;
  source: string;
  created_at: string;
}

export interface FormationSnapshotData {
  id: string;
  match_id: string;
  half: number;
  minute: number | null;
  label: string | null;
  positions: Array<{ player_id?: string | null; jersey_number?: number | null; x: number; y: number; team?: string; player_name?: string | null }> | null;
  video_timestamp_ms: number | null;
  source: string;
  created_at: string;
}

export interface KickoutPlayData {
  id: string;
  club_id: string;
  name: string;
  description: string | null;
  diagram: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

const playerMovementAPI = {
  // Carrier segments
  startCarrierSegment: (data: {
    match_id: string;
    /** Our player — or leave out and pass opposition_player_id for an opposition carrier (inter-county) */
    player_id?: string;
    opposition_player_id?: string;
    jersey_number?: number | null;
    team: string;
    half: number;
    minute?: number | null;
    match_clock_s?: number | null;
    start_x?: number | null;
    start_y?: number | null;
    source?: string;
    video_timestamp_ms?: number | null;
  }): Promise<BallCarrierSegment> =>
    fetchAPI('/player-movement/carrier-segments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  endCarrierSegment: (segmentId: string, data: {
    end_x?: number | null;
    end_y?: number | null;
    ended_by?: string | null;
  }): Promise<BallCarrierSegment> =>
    fetchAPI(`/player-movement/carrier-segments/${segmentId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  appendPathPoints: (segmentId: string, points: Array<{ x: number; y: number }>): Promise<BallCarrierSegment> =>
    fetchAPI(`/player-movement/carrier-segments/${segmentId}/path-points`, {
      method: 'POST',
      body: JSON.stringify({ points }),
    }),

  listCarrierSegments: (matchId: string): Promise<{ segments: BallCarrierSegment[]; total: number }> =>
    fetchAPI(`/player-movement/carrier-segments/${matchId}`),

  deleteCarrierSegment: (segmentId: string): Promise<void> =>
    fetchAPI(`/player-movement/carrier-segments/${segmentId}`, { method: 'DELETE' }),

  deleteCarrierSegmentsAfter: (matchId: string, timestampMs: number): Promise<{ deleted_count: number; match_id: string; after_ms: number }> =>
    fetchAPI(`/player-movement/carrier-segments/match/${matchId}/after/${timestampMs}`, { method: 'DELETE' }),

  // Formation snapshots
  createSnapshot: (data: {
    match_id: string;
    half: number;
    minute?: number | null;
    label?: string | null;
    positions: Array<{ player_id?: string | null; jersey_number?: number | null; x: number; y: number; team?: string; player_name?: string | null }>;
    source?: string;
    video_timestamp_ms?: number | null;
  }): Promise<FormationSnapshotData> =>
    fetchAPI('/player-movement/snapshots', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listSnapshots: (matchId: string): Promise<{ snapshots: FormationSnapshotData[]; total: number }> =>
    fetchAPI(`/player-movement/snapshots/${matchId}`),

  deleteSnapshot: (snapshotId: string): Promise<void> =>
    fetchAPI(`/player-movement/snapshots/${snapshotId}`, { method: 'DELETE' }),

  // Tactical tags
  createTacticalTag: (data: {
    match_id: string;
    tag_type: string;
    label?: string | null;
    half: number;
    minute?: number | null;
    match_clock_s?: number | null;
    pitch_x?: number | null;
    pitch_y?: number | null;
    source?: string;
  }): Promise<TacticalTagData> =>
    fetchAPI('/player-movement/tactical-tags', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listTacticalTags: (matchId: string): Promise<{ tags: TacticalTagData[]; total: number }> =>
    fetchAPI(`/player-movement/tactical-tags/${matchId}`),

  deleteTacticalTag: (tagId: string): Promise<void> =>
    fetchAPI(`/player-movement/tactical-tags/${tagId}`, { method: 'DELETE' }),

  // Kickout plays
  createKickoutPlay: (data: { name: string; description?: string | null; diagram?: Record<string, unknown> | null }): Promise<KickoutPlayData> =>
    fetchAPI('/player-movement/kickout-plays', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listKickoutPlays: (): Promise<{ plays: KickoutPlayData[]; total: number }> =>
    fetchAPI('/player-movement/kickout-plays'),

  updateKickoutPlay: (playId: string, data: { name?: string; description?: string | null; is_active?: boolean }): Promise<KickoutPlayData> =>
    fetchAPI(`/player-movement/kickout-plays/${playId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteKickoutPlay: (playId: string): Promise<void> =>
    fetchAPI(`/player-movement/kickout-plays/${playId}`, { method: 'DELETE' }),

  // Derive chains
  deriveChains: (matchId: string): Promise<{ chains_derived: number; chain_ids: string[] }> =>
    fetchAPI(`/player-movement/chains/${matchId}/derive`),
};

// ============ Match Prep API ============

export interface SetPieceRoutine {
  id: string;
  name: string;
  category: 'attacking' | 'defensive' | 'kickout';
  description: string | null;
  elements: Array<Record<string, unknown>>;
  animation_settings?: Record<string, number> | null;
  has_voiceover?: boolean;
  created_at: string;
  updated_at: string;
}

/** One opposition player in a match lineup (starter by position slot, or bench 'sub-N'). */
export interface OppositionLineupEntry {
  position_id: string;
  jersey_number: number | null;
  surname: string;
}

export interface OppositionLineupRow extends OppositionLineupEntry {
  opposition_player_id: string;
  is_substitute: boolean;
  is_on_field: boolean;
}

export interface OppositionLineupResponse {
  team_id: string;
  team_name: string;
  lineup: OppositionLineupRow[];
  /** true = the rows are last time's lineup vs this team, not yet saved for this match */
  prefill: boolean;
}

export interface ManMarkingAssignment {
  id: string;
  match_id: string;
  player_id: string;
  player_name: string | null;
  opponent_player_name: string;
  notes: string | null;
  created_at: string;
}

export interface SleepFlag {
  player_id: string;
  player_name: string;
  avg_last_2_nights: number;
  nights_below_6h: number;
  severity: 'medium' | 'high';
}

const matchPrepAPI = {
  // Tactical notes
  saveTacticalNotes: (matchId: string, tacticalNotes: string): Promise<{ tactical_notes: string }> =>
    fetchAPI(`/match-prep/matches/${matchId}/tactical-notes`, {
      method: 'PUT',
      body: JSON.stringify({ tactical_notes: tacticalNotes }),
    }),

  getTacticalNotes: (matchId: string): Promise<{ tactical_notes: string }> =>
    fetchAPI(`/match-prep/matches/${matchId}/tactical-notes`),

  // Set-piece routines
  createSetPiece: (data: { name: string; category: string; description?: string; elements: Array<Record<string, unknown>> }): Promise<SetPieceRoutine> =>
    fetchAPI('/match-prep/set-pieces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listSetPieces: (category?: string): Promise<SetPieceRoutine[]> =>
    fetchAPI(`/match-prep/set-pieces${category ? `?category=${category}` : ''}`),

  getSetPiece: (id: string): Promise<SetPieceRoutine> =>
    fetchAPI(`/match-prep/set-pieces/${id}`),

  updateSetPiece: (id: string, data: { name?: string; category?: string; description?: string; elements?: Array<Record<string, unknown>> }): Promise<SetPieceRoutine> =>
    fetchAPI(`/match-prep/set-pieces/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  deleteSetPiece: (id: string): Promise<void> =>
    fetchAPI(`/match-prep/set-pieces/${id}`, { method: 'DELETE' }),

  // Man marking assignments
  createMarking: (matchId: string, data: { player_id: string; opponent_player_name: string; notes?: string }): Promise<ManMarkingAssignment> =>
    fetchAPI(`/match-prep/matches/${matchId}/marking`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listMarkings: (matchId: string): Promise<ManMarkingAssignment[]> =>
    fetchAPI(`/match-prep/matches/${matchId}/marking`),

  deleteMarking: (assignmentId: string): Promise<void> =>
    fetchAPI(`/match-prep/marking/${assignmentId}`, { method: 'DELETE' }),

  // Opposition Roster
  getOppositionRoster: (matchId: string): Promise<{ players: string[] }> =>
    fetchAPI(`/match-prep/matches/${matchId}/opposition-roster`),

  saveOppositionRoster: (matchId: string, players: string[]): Promise<{ players: string[] }> =>
    fetchAPI(`/match-prep/matches/${matchId}/opposition-roster`, {
      method: 'PUT',
      body: JSON.stringify({ players }),
    }),

  // Opposition lineup (inter-county only): starters by position slot + bench, with last-time prefill
  getOppositionLineup: (matchId: string): Promise<OppositionLineupResponse> =>
    fetchAPI(`/match-prep/matches/${matchId}/opposition-lineup`),

  saveOppositionLineup: (matchId: string, lineup: OppositionLineupEntry[]): Promise<OppositionLineupResponse> =>
    fetchAPI(`/match-prep/matches/${matchId}/opposition-lineup`, {
      method: 'PUT',
      body: JSON.stringify({ lineup }),
    }),

  // Sleep flags for lineup page
  getSleepFlags: (): Promise<{ flags: SleepFlag[] }> =>
    fetchAPI('/match-prep/sleep-flags'),

  // Voiceover
  getVoiceoverUploadUrl: (routineId: string): Promise<{ upload_url: string; key: string }> =>
    fetchAPI(`/match-prep/set-pieces/${routineId}/voiceover-upload-url`, { method: 'POST' }),

  confirmVoiceoverUpload: (routineId: string, key: string): Promise<{ voiceover_key: string }> =>
    fetchAPI(`/match-prep/set-pieces/${routineId}/voiceover-confirm`, {
      method: 'PUT',
      body: JSON.stringify({ key }),
    }),

  getVoiceoverUrl: (routineId: string): Promise<{ voiceover_url: string | null }> =>
    fetchAPI(`/match-prep/set-pieces/${routineId}/voiceover-url`),

  deleteVoiceover: (routineId: string): Promise<void> =>
    fetchAPI(`/match-prep/set-pieces/${routineId}/voiceover`, { method: 'DELETE' }),
};

// ============================================================================
// Playbook Push API
// ============================================================================

const playbookAPI = {
  pushToPlayers: (routineId: string, playerIds: string[], message?: string) =>
    fetchAPI('/playbook/push', {
      method: 'POST',
      body: JSON.stringify({ routine_id: routineId, player_ids: playerIds, message }),
    }),

  listPushes: () =>
    fetchAPI('/playbook/pushes'),

  revokePush: (pushId: string): Promise<void> =>
    fetchAPI(`/playbook/pushes/${pushId}`, { method: 'DELETE' }),

  // Player portal
  getMyPlaybooks: () =>
    fetchAPI('/playbook/player/playbooks'),

  markPlaybookViewed: (pushId: string) =>
    fetchAPI(`/playbook/player/playbooks/${pushId}/viewed`, { method: 'POST' }),
};

// ============================================================================
// Organizations & Multi-Team API
// ============================================================================

import type { ClubMembership, Organization } from '../types';

export const organizationsAPI = {
  getMyClubs: () =>
    fetchAPI<ClubMembership[]>('/my-clubs'),

  switchClub: (clubId: string) =>
    fetchAPI<{ club_id: string; role: string; player_id: string | null }>('/switch-club', {
      method: 'POST',
      body: JSON.stringify({ club_id: clubId }),
    }),

  getOrganization: () =>
    fetchAPI<Organization>('/organization'),

  createTeam: (data: { name: string; short_name?: string; county?: string; province?: string; primary_colour?: string; secondary_colour?: string }) =>
    fetchAPI('/organization/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deactivateTeam: (clubId: string) =>
    fetchAPI(`/organization/teams/${clubId}`, {
      method: 'DELETE',
    }),
};


// ============================================================================
// Audit Log API
// ============================================================================

export interface AuditLogEntry {
  id: string
  user_email: string
  user_name: string | null
  action: string
  resource_type: string | null
  resource_id: string | null
  detail: Record<string, unknown> | null
  http_method: string | null
  endpoint: string | null
  ip_address: string | null
  created_at: string | null
}

export interface AuditLogResponse {
  logs: AuditLogEntry[]
  total: number
  page: number
  per_page: number
  total_pages: number
}

export interface AuditSummary {
  action_counts: Record<string, number>
  resource_counts: Record<string, number>
  active_users: { email: string; name: string | null; actions: number }[]
}

export const auditLogAPI = {
  list: (params: { page?: number; per_page?: number; action?: string; resource_type?: string; user_email?: string } = {}) => {
    const search = new URLSearchParams()
    if (params.page) search.set('page', String(params.page))
    if (params.per_page) search.set('per_page', String(params.per_page))
    if (params.action) search.set('action', params.action)
    if (params.resource_type) search.set('resource_type', params.resource_type)
    if (params.user_email) search.set('user_email', params.user_email)
    const qs = search.toString()
    return fetchAPI<AuditLogResponse>(`/audit-log/${qs ? '?' + qs : ''}`)
  },

  summary: () =>
    fetchAPI<AuditSummary>('/audit-log/summary'),
}

export interface TeamVolumeInterval {
  interval: string
  distance_km: number
  carries: number
}

export interface TeamVolumeData {
  intervals: TeamVolumeInterval[]
  total_distance_km: number
  source: 'carrier_backed' | 'event_estimate'
}

const matchAnalyticsAPI = {
  getScoreOrigins: (matchId: string) => fetchAPI<ScoreOriginsData>(`/match-analytics/${matchId}/score-origins`),
  getScoreableFrees: (matchId: string) => fetchAPI<ScoreableFreesData>(`/match-analytics/${matchId}/scoreable-frees`),
  getAttackEfficiency: (matchId: string) => fetchAPI<AttackEfficiencyData>(`/match-analytics/${matchId}/attack-efficiency`),
  getSeasonBenchmark: (matchId: string) => fetchAPI<SeasonBenchmarkData>(`/match-analytics/${matchId}/vs-season`),
  getTeamVolume: (matchId: string) => fetchAPI<TeamVolumeData>(`/match-analytics/${matchId}/team-volume`),
};

export interface MatchVoiceNote {
  id: string;
  match_id: string;
  text: string;
  half: number | null;
  minute: number | null;
  created_at: string;
}

export const matchVoiceNotesAPI = {
  create: (data: { match_id: string; text: string; half?: number | null; minute?: number | null }): Promise<MatchVoiceNote> =>
    fetchAPI('/match-voice-notes/', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getByMatch: (matchId: string): Promise<{ notes: MatchVoiceNote[]; total: number }> =>
    fetchAPI(`/match-voice-notes/match/${matchId}`),

  delete: (noteId: string): Promise<void> =>
    fetchAPI(`/match-voice-notes/${noteId}`, { method: 'DELETE' }),
};

export interface DashboardLayoutData {
  version: number;
  chartOrder: string[];
  hiddenCharts: string[];
  sectionOrder: string[];
  pinnedAiCharts: AIChartSpec[];
}

export interface DashboardLayoutResponse {
  layout_data: DashboardLayoutData;
  updated_at: string;
}

export const dashboardLayoutAPI = {
  get: (): Promise<DashboardLayoutResponse | null> =>
    fetchAPI('/dashboard/layout'),

  save: (layout_data: DashboardLayoutData): Promise<DashboardLayoutResponse> =>
    fetchAPI('/dashboard/layout', {
      method: 'POST',
      body: JSON.stringify({ layout_data }),
    }),
};

export const api = {
  players: playersAPI,
  matches: matchesAPI,
  matchEvents: matchEventsAPI,
  matchVoiceNotes: matchVoiceNotesAPI,
  possession: possessionAPI,
  matchLineups: matchLineupsAPI,
  analytics: analyticsAPI,
  ai: aiAPI,
  liveInsights: liveInsightsAPI,
  rag: ragAPI,
  squadHealth: squadHealthAPI,
  fitnessTests: fitnessTestsAPI,
  matchGps: matchGpsAPI,
  onboarding: onboardingAPI,
  fixtures: fixturesAPI,
  knowledgeBase: knowledgeBaseAPI,
  clubMembers: clubMembersAPI,
  playerMovement: playerMovementAPI,
  matchPrep: matchPrepAPI,
  playbook: playbookAPI,
  auditLog: auditLogAPI,
  matchAnalytics: matchAnalyticsAPI,
  dashboardLayout: dashboardLayoutAPI,
};

export default api;

