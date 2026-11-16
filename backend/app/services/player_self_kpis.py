"""A player's KPIs per match, against HIS OWN average and against the SQUAD average.

Jim's ask (2026-11-15): a player's figures compared with his own match data; Owen (2026-11-16): the squad average beside
it too ("the more info the better"). Leaderboards do the ranking. The frontend picks a match (or the season) and shows it
against his average over his OTHER matches and the squad's average. Matches where a player played under MIN_MINUTES
are kept in his series but left out of his averages and bests and out of the squad averages, so a ten-minute cameo is
never "his worst game" and never drags the squad figure down.

Two parts, so the page is quick:
- player_self_kpis: tagged events, ball-carrier segments, minutes, the match GPS summary (incl. heart rate), impact rank.
- player_self_gps_kpis: from the GPS time-series analysis (only matches with a synced GPS file): getting goal-side after
  we lose the ball, sprinting after we lose it, average position, high-speed running per minute.

Squad averages use exactly the same rules, from every squad player's rows.
"""
from __future__ import annotations

import uuid
from statistics import mean
from typing import Dict, List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.match_event import EventType, MatchEvent, Team

MIN_MINUTES = 20
import time as _time
_SQUAD_CACHE: Dict[str, tuple] = {}     # club -> (fingerprint, built_at, by_player, matches); one squad pass serves every player page
_TTL_S = 600
PITCH_LENGTH_M = 145.0

E = EventType
SCORE_POINTS = {E.GOAL: 3, E.POINT: 1, E.POINT_FREE: 1, E.FORTY_FIVE: 1, E.TWO_POINT: 2, E.TWO_POINT_FREE: 2}
MISSES = {E.WIDE, E.WIDE_FREE, E.SHORT, E.SAVED, E.HIT_POST, E.FORTY_FIVE_MISSED}
FREE_SHOTS = {E.POINT_FREE, E.TWO_POINT_FREE, E.FORTY_FIVE, E.WIDE_FREE, E.FORTY_FIVE_MISSED}
KO_WON_CLEAN = {E.KICKOUT_WON, E.OWN_KICKOUT_WON, E.OPP_KICKOUT_WON}
KO_WON_BREAK = {E.BREAKING_BALL_WON, E.OWN_KICKOUT_WON_BREAK, E.OPP_KICKOUT_WON_BREAK}
COUNT = {E.TURNOVER_WON: "turnovers_won", E.TACKLE_WON: "turnovers_won", E.TURNOVER_LOST: "turnovers_lost",
         E.UNFORCED_ERROR: "turnovers_lost", E.BLOCK: "blocks", E.INTERCEPTION: "interceptions",
         E.FREE_WON: "frees_won", E.FOUL_WON: "frees_won", E.FREE_CONCEDED: "frees_conceded",
         E.FOUL_COMMITTED: "frees_conceded", E.YELLOW_CARD: "cards", E.RED_CARD: "cards"}
COUNT_KEYS = ("score_points", "scores", "shots", "scores_from_play", "assists", "turnovers_lost", "stray_passes", "frees_won",
              "turnovers_won", "blocks", "interceptions", "kickouts_won", "kickouts_won_clean", "kickouts_won_break",
              "frees_conceded", "cards")

