# GPS time-series: build handover (Stage 2)

For the agent building the GPS views. Stage 1 (2026-11-05) built and verified the plumbing: upload detection,
packed storage, lat/lon to pitch, and the GPS-clock to video-clock sync, on all five Donegal 2026 matches in
production. Read in this order: this file, `docs/gps-timeseries-design.md` (why things are shaped this way),
`docs/gps-ideas-proposal.md` (what Owen can pick from), `docs/pitch-coordinates.md` (attack direction rules,
not optional). Do not rebuild anything listed under "What exists"; call it.

## What exists (all deployed to prod, migration b077 applied)

Backend, `backend/app/services/gps_timeseries/`:

| module | use it for |
|---|---|
| `parser.py` | `detect_file_kind(head_bytes)` -> `timeseries` / `timeseries_sparse` / `summary` / `unknown`; `parse_timeseries(fh, match_date)` -> dense 10 Hz `Track`; `track_from_arrays(...)` for the browser payload |
| `codec.py` | `Track` dataclass (`t0_ms`, `hz`, `lat`, `lon`, `speed`, `hr`, `flags`, `index_for_ms()`), `encode` / `decode` the blob, `densify` |
| `geo.py` | `latlon_to_uv(lat, lon, cal)` -> metres in the screen frame; `uv_to_pitch` / `pitch_to_uv` <-> app 0-100 raw coordinates; `fit_axis` |
| `clock.py` | `video_to_gps_ms(periods, video_ms)`, `gps_to_video_ms`, `period_for_video_ms` |
| `sync.py` | `compute(tracks, carries, events, starters, period_starts, period_ends)` -> calibration, periods, tag_lag, quality |
| `names.py` | `match_device_name("EB. Gallagher", players)` |
| `service.py` | `upsert_track`, `load_tracks`, `run_sync`, `set_manual_periods`, `window`, `summary`, `anchors`, `delete_all` |

Routes, `backend/app/routes/match_gps_timeseries.py`, all under `/api/v1/matches/{match_id}/gps/timeseries`:

| method, path | does |
|---|---|
| `POST .../tracks` | store one player's parsed track (`TrackUpload` JSON from the browser parser). Without `player_id` the device name is matched; 422 names the device when it cannot |
| `POST .../sync` | run the automatic sync (10-20 s on the shared Fly CPU). 422 with the reason when it cannot sync |
| `PATCH .../sync` | manual per-period offset (`{"periods":[{"half":1,"offset_ms":...}]}`), marks the sync `confirmed` |
| `GET .../` | tracks (with per-player quality) + sync summary (periods without the anchors) |
| `GET .../anchors` | per period: the per-carry implied offsets behind the automatic offset |
| `GET .../window?from_ms=&to_ms=&hz=5&players=` | every tracked player's x/y (raw screen 0-100) and speed between two **video** times, at most 6000 samples per player per call |
| `DELETE .../` | remove the match's tracks and sync |

Frontend: `src/services/api.ts` -> `api.matchGpsTimeseries.{uploadTrack, runSync, overrideSync, getSummary,
getAnchors, getWindow, deleteAll}` with types; `src/utils/gpsTimeseriesParser.ts` (`detectGpsFile`,
`parseGpsFile`, `fileDateFromName`) and `src/utils/gpsClock.ts` (`videoToGpsMs`, `gpsToVideoMs`,
`periodForVideoMs`, `formatUtc`). No screens exist yet.

Script: `backend/scripts/ingest_gps_timeseries.py <match_id> "<folder>"` ingests a folder of per-player CSVs and
runs the sync through the same service functions (run with `DATABASE_URL` pointed at prod).

## Data format, in one paragraph

A track is one row per player per match (`match_gps_tracks`), a zlib blob of dense 10 Hz samples: raw lat/lon,
device speed, heart rate, flags (bit0 interpolated gap, bit1 bad fix). Sample `i` is at `t0_ms + i * 100` (UTC
epoch ms). The pitch calibration and the video offsets live in `match_gps_sync` (`calibration`, `periods`).
`geo.latlon_to_uv` projects a track onto the pitch (metres from the centre, screen frame); `geo.uv_to_pitch`
turns that into the same 0-100 raw coordinates events use. **Those are direction-blind.** To say "attacking
third", "behind the ball", "left wing", frame them with `pointInSideFrame` (frontend) or `own_frame` /
`side_frame` (backend) exactly like an event, using the period's `half`. The window endpoint gives you `half`.

## Measured sync results (production, 2026-11-05)

