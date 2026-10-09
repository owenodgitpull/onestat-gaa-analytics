# Inputs for the "agents' tactical analysis + real-time insights" plan (2026-10-09)

Answers to the four things the planning agent asked for. Files in this folder:

| file | what it is |
|---|---|
| `01-data-schema.md` | Generated from the SQLAlchemy models: every `EventType` value, `Team`, and the columns of `MatchEvent`, `VideoEvent`, `TacticalTag`, `PossessionEvent`, `BallCarrierSegment`, `FormationSnapshot`, `MatchGPSData`, `LiveInsight` and more |
| `02-live-insight-system-prompt.txt` | The real assembled system prompt + user prompt the 5-minute live insight sends (captured from production for a sample match, with `GAA_ESSENTIALS`, club context and KB context filled in) |
| `03-live-insight-tools.json` | The 5 tool schemas the live insight can call (`get_live_match_stats`, `get_match_events`, `get_ball_carrier_data`, `get_formation_snapshots`, `get_tactical_tags`) |
| `04-live-insight-sample-input.json` | One real sample of the 5-minute input: the recent events, the per-player concern snapshot, the "already flagged" note, and the actual output of `get_live_match_stats`, `get_tactical_tags`, `get_ball_carrier_data` and `get_formation_snapshots` for Dungloe v St Eunans (video-tagged, to ~minute 34) |

## 1. MatchEvent schema, event type names, tag type names
See `01-data-schema.md`. Key points:
- Live Recording and Video Tagging write the SAME `match_events` table. Video events are mirrored live (`video_events.match_event_id`).
- `Team` is `own` / `opponent`. Video events use `team_a` (us) / `team_b` (them) and VIDEO type names (GOAL_SCORED, POINT_SCORED, BLOCK_SHOT, FREE_KICK, PASS_HAND, LONG_KICK_PASS…); mapping is in `backend/app/services/video/event_mapper.py`.
- An opposition foul is stored as `foul_won` for `own` in BOTH modes (aligned 2026-10-09).
- Free short pass / free high ball are `free_short_pass` / `free_high_ball` in both modes.
- Tactical tag types (`TacticalTag.tag_type`): `high_press`, `blanket_defence`, `formation_change`, `custom` (free-text `label`).
- Coordinates are raw screen coordinates and direction-blind — always convert with the attack-frame helpers (`docs/pitch-coordinates.md`). Pitch is 145m x 90m.

## 2. Do ball-location tags carry team and player?
- `TacticalTag` (the tag button): has a pitch position, half, minute — **no team, no player**.
- `PossessionEvent` (ball-location samples / drag path): has **team** (`own`/`opponent`/`contested`) and duration, **no player**.
- `BallCarrierSegment` (ball-carry tracking): has **team and player** (our players only — opposition individuals are never tracked), drawn path points, start/end positions and `ended_by`.
- `BallPositionSample` (legacy video telemetry): team (`team_a`/`team_b`), no player.
- Match events carry `team`, and `player_id` for our players (opposition events only optionally carry `opponent_player_name`).

## 3. What GPS do we have?
- **Our own players only.** `match_gps_data` = one row per player per match (STATSports PDF/CSV upload AFTER the match): total distance, high-speed running, sprint distance/count, accelerations/decelerations, max/avg speed, player load, heart-rate, minutes played. Training GPS is the same (own squad).
- **No opposition GPS.** **No time series** (no 5-minute splits) — so GPS cannot feed a live 5-minute insight today; the "Team Volume (5-min)" chart is built from events, not GPS.

## 4. Current match-agent prompt and a sample five-minute input
See files `02`, `03`, `04`. Things the planner should know about how it runs today:
- The live insight runs on **Haiku 4.5** (max 200 tokens, max 2 tool turns). The post-match report, Season and Chat agents run on **Sonnet 5.5** (switched 2026-10-08).
- Interval trigger: `LiveInsightsService._check_interval_trigger` fires every 5 match minutes (first at minute 5); also pattern triggers (scoring run, drought, turnover crisis). **Known bug:** its half-change arithmetic hard-codes a 30-minute half — it must use the match's `half_duration_mins` (club 30 / inter-county 35).
- It already has a repeat-suppression mechanism (`flagged_concerns` + the "already flagged" note).
- Output is hard-capped to 2–3 sentences / <80 words (small sidebar widget). Insights are stored in `live_insights` but are not yet shown on the Match Result page (planned: timeline for Jim).
- Video Tagging does not generate live insights yet (deferred until a clean full-match run).
