# GPS time-series: storage, upload detection and video sync (design)

Written 2026-11-05, Stage 1, before building. Companion documents: `docs/gps-build-handover.md` (how to build on it)
and `docs/gps-ideas-proposal.md` (what to build).

## What the files are

STATSports "RawDataExtended" export: one CSV per player per session, named
`YYYY-MM-DD-<Initials>.-<Surname>-Session-Full-Session.csv`, 100 to 170 MB each, 24 to 26 files per match.
All five Donegal matches have the identical 17-column header:

```
Player Display Name, Time, Lat, Lon, Speed (m/s), Heart Rate (bpm), Hacc, Hdop, Quality of Signal,
No. of Satellites, Instantaneous Acceleration Impulse, Accl X, Accl Y, Accl Z, Gyro Yro X, Gyro Y, Gyro Z
```

Facts measured on the real files (not assumed):

- Rows are 100 Hz. Only the accelerometer and gyro columns change row to row; `Time`, `Lat`, `Lon`, `Speed`,
  heart rate and the signal columns repeat 10 times per 0.1 s. The real position rate is **10 Hz** (median
  step 0.100 s, no negative steps, a handful of >0.15 s gaps per file).
- `Time` is time of day only (`HH:MM:SS.s`), **UTC**, no date. The date is in the file name and the folder name.
  Proof: every file starts 25 to 35 minutes before the published Irish throw-in time once read as UTC, and the
  carry-based sync lands the first-half throw-in at 14:00:16 UTC for a 15:00 Irish Summer Time throw-in.
- A session covers the whole afternoon (2h05 to 2h50): warm-up, match, cool-down. The match is found by syncing,
  never by trusting the file boundaries.
- Heart rate is 0 for most players (no strap). `Speed` can be a denormal like `1.7E-109` (treat as 0).
- Some files are not the match at all: in the Down folder two players (McCahill, Brennan) have a 65-minute
  session from 08:15 UTC, a morning session elsewhere. Detect by overlap with the match window and skip.
- Lat/Lon contain junk before satellite lock (0,0 or kilometres away). 5 to 20% of fixes per match are dropped
  by the bad-fix rule below.
- No goalkeeper file in any match (Mulreany, Patton). Goalkeeper-based anchors are not available.

## Storage

Two tables, migration `b077`.

### `match_gps_tracks` (one row per player per match)

| column | type | notes |
|---|---|---|
| id | uuid pk | |
| match_id | uuid fk matches (cascade), indexed | |
| club_id | uuid fk clubs, indexed | tenancy filter without a join |
| player_id | uuid fk players (cascade) | unique with match_id |
| device_name | text | the file's `Player Display Name`, e.g. `EB. Gallagher` |
| source_filename | text | |
| hz | smallint | 10 |
| t0_ms | bigint | UTC epoch ms of sample 0 (match date + file time of day) |
| n_samples | int | |
| blob | bytea | packed samples (raw lat/lon, speed, heart rate, flags), format below |
| stats | json | distance, max speed, mean hdop, good-fix share, heart-rate availability; in-match figures added once synced |
| created_at | timestamp | |

Sample `i` is at `t0_ms + i * 1000 / hz`. Gaps are filled by linear interpolation and flagged, so the arrays are
dense and indexable by time without a search.

**`blob` format v1** (first byte = version `1`, then `zlib` of the concatenated columns, little-endian):

| column | dtype | unit |
|---|---|---|
| lat_e7 | int32, first absolute then deltas | degrees x 1e7 |
| lon_e7 | int32, first absolute then deltas | degrees x 1e7 |
| speed | uint16 | cm/s from the device |
| hr | uint8 | bpm, 0 = no strap |
| flags | uint8 | bit0 interpolated gap, bit1 bad fix (hdop > 2.5, under 8 satellites, no lock, or over 1 km from the session), bit2 clamped |

Positions are stored as raw lat/lon on purpose: the pitch calibration (axis, centre, which way is screen right)
is only known after the sync and may be redone later, and projecting 90,000 points is a few milliseconds of numpy
at read time (`geo.latlon_to_uv`). There is no second blob. Measured on a real file: 80,603 samples pack to 222 KB
(2.8 bytes per sample), parse takes 2.9 s, encode 0.05 s.

Size: about 90,000 samples per player, 200 to 300 KB per row, 6 to 8 MB per match, under 40 MB for the five matches. It
stays in Postgres (transactional, one place, the API can read a window with one query). R2 is not needed.

Converting to app coordinates (same raw screen frame as `pitch_x`/`pitch_y` on events):

```
pitch_x = 50 + u_m / pitch_length_m * 100      pitch_y = 50 + v_m / pitch_width_m * 100
```

with the match's `pitch_length_m` / `pitch_width_m` (145 x 90 when unset). Everything downstream then goes
through the attack-direction helpers exactly like an event does.

### `match_gps_sync` (one row per match)

