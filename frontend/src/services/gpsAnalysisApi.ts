/**
 * GPS analysis (Stage 2) client: GET /matches/{id}/gps/analysis/* and /gps-analysis/season. Read-only.
 * Positions from `analysis`, `heatmap` and `shape-series` are in OUR attack frame, in metres:
 * x = 0 our goal line .. pitch length their goal line, y small = our LEFT. `context` returns RAW screen 0-100
 * coordinates for carries/events: frame them with pointInSideFrame like any event.
 */
import { fetchAPI } from './api'

export interface GpsPos { player_id: string; name: string | null; x: number | null; y: number | null }

export interface GpsReplayContext {
  match_id: string
  opponent: string | null
  session: { id: string; first_half_start_ms: number | null; halftime_ms: number | null; second_half_start_ms: number | null; full_time_ms: number | null; et_first_half_start_ms?: number | null; et_halftime_ms?: number | null; et_second_half_start_ms?: number | null; et_full_time_ms?: number | null; duration_ms: number | null }
  attacking_right_first_half: boolean | null
  own_attacks_right_by_half: Record<string, boolean>
  periods: { half: number; video_start_ms: number; video_end_ms: number }[]
  sync: { status: string; periods: any[]; tag_lag: Record<string, { n: number; median_s: number; p25_s: number; p75_s: number }> & { _manual?: { shift_ms: number } }; computed_at: string | null; confirmed_at: string | null }
  pitch_length_m: number
  pitch_width_m: number
  players: Record<string, { name: string | null; jersey: number | null }>
  starters: string[]
  bench: string[]
  on_pitch: Record<string, [number, number][]>
  tracked: string[]
  carries: { team: 'own' | 'opponent'; player_id: string | null; half: number | null; start_x: number | null; start_y: number | null; end_x: number | null; end_y: number | null; video_ms: number; end_video_ms: number | null; ended_by: string | null; opposition_player?: string | null }[]
  events: { id: string; team: string; event_type: string; sub_type: string | null; half: number | null; video_ms: number; pitch_x: number | null; pitch_y: number | null; player_id: string | null; sub_in_player_id: string | null; opposition_player: string | null; match_minute: number | null; match_second: number | null }[]
}

export interface ShapeStats { length: number | null; width: number | null; compactness: number | null; area: number | null; centroid_x: number | null; deep6: number | null; seconds: number }

export interface GpsTransitionLost {
  video_ms: number; half: number | null; lost_by: string | null; spot_x: number | null; spot_y: number | null; how: string
  players_on: number; target: number; goal_side_at_0: number; goal_side: number[]; recovery_s: number | null; already_back: boolean
  retreat_5s_m: number | null; retreat_10s_m: number | null
  sprinted: { player_id: string; name: string | null; max_speed: number | null }[]
  did_not_sprint: { player_id: string; name: string | null; max_speed: number | null }[]
  outcome: string
}
export interface GpsTransitionWon {
  video_ms: number; half: number | null; won_by: string | null; spot_x: number | null; spot_y: number | null; players_on: number
  advance_10s_m: number | null; forward_runners: { player_id: string; name: string | null; gain_m: number | null; max_speed: number | null }[]
  n_forward_runners: number; outcome: string
}
export interface GpsKickout {
  video_ms: number; half: number | null; kind: 'own' | 'opp'; outcome: string; won: boolean; event_type: string; player: string | null
  landing_x: number | null; landing_y: number | null; team_mean_x: number | null; players_in_their_half: number; players_tracked: number
  sprinting_after: number; at_kick: GpsPos[]; after_6s: GpsPos[]
  moved: { player_id: string; name: string | null; dx: number | null; dy: number | null; dist: number | null; max_speed: number | null }[]
}
export interface GpsIntensityPlayer {
  player_id: string; name: string | null; minutes: number | null; distance_m: number; m_per_min: number | null; hsr_m: number; sprints: number; accels: number
  max_speed: number | null; distance_in_m: number; hsr_in_m: number; distance_out_m: number; hsr_out_m: number
  hsr_per_min_first10?: number | null; hsr_per_min_last10?: number | null; drop_off_pct?: number | null
  blocks: { half: number; block: number; distance_m: number; hsr_m: number; minutes: number | null }[]
}
export interface GpsBlock { half: number; block: number; label: string; team_distance_m: number; team_hsr_m: number; m_per_player_min: number | null; hsr_per_player_min: number | null; in_poss_share: number | null }
export interface GpsTagFlag { kind: string; id: string; event_type: string; player_id: string; player: string | null; video_ms: number; half: number | null; dist_at_tap_m: number | null; nearest_m: number | null; nearest_lag_s: number | null; reason: string }
export interface GpsShotAgainst { video_ms: number; half: number | null; event_type: string; shooter: string | null; shot_x: number | null; shot_y: number | null; nearest: string | null; nearest_m: number | null; within_5m: number; within_10m: number; assigned_marker: { name: string | null; dist_m: number | null; was_nearest: boolean } | null }
export interface GpsMoment { kind: string; video_ms: number; title: string; detail: string }

