import { fetchAPI } from './api';
import type { MatchGPSData, KickoutTrendMatch, KickoutLandingZonesData } from './api';

// ---- Types ----

export interface QuarterBucket {
  quarter: string;
  work_rate_count: number;
  errors_count: number;
  work_rate_per_match: number;
  errors_per_match: number;
}

export interface QuarterProfile {
  matches_included: number;
  quarters: QuarterBucket[];
  note: string;
}

export interface DisciplineMatchPoint {
  match_id: string;
  opponent: string;
  match_date: string;
  turnovers_won: number;
  turnovers_lost: number;
  unforced_errors: number;
}

export interface DisciplineTrend {
  player_id: string;
  matches: DisciplineMatchPoint[];
}

export interface PositionalBenchmarkStats {
  matches_played: number;
  scoring_per_match: number;
  turnovers_won_per_match: number;
  turnovers_lost_per_match: number;
  blocks_per_match: number;
  assists_per_match: number;
  shooting_accuracy_pct: number | null;
}

export interface PositionalBenchmark {
  player_id: string;
  position: string | null;
  peer_count: number;
  player_stats?: PositionalBenchmarkStats | null;
  position_avg?: PositionalBenchmarkStats | null;
  message?: string | null;
}

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

export interface LeaderboardFilter {
  competition?: string | null;
  lastN?: number | null;
}

function leaderboardFilterQS(filter?: LeaderboardFilter): string {
  if (!filter) return '';
  const params = new URLSearchParams();
  if (filter.competition) params.set('competition', filter.competition);
  if (filter.lastN) params.set('last_n', String(filter.lastN));
  const qs = params.toString();
  return qs ? `?${qs}` : '';
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
  fouls_committed: number;
  kickouts_won: number;
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
  sprint_distance_m: number | null;
  hml_distance_m: number | null;
  avg_speed_ms: number | null;
  acceleration_count: number | null;
  deceleration_count: number | null;
  avg_heart_rate: number | null;
  max_heart_rate: number | null;
  time_in_red_zone_mins: number | null;
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

export interface WorkloadEntry {
  date: string;
  acute_load_7d: number | null;
  chronic_load_28d: number | null;
  acwr: number | null;
  training_load: number;
  match_load: number;
  total_load: number;
  total_distance_m: number;
  high_speed_distance_m: number;
  sprint_count: number;
}

export interface AIInsight {
  insights: string[];
  generated_at: string;
}

export interface PlayerChallenge {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  metric_key: string;
  target_value: number;
  current_value: number;
  progress_pct: number;
  expires_at: string | null;
  created_at: string | null;
}

export interface SeasonStory {
  story: string | null;
  generated_at: string;
}

export interface HeadToHeadPlayerStats {
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

export interface HeadToHeadData {
  me: HeadToHeadPlayerStats;
  them: HeadToHeadPlayerStats;
  my_ranks: Record<string, number | null>;
  their_ranks: Record<string, number | null>;
}

export interface RosterPlayer {
  id: string;
  name: string;
  jersey_number: number | null;
  position: string | null;
}

export interface SleepLogEntry {
  date: string;        // YYYY-MM-DD
  hours_slept: number;
  quality: number | null;  // 1-5
  notes: string | null;
}

export interface SleepHistory {
  entries: SleepLogEntry[];
}

export interface TaggedClipItem {
  presentation_id: string;
  presentation_title: string;
  slide_id: string;
  slide_type: 'clip' | 'annotation' | 'text' | 'animation';
  clip_label: string | null;
  text_title: string | null;
  created_at: string;
}

export interface TaggedClipDetail {
  slide_type: 'clip' | 'annotation' | 'text' | 'animation';
  video_url: string | null;
  clip_start_ms: number | null;
  clip_end_ms: number | null;
  clip_label: string | null;
  freeze_frame_ms: number | null;
  annotation_shapes: Array<Record<string, unknown>> | null;
  text_title: string | null;
  text_body: string | null;
  voiceover_url: string | null;
}

// ---- API Functions ----

export const playerPortalAPI = {
  // Leaderboards
  getAllLeaderboards: (filter?: LeaderboardFilter) =>
    fetchAPI<{ leaderboards: LeaderboardContext[] }>(`/player-portal/leaderboards${leaderboardFilterQS(filter)}`),

  getSingleLeaderboard: (category: string, filter?: LeaderboardFilter) =>
    fetchAPI<{ category: string; display_name: string; unit: string; ranking: LeaderboardEntry[] }>(
      `/player-portal/leaderboards/${category}${leaderboardFilterQS(filter)}`
    ),

  getCompetitions: () =>
    fetchAPI<string[]>('/player-portal/competitions'),

  // Leaderboard visibility — a player's own opt-out from teammate-visible
  // leaderboards. Self-service only; doesn't affect their own dashboard.
  getLeaderboardVisibility: () =>
    fetchAPI<{ hide_from_leaderboards: boolean }>('/player-portal/leaderboards/me/visibility'),

  setLeaderboardVisibility: (hide: boolean) =>
    fetchAPI<{ hide_from_leaderboards: boolean }>('/player-portal/leaderboards/me/visibility', {
      method: 'PUT',
      body: JSON.stringify({ hide_from_leaderboards: hide }),
    }),

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

  getMyWorkload: () =>
    fetchAPI<{ workload_entries: WorkloadEntry[] }>('/player-portal/my-stats/workload'),

  getMyMatchGpsHistory: () =>
    fetchAPI<MatchGPSData[]>('/player-portal/my-stats/match-gps-history'),

  getMyQuarterProfile: () =>
    fetchAPI<QuarterProfile>('/player-portal/my-stats/quarter-profile'),

  getMyDisciplineTrend: () =>
    fetchAPI<DisciplineTrend>('/player-portal/my-stats/discipline-trend'),

  getMyKickoutOutcomes: () =>
    fetchAPI<KickoutTrendMatch[]>('/player-portal/my-stats/kickout-outcomes'),

  getMyKickoutZones: () =>
    fetchAPI<KickoutLandingZonesData>('/player-portal/my-stats/kickout-zones'),

  getMyPositionalBenchmark: () =>
    fetchAPI<PositionalBenchmark>('/player-portal/my-stats/positional-benchmark'),

  getMyAIInsights: () =>
    fetchAPI<AIInsight>('/player-portal/my-stats/ai-insights'),

  getMyChallenges: () =>
    fetchAPI<{ challenges: PlayerChallenge[] }>('/player-portal/my-stats/challenges'),

  getSeasonStory: () =>
    fetchAPI<SeasonStory>('/player-portal/my-stats/season-story'),

  getHeadToHead: (otherPlayerId: string) =>
    fetchAPI<HeadToHeadData>(`/player-portal/head-to-head/${otherPlayerId}`),

  getRoster: () =>
    fetchAPI<{ players: RosterPlayer[] }>('/player-portal/roster'),

  // Sleep tracking
  logSleep: (data: { hours_slept: number; quality?: number; notes?: string }) =>
    fetchAPI<SleepLogEntry>('/player-portal/sleep/log', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getSleepHistory: (days?: number) =>
    fetchAPI<SleepHistory>(
      `/player-portal/sleep/history${days != null ? `?days=${days}` : ''}`
    ),

  // Tagged clips (Phase 11, 10e) — slides a coach explicitly shared with this player
  getTaggedClips: () =>
    fetchAPI<{ clips: TaggedClipItem[] }>('/player-portal/tagged-clips'),

  getTaggedClipDetail: (slideId: string) =>
    fetchAPI<TaggedClipDetail>(`/player-portal/tagged-clips/${slideId}`),
};
