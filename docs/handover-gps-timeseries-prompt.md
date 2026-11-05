# Handover prompt: GPS time-series + video sync agent

You are taking on a major feature for ONEStat, a GAA football analytics SaaS: raw GPS TIME-SERIES ingestion, video sync, and new visualisations. The product owner is Owen. Read these first, in order:
1. PRODUCT.md and DESIGN.md in the repo root (design system: dark glass, emerald/cyan on near-black; tablets and laptops lead, phones must work; every async action needs a spinner and status line).
2. Memory notes project-handover-gps-timeseries-agent.md and project-gps-timeseries-plan-and-notes.md (in the project memory folder under C:\Users\owen_\.claude\projects\...\memory). They are about three weeks old, so verify any file or function they name before relying on it.

## The job

Until now GPS in the app meant per-player SUMMARY rows (MatchGPSData: distance, HSR, sprints, load...), uploaded via backend/app/routes/match_gps.py (/gps/upload|preview|confirm), parsed by services/gps_parser_flexible.py, confirmed in GPSConfirmModal.tsx. Donegal's GPS is a full time series (every player's position over time, around 10Hz). That has never been done here. Build:

1. **A smooth upload.** The Upload GPS flow must detect and say whether a file is a full time series or the usual summary, keep the summary path working untouched, and guide the user.
2. **Compact storage.** Do NOT put one row per sample into the main event tables. Propose a design first (the earlier plan was one compressed blob per player per match, plus a sync table holding offset, anchors and drift).
3. **Sync to video.** GPS clock to video clock. Notes from Owen, unverified: STATSports stamps UTC wall-clock; anchor first-half and second-half throw-in frames to UTC and re-anchor at half time; lat/lon to pitch needs the four corner-flag coordinates (145 m x about 90 m). Some exports are event or burst lists rather than full 10Hz, so detect that. Match start, half time, second-half start and full time are already marked in the prod DB for tagged matches; read them rather than asking.
4. **Views and insights** (see below).
5. **Event click-to-play lead.** utils/videoSeek.ts EVENT_SEEK_LEAD_MS is 4000 ms, which is too short because tagging lags the action. Make it per event type and ideally measured from the GPS sync. It must also feed the analyst chat agent's clip tool (create_video_compilation).

## Matches (5 fully tagged, all with video)

Club: Donegal GAA 74a08940-6066-40dc-8bcf-6fd3e1ed3dad. Look up the match and video-session ids in the prod DB (matches / video_sessions tables).

| Date | Opponent | Competition | Result (Donegal first) |
|---|---|---|---|
| 29/03/2026 | Kerry | Allianz League Div 1 Final (neutral) | 3-20 v 2-10, W. Match 2e2c93b6-4b21-4386-b635-b5cf05126999, video session 56e89389-f73f-4e10-af93-33f15d27a2af |
| 26/04/2026 | Down | Ulster SFC Quarter-Final (home) | 1-21 v 3-21, L. Match 75fb4fe0-3593-4f7b-8808-fc42c20b1358, video session afa665a9-f722-46ac-ac62-a5a8eb89761e. First full GPS file. |
| 23/05/2026 | Kerry | All-Ireland SC Round 1 (away) | 2-20 v 0-16, W |
| 13/06/2026 | Cork | All-Ireland SC Round 2 (home) | 1-13 v 0-17, L |
| 21/06/2026 | Dublin | All-Ireland SC Round 3 (away) | 2-22 v 2-26, L |

Ask Owen for the GPS files and their column names (one per match) before designing the parser. Inspect the real files first. Expect differences between files; the parser must not assume the Down file's shape.

## Think big, with evidence

This is the first time the app can see OFF-BALL movement. We already have rich on-ball data: tagged events with x/y, ball carrier segments with paths, possession chains, kickouts, turnovers, all with video timestamps. Combining the two is the product. Before building views, write a short proposal with at least 10 ideas, ranked by coach value and effort. Seed ideas, not limits:

- Replay: all 15 players moving on the pitch synced to the video, with the ball carrier highlighted and the tagged event overlay.
- Defensive shape: line depth, width, compactness, team length over time; shape at each kickout, turnover and scoring chance; how it changes when we lose possession.
- Transition: how fast the team gets behind the ball after a turnover; the sprint response; who reacts first.
- Marking: marker-to-opponent separation (only where an opposition marker is known); who was nearest the ball carrier when a score or turnover happened.
- Support play: runners off the ball, distance and angle of options at each pass; passes that skipped an open runner.
- Kickout geometry: where players stand before the kickout, who ran where, and the effect on the outcome; the push-up pattern by half.
- Fatigue and intensity: speed and distance by phase, by 5-minute block, and by position; the drop-off before substitutions.
- Heat maps and occupation: per player, per phase (in possession or out), attack-direction aware.
- Cross-match trends over the 5 games: how shape, intensity and transition speed differ in wins and losses.
- Validation: check tagged carriers and pass distances against real positions and flag likely mis-tags (a data-health check).
- Coach outputs: a "key moments" reel, a Match Result section, and agent tools so the analyst chat can answer "how compact were we after turnovers?" with numbers plus clips.

Owen decides which ideas get built. Present the proposal and wait for his pick before building the views. Plan the plumbing (storage, sync) first.

## Rules

- **Stay on the task.** If you find a bug, tech debt, a design issue or a risky pattern that is NOT needed for this task, do not fix it. Append it to `discoveries.md` in the repo root (template already there): date, file path, what you saw, why it matters, suggested fix. Then carry on. If an issue blocks or directly affects this task, fix it and mention it in your summary.
- Always use the PRODUCTION database (never local .env). Supabase host db.uzfwzatdyvnqwurkxhrr.supabase.co port 6543. Prod scripts run through flyctl ssh console (upload with flyctl ssh sftp put, which won't overwrite, so use a new filename each time).
- Migrations: apply BEFORE deploying code, and check for locks first. No backend deploys while a match is being live-tagged. Ask Owen if unsure.
- Deploy to prod after each completed stage: frontend `npx vercel --prod --yes --scope owenodgitpulls-projects` from the repo root; backend `flyctl deploy --remote-only` from backend/.
- Pitch geometry is 145 m app-wide. Raw pitch_x is direction-blind: ALWAYS use the attack-direction helpers (backend app/utils/attack_direction.py, frontend utils/attackDirection.ts).
- Never lose or alter existing tagged data. Ask before anything destructive. Take a JSON backup before touching match data.
- No loose LLM calls from pages. Agent features go through the existing agents and tools in backend/app/services/ai/.
- Performance: 10Hz x 15 players x 80 minutes is about 700k points per match, times 5 matches. Use downsampling and windowed loading in the browser.
- Report honestly: what you verified in the running app versus what you assumed.
- Commit often; keep commits small and staged.
