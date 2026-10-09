# Data schema for the agent plan (generated from the SQLAlchemy models, 2026-10-09)

Coordinates: `pitch_x` 0-100 along the pitch (0 = left goal on screen), `pitch_y` 0-100 across. Raw SCREEN coordinates, direction-blind: convert with the attack-frame helpers (`backend/app/utils/attack_direction.py`, see `docs/pitch-coordinates.md`). Real pitch = 145m x 90m.

## EventType (MatchEvent.event_type) — every value

`goal`, `point`, `two_point`, `wide`, `short`, `saved`, `hit_post`, `turnover_lost`, `turnover_won`, `tackle_won`, `unforced_error`, `kickout_won`, `kickout_lost`, `breaking_ball_won`, `breaking_ball_lost`, `own_kickout_won`, `own_kickout_opposition_won`, `own_kickout_won_break`, `own_kickout_opposition_won_break`, `opp_kickout_won`, `opp_kickout_opposition_won`, `opp_kickout_won_break`, `opp_kickout_opposition_won_break`, `own_kickout_sideline`, `opp_kickout_sideline`, `sideline_ball`, `yellow_card`, `black_card`, `red_card`, `free_won`, `free_conceded`, `point_free`, `two_point_free`, `wide_free`, `free_short_pass`, `free_high_ball`, `long_kick_pass`, `high_ball`, `forty_five`, `forty_five_missed`, `penalty_goal`, `penalty_miss`, `foul_committed`, `foul_won`, `block`, `interception`, `substitution`, `other`


## Team (MatchEvent.team)
`own`, `opponent`

### MatchEvent (`match_events`)
One row per tagged event (live recording AND video tagging write the same table; video events are mirrored via `video_events.match_event_id`).

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `player_id` | UUID | yes |
| `assist_player_id` | UUID | yes |
| `kickout_target_player_id` | UUID | yes |
| `sub_in_player_id` | UUID | yes |
| `event_type` | VARCHAR(32) | no |
| `team` | VARCHAR(8) | no |
| `minute` | INTEGER | yes |
| `pitch_x` | FLOAT | yes |
| `pitch_y` | FLOAT | yes |
| `notes` | VARCHAR | yes |
| `opponent_player_name` | VARCHAR(200) | yes |
| `under_pressure` | BOOLEAN | yes |
| `opposition_foot` | VARCHAR(1) | yes |
| `end_x` | FLOAT | yes |
| `end_y` | FLOAT | yes |
| `sub_type` | VARCHAR(50) | yes |
| `brought_forward` | BOOLEAN | no |
| `brought_forward_reason` | VARCHAR(50) | yes |
| `advanced_position_x` | FLOAT | yes |
| `advanced_position_y` | FLOAT | yes |
| `half` | INTEGER | yes |
| `client_event_id` | VARCHAR(64) | yes |
| `created_at` | DATETIME | no |

### VideoEvent (`video_events`)
Video-tagging source rows (event_type here uses VIDEO names, e.g. GOAL_SCORED, POINT_SCORED, BLOCK_SHOT, FREE_KICK, OWN_KICKOUT_WON, LONG_KICK_PASS, PASS_HAND). Team is `team_a` (us) / `team_b` (them). Mapping: `backend/app/services/video/event_mapper.py`.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `video_session_id` | UUID | no |
| `match_id` | UUID | no |
| `event_type` | VARCHAR(50) | no |
| `sub_type` | VARCHAR(50) | yes |
| `team` | VARCHAR(20) | no |
| `half` | INTEGER | no |
| `match_minute` | INTEGER | no |
| `match_second` | INTEGER | no |
| `video_timestamp_ms` | BIGINT | yes |
| `pitch_zone` | VARCHAR(20) | yes |
| `pitch_x` | FLOAT | yes |
| `pitch_y` | FLOAT | yes |
| `end_x` | FLOAT | yes |
| `end_y` | FLOAT | yes |
| `brought_forward` | BOOLEAN | no |
| `brought_forward_reason` | VARCHAR(50) | yes |
| `advanced_position_x` | FLOAT | yes |
| `advanced_position_y` | FLOAT | yes |
| `target_player_id` | UUID | yes |
| `player_id` | UUID | yes |
| `sub_in_player_id` | UUID | yes |
| `assist_player_id` | UUID | yes |
| `jersey_number` | INTEGER | yes |
| `player_confidence` | VARCHAR(10) | yes |
| `event_confidence` | VARCHAR(10) | yes |
| `scoring_context` | JSON | yes |
| `kickout_context` | JSON | yes |
| `match_event_id` | UUID | yes |
| `possession_chain_id` | UUID | yes |
| `possession_team` | VARCHAR(20) | yes |
| `description` | TEXT | yes |
| `opponent_player_name` | VARCHAR(200) | yes |
| `batch_index` | INTEGER | yes |
| `source` | VARCHAR(20) | no |
| `is_verified` | BOOLEAN | no |
| `created_at` | DATETIME | no |
| `updated_at` | DATETIME | no |

