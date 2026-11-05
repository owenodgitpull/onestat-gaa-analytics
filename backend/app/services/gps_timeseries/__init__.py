"""GPS time-series: raw 10 Hz player positions, packed per player per match, synced to the match video.

Modules:
- parser: read a STATSports RawDataExtended CSV (or any time/lat/lon file) into dense 10 Hz arrays; detect file kind
- codec: pack / unpack the dense arrays into the bytea blob stored on match_gps_tracks
- geo: lat/lon -> local metres -> pitch frame (the calibration maths)
- clock: video time <-> GPS UTC time per period
- sync: find the pitch calibration and the per-period offsets from the tagged carries
- names: device display name ("EB. Gallagher") -> player
- service: the DB-facing functions the routes and scripts call
"""