# key, label, group, unit, higher_is_better (None = neither: the direction is described, not judged), needs
KPIS = [
    ("score_points", "Points scored", "Scoring", "pts", True, "events"),
    ("scores", "Scores", "Scoring", "", True, "events"),
    ("shots", "Shots", "Scoring", "", True, "events"),
    ("conversion_pct", "Shots scored", "Scoring", "%", True, "shots"),
    ("scores_from_play", "Scores from play", "Scoring", "", True, "events"),
    ("assists", "Assists", "Scoring", "", True, "events"),
    ("impact_rank", "Impact rank in our team", "Scoring", "rank", False, "impact"),
    ("carries", "Carries", "On the ball", "", True, "carries"),
    ("passes", "Passes", "On the ball", "", True, "carries"),
    ("metres_per_carry", "Metres gained per carry", "On the ball", "m", True, "carries"),
    ("turnovers_lost", "Turnovers lost", "On the ball", "", False, "events"),
    ("stray_passes", "Stray passes (part of turnovers lost)", "On the ball", "", False, "events"),
    ("frees_won", "Frees won", "On the ball", "", True, "events"),
    ("turnovers_won", "Turnovers won", "Defending", "", True, "events"),
    ("blocks", "Blocks", "Defending", "", True, "events"),
    ("interceptions", "Interceptions", "Defending", "", True, "events"),
    ("kickouts_won", "Kickouts won", "Restarts", "", True, "events"),
    ("kickouts_won_clean", "Kickouts won clean (caught)", "Restarts", "", True, "events"),
    ("kickouts_won_break", "Kickouts won off the break", "Restarts", "", True, "events"),
    ("frees_conceded", "Frees conceded", "Discipline", "", False, "events"),
    ("cards", "Cards", "Discipline", "", False, "events"),
    ("distance_km", "Distance", "Running (GPS)", "km", True, "gps"),
    ("m_per_min", "Metres per minute", "Running (GPS)", "m/min", True, "gps"),
    ("hsr_m", "High-speed running", "Running (GPS)", "m", True, "gps"),
    ("sprints", "Sprints", "Running (GPS)", "", True, "gps"),
    ("top_speed", "Top speed", "Running (GPS)", "m/s", True, "gps"),
    ("accelerations", "Accelerations", "Running (GPS)", "", True, "gps"),
    ("avg_hr", "Average heart rate", "Heart rate", "bpm", None, "gps"),
    ("max_hr", "Max heart rate", "Heart rate", "bpm", None, "gps"),
    ("red_zone_min", "Minutes above 90% of max heart rate", "Heart rate", "min", None, "gps"),
]

GPS_KPIS = [
    ("back_10s_pct", "Goal-side 10 s after we lost the ball", "Tracking (GPS)", "%", True),
    ("sprint_after_loss_pct", "Sprinted after we lost the ball", "Tracking (GPS)", "%", True),
    ("hsr_per_min", "High-speed running per minute", "Tracking (GPS)", "m/min", True),
    ("avg_x_m", "Average position (m from our goal)", "Tracking (GPS)", "m", None),
    ("avg_x_without_m", "Average position without the ball", "Tracking (GPS)", "m", None),
]


def _r(v, n=1):
    return None if v is None else round(float(v), n)


def _squad(rows_by_player: Dict[str, List[dict]], keys) -> dict:
    """Squad averages per match and for the season: every player's full (not short) matches, the same rules as his own."""
    per_match: Dict[str, Dict[str, List[float]]] = {}
    season: Dict[str, List[float]] = {}
    for rows in rows_by_player.values():
        for r in rows:
            if r["short"]:
                continue
            for k in keys:
                v = r["values"].get(k)
                if v is None:
                    continue
                per_match.setdefault(r["match_id"], {}).setdefault(k, []).append(v)
                season.setdefault(k, []).append(v)
    return {
        "by_match": {mid: {k: _r(mean(v), 2) for k, v in d.items()} for mid, d in per_match.items()},
        "season": {k: _r(mean(v), 2) for k, v in season.items()},
        "players_by_match": {mid: max((len(v) for v in d.values()), default=0) for mid, d in per_match.items()},
    }


# The impact weighting of ai._shared.get_match_player_impact (the reports' Man of the Match), our team only. That tool builds
# both teams' full tables (~6 s a match); this is the same sum from rows already loaded. Keep the two in step.
IMPACT_SCORE = {"goal": 10, "penalty_goal": 10, "point": 3, "point_free": 3, "forty_five": 3, "two_point": 5, "two_point_free": 5}
IMPACT_WON = {"turnover_won", "interception", "tackle_won", "block"}
IMPACT_KO = {"own_kickout_won", "own_kickout_won_break", "opp_kickout_won", "opp_kickout_won_break",
             "own_kickout_opposition_won", "own_kickout_opposition_won_break",
             "opp_kickout_opposition_won", "opp_kickout_opposition_won_break", "kickout_won", "breaking_ball_won"}