| column | type | notes |
|---|---|---|
| match_id | uuid pk/fk | |
| club_id | uuid | |
| status | text | `pending` (tracks uploaded, not synced), `auto`, `confirmed`, `failed` |
| calibration | json | lat/lon origin, pitch axis angle, centre, flip_u, flip_v, tag bias (du, dv), fitted extent, pitch dims used |
| periods | json | per period (1, 2, 3 = ET1, 4 = ET2): `video_start_ms`, `offset_s`, `rate`, residual stats, implied offsets list (the anchors), `source` auto/manual |
| tag_lag | json | per event type: n, median, p25, p75 seconds between the tap and the moment the player was at the tagged spot |
| quality | json | per track: in-match coverage, bad-fix share, `in_match` boolean |
| error | text | |
| computed_at, confirmed_at, confirmed_by_user_id | | |

Clock mapping used everywhere (`backend/app/services/gps_timeseries/clock.py`, `frontend/src/utils/gpsClock.ts`):

```
gps_utc_s = video_ms / 1000 * rate + offset_s        (per period; rate is 1 + drift, ~1.000)
```

A video time belongs to the latest period whose `video_start_ms` it is past. Match clock to video uses the
existing `restamp.match_clock` rules (half marks and clock stoppages); GPS never deals with the match clock
directly.

## Upload detection

`POST /matches/{id}/gps/preview` (the existing summary path) now reads the first 4 KB and returns
`file_kind`:

- `summary`: header has one row per player with distance/HSR style columns. Unchanged behaviour.
- `timeseries`: header has `Time` plus `Lat`/`Lon` (or `Latitude`/`Longitude`, or `X`/`Y` in metres) and a
  speed column. The preview returns `file_kind = "timeseries"` with a message and the parsed metadata, and does
  not run the summary parser. The confirm modal should point the user at the time-series uploader.
- `timeseries_sparse`: same columns but irregular timestamps (median step > 0.2 s or more than 20% gaps): a burst
  or event list. Accepted for storage but marked `sparse` in `stats`; replay is refused for sparse tracks.

The time-series uploader is multi-file (one CSV per player) and parses in the browser in a Web Worker:
dedupe to 10 Hz, keep lat/lon/speed/hr/hdop/satellites, send about 3 MB per player instead of 130 MB.
Server side, `POST /matches/{id}/gps/timeseries/tracks` validates, matches the device name to a player (the
existing `_match_gps_player` rules plus two-letter initials such as `EB.` and `CC.`, accent folding, and
`McGeehan` vs `McGeehin` prefix tolerance), encodes and stores. The server can also parse a raw CSV itself
(`gps_timeseries/parser.py`), which is what the Stage 1 ingestion script and the tests use.

`POST /matches/{id}/gps/timeseries/sync` runs the sync below and stores `match_gps_sync`.

## Sync method (what was built and measured)

Inputs: the tracks, the video session marks (`first_half_start_ms`, `second_half_start_ms`, extra-time marks),
own-team ball-carrier segments (start point + video time), own-team located events with a player.

1. **Bad-fix filter.** Drop fixes with lat/lon 0 or more than 600 m from the session median. Drop a track with
   fewer than 60 s of good fixes near the venue (not a match session).
2. **Pass 1, orientation-free coarse offset.** A carrier is running when his carry starts. For every candidate
   offset over the whole session (1 s steps) take the mean of the carriers' device speed at `carry_video_time +
   offset`. The true offset is a sharp peak (3.7 to 4.2 m/s against a session median of 1.4 to 1.7 m/s) on all
   five matches.
3. **Pitch axis.** PCA on the starting fifteen's positions in the first 25 minutes after the coarse offset,
   trimmed four times to a 160 x 104 m box so bench and warm-up points fall out. Centre = midpoint of the
   0.1/99.9 percentiles. The fitted extents came out 145 to 149 m by 92 to 93 m on every venue.
4. **Orientation.** The pitch's long axis maps to screen x either way, and the width either way: four
   candidates. Score each by the median distance between the tagged carry start and the carrier's GPS position,
   scanning the offset +-120 s around pass 1. Pick the smallest. (Which end is which also follows from
   `attacking_right_first_half` but the data decides, the setting is a cross-check.)
5. **Per period offset.** Fine scan at 0.1 s within +-15 s. Period 2 and the extra-time periods are scanned
   separately (the video has the breaks cut out, so each period has its own offset).
6. **Tag bias.** Median residual vector between tagged carry starts and GPS positions in period 1, applied as a
   centre correction (du, dv).
7. **Drift and anchors.** For each carry, the moment within +-8 s when the carrier was nearest the tagged spot
   gives an implied offset; a straight line through them gives the rate. These points are stored as the anchors.
8. **Tag lag.** Same nearest-moment idea per located event type: how long after (or before) the tap the player
   was really at the tagged spot. This is the per-event-type seek lead.

Measured results are in `docs/gps-build-handover.md`.
