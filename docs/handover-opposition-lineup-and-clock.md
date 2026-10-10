# Handover — opposition lineup (inter-county), match clock seconds, Video Tagging save queue (2026-10-10)

## Shipped and deployed
**Match clock seconds** — `match_clock_s` (game-clock seconds at the tap = minute*60+seconds) on `match_events`, `possession_events`,
`tactical_tags`, `ball_carrier_segments`. Live Recording stamps it centrally in `frontend/src/services/offline/offlineApi.ts`
(`setMatchClockProvider`, registered by MatchRecording; reads a ref, no requests). Video Tagging sends `match_minute*60+match_second`
(events mirror via `live_sync`, possession points / tags / carries explicitly). Verified on prod for the video path; **live path not yet
verified on a real live match**. Known gap: `resyncLocalEvents` (post-refresh recovery) rebuilds from the local copy, which has no clock.

**Video Tagging save queue** — `frontend/src/services/videoWriteQueue.ts` + `hooks/useVideoEvents.ts`. A create that fails for a
server/network reason (no response, 5xx, 408, 429) stays on screen and is re-sent (backoff 3s→30s, on `online`, on mount) until saved;
a 4xx rejection is removed with the popup. Idempotent on the server through `video_events.client_event_id` (migration b069, partial
dedupe in `POST /video/events/{session}`). A "n events waiting to save" pill (`components/video/PendingWritesPill.tsx`) shows in both
the normal and fullscreen layouts. Update/delete behaviour is unchanged (retry 502-504 then roll back).

**Opposition lineup — inter-county only** (gate: `clubs.team_level == 'inter_county'`, mapped to features in `backend/app/utils/features.py`;
the frontend reads `club.features.opposition_lineup`; clubs see no change). "Donegal GAA" (club 74a08940…) is set to inter_county.
- Tables (b068): `opposition_teams`, `opposition_players` (surname only), `opposition_lineup` (per match, same slot ids as our lineup);
  `matches.opposition_team_id`, `match_events.opposition_player_id`; `ball_carrier_segments.opposition_player_id` (player_id now nullable,
  CHECK exactly one).
- API: `GET/PUT /match-prep/matches/{id}/opposition-lineup` (prefills from the last lineup vs the same team); the lineup also rides in
  `GET /matches/{id}` as `opposition_lineup`.
- UI: Match Prep → `OppositionLineupEditor` (15 + bench, jersey + surname, paste a team sheet).
- Recorders: when they have the ball, the carrier radial, pitch receiver dots and fullscreen strip show THEIR lineup in their strip
  colours and direction (`hooks/useOppositionSquad.ts`; Live Recording + fullscreen + Video Tagging). Their carrier is held in separate
  state (`activeOppCarrierId`) so none of the own-team logic can see it. A different opposition carrier = one pass (keeps the PPDA count).
- Analysis: `get_ball_carrier_data` is now per team (pass network, chains, tempo, gain) with an `opposition` section when their carriers are
  tracked; own output is byte-identical where no opposition data exists (checked against prod). `opposition_ball_path` (ball-path log,
  every match) is added to the tool and the live brief ("THEIR BALL MOVEMENT"); the post-match report prompt has rule 7f.
  NB: older matches had a few of OUR players stored on `opponent`-team segments; they no longer count in "our" carry stats
  (e.g. 138 → 129 carries on one match).

## Not done yet
- Opposition substitutions (Us/Them toggle in the substitution modal; lineup `is_on_field` + clock).
- Prefill "who scored / lost it" from the active opposition carrier (and write `opposition_player_id` on the event).
- "THEIR score" tint on the scoring buttons when they have the ball; opposition carrier name in the Video status label.
- Season agent: scout report per opposition team across fixtures (`opposition_teams`/`opposition_players` are ready for it).
- The seven phases (Stage A: `phase_facts.py`, PHASES block in `live_brief.py`, tools, prompts) — plan in
  `docs/agent-plan-inputs/05-phase-plan-amended.md`; the clock seconds it needs are now being captured.
- Replay the live insights (`backend/scripts/run_replay.py --label v11-opposition-movement`) and compare with v10.

## Operating lesson (2026-10-10 outage)
A migration on `matches` queued behind a stuck read and every save failed for ~6 minutes. Migrate FIRST (lock_timeout + retries, check
`pg_stat_activity`), then deploy code; the container's start-up `alembic upgrade head` is non-fatal and can leave code ahead of schema.
Memory: `feedback-migrations-during-live-recording`.
