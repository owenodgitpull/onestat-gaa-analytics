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