def _impact_ranks(events, carries, throw_ins, squad_ids) -> Dict[str, Dict[str, int]]:
    """{match_id: {player_id: rank in our team}}; ties share a rank; only players with something tagged are ranked."""
    score: Dict[str, Dict[str, int]] = {}

    def add(mid, p, n):
        if p and p in squad_ids:
            d = score.setdefault(str(mid), {})
            d[p] = d.get(p, 0) + n

    for e in events:
        et = e.event_type.value if hasattr(e.event_type, "value") else str(e.event_type)
        p = str(e.player_id) if e.player_id else None
        n = IMPACT_SCORE.get(et, 0)
        n += 2 if et in IMPACT_WON or et in IMPACT_KO else 0
        n -= 1 if et in ("turnover_lost", "unforced_error") else 0
        add(e.match_id, p, n)
        if et in IMPACT_SCORE and e.assist_player_id:
            add(e.match_id, str(e.assist_player_id), 3)
    for c in carries:
        add(c.match_id, str(c.player_id) if c.player_id else None, 0)
    for mid, p in throw_ins:
        add(mid, str(p) if p else None, 2)
    return {mid: {p: 1 + sum(1 for x in d.values() if x > v) for p, v in d.items()} for mid, d in score.items()}


async def player_self_kpis(db: AsyncSession, club_id, player_id) -> dict:
    from app.models.ball_carrier_segment import BallCarrierSegment
    from app.models.match_gps import MatchGPSData
    from app.models.match_lineup import MatchLineup
    from app.models.player import Player
    from app.services.ai._shared import compute_playing_minutes
    from app.services.attack_frame import load_direction_map, own_frame

    pid = str(player_id)
    matches = (await db.execute(select(Match).where(and_(Match.counts_in_stats, Match.is_deleted.is_(False), Match.club_id == club_id))
                                .order_by(Match.match_date.asc()))).scalars().all()
    if not matches:
        return {"matches": [], "kpis": [], "min_minutes": MIN_MINUTES, "squad": {"by_match": {}, "season": {}}}
    mids = [m.id for m in matches]
    from sqlalchemy import func
    fp = tuple((await db.execute(select(func.count(MatchEvent.id), func.max(MatchEvent.created_at)).where(MatchEvent.match_id.in_(mids)))).one())
    fp = (fp, tuple(str(m) for m in mids), tuple(str(getattr(m, "updated_at", "")) for m in matches))
    hit = _SQUAD_CACHE.get(str(club_id))
    if hit and hit[0] == fp and _time.time() - hit[1] < _TTL_S:
        return _assemble(pid, hit[2])
    squad_ids = {str(r[0]) for r in (await db.execute(select(Player.id).where(Player.club_id == club_id))).all()}

    on_field: Dict[str, set] = {}
    for mid, p in (await db.execute(select(MatchLineup.match_id, MatchLineup.player_id).where(and_(
            MatchLineup.match_id.in_(mids), MatchLineup.is_on_field.is_(True))))).all():
        on_field.setdefault(str(p), set()).add(mid)
    events = (await db.execute(select(MatchEvent).where(and_(MatchEvent.match_id.in_(mids), MatchEvent.team == Team.OWN)))).scalars().all()
    carries = (await db.execute(select(BallCarrierSegment).where(and_(
        BallCarrierSegment.match_id.in_(mids), BallCarrierSegment.team == "own")))).scalars().all()
    gps: Dict[tuple, object] = {(str(r.player_id), r.match_id): r for r in (await db.execute(
        select(MatchGPSData).where(MatchGPSData.match_id.in_(mids)))).scalars().all()}
    dmap = await load_direction_map(db, mids)
    minutes = {}
    for m in matches:
        try:
            minutes[m.id] = await compute_playing_minutes(db, m.id)
        except Exception:
            minutes[m.id] = {}

    ev_by: Dict[tuple, list] = {}
    assists: Dict[tuple, int] = {}
    for e in events:
        if e.player_id:
            ev_by.setdefault((str(e.player_id), e.match_id), []).append(e)
        if e.assist_player_id:
            k = (str(e.assist_player_id), e.match_id)
            assists[k] = assists.get(k, 0) + 1
    from app.models.video_event import VideoEvent
    try:
        throw_ins = (await db.execute(select(VideoEvent.match_id, VideoEvent.player_id).where(and_(
            VideoEvent.match_id.in_(mids), VideoEvent.event_type == "THROW_IN", VideoEvent.player_id.isnot(None))))).all()
    except Exception:
        throw_ins = []
    impact = _impact_ranks(events, carries, throw_ins, squad_ids)
    ca_by: Dict[tuple, list] = {}
    for c in carries:
        if c.player_id:
            ca_by.setdefault((str(c.player_id), c.match_id), []).append(c)

    def rows_for(p: str) -> List[dict]:
        rows = []
        for m in matches:
            key = (p, m.id)
            played = m.id in on_field.get(p, ()) or key in gps or key in ev_by or key in ca_by or key in assists
            if not played:
                continue
            mins = minutes.get(m.id, {}).get(p)
            v: Dict[str, Optional[float]] = {k: 0 for k in COUNT_KEYS}
            v["assists"] = assists.get(key, 0)
            for e in ev_by.get(key, []):
                t = e.event_type
                if t in SCORE_POINTS:
                    v["score_points"] += SCORE_POINTS[t]; v["scores"] += 1; v["shots"] += 1
                    if t not in FREE_SHOTS:
                        v["scores_from_play"] += 1
                elif t in MISSES:
                    v["shots"] += 1
                elif t in COUNT:
                    v[COUNT[t]] += 1
                    if COUNT[t] == "turnovers_lost" and e.sub_type and "pass" in e.sub_type.lower():
                        v["stray_passes"] += 1
                elif t in KO_WON_CLEAN:
                    v["kickouts_won"] += 1; v["kickouts_won_clean"] += 1
                elif t in KO_WON_BREAK:
                    v["kickouts_won"] += 1; v["kickouts_won_break"] += 1
            v["conversion_pct"] = round(100 * v["scores"] / v["shots"], 0) if v["shots"] else None
            cs = ca_by.get(key, [])
            if cs:
                gains = []
                for c in cs:
                    sx, _ = own_frame(c, dmap, "start_x", "start_y")
                    ex, _ = own_frame(c, dmap, "end_x", "end_y")
                    if sx is not None and ex is not None:
                        gains.append((ex - sx) / 100.0 * PITCH_LENGTH_M)
                v["carries"] = len(cs)
                v["passes"] = sum(1 for c in cs if c.ended_by == "pass")
                v["metres_per_carry"] = _r(mean(gains)) if gains else None
            else:
                v["carries"] = v["passes"] = v["metres_per_carry"] = None
            v["impact_rank"] = impact.get(str(m.id), {}).get(p)
            g = gps.get(key)
            if g is not None and g.total_distance_m:
                gm = g.playing_minutes or mins
                v["distance_km"] = _r(g.total_distance_m / 1000, 2)
                v["m_per_min"] = _r(g.total_distance_m / gm, 0) if gm else None
                v["hsr_m"] = _r(g.high_speed_running_m, 0)
                v["sprints"] = g.sprint_count
                v["top_speed"] = _r(g.max_speed_ms, 2)
                v["accelerations"] = g.acceleration_count
                v["avg_hr"] = g.avg_heart_rate or None
                v["max_hr"] = g.max_heart_rate or None
                v["red_zone_min"] = _r(g.time_in_red_zone_mins) if g.time_in_red_zone_mins else None
            else:
                for k in ("distance_km", "m_per_min", "hsr_m", "sprints", "top_speed", "accelerations", "avg_hr", "max_hr", "red_zone_min"):
                    v[k] = None
            if not (key in ev_by or m.id in on_field.get(p, ())):
                for k, *_rest in KPIS:
                    if _rest[-1] == "events":
                        v[k] = None
            rows.append({"match_id": str(m.id), "opponent": m.opponent, "date": m.match_date.isoformat() if m.match_date else None,
                         "competition": getattr(m, "competition", None), "minutes": mins,
                         "short": mins is not None and mins < MIN_MINUTES, "values": v})
        return rows

    by_player = {p: rows_for(p) for p in squad_ids}
    _SQUAD_CACHE[str(club_id)] = (fp, _time.time(), by_player)
    return _assemble(pid, by_player)


