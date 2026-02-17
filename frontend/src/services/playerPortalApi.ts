import { fetchAPI } from './api';

// ---- Types ----

export interface LeaderboardEntry {
  rank: number;
  player_id: string;
  player_name: string;
  value: number;
  detail: string | null;
}

export interface LeaderboardContext {
  category: string;
  display_name: string;
  unit: string;
  my_rank: number | null;
  my_value: number | null;
  total_players: number;
  top_3: LeaderboardEntry[];
  context_window: LeaderboardEntry[];
}

export interface RecentFormMatch {
  match_id: string;
  opponent: string;
  match_date: string;
  result: string;
  team_score: string;
  opponent_score: string;
  personal_score: string;
  key_stat: string | null;
}

export interface LeaderboardPosition {
  category: string;
  display_name: string;
  rank: number;
  total: number;
  value: number;
}

export interface SeasonStats {
  matches_played: number;
  total_score: string;
  total_points_value: number;
  goals: number;
  points: number;
  two_pointers: number;
  accuracy_pct: number | null;
  turnovers_won: number;
  turnovers_lost: number;
  blocks: number;
  interceptions: number;
}

export interface PlayerDashboard {
  player_name: string;
  jersey_number: number | null;
  position: string | null;
  season_stats: SeasonStats;
  recent_form: RecentFormMatch[];
  leaderboard_positions: LeaderboardPosition[];
  highlights: string[];
}

export interface PlayerMatchStatRow {
  match_id: string;
  opponent: string;
  match_date: string;
  result: string;
  goals: number;
  points: number;
  two_pointers: number;
  frees: number;
  wides: number;
  turnovers_won: number;
  turnovers_lost: number;
  blocks: number;
  interceptions: number;
  total_score_value: number;
}

export interface ShotEvent {
  match_id: string;
  opponent: string;
  event_type: string;
  pitch_x: number | null;
  pitch_y: number | null;
  minute: number | null;
}

export interface GPSEntry {
  match_id: string | null;
  session_type: string;
  opponent_or_label: string;
  date: string;
  total_distance_m: number | null;
  high_speed_running_m: number | null;
  sprint_count: number | null;
  max_speed_ms: number | null;
  dynamic_stress_load: number | null;
  player_load: number | null;
  playing_minutes: number | null;
}

export interface FitnessEntry {
  test_id: string;
  test_date: string;
  weight_kg: number | null;
  body_fat_percentage: number | null;
  cmj_cm: number | null;
  squat_jump_cm: number | null;
  bronco_test_min: number | null;
  sprint_0_10m_sec: number | null;
  press_ups_60s: number | null;
  pull_ups_60s: number | null;
}

export interface AttendanceSession {
  session_id: string;
  date: string;
  type: string;
  status: string;
}

export interface AttendanceSummary {
  total_sessions: number;
  attended: number;
  rate_pct: number;
  current_streak: number;
  longest_streak: number;
  by_type: Record<string, { total: number; attended: number }>;
  sessions: AttendanceSession[];
}

// ---- API Functions ----

export const playerPortalAPI = {
  // Leaderboards
  getAllLeaderboards: () =>
    fetchAPI<{ leaderboards: LeaderboardContext[] }>('/player-portal/leaderboards'),

  getSingleLeaderboard: (category: string) =>
    fetchAPI<{ category: string; display_name: string; unit: string; ranking: LeaderboardEntry[] }>(
      `/player-portal/leaderboards/${category}`
    ),

  // Dashboard
  getMyDashboard: () =>
    fetchAPI<PlayerDashboard>('/player-portal/my-dashboard'),

  // My Stats
  getMyMatchStats: () =>
    fetchAPI<{ matches: PlayerMatchStatRow[] }>('/player-portal/my-stats/matches'),

  getMyShots: () =>
    fetchAPI<{ shots: ShotEvent[] }>('/player-portal/my-stats/shots'),

  getMyGPS: () =>
    fetchAPI<{ gps_entries: GPSEntry[] }>('/player-portal/my-stats/gps'),

  getMyFitness: () =>
    fetchAPI<{ fitness_tests: FitnessEntry[] }>('/player-portal/my-stats/fitness'),

  getMyAttendance: () =>
    fetchAPI<AttendanceSummary>('/player-portal/my-stats/attendance'),
};
