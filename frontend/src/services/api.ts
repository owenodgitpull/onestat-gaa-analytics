/**
 * API Service Layer
 * Handles all communication with the FastAPI backend
 */

import type {
  Match,
  Player,
  MatchEvent,
  PossessionEvent,
  MatchStats
} from '../types';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8001/api/v1';

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
 */
export async function fetchAPI<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'include',
      headers: {
        ...defaultHeaders,
        ...options.headers,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.detail || errorData.error || `API Error: ${response.status} ${response.statusText}`
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
    const response = await fetchAPI<{ players: Player[]; total: number; page: number; page_size: number }>('/players/?limit=100&active_only=false');
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
    temperature_celsius?: number | null;
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
      const response = await fetchAPI<{ matches: Match[] }>('/matches/?status=scheduled&limit=1');
      return response.matches.length > 0 ? response.matches[0] : null;
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
   * Get pitch path visualizations for a match (traces possession chains from events)
   */
  getPitchPaths: async (matchId: string, outcomes?: string[]): Promise<PitchPathsResponse> => {
    const params = outcomes ? `?outcomes=${outcomes.join(',')}` : '';
    return fetchAPI<PitchPathsResponse>(`/matches/${matchId}/pitch-paths${params}`);
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
    // Strip `half` — backend expects absolute minute only
    const { is_home_team, x_coord, y_coord, half, ...rest } = event;

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
        team: is_home_team ? 'own' : 'opponent',
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
   * Get the last match's lineup (for quick re-use)
   */
  getLastLineup: async (): Promise<MatchLineupResponse[]> => {
    return fetchAPI<MatchLineupResponse[]>(`/match-lineups/last-lineup`);
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
}

export interface KPICardItem {
  key: string;
  label: string;
  value: number;
  format: string;
  color: string;
  insight?: string;
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

export interface SeasonDashboardData {
  possession_funnel: PossessionFunnelData;
  kickout_trends: KickoutTrendMatch[];
  turnover_leaderboard: TurnoverSourcePlayer[];
  red_zone_players: RedZonePlayer[];
  workhorse_radar: WorkhorseRadarData;
  territory_distribution: TerritoryDistributionData;
  kpi_cards?: KPICards;
}

// Training Analytics types
export interface LeaderboardPlayer {
  player_id: string;
  player_name: string;
  avg_total_distance_m: number;
  avg_max_speed_ms: number;
  avg_high_speed_running_m: number;
  avg_sprint_count: number;
  avg_dynamic_stress_load: number;
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
  top_speed_player: string;
  top_speed_value: number;
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

const analyticsAPI = {
  getDashboard: async (): Promise<DashboardData> => {
    return fetchAPI<DashboardData>('/analytics/dashboard');
  },

  getSeasonDashboard: async (): Promise<SeasonDashboardData> => {
    return fetchAPI<SeasonDashboardData>('/analytics/season-dashboard');
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
  type: 'line' | 'bar' | 'pie' | 'scatter' | 'area' | 'composed' | 'pitch';
  title: string;
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
}

export interface PitchPathsResponse {
  paths: PitchPath[];
  insight: string;
  title?: string;
  attacking_right_first_half?: boolean;
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

  analyzeGps: async (gpsData: any[], matchInfo?: any): Promise<GPSAnalysisResponse> => {
    return fetchAPI<GPSAnalysisResponse>('/ai/analyze-gps', {
      method: 'POST',
      body: JSON.stringify({ gps_data: gpsData, match_info: matchInfo }),
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
    numCharts: number = 4
  ): Promise<DashboardChartsResponse> => {
    return fetchAPI<DashboardChartsResponse>('/ai/dashboard-charts', {
      method: 'POST',
      body: JSON.stringify({ excluded_chart_ids: excludedChartIds, num_charts: numCharts }),
    });
  },

  /**
   * Generate a single replacement chart when one is dismissed
   */
  getReplacementChart: async (excludedChartIds: string[] = []): Promise<SingleChartResponse> => {
    return fetchAPI<SingleChartResponse>('/ai/generate-replacement-chart', {
      method: 'POST',
      body: JSON.stringify({ excluded_chart_ids: excludedChartIds }),
    });
  },

  getOutlierSuggestions: async (): Promise<OutlierSuggestionsResponse> => {
    return fetchAPI<OutlierSuggestionsResponse>('/ai/outlier-suggestions');
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
  squad_size: number;
  tested_count: number;
  avg_cmj?: number;
  avg_bronco?: number;
  avg_sprint?: number;
  team_strengths: string[];
  team_weaknesses: string[];
  priority_areas: string[];
  recommendations: string[];
  high_risk_count: number;
  mobility_concern_count: number;
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
  bulkCreate: async (tests: FitnessTestCreate[]): Promise<FitnessTest[]> => {
    return fetchAPI<FitnessTest[]>('/fitness-tests/bulk', {
      method: 'POST',
      body: JSON.stringify({ tests }),
    });
  },

  /**
   * List all fitness tests with optional filters
   */
  list: async (playerId?: string, dateFrom?: string): Promise<FitnessTest[]> => {
    const params = new URLSearchParams();
    if (playerId) params.append('player_id', playerId);
    if (dateFrom) params.append('date_from', dateFrom);
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

export const api = {
  players: playersAPI,
  matches: matchesAPI,
  matchEvents: matchEventsAPI,
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
};

export default api;

