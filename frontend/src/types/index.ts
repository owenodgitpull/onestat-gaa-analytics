// Type definitions for the Dungloe GAA Analytics app

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
  FULL_BACK = 'full_back',
  CORNER_BACK = 'corner_back',
  HALF_BACK = 'half_back',
  MIDFIELD = 'midfield',
  HALF_FORWARD = 'half_forward',
  CORNER_FORWARD = 'corner_forward',
  FULL_FORWARD = 'full_forward',
  GOALKEEPER = 'goalkeeper',
  SUBSTITUTE = 'substitute',
  OTHER = 'other',
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
  dungloe_goals: number;
  dungloe_points: number;
  opponent_goals: number;
  opponent_points: number;
  started_at: string | null;
  completed_at: string | null;
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
  x_coord: number | null;
  y_coord: number | null;
  is_home_team: boolean;
  notes: string | null;
  created_at: string;
}

export enum EventType {
  // Dungloe scoring
  GOAL = 'goal',
  POINT = 'point',
  TWO_POINT = 'two_point',
  WIDE = 'wide',
  SHORT = 'short',
  SAVED = 'saved',
  // Opponent scoring
  OPP_GOAL = 'opp_goal',
  OPP_POINT = 'opp_point',
  OPP_WIDE = 'opp_wide',
  // Turnovers
  TURNOVER_LOST = 'turnover_lost',
  TURNOVER_WON = 'turnover_won',
  OUR_UNFORCED_ERROR = 'our_unforced_error',
  OPP_UNFORCED_ERROR = 'opp_unforced_error',
  // Kickouts
  KICKOUT_WON = 'kickout_won',
  KICKOUT_LOST = 'kickout_lost',
  OWN_KICKOUT_WON = 'own_kickout_won',
  OWN_KICKOUT_LOST = 'own_kickout_lost',
  OPP_KICKOUT_WON = 'opp_kickout_won',
  OPP_KICKOUT_LOST = 'opp_kickout_lost',
  OWN_KICKOUT_BREAK_WON = 'own_kickout_break_won',
  OWN_KICKOUT_BREAK_LOST = 'own_kickout_break_lost',
  OPP_KICKOUT_BREAK_WON = 'opp_kickout_break_won',
  OPP_KICKOUT_BREAK_LOST = 'opp_kickout_break_lost',
  BREAKING_BALL_WON = 'breaking_ball_won',
  // Cards & fouls
  YELLOW_CARD = 'yellow_card',
  RED_CARD = 'red_card',
  FREE_WON = 'free_won',
  FREE_CONCEDED = 'free_conceded',
  BLOCK = 'block',
  INTERCEPTION = 'interception',
  OTHER = 'other',
}

export enum Team {
  DUNGLOE = 'dungloe',
  OPPONENT = 'opponent',
}

export enum PossessionTeam {
  DUNGLOE = 'dungloe',
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
  dungloe_possession_percentage: number;
  opponent_possession_percentage: number;
  dungloe_total_shots: number;
  dungloe_scores: number;
  dungloe_wides: number;
  dungloe_accuracy: number;
  dungloe_conversion_rate: number; // Added
  opponent_total_shots: number;
  opponent_scores: number;
  opponent_wides: number;
  opponent_accuracy: number;
  opponent_conversion_rate: number; // Added
  dungloe_turnovers_won: number;
  dungloe_turnovers_lost: number;
  opponent_turnovers_won: number;
  opponent_turnovers_lost: number;
  dungloe_kickouts_won: number;
  dungloe_kickouts_lost: number;
  opponent_kickouts_won: number;
  opponent_kickouts_lost: number;
  dungloe_yellow_cards: number;
  dungloe_red_cards: number;
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

