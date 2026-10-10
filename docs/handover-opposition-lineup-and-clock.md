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

## Opposition substitutions — shipped 2026-10-10 (later the same day)
Us/Them toggle in the manual-event / substitution modals (Live Recording + Video Tagging; the team toggle was previously hidden for
subs). Picking Them shows their on-field players (to come off) and bench (to come on) from the lineup. The event carries
`opposition_player_id` (off) and `opposition_sub_in_player_id` (on) (b070); the SERVER swaps the two lineup slots when the event is
written (`opposition_service.apply_substitution_event`, called from `MatchEventService.create_event` and the video `live_sync`
mirror), and swaps back when the event is deleted or undone — so it also works offline and with Undo to Point. The incoming player takes
the outgoing player's slot, so their circle appears where he left. The client applies the same swap to the cached match immediately.
Also fixed in the two modals: half length was hard-coded to 30 (`+ 30`); it now uses the match's half length.

## Not done yet (agreed to-do)
- **Prefill "who scored / who lost it" from the opposition carrier.** Today the opposition scorer prompt (`OppositionScorerStrip`) asks
  for a surname after each of their scores/forced turnovers. With their circles, if their carrier is already selected (#12 has the
  ball) the answer is known: attribute it automatically (one-tap confirm / change chip instead of a pop-up), write
  `opposition_player_id` on the event (the column exists) so scorers are real player ids, not free text. Saves a tap at the busiest
  moment. Keep the footedness step.
- **Season-agent scout report per opposition team.** `opposition_teams` / `opposition_players` persist across fixtures, so the season
  agent can answer "what do Tyrone do?": every fixture against them, their scores by zone/type, kickout and ball-movement profile
  (`opposition_ball_path`, `opposition` carry section), their threats (top scorers/links by player), and how the last meeting went
  against our approach — as a tool (`get_opposition_scout_report`) the season agent / pre-match brief calls. Needs the scorer prefill
  above (player ids on events) to be sharp.
- Their-score tint on the scoring buttons: judged NOT needed (the possession indicator already shows who has the ball and the user
  asked for no UX change beyond opposition circles). Revisit only if mis-taps show up in testing.
- The seven phases (Stage A: `phase_facts.py`, PHASES block in `live_brief.py`, tools, prompts) — plan in
  `docs/agent-plan-inputs/05-phase-plan-amended.md`; the clock seconds it needs are now being captured.
- Replay the live insights (`backend/scripts/run_replay.py --label v11-opposition-movement`) and compare with v10.

## Operating lesson (2026-10-10 outage)
A migration on `matches` queued behind a stuck read and every save failed for ~6 minutes. Migrate FIRST (lock_timeout + retries, check
`pg_stat_activity`), then deploy code; the container's start-up `alembic upgrade head` is non-fatal and can leave code ahead of schema.
Memory: `feedback-migrations-during-live-recording`.