export interface GpsMatchAnalysis {
  match_id: string; opponent: string | null; match_date: string | null
  result: { team_goals: number; team_points: number; opponent_goals: number; opponent_points: number }
  pitch_length_m: number; pitch_width_m: number; sync_status: string
  summary: {
    by_half: Record<string, { team_distance_m: number; team_hsr_m: number; compactness_in: number | null; compactness_out: number | null; length_out: number | null }>
    shape: { in: ShapeStats; out: ShapeStats; set_piece?: ShapeStats }
    shape_by_half: Record<string, { in: ShapeStats; out: ShapeStats; set_piece?: ShapeStats }>
    transitions: { n_lost: number; n_won: number; already_back: number; caught_short: number; median_recovery_s: number | null; not_recovered_in_15s: number; median_retreat_10s_m: number | null; median_forward_runners: number | null; lost_led_to_score: number; won_led_to_score: number }
    fastest_recoveries: { video_ms: number; half: number | null; recovery_s: number; lost_by: string | null; outcome: string }[]
    drop_off: { player_id: string; name: string | null; minutes: number | null; hsr_per_min_first10: number | null; hsr_per_min_last10: number | null; drop_off_pct: number | null }[]
    team_distance_m: number; team_hsr_m: number; players_tracked: number
    possession_tagged_share_pct: number | null; in_possession_share_pct: number; set_piece_share_pct?: number | null
    kickout_push_up: Record<string, { n: number; team_mean_x: number | null; players_in_their_half: number | null }>
    tag_health: { checked: number; flagged: number }
    support: { n_passes: number; mean_within_15m: number | null; isolated_share_pct: number | null; further_option_share_pct: number | null }
    marking: { n_shots: number; median_nearest_m: number | null; median_nearest_m_scores: number | null; unpressured_share_pct: number | null }
  }
  transitions: { lost: GpsTransitionLost[]; won: GpsTransitionWon[]; summary: GpsMatchAnalysis['summary']['transitions'] }
  kickouts: { kickouts: GpsKickout[]; groups: Record<string, { n: number; team_mean_x: number | null; players_in_their_half: number | null }>; push_up_on_their_kickouts: Record<string, { n: number; team_mean_x: number | null; players_in_their_half: number | null }> }
  intensity: { players: GpsIntensityPlayer[]; blocks: GpsBlock[]; by_half: Record<string, { team_distance_m: number; team_hsr_m: number }>; thresholds: { hsr_ms: number; sprint_ms: number; accel_ms2: number } }
  tag_health: { checked: number; flagged: GpsTagFlag[]; n_flagged: number; untracked_player: number }
  support: { n_passes: number; mean_within_15m: number | null; isolated_share_pct: number | null; further_option_share_pct: number | null; players: { player_id: string; name: string | null; passes: number; isolated: number; further_option: number; mean_within_15m: number | null }[]; further_option_passes: { video_ms: number; half: number | null; passer: string | null; receiver: string | null; within_15m: number; nearest_ahead_m: number | null; gain_m: number | null; further_option: string | null; further_option_ahead_m: number | null }[] }
  marking: { shots: GpsShotAgainst[]; n_shots: number; median_nearest_m: number | null; median_nearest_m_scores: number | null; unpressured_share_pct: number | null; has_assignments: boolean }
  moments: GpsMoment[]
  computed_in_s: number
}