Median residual = distance between a tagged carry start and where the carrier's unit says he was at that video
time; it mixes GPS error (2-3 m) with tagging error (most of it). Orientation = which way the fitted pitch axis
maps to screen x (`flip_u`) and the width to screen y (`flip_v`); the losing orientations scored 28-48 m.

| match | files / in match | period 1 | period 2 | extra time | video rate (p1 / p2) |
|---|---|---|---|---|---|
| Kerry, NFL final, Croke Park, 29 Mar | 24 / 24 | 9.9 m (n 175) | 12.2 m (n 223) | | 1.0008 / 0.9998 |
| Down, Letterkenny, 26 Apr | 26 / 24 (two morning sessions) | 7.9 m (n 176) | 9.6 m (n 116) | | 0.9993 / 0.9995 |
| Kerry, Killarney, 23 May | 26 / 25 | 6.8 m (n 120) | 8.2 m (n 239) | | 0.9997 / 0.9997 |
| Cork, Ballybofey, 13 Jun | 24 / 24 | 12.0 m (n 146) | 6.9 m (n 178) | | 0.9994 / 0.9995 |
| Dublin, Croke Park, 21 Jun | 25 / 23 | 9.9 m (n 176) | 11.3 m (n 106) | ET1 10.3 m (n 17), ET2 12.6 m (n 33) | 1.0015 / 1.0004 |

These are the production values (`GET .../gps/timeseries` on each match returns them). The residual includes the
tag bias (`calibration.tag_bias_u_m/v_m`, up to 5.5 m at Croke Park); subtracting it brings the Croke Park rows
to 7-9 m like the others.

Offsets are pinned to 0.1 s; the per-carry implied offsets scatter with a standard deviation of 2.5 to 4 s, which
is the tagging jitter, not the sync. Rate (drift) is within 0.0007 of 1 on every period: under 2 s across a half,
so a single offset per period is enough. The pre-match "quiet then everyone moves" in the team speed trace is the
team breaking from the photo / anthem line, **35 s before the throw-in frame**: do not use it as a throw-in
anchor.

Tag lag (seconds between the tap and the moment the player's unit was at the tagged spot; negative = tapped after
the action), Down match, from `match_gps_sync.tag_lag`:

| event type | n | median | p25..p75 |
|---|---|---|---|
| PASS_HAND | 142 | -1.2 | -3.2 .. +0.2 |
| POINT_SCORED | 16 | -2.2 | -4.6 .. -1.1 |
| WIDE | 6 | -3.4 | -4.3 .. -2.3 |
| FOUL_COMMITTED | 6 | -5.6 | -8.2 .. -3.4 |
| LONG_KICK_PASS | 20 | +0.8 | -3.1 .. +4.5 |
| OWN_KICKOUT_WON | 21 | +1.8 | 0.0 .. +3.0 |

Kickouts are positive because the tagged spot is where the ball landed and the catcher gets there after the tap
(the tap is at the kick). Use p25 (not the median) as the seek lead so the action is on screen: about 3 s for a
hand pass, 5 s for a score, 8 s for a foul. Other matches agree within a second.

## Pitfalls found (do not rediscover these)

1. **Time of day only, UTC.** The files carry no date and the clock is UTC (Irish time was UTC+1 on all five
   dates). The match date supplies the date. A session can start before the match is "on" the date only in the
   afternoon, so no midnight handling exists.
2. **100 Hz rows, 10 Hz GPS.** Only rows whose `Time` changes are fixes. Everything is built on 10 Hz; the
   accelerometer / gyro columns are discarded.
3. **No goalkeeper, no opposition.** Mulreany and Patton have no unit. Any goalkeeper-based idea is out.
4. **Not every file is the match.** The Down folder has two players' morning session (McCahill, Brennan, 08:15
   UTC). They parse and store fine but `quality[player].in_match` is false and `stats.in_match` false; filter on
   it in every view. The uploader should show them as "not in the match window".
5. **Bad fixes before lock.** 5-20% of fixes per match are far from the venue or hdop > 2.5; they are flagged
   (bit1) and excluded by the window endpoint (null) and by the sync. Never read a flagged sample as a position.
6. **The pitch is fitted, not given.** Length is assumed 145 m and width 90 m (the match's `pitch_length_m`,
   `pitch_width_m` when set); the GPS only fixes the centre and the axis. Fitted extents came out 143-149 m by
   80-93 m, so positions near the end lines can sit a metre or two outside 0-100.
7. **The tags carry a bias, not the GPS.** `calibration.tag_bias_u_m/v_m` (median tagged-minus-GPS in period 1)
   is reported, not applied. Croke Park shows +5 m along the length in both matches there. If a view overlays tags
   on GPS and they look shifted, that is why.