def _assemble(pid: str, by_player: Dict[str, List[dict]]) -> dict:
    rows = by_player.get(pid, [])
    squad = _squad(by_player, [k for k, *_ in KPIS])

    kpis = []
    for key, label, group, unit, hib, _needs in KPIS:
        if all(r["values"].get(key) is None for r in rows):
            continue
        kpis.append({"key": key, "label": label, "group": group, "unit": unit, "higher_is_better": hib})
    return {"player_id": pid, "min_minutes": MIN_MINUTES, "matches": rows, "kpis": kpis,
            "squad": {"by_match": squad["by_match"], "season": squad["season"], "players_by_match": squad["players_by_match"]},
            "note": (f"Each figure is one match. 'His average' leaves out the match being looked at and any match under "
                     f"{MIN_MINUTES} minutes; 'squad average' is every squad player's figure in full matches (same rule). "
                     f"Running and heart-rate figures only for matches with a GPS upload.")}


async def player_self_gps_kpis(db: AsyncSession, club_id, player_id) -> dict:
    """KPIs from the GPS time-series analysis, per synced match, for him and the squad (same rules)."""
    from app.services.gps_analysis.loader import NotReady, synced_matches
    from app.services.gps_analysis.service import analyse

    pid = str(player_id)
    by_player: Dict[str, List[dict]] = {}
    for m in await synced_matches(db, club_id):
        try:
            res, _, _ = await analyse(db, m)
        except NotReady:
            continue
        except Exception:
            continue
        mid = str(m.id)
        acc: Dict[str, dict] = {}
        for p in res["intensity"]["players"]:
            mins = p.get("minutes") or 0
            acc[p["player_id"]] = {"minutes": mins, "hsr_per_min": _r(p["hsr_m"] / mins, 1) if mins else None,
                                   "lost_on": 0, "back": 0, "sprinted": 0}
        for t in res["transitions"]["lost"]:
            sprinted = {r["player_id"] for r in t.get("sprinted", [])}
            for q in t.get("on_ids") or []:
                if q not in acc:
                    continue
                acc[q]["lost_on"] += 1
                acc[q]["back"] += int(q in (t.get("back_10s_ids") or []))
                acc[q]["sprinted"] += int(q in sprinted)
        pos = {p.get("player_id"): p for p in res["positions"]["players"] if p.get("player_id")}
        for q, a in acc.items():
            v = {"hsr_per_min": a["hsr_per_min"],
                 "back_10s_pct": round(100 * a["back"] / a["lost_on"]) if a["lost_on"] >= 3 else None,
                 "sprint_after_loss_pct": round(100 * a["sprinted"] / a["lost_on"]) if a["lost_on"] >= 3 else None,
                 "lost_on": a["lost_on"], "avg_x_m": None, "avg_x_without_m": None}
            p = pos.get(q)
            if p:
                cells = [c for h in p["halves"].values() for c in h.values()]
                wo = [c for h in p["halves"].values() for s, c in h.items() if s == "without_ball"]
                tot = sum(c["minutes"] for c in cells)
                if tot:
                    v["avg_x_m"] = _r(sum(c["x_m"] * c["minutes"] for c in cells) / tot)
                tw = sum(c["minutes"] for c in wo)
                if tw:
                    v["avg_x_without_m"] = _r(sum(c["x_m"] * c["minutes"] for c in wo) / tw)
            by_player.setdefault(q, []).append({"match_id": mid, "minutes": round(a["minutes"]), "short": a["minutes"] < MIN_MINUTES, "values": v})
    rows = by_player.get(pid, [])
    squad = _squad(by_player, [k for k, *_ in GPS_KPIS])
    kpis = [{"key": k, "label": lab, "group": g, "unit": u, "higher_is_better": hib}
            for k, lab, g, u, hib in GPS_KPIS if any(r["values"].get(k) is not None for r in rows)]
    return {"player_id": pid, "matches": rows, "kpis": kpis, "squad": {"by_match": squad["by_match"], "season": squad["season"]},
            "how_to_read": ("Only matches with a synced GPS file. Goal-side: of the times we lost the ball while he was on, the % "
                            "where he was at least 2 m nearer our goal than the ball 10 s later (forwards are rarely expected to be). "
                            "Sprinted: % where he went over 5.5 m/s within 10 s. Each needs at least 3 such moments in the match. "
                            "Average position: metres from our own goal line, higher = further up the pitch.")}
