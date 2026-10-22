# Carry distance vs pass flight (the one place this is written down)

## How a video match is tagged
- A player carrying the ball: the tagger DRAGS the ball. That saves ball positions (possession_events: video_ms + pitch_x/y, a tick every ~0.2-1 s) and the carry's trail (ball_carrier_segments.path_points).
- A hand pass: the tagger TAPS the pitch where the pass goes and changes carrier at that moment -> the ball position JUMPS between two neighbouring ticks (typically 10-30 m in well under 1.6 s).
- A kick pass: the tagger picks kick pass and taps where; the kicker's carry ends where it was KICKED FROM (fixed 2026-10-13, commit 7974240).

## What is stored now (matches tagged after 2026-10-13)
carry.end = pass ORIGIN; the PASS_HAND event holds origin (pitch_x/y) and destination (end_x/y); the next carry starts at the destination.

## Older matches / carries that still hold the flight
Detect a pass from the BALL TIMELINE (not the carry trail: the trail lags the drag by 10-20 m, so "far from the last trail point" is NOT a tap - tried and rejected 2026-10-22): the biggest move between two neighbouring ticks, >= 6 m (calibrated metres) within 1.6 s, between 2.5 s before the carry ended and 0.7 s after the next carrier started. Validated against the app's own saved from/to: median error 0.0 m (Kerry: all 274 identical).
Guards (added 2026-10-22 after a first run went wrong and was fully restored from backup): the search window starts AFTER the carry began (a jump before that is the pass that gave this carrier the ball); the app's own saved from/to is used when it exists; a detected tap must land within 3 m of the next carrier's start. With those, only 49 carries (648 m) needed trimming across the four matches - the earlier '339 / 4.9 km' was inflated by the bug.
Backfill: `backend/scripts/backfill_pass_flights.py` (dry run by default; `BACKUP=1` prints the before-state, `APPLY=1` writes). Run 2026-10-22 on Down, Dublin, Cork, Kerry: 49 carries trimmed (648 m of pass flight moved out of carries); pass events filled where a PASS_HAND existed (flagged `scoring_context.pass_flight_estimated`). Backups: `docs/backups/carry-flight-backfill-2026-10-22-v2.jsonl` (the applied run) and `...-22.jsonl` (first run, restored). Idempotent (a second run changes nothing).

## Metres
`backend/app/utils/pitch_calibration.py` is the only place that turns a drawn position into metres: `along_m` / `lateral_m` / `position_m` / `distance_m` (drawing lines at their real 13/20/40/45/65 m, per-match `pitch_length_m` / `pitch_width_m`, default 145 x 80). Never `pct * length`.
- Report carry gain (`avg_gain_x_metres`, get_ball_carrier_data): per-carry calibrated, done 2026-10-22.
- STILL on their own scale: leaderboard Orchestrator carry distance, Team Volume chart, the frontend Paths Taken metres (+77m etc.). Move them onto `distance_m`.