export interface GpsShapeSeries { video_ms: number[]; half: number[]; poss: number[]; length: (number | null)[]; width: (number | null)[]; compactness: (number | null)[]; area: (number | null)[]; centroid_x: (number | null)[]; deep6: (number | null)[] }

export interface GpsHeatmap { cell_m: number; nx: number; ny: number; pitch_length_m: number; pitch_width_m: number; seconds: number[][]; total_seconds: number; thirds_pct: number[]; mean_x: number | null; mean_y: number | null }

export interface GpsSeasonRow {
  match_id: string; opponent: string | null; match_date: string | null; result: 'W' | 'L' | 'D'; score: string
  compactness_out_m: number | null; length_out_m: number | null; compactness_in_m: number | null
  median_recovery_s: number | null; not_recovered_in_15s: number; turnovers_lost: number; median_forward_runners: number | null
  hsr_per_player_min: number | null; m_per_player_min: number | null; push_up_mean_x_m: number | null
  support_within_15m: number | null; shots_against_nearest_m: number | null; tag_flags: number
}
export interface GpsLoadAlert { player_id: string; name: string | null; match_id: string; opponent: string | null; match_date: string | null; minutes: number | null; hsr_m: number; hsr_per_min: number | null; sprints: number; distance_m: number; own_avg_hsr_per_min: number; vs_own_avg_pct: number; direction: 'above' | 'below' }
export interface GpsSeason { matches: GpsSeasonRow[]; load_alerts: GpsLoadAlert[]; players: Record<string, { name: string | null; matches: { match_id: string; opponent: string | null; match_date: string | null; minutes: number | null; hsr_m: number; hsr_per_min: number | null; sprints: number; distance_m: number }[] }>; note: string }

export const gpsAnalysisApi = {
  context: (matchId: string) => fetchAPI<GpsReplayContext>(`/matches/${matchId}/gps/analysis/context`),
  analysis: (matchId: string) => fetchAPI<GpsMatchAnalysis>(`/matches/${matchId}/gps/analysis`, { timeoutMs: 60000 }),
  shapeSeries: (matchId: string, stepS = 2) => fetchAPI<GpsShapeSeries>(`/matches/${matchId}/gps/analysis/shape-series?step_s=${stepS}`, { timeoutMs: 60000 }),
  heatmap: (matchId: string, opts: { playerId?: string; half?: number; state?: 'all' | 'in' | 'out' }) => {
    const q = new URLSearchParams()
    if (opts.playerId) q.set('player_id', opts.playerId)
    if (opts.half) q.set('half', String(opts.half))
    q.set('state', opts.state || 'all')
    return fetchAPI<GpsHeatmap>(`/matches/${matchId}/gps/analysis/heatmap?${q.toString()}`, { timeoutMs: 60000 })
  },
  season: () => fetchAPI<GpsSeason>(`/gps-analysis/season`, { timeoutMs: 120000 }),
}

/** Video ms -> "23:14" (minutes into the video, not the match clock). */
export function videoClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`
}

/** Seconds into the period (period start = its throw-in mark in the video) -> "12:05". */
export function periodClock(ms: number, periods: { half: number; video_start_ms: number }[]): string {
  const ps = [...periods].sort((a, b) => a.video_start_ms - b.video_start_ms)
  let cur = ps[0]
  for (const p of ps) if (ms >= p.video_start_ms) cur = p
  if (!cur) return videoClock(ms)
  const label = cur.half === 1 ? '1H' : cur.half === 2 ? '2H' : cur.half === 3 ? 'ET1' : 'ET2'
  return `${label} ${videoClock(ms - cur.video_start_ms)}`
}

export const COLOR_OURS = '#0d9f6e'     // validated pair (dataviz validator, dark surface): ours / in possession
export const COLOR_THEIRS = '#e8620f'   // theirs / out of possession
