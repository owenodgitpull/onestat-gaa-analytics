"""
How the OPPOSITION moves the ball — derived from the ball-path log, for every match.

Every match records where the ball is and which team has it (`possession_events`, team own/opponent/contested, with
position and duration). That is enough to describe their possessions without tracking their players: how long they
held it, how far up the pitch they got, how often they reached our defensive third and down which channel. It is
coarse (ball ticks every few seconds plus dragged paths; no players, no passes) so it is labelled as such — the
agents quote it with that caveat. When the opposition's carriers are tracked (inter-county lineups), the richer
`opposition` section of get_ball_carrier_data (pass network, chains, tempo) is used alongside it.

Pure and cheap: one indexed query, everything in OUR attacking frame via the shared helpers.
"""
from statistics import median
from typing import Optional

from sqlalchemy import select

from app.models.possession_event import PossessionEvent
from app.services.attack_frame import load_direction_map, own_frame

THIRD_LINE = 31.0   # x <= 31 (our frame) = our defensive third, as everywhere else in the live brief
SOURCE_NOTE = (
    "Derived from the ball-path log (ball position every few seconds + dragged paths): no opposition players or "
    "passes are tracked here, so describe tempo and directness, not individuals."
)


def _channel(y: float) -> str:
    return "our left" if y < 33 else ("our right" if y > 67 else "the centre")


async def _runs(db, match_id) -> list[dict]:
    rows = (await db.execute(
        select(PossessionEvent).where(PossessionEvent.match_id == match_id).order_by(PossessionEvent.created_at, PossessionEvent.id)
    )).scalars().all()
    if not rows:
        return []
    if any(r.video_ms is not None for r in rows):   # Video Tagging rows carry their real video time
        rows = sorted(rows, key=lambda r: (r.video_ms is None, r.video_ms or 0, r.created_at))
    dmap = await load_direction_map(db, {match_id})

    runs: list[dict] = []
    cur: Optional[dict] = None
    for r in rows:
        team = str(getattr(r.team, "value", r.team)).lower()
        if team != "opponent":
            if cur:
                runs.append(cur)
                cur = None
            continue
        fx, fy = own_frame(r, dmap)
        if cur is None:
            cur = {"minute": r.minute, "seconds": 0, "pts": []}
        cur["seconds"] += int(r.duration_seconds or 0)
        if fx is not None:
            cur["pts"].append((fx, fy))
    if cur:
        runs.append(cur)
    return runs


def _summarise(runs: list[dict], length_m: float) -> Optional[dict]:
    if not runs:
        return None
    secs = [r["seconds"] for r in runs]
    moved = [r for r in runs if len(r["pts"]) >= 2]
    gains = [(r["pts"][0][0] - r["pts"][-1][0]) / 100.0 * length_m for r in moved]   # + = towards OUR goal
    into_third = [r for r in runs if r["pts"] and min(p[0] for p in r["pts"]) <= THIRD_LINE]
    past_half = [r for r in runs if r["pts"] and min(p[0] for p in r["pts"]) <= 50.0]
    channels: dict[str, int] = {}
    for r in into_third:
        entry = next((p for p in r["pts"] if p[0] <= THIRD_LINE), None)
        if entry:
            ch = _channel(entry[1])
            channels[ch] = channels.get(ch, 0) + 1
    out = {
        "possessions": len(runs),
        "avg_seconds": round(sum(secs) / len(secs), 1),
        "median_seconds": round(median(secs), 1),
        "short_10s_or_less": sum(1 for s in secs if s <= 10),
        "sustained_over_30s": sum(1 for s in secs if s > 30),
        "reached_our_half": len(past_half),
        "reached_our_defensive_third": len(into_third),
        "entered_our_third_via": channels,
    }
    if gains:
        out["possessions_with_movement"] = len(gains)
        out["avg_gain_towards_our_goal_m"] = round(sum(gains) / len(gains), 1)
        out["progressed_20m_plus"] = sum(1 for g in gains if g >= 20)
    return out


async def opposition_ball_path(db, match_id, *, length_m: float = 145.0,
                               up_to_minute: Optional[int] = None, since_minute: Optional[int] = None) -> Optional[dict]:
    """Summary of the opposition's possessions (optionally only those starting up to / after a minute). None if no data."""
    try:
        runs = await _runs(db, match_id)
        if up_to_minute is not None:
            runs = [r for r in runs if r["minute"] is None or r["minute"] <= up_to_minute]
        if since_minute is not None:
            runs = [r for r in runs if r["minute"] is not None and r["minute"] > since_minute]
        s = _summarise(runs, length_m)
        if s:
            s["source"] = SOURCE_NOTE
        return s
    except Exception:
        return None
