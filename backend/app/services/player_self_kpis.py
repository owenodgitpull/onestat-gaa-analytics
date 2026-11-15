"""A player's KPIs against HIMSELF: every match he played, each KPI per match, and his own average / best.

Jim's ask (2026-11-15): a player's figures compared with his own match data, never with team-mates or outside figures
(leaderboards already do the team comparison). The frontend picks a match and shows it against his average over his
OTHER matches. Matches where he played under MIN_MINUTES are kept in the series but left out of averages and bests, so a
ten-minute cameo is never "his worst game".

Sources: tagged match events (scores, shots, turnovers, kickouts, discipline), ball-carrier segments (carries, passes,
metres gained), lineup + substitutions (minutes, via compute_playing_minutes) and the match GPS summary (running).
"""
from __future__ import annotations

import uuid
from statistics import mean
from typing import Dict, List, Optional

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.match_event import EventType, MatchEvent, Team

MIN_MINUTES = 20
PITCH_LENGTH_M = 145.0

E = EventType
SCORE_POINTS = {E.GOAL: 3, E.POINT: 1, E.POINT_FREE: 1, E.FORTY_FIVE: 1, E.TWO_POINT: 2, E.TWO_POINT_FREE: 2}
MISSES = {E.WIDE, E.WIDE_FREE, E.SHORT, E.SAVED, E.HIT_POST, E.FORTY_FIVE_MISSED}
FREE_SHOTS = {E.POINT_FREE, E.TWO_POINT_FREE, E.FORTY_FIVE, E.WIDE_FREE, E.FORTY_FIVE_MISSED}
KO_WON = {E.KICKOUT_WON, E.BREAKING_BALL_WON, E.OWN_KICKOUT_WON, E.OWN_KICKOUT_WON_BREAK, E.OPP_KICKOUT_WON, E.OPP_KICKOUT_WON_BREAK}
KO_LOST = {E.KICKOUT_LOST, E.BREAKING_BALL_LOST, E.OWN_KICKOUT_OPPOSITION_WON, E.OWN_KICKOUT_OPPOSITION_WON_BREAK,
           E.OPP_KICKOUT_OPPOSITION_WON, E.OPP_KICKOUT_OPPOSITION_WON_BREAK}
COUNT = {E.TURNOVER_WON: "turnovers_won", E.TACKLE_WON: "turnovers_won", E.TURNOVER_LOST: "turnovers_lost",
         E.UNFORCED_ERROR: "turnovers_lost", E.BLOCK: "blocks", E.INTERCEPTION: "interceptions",
         E.FREE_WON: "frees_won", E.FOUL_WON: "frees_won", E.FREE_CONCEDED: "frees_conceded",
         E.FOUL_COMMITTED: "frees_conceded", E.YELLOW_CARD: "cards", E.RED_CARD: "cards"}

# key, label, group, unit, higher_is_better, needs (the data a match must have for the KPI to count)
KPIS = [
    ("score_points", "Points scored", "Scoring", "pts", True, "events"),
    ("scores", "Scores", "Scoring", "", True, "events"),
    ("shots", "Shots", "Scoring", "", True, "events"),
    ("conversion_pct", "Shots scored", "Scoring", "%", True, "shots"),
    ("scores_from_play", "Scores from play", "Scoring", "", True, "events"),
    ("assists", "Assists", "Scoring", "", True, "events"),
    ("carries", "Carries", "On the ball", "", True, "carries"),
    ("passes", "Passes", "On the ball", "", True, "carries"),
    ("metres_per_carry", "Metres gained per carry", "On the ball", "m", True, "carries"),
    ("turnovers_lost", "Turnovers lost", "On the ball", "", False, "events"),
    ("frees_won", "Frees won", "On the ball", "", True, "events"),
    ("turnovers_won", "Turnovers won", "Defending", "", True, "events"),
    ("blocks", "Blocks", "Defending", "", True, "events"),
    ("interceptions", "Interceptions", "Defending", "", True, "events"),
    ("kickouts_won", "Kickouts won", "Restarts", "", True, "events"),
    ("frees_conceded", "Frees conceded", "Discipline", "", False, "events"),
    ("cards", "Cards", "Discipline", "", False, "events"),
    ("distance_km", "Distance", "Running (GPS)", "km", True, "gps"),
    ("m_per_min", "Metres per minute", "Running (GPS)", "m/min", True, "gps"),
    ("hsr_m", "High-speed running", "Running (GPS)", "m", True, "gps"),
    ("sprints", "Sprints", "Running (GPS)", "", True, "gps"),
    ("top_speed", "Top speed", "Running (GPS)", "m/s", True, "gps"),
    ("accelerations", "Accelerations", "Running (GPS)", "", True, "gps"),
]


def _r(v, n=1):
    return None if v is None else round(float(v), n)


