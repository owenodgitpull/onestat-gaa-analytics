"""GPS analysis (Stage 2): views and metrics built on the stored, synced GPS time series.

Reads only: match_gps_tracks / match_gps_sync (through services.gps_timeseries), the tagged carries and video events,
the lineup. Writes nothing. Every position is framed with the attack-direction helpers so OUR team attacks towards
x = 100 (metres: X = 0 our goal line, X = pitch length their goal line; Y = 0 our left touchline in that frame).
"""