8. **Two different orientations across the five matches** (`flip_u`/`flip_v` differ by venue because the camera
   side differs). Never assume; always read `calibration` and go through `uv_to_pitch`.
9. **Dublin's 23 synthetic "drift" clock stoppages** are wrong (see `discoveries.md`); GPS proves the video runs
   at real time. They only affect the match clock, not the video sync, but a view that mixes match minutes and
   GPS time will be 3-4 minutes out in that second half until they are removed.
10. **Window size.** 15 players x 10 Hz x 10 minutes = 90k numbers per call is the cap (6000 samples per player).
    Replay at 5 Hz in 2-minute windows, prefetch the next one; whole-match views at 1 Hz (about 4,000 per player)
    in one call per 60 minutes.
11. **`is_substitute` on `match_lineups`** marks the bench; starters are `is_substitute = false`. Who is on the
    pitch at a time comes from SUB_ON events (`sub_in_player_id`) and red cards; the window endpoint returns
    every tracked player, including the bench, so filter.
12. **Local venv pandas is broken** (see `discoveries.md`); the GPS code uses only numpy on purpose.

## Build order

1. **Upload screen** (Match Result page, beside the existing Upload GPS button, or a new "GPS tracks" panel):
   multi-file input, `detectGpsFile` per file, show kind + device name, parse in a Web Worker
   (`parseGpsTimeseriesText`) one file at a time with a progress line, `uploadTrack` each; unmatched -> player
   picker and resend with `player_id`; then `runSync` with a spinner and the result (per period residual, players
   not in the match window). Every step needs a status line (product rule).
2. **Sync check** (small panel): per period offset, residual, n carries, the anchors chart (`getAnchors`: implied
   offset vs video time; a flat cloud is good, a step means a cut in the video), a +-2 s nudge that calls
   `overrideSync`, and three "jump to a kickout" buttons that open the video at the kickout with the replay dots
   so a human can confirm by eye.
3. **Replay** on the Video Tagging / Match Result video: pitch with 15 dots fed by `getWindow` in 2-minute
   windows around the playhead, carrier highlighted from the carry segments, events overlaid, framed with
   `pointInSideFrame` so Donegal always attacks the same way on screen (optional toggle to raw camera view).
4. Then whichever of the ranked ideas Owen picks (proposal doc): shape and transition metrics as backend service
   functions first, views and chat tools on top.

## Verification done in Stage 1 (so you know what is real)

- Backend tests `tests/test_gps_timeseries.py` (24): codec round trip, densify gaps, detection, parser on a
  synthetic STATSports file, 11 device-name cases, clock round trips, geo round trips and flips, and a synthetic
  match with a rotated, flipped pitch and two periods where the sync recovers the planted offsets to within 0.5 s.
- Real-file check: the Python parser and the TypeScript parser give identical counts and `t0_ms` on the same
  130 MB file (806,030 rows -> 80,603 fixes, 4 bad); TypeScript parse is 1.7 s in node.
- Ingestion of all five matches into production through `service.upsert_track` and `service.run_sync` (the same
  functions the routes call), results in the table above.
- After deploy, from the logged-in app (same-origin `/api/v1` proxy) on the Down match: `GET .../gps/timeseries`
  200 in 0.6 s (26 tracks, 24 in match, sync auto, 7 tag-lag types); `GET .../window?from_ms=44270&to_ms=104270&hz=5`
  200 in 1.6 s (26 players x 301 samples, 7.7% nulls = bench/bad fixes, every non-null x inside 0-100);
  the second-half window and `GET .../anchors` 200; a 7000 s window at 10 Hz is refused with 422 as designed.
  The direct `onestat-api.fly.dev` host returns 401 from the browser (cookies are same-origin): always call through the proxy.

## Stage 2 built (2026-11-06)

Everything below is deployed and read-only except the sync nudge (admins, GPS sync only).

