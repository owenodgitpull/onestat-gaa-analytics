"""
Re-stamp a video session's match clock.

Every event's minute / second comes from its video timestamp, the half marks and (new) the periods the match clock was
stopped (an injury, a water break). When those stoppages change, the stored minutes of the events already tagged are
out of date. This recomputes them from the video timestamps with the same rules the tagging page uses
(`calcMatchTime` in VideoTagging.tsx), so it is idempotent: running it twice changes nothing.

Touches: video events, their mirrored match events, possession events and carrier segments of the session's match.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select, update, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_session import VideoSession
from app.models.video_event import VideoEvent
from app.models.match import Match

ET_PERIOD_MINS = 10


def _stopped_between(stoppages: list, from_ms: int, to_ms: int) -> int:
    total = 0
    for st in stoppages or []:
        try:
            total += max(0, min(to_ms, int(st["end_ms"])) - max(from_ms, int(st["start_ms"])))
        except (KeyError, TypeError, ValueError):
            continue
    return total


def match_clock(session: VideoSession, half_mins: int, video_ms: int) -> tuple[int, int, int]:
    """(half, minute, second) for a video timestamp - mirrors the tagging page's calcMatchTime."""
    stoppages = session.clock_stoppages or []
    h1 = session.first_half_start_ms or 0
    h2 = session.second_half_start_ms
    et1 = session.et_first_half_start_ms
    et2 = session.et_second_half_start_ms

    if et2 is not None and video_ms >= et2:
        sec = max(0, video_ms - et2 - _stopped_between(stoppages, et2, video_ms)) // 1000
        return 4, half_mins * 2 + ET_PERIOD_MINS + sec // 60, sec % 60
    if et1 is not None and video_ms >= et1:
        sec = max(0, video_ms - et1 - _stopped_between(stoppages, et1, video_ms)) // 1000
        return 3, half_mins * 2 + sec // 60, sec % 60
    if h2 is not None and video_ms >= h2:
        elapsed = max(0, video_ms - h2 - _stopped_between(stoppages, h2, video_ms))
        sec = elapsed // 1000
        return 2, half_mins + sec // 60, sec % 60
    elapsed = max(0, video_ms - h1 - _stopped_between(stoppages, h1, video_ms)) + (session.first_half_clock_offset_ms or 0)
    sec = elapsed // 1000
    return 1, sec // 60, sec % 60


async def restamp_session(db: AsyncSession, session: VideoSession) -> dict:
    """Recompute minute/second for everything stamped from this session's video. Caller commits."""
    match = (await db.execute(select(Match).where(Match.id == session.match_id))).scalar_one_or_none()
    half_mins = (match.half_duration_mins if match else None) or 30

    counts = {"video_events": 0, "possession_events": 0, "carrier_segments": 0}

    events = (await db.execute(
        select(VideoEvent).where(VideoEvent.video_session_id == session.id, VideoEvent.video_timestamp_ms.isnot(None))
    )).scalars().all()
    for ev in events:
        half, minute, second = match_clock(session, half_mins, int(ev.video_timestamp_ms))
        if (ev.match_minute, ev.match_second) != (minute, second) or ev.half != half:
            ev.match_minute, ev.match_second, ev.half = minute, second, half
            counts["video_events"] += 1
            if ev.match_event_id:
                await db.execute(text(
                    "update match_events set minute=:mi, match_clock_s=:cs, half=:h where id=:i"
                ), {"mi": minute, "cs": minute * 60 + second, "h": half, "i": ev.match_event_id})

    # Possession rows and carrier segments carry their own video timestamp
    rows = (await db.execute(text(
        "select id, video_ms from possession_events where match_id=:m and video_ms is not null"
    ), {"m": session.match_id})).all()
    for pid, vms in rows:
        half, minute, second = match_clock(session, half_mins, int(vms))
        res = await db.execute(text(
            "update possession_events set minute=:mi, match_clock_s=:cs, half=:h "
            "where id=:i and (minute is distinct from :mi or match_clock_s is distinct from :cs or half is distinct from :h)"
        ), {"mi": minute, "cs": minute * 60 + second, "h": half, "i": pid})
        counts["possession_events"] += res.rowcount or 0

    segs = (await db.execute(text(
        "select id, video_timestamp_ms from ball_carrier_segments where match_id=:m and video_timestamp_ms is not null"
    ), {"m": session.match_id})).all()
    for sid, vms in segs:
        half, minute, second = match_clock(session, half_mins, int(vms))
        res = await db.execute(text(
            "update ball_carrier_segments set minute=:mi, match_clock_s=:cs, half=:h "
            "where id=:i and (minute is distinct from :mi or match_clock_s is distinct from :cs or half is distinct from :h)"
        ), {"mi": minute, "cs": minute * 60 + second, "h": half, "i": sid})
        counts["carrier_segments"] += res.rowcount or 0
    return counts
