"""Agent tool: one player's KPI profile, the same figures the coach sees on the player page (Owen 2026-11-16: the agents
must know as much as the screens show).

Every KPI against HIMSELF (season average over his full matches, his last 3, his best) and the squad average; the GPS
tracking figures (goal-side and sprinting after we lose the ball, average position); and his leaderboard places. Our club
only: never compared with outside figures.
"""
from __future__ import annotations

import uuid
from statistics import mean

from sqlalchemy import and_, select

from app.services.ai.gps_tools import safe_json

TOOL_DEFS = [
    {
        "name": "get_player_kpi_profile",
        "description": (
            "One player's KPI profile, the figures on his player page: for every KPI (scoring, on the ball, defending, "
            "kickouts, discipline, running, heart rate, GPS tracking such as goal-side and sprinting after we lose the ball "
            "and average position) his season average per full match, his last 3, his best and against whom, the squad "
            "average, and the trend (last 3 v season); plus each match's figures and his leaderboard places in the squad. "
            "Use search_players first for the UUID. Compare him only with himself or the squad."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "player_id": {"type": "string", "description": "The player's UUID (from search_players)"},
                "include_matches": {"type": "boolean", "description": "Also return each match's figures (default false)"},
            },
            "required": ["player_id"],
        },
    },
]


def _summary(rows, kpis, squad_season, window=3):
    out = []
    for k in kpis:
        key = k["key"]
        full = [r for r in rows if not r.get("short") and r["values"].get(key) is not None]
        if not full:
            continue
        vals = [r["values"][key] for r in full]
        season = mean(vals)
        recent = mean(vals[-window:]) if len(vals) >= window + 1 else None
        hib = k.get("higher_is_better")
        best = None
        if hib is not None:
            b = (min if hib is False else max)(full, key=lambda r: r["values"][key])
            best = {"value": b["values"][key], "opponent": b.get("opponent")}
        trend = None
        if recent is not None:
            d = recent - season
            small = abs(d) < max(abs(season) * 0.05, 0.4 if k["unit"] in ("", "pts", "rank") else 1e-9)
            trend = "stable" if small else ("up" if d > 0 else "down")
            if trend != "stable" and hib is not None:
                trend += " (better)" if (d > 0) == hib else " (worse)"
        out.append({"kpi": k["label"], "group": k["group"], "unit": k["unit"], "season_avg": round(season, 2),
                    f"last_{window}": round(recent, 2) if recent is not None else None, "best": best,
                    "squad_avg": squad_season.get(key) if k["unit"] != "rank" else None, "trend": trend,
                    "matches": len(full)})
    return out


async def get_player_kpi_profile(db, player_id: str, include_matches: bool = False, club_id=None) -> str:
    from app.models.player import Player
    from app.services.leaderboard_service import LeaderboardService
    from app.services.player_self_kpis import player_self_gps_kpis, player_self_kpis
    try:
        pid = uuid.UUID(str(player_id))
    except (ValueError, TypeError):
        return safe_json({"error": f"'{player_id}' is not a player UUID; use search_players first"})
    p = (await db.execute(select(Player).where(and_(Player.id == pid, Player.club_id == club_id)))).scalar_one_or_none()
    if p is None:
        return safe_json({"error": "Player not found in this club"})
    data = await player_self_kpis(db, club_id, pid)
    try:
        gps = await player_self_gps_kpis(db, club_id, pid)
    except Exception:
        gps = {"matches": [], "kpis": [], "squad": {"season": {}}}
    # GPS tracking figures merged into his match rows (same as the player page)
    by_mid = {m["match_id"]: m["values"] for m in gps.get("matches", [])}
    rows = [{**r, "values": {**r["values"], **by_mid.get(r["match_id"], {})}} for r in data.get("matches", [])]
    kpis = list(data.get("kpis", [])) + list(gps.get("kpis", []))
    squad = {**(data.get("squad") or {}).get("season", {}), **(gps.get("squad") or {}).get("season", {})}
    boards = await LeaderboardService.get_all_leaderboards(db, club_id, pid, viewer_is_admin=True)
    places = [{"board": b["display_name"], "place": b["my_rank"], "of": b["total_players"], "value": b["my_value"], "unit": b.get("unit")}
              for b in boards if b.get("my_rank") is not None]
    out = {
        "player": p.name, "position": getattr(p, "position", None),
        "full_matches": sum(1 for r in rows if not r.get("short")), "min_minutes": data.get("min_minutes"),
        "kpis": _summary(rows, kpis, squad),
        "leaderboard_places": sorted(places, key=lambda x: x["place"]),
        "how_to_read": (
            "season_avg = his average per FULL match (games under min_minutes left out); last_3 = his last 3 full matches; "
            "trend compares last_3 with season_avg ('better'/'worse' only where higher or lower is clearly better; average "
            "position has no better/worse). squad_avg = every squad player's full matches. Impact rank: lower is better. "
            "Goal-side / sprinted after losing the ball: % of the times we lost the ball while he was on (forwards are rarely "
            "expected to be goal-side). Compare him only with himself or the squad; never with outside figures. Leaderboard "
            "places are squad ranks."
        ),
    }
    if include_matches:
        out["matches"] = [{"opponent": r["opponent"], "date": r["date"], "minutes": r["minutes"], "short": r["short"],
                           "values": {k: v for k, v in r["values"].items() if v is not None}} for r in rows]
    return safe_json(out)
