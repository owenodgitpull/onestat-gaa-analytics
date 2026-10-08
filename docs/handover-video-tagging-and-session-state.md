# Handover — Video Tagging state + what the next agent must know (2026-10-09)

Read this first, then `C:\Users\owen_\.claude\plans\mcguinness-inter-county-readiness.md` (the plan) and the
memory index (`MEMORY.md`). Owen is the product owner; he tests live and reports by screenshot.

## Standing rules from Owen (do not re-ask)
- Always commit + push, and deploy to prod after every change (Vercel frontend, Fly backend). Production DB only.
  - Frontend: `npx vercel --prod --yes --scope owenodgitpulls-projects` from the repo root (first try sometimes
    returns "status error" — just rerun).
  - Backend: `flyctl deploy --remote-only` from `backend/`. A backend deploy restarts the machine and kills any
    background job running on it.
  - Local `.env` does NOT point at prod. Inspect prod only via the Fly machine (base64 python through
    `flyctl ssh console`); scripts used this session live in `%LOCALAPPDATA%\Temp\onestat_tmp\`.
- UX: glassmorphism, instant (optimistic) UI, no native browser pop-ups (use the glass dialog system), tablets +
  laptops are the priority (use `md:`).
- Half length is ALWAYS the logged-in club's setting (club 30 / inter-county 35) — dynamic, never hard-coded.
  Known leftover: `live_insights_service._check_interval_trigger` hard-codes 30.
- Attack direction: raw `pitch_x/y` are screen coords and direction-blind. Always use the frame helpers
  (`backend/app/utils/attack_direction.py`, `services/attack_frame.py`, `frontend/src/utils/attackDirection.ts`),
  see `docs/pitch-coordinates.md`. Guard tests: `backend/tests/test_direction_guard.py`, `npm run check:direction`.
- Tenant isolation: every endpoint taking an id must prove it belongs to the caller's club
  (`backend/app/auth/tenancy.py`; guard test `tests/test_tenant_guard.py`). AI tools fail closed with no club.
- Real club is "Dungloe GAA" (club id starts `0d9be653`). Other "Dungloe GAA"/test accounts exist — always
  scope by club_id. The real club has 8 real matches; the St Eunans video one is
  `b109b5c1-d121-489f-9098-1ddfa12ed3a7` (session `f313c211-abd0-4a47-8874-21a27562041e`), tagged to ~20:54 so far.
  Dungloe v Termon `96d8b18c-d953-4480-89d5-ad0dd6e81169` is the completed LIVE-recorded comparison match.
- Opposition lineup + tactical coverage: NOT until Owen confirms video-vs-live parity ("one item at a time").

## What Video Tagging does now (shipped)
- Live write-through: every tagged event is saved straight into `match_events` (via `services/video/live_sync.py`),
  scores/PlayerMatchStats updated; `Match.video_tagging_in_progress` keeps the match out of season stats until done.
- Tracking vs Review mode (nothing recorded while reviewing; "Review last 10 seconds"; auto-return).
- Undo to Point: deletes events/possession/carry segments after a video time, restores possession, ball spot
  (page ball-history first, else last server possession row) and carrier; shows an amber "Rolled back" banner.
  Carry segments now store `video_timestamp_ms`; older segments (first ~8 min of St Eunans) have none, so undo
  cannot cut them.
- Possession is measured in video time (rows carry `video_ms`; drag waypoints now get their own times).
- Open prompts (free outcome, 45, block recovery, pickers…) survive a refresh (localStorage `vt-pending-<session>`).
- "Ball: Us/Opp" manual possession toggle (pitch toolbar next to Snap). Event click seeks 4s early
  (`utils/videoSeek.ts`). Long Kick Pass / High Ball with outcome chips; brought-forward free is opt-in.
- Charts on the video page now mirror the result page (Paths Taken, Scoreable Frees, Expected Points, Score
  Origins, Attack Efficiency, vs Season Average added 2026-10-09).
- All three AI agents + chart engine run on `claude-sonnet-5-5` (Haiku 4.5 sub-tasks and a few old Sonnet-4
  one-off endpoints were deliberately left).

## Known gaps / TODOs (not done)
- Parity audit: go through EVERY Live Recording button and confirm the same follow-on prompts and effects exist in
  Video Tagging (Owen found Block→"who recovered" missing; expects more). Memory: `project-video-live-followup-parity-audit-todo`.
- Update in-app guides/tour for Tracking vs Review (reminder memory exists).
- 5-minute live insights timeline on the Match Result page for Jim; video-tagging insights after Owen's clean run;
  re-run-insights tool for prompt tuning. Memory: `project-intercounty-live-insights-timeline-todo`.
- Agent-prompt tactical-awareness review (7 phases) — in the McGuinness plan.
- Season discipline view for brought-forward frees; high-ball/long-kick win-rate charts; retire pitch zones
  (x/y only); position editing in Live Recording; opposition lineup (deferred).
- Poss→Shots is capped so it can't exceed 100%; revisit after a long clean run.
- Re-time an event's video time was discussed and deliberately NOT built (order/possession side effects).
- Match reports on file were written by older models; regenerate when a match completes.
- Infra before All-Ireland series: 2 Fly machines, DB pool, alerts, load test (Fly shared-cpu was tried and
  failed health checks — keep performance-1x).

## Gotchas hit this session
- React `useMemo` stale deps (match loads after events); `useCallback` TDZ when referencing later-declared consts
  (use refs).
- Possession/segment "delete after" endpoints must use columns that exist (a bad column silently aborted undo).
- Dictation artefacts in Owen's messages (names/times) — confirm odd names/minutes against the data.
- Match clock = video position − offset, so playback speed does not affect it.