async def player_self_kpis(db: AsyncSession, club_id, player_id) -> dict:
    from app.models.ball_carrier_segment import BallCarrierSegment
    from app.models.match_gps import MatchGPSData
    from app.models.match_lineup import MatchLineup
    from app.services.ai._shared import compute_playing_minutes
    from app.services.attack_frame import load_direction_map, own_frame

    pid = player_id if isinstance(player_id, uuid.UUID) else uuid.UUID(str(player_id))
    matches = (await db.execute(select(Match).where(and_(Match.counts_in_stats, Match.is_deleted.is_(False), Match.club_id == club_id))
                                .order_by(Match.match_date.asc()))).scalars().all()
    if not matches:
        return {"matches": [], "kpis": [], "min_minutes": MIN_MINUTES}
    mids = [m.id for m in matches]

    on_field = {r[0] for r in (await db.execute(select(MatchLineup.match_id).where(and_(
        MatchLineup.match_id.in_(mids), MatchLineup.player_id == pid, MatchLineup.is_on_field.is_(True))))).all()}
    events = (await db.execute(select(MatchEvent).where(and_(
        MatchEvent.match_id.in_(mids), MatchEvent.team == Team.OWN,
        or_(MatchEvent.player_id == pid, MatchEvent.assist_player_id == pid))))).scalars().all()
    carries = (await db.execute(select(BallCarrierSegment).where(and_(
        BallCarrierSegment.match_id.in_(mids), BallCarrierSegment.player_id == pid, BallCarrierSegment.team == "own")))).scalars().all()
    gps = {r.match_id: r for r in (await db.execute(select(MatchGPSData).where(and_(
        MatchGPSData.match_id.in_(mids), MatchGPSData.player_id == pid)))).scalars().all()}
    dmap = await load_direction_map(db, mids)

    ev_by, ca_by = {}, {}
    for e in events:
        ev_by.setdefault(e.match_id, []).append(e)
    for c in carries:
        ca_by.setdefault(c.match_id, []).append(c)
    played = [m for m in matches if m.id in on_field or m.id in gps or ev_by.get(m.id) or ca_by.get(m.id)]

    rows = []
    for m in played:
        mins = None
        try:
            mins = (await compute_playing_minutes(db, m.id)).get(str(pid))
        except Exception:
            mins = None
        v: Dict[str, Optional[float]] = {k: 0 for k in ("score_points", "scores", "shots", "scores_from_play", "assists",
                                                         "turnovers_lost", "frees_won", "turnovers_won", "blocks",
                                                         "interceptions", "kickouts_won", "frees_conceded", "cards")}
        for e in ev_by.get(m.id, []):
            if e.player_id != pid:          # only the assist credit
                if e.assist_player_id == pid:
                    v["assists"] += 1
                continue
            t = e.event_type
            if t in SCORE_POINTS:
                v["score_points"] += SCORE_POINTS[t]; v["scores"] += 1; v["shots"] += 1
                if t not in FREE_SHOTS:
                    v["scores_from_play"] += 1
            elif t in MISSES:
                v["shots"] += 1
            elif t in COUNT:
                v[COUNT[t]] += 1
            elif t in KO_WON:
                v["kickouts_won"] += 1
        v["conversion_pct"] = round(100 * v["scores"] / v["shots"], 0) if v["shots"] else None
        cs = ca_by.get(m.id, [])
        has_carries = bool(cs)
        if has_carries:
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
        g = gps.get(m.id)
        if g is not None and g.total_distance_m:
            gm = g.playing_minutes or mins
            v["distance_km"] = _r(g.total_distance_m / 1000, 2)
            v["m_per_min"] = _r(g.total_distance_m / gm, 0) if gm else None
            v["hsr_m"] = _r(g.high_speed_running_m, 0)
            v["sprints"] = g.sprint_count
            v["top_speed"] = _r(g.max_speed_ms, 2)
            v["accelerations"] = g.acceleration_count
        else:
            for k in ("distance_km", "m_per_min", "hsr_m", "sprints", "top_speed", "accelerations"):
                v[k] = None
        has_events = bool(ev_by.get(m.id)) or m.id in on_field
        if not has_events:
            for k, *_rest in KPIS:
                if _rest[-1] == "events":
                    v[k] = None
        rows.append({"match_id": str(m.id), "opponent": m.opponent, "date": m.match_date.isoformat() if m.match_date else None,
                     "competition": getattr(m, "competition", None), "minutes": mins,
                     "short": mins is not None and mins < MIN_MINUTES, "values": v})

    kpis = []
    for key, label, group, unit, hib, _needs in KPIS:
        series = [r["values"].get(key) for r in rows]
        if all(x is None for x in series):
            continue
        kpis.append({"key": key, "label": label, "group": group, "unit": unit, "higher_is_better": hib})
    return {"player_id": str(pid), "min_minutes": MIN_MINUTES, "matches": rows, "kpis": kpis,
            "note": (f"Each figure is one match. 'His average' leaves out the match being looked at and any match under "
                     f"{MIN_MINUTES} minutes. Running figures only for matches with a GPS upload.")}