### TacticalTag (ball-location / moment tags) (`tactical_tags`)
`tag_type` values in use: `high_press`, `blanket_defence`, `formation_change`, `custom` (free-text `label`). Carries a pitch position (the ball's location when tagged) but has NO team and NO player column. `source` = live/video.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `tag_type` | VARCHAR(30) | no |
| `label` | VARCHAR(100) | yes |
| `half` | INTEGER | no |
| `minute` | INTEGER | yes |
| `timestamp_ms` | BIGINT | yes |
| `pitch_x` | FLOAT | yes |
| `pitch_y` | FLOAT | yes |
| `source` | VARCHAR(20) | no |
| `video_timestamp_ms` | BIGINT | yes |
| `created_at` | DATETIME | no |

### PossessionEvent (`possession_events`)
Ball-location samples with a TEAM (`own`/`opponent`/`contested`) and duration, but NO player.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `team` | VARCHAR(20) | no |
| `minute` | INTEGER | yes |
| `pitch_x` | FLOAT | yes |
| `pitch_y` | FLOAT | yes |
| `duration_seconds` | INTEGER | yes |
| `video_ms` | BIGINT | yes |
| `client_event_id` | VARCHAR(64) | yes |
| `created_at` | DATETIME | no |

### BallCarrierSegment (ball-carry tracking) (`ball_carrier_segments`)
Has team AND player (our players only — opposition individuals are never tracked) plus the drawn path (`path_points` JSON list of {x,y}), start/end, `ended_by`. `start_time_ms`/`end_time_ms` are wall-clock for live; `video_timestamp_ms` (video start time) only on segments created after 2026-10-08.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `player_id` | UUID | no |
| `jersey_number` | INTEGER | yes |
| `team` | VARCHAR(20) | no |
| `half` | INTEGER | no |
| `minute` | INTEGER | yes |
| `path_points` | JSON | yes |
| `start_x` | FLOAT | yes |
| `start_y` | FLOAT | yes |
| `end_x` | FLOAT | yes |
| `end_y` | FLOAT | yes |
| `start_time_ms` | BIGINT | yes |
| `end_time_ms` | BIGINT | yes |
| `ended_by` | VARCHAR(30) | yes |
| `source` | VARCHAR(20) | no |
| `video_timestamp_ms` | BIGINT | yes |
| `client_event_id` | VARCHAR(64) | yes |
| `sequence_number` | INTEGER | no |
| `created_at` | DATETIME | no |

### FormationSnapshot (`formation_snapshots`)
Our player positions at a moment (JSON `positions`).

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `half` | INTEGER | no |
| `minute` | INTEGER | yes |
| `timestamp_ms` | BIGINT | yes |
| `label` | VARCHAR(50) | yes |
| `positions` | JSON | yes |
| `client_event_id` | VARCHAR(64) | yes |
| `source` | VARCHAR(20) | no |
| `video_timestamp_ms` | BIGINT | yes |
| `created_at` | DATETIME | no |

### PossessionChain (`possession_chains`)
Derived possession chains.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `video_session_id` | UUID | yes |
| `match_id` | UUID | no |
| `team` | VARCHAR(20) | no |
| `start_zone` | VARCHAR(20) | yes |
| `end_zone` | VARCHAR(20) | yes |
| `outcome` | VARCHAR(30) | yes |
| `duration_seconds` | FLOAT | yes |
| `pass_count` | INTEGER | yes |
| `solo_count` | INTEGER | yes |
| `player_sequence` | JSON | yes |
| `jersey_sequence` | JSON | yes |
| `start_x` | FLOAT | yes |
| `start_y` | FLOAT | yes |
| `end_x` | FLOAT | yes |
| `end_y` | FLOAT | yes |
| `start_time_ms` | BIGINT | yes |
| `end_time_ms` | BIGINT | yes |
| `start_event` | VARCHAR(30) | yes |
| `end_event` | VARCHAR(30) | yes |
| `chain_length` | INTEGER | yes |
| `source` | VARCHAR(20) | yes |
| `created_at` | DATETIME | no |

### MovementArrow (`movement_arrows`)
Off-ball movement arrows.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `player_id` | UUID | yes |
| `jersey_number` | INTEGER | yes |
| `path_points` | JSON | yes |
| `start_x` | FLOAT | yes |
| `start_y` | FLOAT | yes |
| `end_x` | FLOAT | yes |
| `end_y` | FLOAT | yes |
| `label` | VARCHAR(30) | yes |
| `half` | INTEGER | yes |
| `minute` | INTEGER | yes |
| `video_timestamp_ms` | BIGINT | yes |
| `source` | VARCHAR(20) | no |
| `created_at` | DATETIME | no |

### BallPositionSample (`ball_position_samples`)
Legacy video telemetry (ball position every few seconds, keyed by video session; has possession_team team_a/team_b, no player).

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `video_session_id` | UUID | no |
| `video_timestamp_ms` | BIGINT | no |
| `pitch_x` | FLOAT | no |
| `pitch_y` | FLOAT | no |
| `possession_team` | VARCHAR(20) | no |

### PlayerMatchStats (`player_match_stats`)
Per-player match aggregates.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `player_id` | UUID | no |
| `goals` | INTEGER | no |
| `points` | INTEGER | no |
| `two_pointers` | INTEGER | no |
| `assists` | INTEGER | no |
| `wides` | INTEGER | no |
| `shots_short` | INTEGER | no |
| `shots_saved` | INTEGER | no |
| `shots_hit_post` | INTEGER | no |
| `turnovers_lost` | INTEGER | no |
| `turnovers_won` | INTEGER | no |
| `kickouts_won` | INTEGER | no |
| `kickouts_lost` | INTEGER | no |
| `breaking_balls_won` | INTEGER | no |
| `blocks` | INTEGER | no |
| `interceptions` | INTEGER | no |
| `yellow_cards` | INTEGER | no |
| `red_cards` | INTEGER | no |
| `frees_won` | INTEGER | no |
| `frees_conceded` | INTEGER | no |
| `minutes_played` | INTEGER | yes |
| `started` | BOOLEAN | no |
| `total_score` | INTEGER | no |
| `accuracy` | FLOAT | yes |
| `turnover_ratio` | FLOAT | yes |
| `ai_insights` | JSONB | yes |
| `created_at` | DATETIME | no |
| `updated_at` | DATETIME | no |

### MatchGPSData (GPS) (`match_gps_data`)
OUR players only (player_id FK to our club's players, STATSports PDF/CSV upload after the match). One row per player per match = TOTALS (distance, HSR, sprints, accels, load, HR). No opposition GPS and no time series / 5-minute splits.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `player_id` | UUID | no |
| `total_distance_m` | FLOAT | yes |
| `high_speed_running_m` | FLOAT | yes |
| `sprint_distance_m` | FLOAT | yes |
| `hml_distance_m` | FLOAT | yes |
| `max_speed_ms` | FLOAT | yes |
| `avg_speed_ms` | FLOAT | yes |
| `sprint_count` | INTEGER | yes |
| `acceleration_count` | INTEGER | yes |
| `deceleration_count` | INTEGER | yes |
| `dynamic_stress_load` | FLOAT | yes |
| `player_load` | FLOAT | yes |
| `avg_heart_rate` | INTEGER | yes |
| `max_heart_rate` | INTEGER | yes |
| `time_in_red_zone_mins` | FLOAT | yes |
| `step_balance_left_pct` | FLOAT | yes |
| `playing_minutes` | INTEGER | yes |
| `started_as_sub` | BOOLEAN | yes |
| `duration_mins` | FLOAT | yes |
| `notes` | TEXT | yes |
| `raw_data` | JSON | yes |
| `created_at` | DATETIME | yes |

### LiveInsight (`live_insights`)
Stored 5-minute / trigger insights shown on the live screen.

| column | type | nullable |
|---|---|---|
| `id` | UUID | no |
| `match_id` | UUID | no |
| `minute` | INTEGER | no |
| `half` | INTEGER | no |
| `trigger` | VARCHAR(30) | no |
| `insight` | TEXT | no |
| `trigger_context` | VARCHAR | yes |
| `flagged_concerns` | JSON | yes |
| `created_at` | DATETIME | no |
