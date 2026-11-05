"""Video clock <-> GPS UTC clock.

A match video has one or more PERIODS (first half, second half, extra time 1, extra time 2). The video has the
breaks cut out, so each period carries its own linear mapping:

    gps_utc_ms = video_ms * rate + offset_ms

`periods` is the list stored on match_gps_sync.periods: each item has
    half            1, 2, 3, 4
    video_start_ms  the period's start mark on the video (session first_half_start_ms etc.)
    offset_ms       int, see formula
    rate            float, 1.0 + drift (measured; always within 0.001 of 1.0 so far)
A video time belongs to the latest period whose video_start_ms it has passed (before the first mark it belongs to
period 1). Keep frontend/src/utils/gpsClock.ts in step with this file.
"""
from __future__ import annotations

from typing import Iterable, Optional


def period_for_video_ms(periods: Iterable[dict], video_ms: float) -> Optional[dict]:
    ps = sorted(periods, key=lambda p: p["video_start_ms"])
    if not ps:
        return None
    cur = ps[0]
    for p in ps:
        if video_ms >= p["video_start_ms"]:
            cur = p
    return cur


def video_to_gps_ms(periods: Iterable[dict], video_ms: float) -> Optional[float]:
    p = period_for_video_ms(periods, video_ms)
    if p is None:
        return None
    return video_ms * float(p.get("rate") or 1.0) + float(p["offset_ms"])


def gps_to_video_ms(periods: Iterable[dict], gps_ms: float) -> Optional[float]:
    """Inverse mapping. Picks the period whose video range contains the answer; GPS times that fall in a cut
    (half-time) map onto the end of the earlier period."""
    ps = sorted(periods, key=lambda p: p["video_start_ms"])
    if not ps:
        return None
    best = None
    for i, p in enumerate(ps):
        v = (gps_ms - float(p["offset_ms"])) / float(p.get("rate") or 1.0)
        start = p["video_start_ms"]
        end = ps[i + 1]["video_start_ms"] if i + 1 < len(ps) else float("inf")
        if start <= v < end:
            return v
        if v < start and best is None and i > 0:
            best = start  # fell into the cut before this period: clamp to the earlier period's end
    return best if best is not None else (gps_ms - float(ps[0]["offset_ms"])) / float(ps[0].get("rate") or 1.0)
