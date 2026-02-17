// Type definitions for the GAA Analytics app

export interface Club {
  id: string;
  name: string;
  short_name: string | null;
  county: string | null;
  province: string | null;
  home_ground: string | null;
  primary_colour: string | null;
  secondary_colour: string | null;
  logo_url: string | null;
  is_active: boolean;
  onboarding_completed: boolean;
  created_at: string;
}

export interface Player {
  id: string;  // UUID
  name: string;
  position: string;  // Using string to match backend
  jersey_number: number | null;
  date_of_birth: string | null;
  status: string;  // Using string to match backend
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

export enum PlayerPosition {
  GOALKEEPER = 'goalkeeper',
  DEFENDER = 'defender',
  MIDFIELDER = 'midfielder',
  FORWARD = 'forward',
}

export enum PlayerStatus {
  ACTIVE = 'active',
  INJURED = 'injured',
  SUSPENDED = 'suspended',
  INACTIVE = 'inactive',
}

export interface Match {
  id: string; // UUID
  opponent: string;
  match_date: string;
  venue: string;
  is_home: boolean;
  status: string;
  competition?: string;
  team_goals: number;
  team_points: number;
  opponent_goals: number;
  opponent_points: number;
  weather_condition?: string | null;
  temperature_celsius?: number | null;
  started_at: string | null;
  completed_at: string | null;
  current_phase?: string | null;
  second_half_started_at?: string | null;
  attacking_right_first_half?: boolean | null;
  created_at?: string;
  updated_at?: string;
}

export enum MatchVenue {
  HOME = 'home',
  AWAY = 'away',
  NEUTRAL = 'neutral',
}

export enum MatchStatus {
  SCHEDULED = 'scheduled',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export interface MatchEvent {
  id: number;
  match_id: string; // UUID
  player_id: number | null;
  event_type: string;
  minute: number;
  half: number;
  pitch_x: number | null;
  pitch_y: number | null;
  is_home_team: boolean;
  notes: string | null;
  created_at: string;
}

export enum EventType {
  // Scoring (team determined by possession)
  GOAL = 'goal',
  POINT = 'point',
  TWO_POINT = 'two_point',
  WIDE = 'wide',
  SHORT = 'short',
  SAVED = 'saved',
  // Free kick scoring
  POINT_FREE = 'point_free',
  TWO_POINT_FREE = 'two_point_free',
  WIDE_FREE = 'wide_free',
  FORTY_FIVE = 'forty_five',  // 45m free scored - always 1 point
  FORTY_FIVE_MISSED = 'forty_five_missed',  // 45m free missed
  // Penalty
  PENALTY_GOAL = 'penalty_goal',  // Penalty scored (counts as goal)
  PENALTY_MISS = 'penalty_miss',  // Penalty missed (wide/saved)
  // Turnovers
  TURNOVER_LOST = 'turnover_lost',
  TURNOVER_WON = 'turnover_won',
  OUR_UNFORCED_ERROR = 'our_unforced_error',
  OPP_UNFORCED_ERROR = 'opp_unforced_error',
  // Kickouts - Explicit labels (no ambiguity)
  OWN_KICKOUT_WON = 'own_kickout_won',
  OWN_KICKOUT_OPPOSITION_WON = 'own_kickout_opposition_won',
  OWN_KICKOUT_WON_BREAK = 'own_kickout_won_break',
  OWN_KICKOUT_OPPOSITION_WON_BREAK = 'own_kickout_opposition_won_break',
  OPP_KICKOUT_WON = 'opp_kickout_won',
  OPP_KICKOUT_OPPOSITION_WON = 'opp_kickout_opposition_won',
  OPP_KICKOUT_WON_BREAK = 'opp_kickout_won_break',
  OPP_KICKOUT_OPPOSITION_WON_BREAK = 'opp_kickout_opposition_won_break',
  // Cards & fouls
  YELLOW_CARD = 'yellow_card',
  RED_CARD = 'red_card',
  FOUL_COMMITTED = 'foul_committed',
  FOUL_WON = 'foul_won',
  FREE_WON = 'free_won',
  FREE_CONCEDED = 'free_conceded',
  BLOCK = 'block',
  INTERCEPTION = 'interception',
  // Substitutions
  SUBSTITUTION = 'substitution',
  OTHER = 'other',
}

export enum Team {
  OWN = 'own',
  OPPONENT = 'opponent',
}

export enum PossessionTeam {
  OWN = 'own',
  OPPONENT = 'opponent',
  CONTESTED = 'contested',
}

export interface PossessionEvent {
  id: number;
  match_id: number;
  is_home_team: boolean;
  x_coord: number;
  y_coord: number;
  minute: number;
  half: number;
  created_at: string;
}

export interface MatchStats {
  match_id: string;
  team_possession_percentage: number;
  opponent_possession_percentage: number;
  team_total_shots: number;
  team_scores: number;
  team_wides: number;
  team_accuracy: number;
  team_conversion_rate: number;
  opponent_total_shots: number;
  opponent_scores: number;
  opponent_wides: number;
  opponent_accuracy: number;
  opponent_conversion_rate: number;
  team_turnovers_won: number;
  team_turnovers_lost: number;
  opponent_turnovers_won: number;
  opponent_turnovers_lost: number;
  team_kickouts_won: number;
  team_kickouts_lost: number;
  opponent_kickouts_won: number;
  opponent_kickouts_lost: number;
  team_yellow_cards: number;
  team_red_cards: number;
  opponent_yellow_cards: number;
  opponent_red_cards: number;
}

export interface PlayerMatchStats {
  id: string;  // UUID
  match_id: string;  // UUID
  player_id: string;  // UUID
  goals: number;
  points: number;
  assists: number;
  wides: number;
  turnovers_won: number;
  turnovers_lost: number;
  kickouts_won: number;
  kickouts_lost: number;
  created_at?: string;
  updated_at?: string;
}

// UI-specific types
export interface BallPosition {
  x: number;
  y: number;
  team: PossessionTeam;
}

export interface PitchZone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isTwoPointZone?: boolean;
}