- **Upload:** Match Result -> "GPS tracks" (`components/gps/GpsTracksModal.tsx`, worker `workers/gpsParse.worker.ts`). Rounds lat/lon to 1e-7 and speed to 0.01 before sending (2.8 MB per player instead of 4.3 MB).
- **Backend analysis:** `services/gps_analysis/` (loader = plain SQL, frame = framed grid in OUR attack frame in metres, metrics = shape, transitions, kickouts, intensity, heat maps, tag health, support, marking, moments; service = in-process cache keyed on the sync + a hash of the tagged carries/events/lineup). Routes `routes/match_gps_analysis.py`: `GET /matches/{id}/gps/analysis[/context|/shape-series|/heatmap]`, `GET /gps-analysis/season`. Tests `tests/test_gps_analysis.py` (mirror test included).
- **Screens:** `/results/:matchId/gps?tab=...` (`pages/GpsAnalysis.tsx`: replay, overview, shape, transitions, kickouts, running, heat maps, passing support, shots against, key moments, tag check, sync check), `/gps-season` (`pages/GpsSeason.tsx`: cross-match rows + running-load alerts), Match Result GPS card (`components/gps/GpsMatchCard.tsx`).
- **AI:** `services/ai/gps_tools.py` -> `get_gps_match_analysis`, `get_gps_season_trends` (ChatAgent gets all tools; added to SEASON_TOOLS).
- **Seek lead:** `utils/videoSeek.ts` per event type; fouls get a 10 s lead in clip compilations.
- **Definitions to know:** turnover = carry team change with a tagged turnover event (60 s) or within 25 s with no dead ball; "back behind the ball" = seconds until min(11, on-pitch tracked - 3) players are goal-side, reported only when caught short; possession = latest tagged carry's team (20 s timeout, score/wide ends it).
- **Not done:** summary rows (MatchGPSData) are not derived from the time series; the support "further option" cannot know if the option was marked (no opposition GPS).

## One GPS upload, nothing dropped (2026-11-07)

- **One button** on Match Result ("Upload GPS", `components/gps/GpsTracksModal.tsx`). Raw files: track + motion
  channels + the original file archived; a summary file (CSV / PDF / Excel) goes to the old preview / confirm flow.
- **Nothing dropped.** `match_gps_tracks.aux` (b078) holds per-0.1 s motion channels on the track grid
  (`services/gps_timeseries/motion.py`: `pl` = sum of |dA| in g, `gmax` = peak resultant g, `imp` = sum of the file's
  Instantaneous Acceleration Impulse). `raw_file_key` = the original CSV gzipped in R2 (`{club}/gps-raw/{match}/...`),
  uploaded by the browser through `POST .../gps/timeseries/raw-file-url`. Anything else can be recomputed from it.
  Browser and backfill binning are mirrors (checked on a real file).
- **Summary rows from the time series.** `services/gps_timeseries/summary.py` `derive()` writes `match_gps_data`
  after every sync (`POST .../sync` returns `player_summary`) or on `POST .../gps/timeseries/summary`. On-pitch time
  only. Definitions are in the module docstring (HML = metabolic power > 25.5 W/kg; DSL = impacts over 2 g weighted
  (g/2)^3, an estimate; PlayerLoad = sum |dA| / 100; accels/decels 3 m/s^2 over 0.3 s; sprints 7 m/s for 1 s).
  Heart rate is ignored when it never changes (no strap: STATSports writes a constant 82).
- **Official summaries win.** A summary upload overwrites the fields it has; `derive()` only fills empty fields on a
  row whose `raw_data.source` is not `raw_gps`. Rows from raw files carry `raw_data.source = "raw_gps"`.
- **Not yet:** step balance; summaries for clubs with raw files but no video sync (needs the match window).

## Off-the-ball analysis for the report agent + pitch drawing fix (2026-11-07)
- `backend/app/services/gps_analysis/situations.py`: `situations` (their scores / missed shots, our shots, our turnovers,
  fouls we conceded: nearest 3 of ours, within 3/5/10 m, goal-side, in line ball-to-goal, inside the 45, shape now and 5 s
  before, every position), `average_positions` (with/without the ball per half), `carrier_pressure` (nearest of ours at each
  of their receptions). Our moments are anchored on the tagged player's own GPS (closest instant to the tag, -6..+1 s);
  opposition moments use the tagged spot at tap minus measured tap delay, banded, with `tag_accuracy` (median distance of our
  receivers from their own tagged spots: 4.9 m Down). Frees / 45s / marks (scoring_context.source) left out of shot moments.
- Tool: `get_gps_match_analysis` sections `situations` (`situation` filter, `full_positions`), `positions`, `pressure`.
- Prompt: lever 10 + softened "not recorded" in `_shared.py`; `OFF_BALL_BLOCK` + required "Off the Ball" section in
  `match_agent.py`, only when match_gps_sync is auto/confirmed. Exact rendered prompt: `docs/match-report-agent-prompt.md`.
- Pitch: `GpsPitch.tsx` draws markings in metres (the shared artwork's arc is ~44.5 m at 145 m, which put players standing on
  the real 40 m arc ~4 m inside it). Sync: `gps_timeseries/pitch_fit.py` centres the pitch between the goals from the arc at
  THEIR kickouts (own kickouts: our players come in early). Length is not fitted (stand-off varies); only Kerry 29 Mar moved
  (-3.6 m). Venue pitch sizes (match.pitch_length_m / width) are the next step for length.
