# Discoveries (tech debt log)

Things found while working on something else. Do not fix them unless they block the current task. Owen reviews this file and picks items up later.

Entry format:

## YYYY-MM-DD - short title
- **Where:** file path and line
- **What:** what you saw
- **Why it matters:** impact
- **Suggested fix:** idea
- **Found while:** the task you were on

---

## 2026-11-05 - Dublin video session: 23 "estimated drift (TV clock check)" stoppages are not video drift
- **Where:** `video_sessions.clock_stoppages` for session 234c6ee4-f885-4d85-a394-eb72ec861ade (Donegal v Dublin, 21 Jun 2026); 23 entries of 10 s every 88.46 s of video from 2 467 444 ms to 4 330 188 ms, note "estimated drift (TV clock check)"
- **What:** They were added to make the match clock agree with the broadcast clock, on the assumption the video ran fast. The GPS sync measures the video rate directly: 0.9995 to 1.0005 on every period of every match (under 2 s across a half), so the video is not drifting 11%. The broadcast clock and the referee's clock simply differ (stoppages the TV clock ignores, or the other way round).
- **Why it matters:** Those stoppages move every second-half event's match minute by up to 3.8 minutes; the GPS, the video and the events disagree about the match clock in that half, and any "minute" based stat (5-minute blocks, time-on-pitch) is off for that match.
- **Suggested fix:** Decide which clock the app means by "match clock" (referee's, as everywhere else) and remove the 23 synthetic stoppages, then `restamp_session`. Keep the two real ones (water break / injury, 1 735 417 ms; 2 455 225 ms).
- **Found while:** GPS time-series sync (Stage 1), measuring drift per period.

## 2026-11-05 - Local backend venv: pandas is broken against the installed numpy
- **Where:** `backend/venv` (pandas 2.1.4 built for numpy 1.x, numpy 2.4.2 installed); `backend/requirements.txt` pins numpy 1.26.3
- **What:** `import pandas` fails with "numpy.dtype size changed, may indicate binary incompatibility". `services/gps_parser_flexible.py` imports pandas, so the summary-GPS flexible parser cannot run locally (prod builds from requirements.txt and is fine).
- **Why it matters:** Any local test or script touching pandas fails with a confusing error; the new GPS time-series code avoids pandas on purpose.
- **Suggested fix:** `pip install "numpy==1.26.3"` in the venv (or rebuild the venv from requirements.txt).
- **Found while:** GPS time-series Stage 1, checking which libraries the backend has.

## 2026-11-05 - Roster spelling vs the GPS unit names
- **Where:** `players` for Donegal GAA: "Eoin McGeehin" (STATSports unit says "E. McGeehan"); "CC. O'Donnell" is Conor O'Donnell's unit name
- **What:** The device-name matcher handles both with a 5-letter surname prefix rule and two-letter initials, so they match, but by fuzzy rules rather than exactly. The Match Minutes spreadsheet spells it McGeehan too.
- **Why it matters:** A roster rename or a new similar surname could make the fuzzy match ambiguous and the upload would ask the user to pick.
- **Suggested fix:** Set `gps_alias` on those two players ("E. McGeehan", "CC. O'Donnell") so the match is exact, or correct the roster spelling if McGeehan is right.
- **Found while:** GPS time-series ingestion.

## 2026-11-05 - Two players share jersey 24 in the Donegal roster
- **Where:** `players`: Ciarán Thompson and Conor McCahill both jersey_number 24; several players have no number (Michael Murphy, Oisín Gallen, Max Campbell ...)
- **What:** Roster numbers are incomplete / duplicated for an inter-county panel.
- **Why it matters:** Anything keyed on jersey number (video tagging pickers, lineup views) can show the wrong man.
- **Suggested fix:** Owen to check the panel numbers against the match programmes.
- **Found while:** GPS time-series ingestion (matching unit names to players).

## 2026-11-06 - Match Result header says "No GPS" on matches that have the raw GPS time series
- **Where:** `frontend/src/pages/MatchResult.tsx`, the GPS status pill beside Lineup (reads `gpsData`, the per-player summary rows)
- **What:** The pill only knows about the summary upload (MatchGPSData). On the five Donegal matches it says "No GPS" while the new GPS card right below shows the time-series numbers.
- **Why it matters:** Contradictory on the same screen.
- **Suggested fix:** Show "GPS tracks" when `api.matchGpsTimeseries.getSummary` has a synced sync, or derive the summary rows from the time series (proposal idea 5).
- **Found while:** GPS Stage 2, checking the Match Result GPS card.

## 2026-11-06 - Opposition-kickout event labels read badly
- **Where:** `frontend/src/utils/eventLabels.ts` (`humanEventType`) for `OPP_KICKOUT_OPPOSITION_WON`, `OWN_KICKOUT_OPPOSITION_WON_BREAK` etc.
- **What:** They render as "Opp Kickout Opposition Won" (seen in the GPS replay overlay and jump list).
- **Why it matters:** Hard to read at a glance; the GPS kickout tab uses "their kickout, lost clean" style instead.
- **Suggested fix:** Add overrides: "Their kickout: they kept it (clean)" / "Our kickout: lost on the break".
- **Found while:** GPS Stage 2 replay.

## The shared pitch artwork's arc is ~44.5 m, not the 40 m arc (tagging screens)
- **Where:** `frontend/public/pitch-svg.svg`, used by Video Tagging, live recording and the charts (not the GPS screens any more: `GpsPitch.tsx` now draws its own markings in metres).
- **What:** At 145 m the drawn arc reaches ~44 m from the end line (also noted in `docs/pitch-svg-geometry.md`). On the GPS replay every player standing on the real 40 m arc at a kickout was drawn ~4 m inside it.
- **Why it matters:** Tags placed "on the arc" by eye land ~4 m too far out; anything that reads "inside the 40 m arc" from a tag is off near the arc.
- **Suggested fix:** Redraw the arc at 40 m in the artwork (or draw markings in metres like GpsPitch). Do not touch stored tags.
- **Found while:** GPS off-the-ball tool (2026-11-07).

## Shots-against tab: frees included and single decimal distances from a tag
- **Where:** `backend/app/services/gps_analysis/metrics.py` `marking()` -> GPS "Shots against" tab.
- **What:** Includes scores from frees/45s (players stand off by rule) and shows e.g. "3.2 m" from the tagged shot spot, which is itself ~5 m out (measured on our own receptions: tag_accuracy median 4.9 m, Down).
- **Suggested fix:** Skip non-FROM_PLAY shots (loader now has `score_source`), show bands ("within 5 m") like `situations.py`.
- **Found while:** GPS off-the-ball tool (2026-11-07).

## Tagged spots sit nearer the middle of the pitch than the GPS
- **What:** Fitting tagged carry spots against the receiver's GPS gives a scale of 0.80-0.94 along the length on all 5 matches (tags compressed towards halfway), offsets under 2 m.
- **Why it matters:** Not a calibration fault (the kickout arc check puts the GPS right); it is how spots get placed by eye from the broadcast angle. Worth knowing for anything that reads distances from tags.
- **Found while:** GPS off-the-ball tool (2026-11-07).

## Dublin (21 Jun): Shea Malone's exit is not logged
- **What:** Malone started (lineup), has events up to 1st half 34', nothing after, and is brought back on at the break before extra time 2 ("on for Conor O'Donnell") with no substitution taking him off in between. His GPS shows only 1.4 km.
- **Why it matters:** His minutes cannot be worked out. The tools now say "minutes unknown" instead of 91, but the log itself is the fix.
- **Suggested fix:** Owen to check the video and add the missing substitution (probably at half-time). Tagged data left alone.
- **Found while:** checking the second Dublin report review (2026-11-08).

## Dublin: "one opposition score missing from the video tags" - WRONG, resolved 2026-11-09
- **What:** The video tags have all 25 Dublin scores. The GPS situations tool did not count FORTY_FIVE as a score, so it said 24. Fixed in `situations.py` (45s now counted, as set pieces).

## Dublin extra time 1, 70:46: the GPS frame looks wrong
- **What:** At R. McGarry's point (shot from ~21 m out) all our tracked players are 40 m+ from our goal and Roarty is at y = -5 m (off the field). This produced the "97.5 m wide" shape the report quoted (now filtered: units off the field are left out of the shape).
- **Why it matters:** The extra-time sync may have drifted, which would affect every extra-time GPS moment in this match.
- **Suggested fix:** Check the ET1 sync offset on the GPS sync check screen against a clear extra-time moment.
- **Found while:** second Dublin review (2026-11-08).

## Dublin: opposition lineup has C. O'Callaghan on the bench - RESOLVED 2026-11-09
- **What:** Not a data-entry error: the opposition lineup table holds the lineup as it is NOW (each tagged substitution swaps slots, and the starter flag followed), so every reader showed the finishing XV as the starting one. Fixed by rebuilding the start from the tagged substitutions (`opposition_service.starting_slots`), used by the match API (start_position_id / started), the lineup viewer, the agents' opposition lineup and the impact tool. Owen's entered positions were correct (they match the TV team graphic); a pasted team-sheet text with different positions was applied by mistake on 2026-11-09 and reverted the same day. All 5 matches had the same storage issue; no stored slots were changed for the other four.

## Two guard tests fail on code that is actually fine
- **What:** `tests/test_tenant_guard.py` flags the four `/gps/analysis/*` routes (they do check the club, through `_match` -> `match_row(db, id, user.club_id)`, which the static scan cannot see), and `tests/test_direction_guard.py` flags `services/gps_analysis/situations.py` (it frames points with `frame.frame_point`, which wraps `to_attack_frame`, not one of the listed marker names).
- **Suggested fix:** teach both scans the helper names (`match_row`, `frame_point`) rather than changing the code.
- **Found while:** KPI audit (2026-11-10). Failing before today's changes.

## Season KPI colour thresholds are club-level
- **What:** Card colours use club-grade bands (e.g. points conceded from play: green under 5, red over 8; opponent inside-45 entries: red over 22). Inter-county figures (19 from play, 31 entries a game) are red on every card regardless of how good they are for that level.
- **Suggested fix:** thresholds per level (club / inter-county) or relative to the team's own season. Owen to decide.
- **Found while:** KPI audit (2026-11-10).

## Dublin: McGee's GPS unit stops at half-time
- **What:** J. McGee's track covers the whole first half and nothing after (37.9% of the match), while the tags show him playing the second half (scores at 61' and 63') and extra time. A track counts only above 50% coverage, so he shows as "no unit" on the replay and his first half is also dropped. No other unit picked up his second half.
- **Suggested fix:** check whether a second-half file exists for his unit; and/or use partial tracks for the time they cover (show the dot, note "no GPS after half-time").
- **Found while:** Owen's question on the replay (2026-11-11).

## A backspace character in useVideoEvents.ts
- **What:** `frontend/src/hooks/useVideoEvents.ts` contains a literal backspace (0x08) character - probably a regex `\b` written through a shell. Not from today's work; not checked whether it breaks anything.
- **Found while:** scanning for the same slip in the report checker (2026-11-11).

## 2026-11-11 Dublin match: substitutions the GPS contradicts
- Half-time: Malone off, Oisín Gallen on is not tagged at all (GPS: Malone off the pitch for the whole 2nd half and ET1, Gallen on from the 2nd-half throw-in). Owen to confirm before anything is added.
- Roarty off (tag ET1 72:03) and Sean Martin off (tag ET1 71:27): GPS has both off from the ET1 throw-in, so the tags are about 1.5-2 minutes late. Left as tagged.
- `frame.on_pitch_intervals`: a SUB_ON for a player the log still has on the pitch overwrites his open spell, so his earlier minutes are dropped from the GPS replay/metrics. Only matters while an exit is untagged.
- Raw zip check: J. McGee and E. McHugh units both stop at 12:56 (about a minute after half-time); no other file in the export carries their data.
