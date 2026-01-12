// Type definitions for the Dungloe GAA Analytics app

export interface Player {
  id: string;
  name: string;
  position: PlayerPosition;
  jersey_number: number | null;
  date_of_birth: string | null;
  status: PlayerStatus;
  active: boolean;
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
  id: string;
  opponent: string;
  match_date: string;
  venue: MatchVenue;
  status: MatchStatus;
  dungloe_goals: number;
  dungloe_points: number;
  opponent_goals: number;
  opponent_points: number;
  started_at: string | null;
  completed_at: string | null;
  dungloe_total_score: number;
  opponent_total_score: number;
  result: 'win' | 'loss' | 'draw' | 'pending';
  notes: string | null;
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
  id: string;
  match_id: string;
  player_id: string | null;
  assist_player_id: string | null;
  event_type: EventType;
  team: Team;
  minute: number | null;
  pitch_x: number | null;
  pitch_y: number | null;
  notes: string | null;
  created_at: string;
  is_score: boolean;
  points_value: number;
  is_in_two_point_zone: boolean;
  player_name: string | null;
  assist_player_name: string | null;
}

export enum EventType {
  GOAL = 'goal',
  POINT = 'point',
  TWO_POINT = 'two_point',
  WIDE = 'wide',
  SHORT = 'short',
  SAVED = 'saved',
  TURNOVER_LOST = 'turnover_lost',
  TURNOVER_WON = 'turnover_won',
  KICKOUT_WON = 'kickout_won',
  KICKOUT_LOST = 'kickout_lost',
  OWN_KICKOUT_WON = 'own_kickout_won',
  OWN_KICKOUT_LOST = 'own_kickout_lost',
  OPP_KICKOUT_WON = 'opp_kickout_won',
  OPP_KICKOUT_LOST = 'opp_kickout_lost',
  BREAKING_BALL_WON = 'breaking_ball_won',
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
  id: string;
  match_id: string;
  team: PossessionTeam;
  pitch_x: number;
  pitch_y: number;
  minute: number | null;
  duration_seconds: number | null;
  created_at: string;
  zone_name: string;
  is_in_two_point_zone: boolean;
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
  id: string;
  match_id: string;
  player_id: string;
  player_name: string;
  goals: number;
  points: number;
  two_pointers: number;
  assists: number;
  wides: number;
  shots_short: number;
  shots_saved: number;
  turnovers_lost: number;
  turnovers_won: number;
  kickouts_won: number;
  kickouts_lost: number;
  breaking_balls_won: number;
  blocks: number;
  interceptions: number;
  yellow_cards: number;
  red_cards: number;
  frees_won: number;
  frees_conceded: number;
  minutes_played: number | null;
  started: boolean;
  total_score: number;
  accuracy: number | null;
  turnover_ratio: number | null;
  impact_score: number;
  ai_insights: Record<string, any> | null;
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

