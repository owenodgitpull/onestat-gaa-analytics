"""Tap delay: a tag is pressed after the action (watch, decide, tap).

The sync measures the delay per event type from our own players' GPS (sync.tag_lag: negative median_s = tapped after
the action). It is used when it rests on 4+ examples, else the defaults below (the Down-match measurements), clamped
to 0-6 s. The user can move every tag earlier or later on the replay's "Edit sync" panel: that is stored as
sync.tag_lag["_manual"]["shift_ms"] (positive = tags drawn later, so less delay taken off). Display and analysis
only: tagged data is never changed. Same rule as the replay (frontend GpsReplay makeLag).
"""
from __future__ import annotations

from typing import Optional

SHOT_TYPES = ("POINT_SCORED", "GOAL_SCORED", "WIDE", "SHORT", "SAVED", "HIT_POST")
DEFAULT_LAG_MS = {"PASS_HAND": 1200, "LONG_KICK_PASS": 1200, "POINT_SCORED": 2200, "GOAL_SCORED": 2200, "WIDE": 3400,
                  "TURNOVER_LOST": 1600, "TURNOVER_WON": 1600, "FOUL_COMMITTED": 5600}
SHOT_LAG_FALLBACK = "POINT_SCORED"   # saves, shorts, posts: no measurement of their own, closest is a point
MANUAL_KEY = "_manual"
MAX_SHIFT_MS = 5000


def manual_shift_ms(tag_lag: Optional[dict]) -> int:
    m = (tag_lag or {}).get(MANUAL_KEY) or {}
    try:
        return int(max(-MAX_SHIFT_MS, min(MAX_SHIFT_MS, int(m.get("shift_ms") or 0))))
    except (TypeError, ValueError):
        return 0


def lag_for(tag_lag: Optional[dict], event_type: Optional[str]) -> int:
    if not event_type:
        return 0
    tl = tag_lag or {}
    key = event_type
    if event_type in SHOT_TYPES and event_type not in tl and event_type not in DEFAULT_LAG_MS:
        key = SHOT_LAG_FALLBACK
    m = tl.get(key)
    ms = -float(m["median_s"]) * 1000 if isinstance(m, dict) and (m.get("n") or 0) >= 4 and m.get("median_s") is not None else DEFAULT_LAG_MS.get(key, 0)
    base = min(6000, max(0, ms))
    # no floor after the user's shift (same as the replay): later than the measured delay draws the tag after the tap
    return int(base - manual_shift_ms(tl))


def lag_ms(inp, event_type: Optional[str]) -> int:
    return lag_for(inp.sync.get("tag_lag"), event_type)
