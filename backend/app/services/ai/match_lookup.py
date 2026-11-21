"""Finding matches without IDs (Owen 2026-11-21: he had to copy match UUIDs out of the app's URLs and paste them into
the chat - no tool let the agent see which matches exist).

- list_matches: the logged-in club's matches (id, date, opponent, competition, venue, score, result, what data each has).
- resolve_match_ref: every tool's match_id may be a UUID, "latest", an opponent name, a date, or both ("Kerry 23 May");
  execute_tool resolves it to the UUID before the tool runs, or answers with the candidates when it is ambiguous.

Club-scoped always: never another club's matches.
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime

from sqlalchemy import and_, select

from app.services.ai.gps_tools import safe_json

TOOL_DEFS = [
    {
        "name": "list_matches",
        "description": (
            "List this club's matches, newest first: match_id, date, opponent, competition, venue, score, result, and which "
            "data each has (tagged events, GPS tracking, video). Call this whenever you need a match_id - never ask the "
            "user for one. Every tool's match_id also accepts an opponent name, a date or 'latest' (e.g. 'Kerry 23 May')."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "opponent": {"type": "string", "description": "Optional: part of the opponent's name"},
                "competition": {"type": "string", "description": "Optional: part of the competition name"},
                "include_unfinished": {"type": "boolean", "description": "Also list scheduled / in-progress matches (default false)"},
                "limit": {"type": "integer", "description": "Most to return (default 30)"},
            },
        },
    },
]

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}
LATEST_WORDS = {"latest", "recent", "last", "most recent", "last match", "latest match", "most_recent"}


def _is_uuid(v) -> bool:
    try:
        uuid.UUID(str(v))
        return True
    except (ValueError, TypeError, AttributeError):
        return False


def _val(v):
    """Enum or plain value -> JSON-safe string."""
    return None if v is None else str(getattr(v, "value", v))


def _score(g, p) -> str:
    return f"{g or 0}-{p or 0}"


async def _club_matches(db, club_id, include_unfinished: bool = False):
    from app.models import Match
    conds = [Match.club_id == club_id, Match.is_deleted.is_(False)]
    if not include_unfinished:
        conds.append(Match.counts_in_stats)
    return (await db.execute(select(Match).where(and_(*conds)).order_by(Match.match_date.desc()))).scalars().all()


def _date_of(m):
    d = m.match_date
    return d.date() if isinstance(d, datetime) else d


async def list_matches(db, club_id, opponent: str | None = None, competition: str | None = None,
                       include_unfinished: bool = False, limit: int = 30) -> str:
    from app.models.match_event import MatchEvent
    from app.models.match_gps_track import MatchGPSTrack
    from app.models.video_session import VideoSession
    from sqlalchemy import func

    ms = await _club_matches(db, club_id, include_unfinished)
    if opponent:
        ms = [m for m in ms if opponent.lower() in (m.opponent or "").lower()]
    if competition:
        ms = [m for m in ms if competition.lower() in (_val(m.competition) or "").lower()]
    ms = ms[: max(1, min(int(limit or 30), 100))]
    ids = [m.id for m in ms]
    ev_n, gps_n, vid = {}, {}, set()
    if ids:
        ev_n = dict((await db.execute(select(MatchEvent.match_id, func.count()).where(MatchEvent.match_id.in_(ids))
                                      .group_by(MatchEvent.match_id))).all())
        gps_n = dict((await db.execute(select(MatchGPSTrack.match_id, func.count()).where(
            MatchGPSTrack.match_id.in_(ids), MatchGPSTrack.club_id == club_id).group_by(MatchGPSTrack.match_id))).all())
        vid = set((await db.execute(select(VideoSession.match_id).where(
            VideoSession.match_id.in_(ids), VideoSession.club_id == club_id))).scalars().all())
    rows = []
    for m in ms:
        us, them = (m.team_goals or 0) * 3 + (m.team_points or 0), (m.opponent_goals or 0) * 3 + (m.opponent_points or 0)
        rows.append({
            "match_id": str(m.id),
            "date": str(_date_of(m)) if m.match_date else None,
            "opponent": m.opponent,
            "competition": _val(m.competition),
            "stage": _val(getattr(m, "stage", None)),
            "venue": _val(m.venue),
            "score": f"{_score(m.team_goals, m.team_points)} v {_score(m.opponent_goals, m.opponent_points)}",
            "result": "won" if us > them else "lost" if us < them else "drew",
            "status": _val(m.status),
            "tagged_events": int(ev_n.get(m.id, 0)),
            "gps_tracking_players": int(gps_n.get(m.id, 0)),
            "video": m.id in vid,
        })
    return safe_json({
        "matches": rows,
        "count": len(rows),
        "how_to_read": "Newest first. Use match_id in other tools. gps_tracking_players > 0 means the positional GPS "
                       "tools (shape, kickouts, transitions) have this match.",
    })


def _parse_date(text: str, years: list[int]) -> tuple[date | None, str]:
    """A date in the text (2026-06-21, 21/6, 21 June, June 21) and the text without it."""
    t = text
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", t)
    if m:
        return date(int(m[1]), int(m[2]), int(m[3])), t.replace(m[0], " ")
    m = re.search(r"\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b", t)
    if m:
        y = int(m[3]) if m[3] else None
        if y and y < 100:
            y += 2000
        return _mk(int(m[1]), int(m[2]), y, years), t.replace(m[0], " ")
    mon = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*"
    m = re.search(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+" + mon + r"(?:\s+(\d{4}))?\b", t, re.I)
    if m:
        return _mk(int(m[1]), _MONTHS[m[2].lower()[:3]], int(m[3]) if m[3] else None, years), t.replace(m[0], " ")
    m = re.search(r"\b" + mon + r"\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?\b", t, re.I)
    if m:
        return _mk(int(m[2]), _MONTHS[m[1].lower()[:3]], int(m[3]) if m[3] else None, years), t.replace(m[0], " ")
    return None, t


def _mk(d, mo, y, years):
    try:
        return date(y or (years[0] if years else date.today().year), mo, d)
    except ValueError:
        return None


async def resolve_match_ref(db, club_id, ref) -> tuple[str | None, dict | None]:
    """(match_id, None) or (None, error with candidates)."""
    if ref is None or _is_uuid(ref):
        return (str(ref) if ref is not None else None), None
    text = str(ref).strip()
    ms = await _club_matches(db, club_id, include_unfinished=True)
    done = [m for m in ms if m.counts_in_stats]

    def cand(xs):
        return [{"match_id": str(m.id), "date": str(_date_of(m)), "opponent": m.opponent, "competition": _val(m.competition)}
                for m in xs[:12]]

    if text.lower().replace("_", " ") in LATEST_WORDS:
        if done:
            return str(done[0].id), None
        return None, {"error": "No completed matches yet."}
    # match on the whole text first, so a date inside an opponent's name is never torn out
    hits = [m for m in ms if text.lower() == (m.opponent or "").lower()]
    if not hits:
        years = sorted({_date_of(m).year for m in ms if m.match_date}, reverse=True)
        d, rest = _parse_date(text, years)
        words = [w for w in re.split(r"[\s,]+", re.sub(r"\b(v|vs|versus|against|the|match|game|on)\b", " ", rest, flags=re.I)) if w]
        hits = ms
        if d:
            same = [m for m in hits if m.match_date and _date_of(m) == d]
            if not same:  # year guessed wrong: same day and month
                same = [m for m in hits if m.match_date and (_date_of(m).month, _date_of(m).day) == (d.month, d.day)]
            hits = same
        if words:
            hits = [m for m in hits if all(w.lower() in f"{m.opponent or ''} {_val(m.competition) or ''}".lower() for w in words)]
        if not d and not words:
            hits = []
    if len(hits) > 1:  # prefer the finished ones, then ask
        fin = [m for m in hits if m.counts_in_stats]
        hits = fin or hits
    if len(hits) == 1:
        return str(hits[0].id), None
    if len(hits) > 1:
        return None, {"error": f"'{text}' matches {len(hits)} matches - pick one match_id (or add the date).",
                      "candidates": cand(hits)}
    return None, {"error": f"No match found for '{text}'. These are the club's matches - use one match_id.",
                  "candidates": cand(done or ms)}
