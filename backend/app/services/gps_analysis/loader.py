"""DB reads for GPS analysis. Read-only: tracks + sync (via gps_timeseries.service), carries, video events, lineup."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match_gps_track import MatchGPSSync
from app.services.gps_timeseries import service as ts_service
from app.services.gps_timeseries.codec import Track


@dataclass
class Carry:
    id: str
    team: str                 # 'own' / 'opponent'
    player_id: Optional[str]
    opposition_player_id: Optional[str]
    half: Optional[int]
    start_x: Optional[float]  # raw screen 0-100
    start_y: Optional[float]
    end_x: Optional[float]
    end_y: Optional[float]
    video_ms: int
    end_video_ms: Optional[int]
    ended_by: Optional[str]


@dataclass
class Event:
    id: str
    team: str                 # 'team_a' (ours) / 'team_b'
    event_type: str
    sub_type: Optional[str]
    half: Optional[int]
    video_ms: int
    pitch_x: Optional[float]  # raw screen 0-100
    pitch_y: Optional[float]
    end_x: Optional[float]
    end_y: Optional[float]
    player_id: Optional[str]
    sub_in_player_id: Optional[str]
    opposition_player_id: Optional[str]
    match_minute: Optional[int]
    match_second: Optional[int]
    score_source: Optional[str] = None   # scoring_context.source on shots: FROM_PLAY, FROM_FREE, FROM_45, ...


@dataclass
class MatchInputs:
    match_id: str
    club_id: str
    opponent: Optional[str]
    match_date: Optional[str]
    attacking_right_first_half: Optional[bool]
    pitch_length_m: float
    pitch_width_m: float
    result: Dict[str, int]
    session: dict                       # video session id + marks
    sync: dict                          # status, calibration, periods, tag_lag, quality, computed_at, confirmed_at
    tracks: Dict[str, Track]            # player_id -> track (in-match tracks only)
    players: Dict[str, dict]            # player_id -> {name, jersey}
    starters: List[str]
    bench: List[str]
    carries: List[Carry] = field(default_factory=list)
    events: List[Event] = field(default_factory=list)
    opposition_names: Dict[str, str] = field(default_factory=dict)   # opposition player id -> surname
    man_marking: List[dict] = field(default_factory=list)            # [{player_id, opponent_name}] from match prep
    half_duration_mins: Optional[int] = None                         # for "70+1" added-time labels

    @property
    def cache_key(self) -> str:
        offs = ",".join(f"{p['half']}:{p['offset_ms']}:{p.get('rate', 1)}" for p in (self.sync.get("periods") or []))
        # any edit to a carry, an event, the lineup or the man-marking changes the key, so a fixed tag shows up at once
        import hashlib
        h = hashlib.sha1()
        for c in self.carries:
            h.update(repr((c.id, c.team, c.player_id, c.half, c.start_x, c.start_y, c.end_x, c.end_y, c.video_ms, c.end_video_ms, c.ended_by)).encode())
        for e in self.events:
            h.update(repr((e.id, e.team, e.event_type, e.sub_type, e.half, e.video_ms, e.pitch_x, e.pitch_y, e.player_id, e.sub_in_player_id, e.opposition_player_id)).encode())
        h.update(repr((sorted(self.starters), sorted(self.bench), self.man_marking, self.attacking_right_first_half)).encode())
        from .frame import POSSESSION_V2
        from .lag import manual_shift_ms
        h.update(repr(("poss-v2" if POSSESSION_V2 else "poss-v1", manual_shift_ms(self.sync.get("tag_lag")))).encode())
        return f"{self.match_id}|{self.sync.get('computed_at')}|{self.sync.get('confirmed_at')}|{offs}|{h.hexdigest()}"


class NotReady(Exception):
    """The match has no synced GPS (no tracks, sync pending or failed)."""


def _s(v):
    return str(v) if v is not None else None


class _Row:
    def __init__(self, d):
        self.__dict__.update(d)


async def match_row(db: AsyncSession, match_id, club_id):
    """The match's own columns only (plain SQL: the ORM Match pulls in every relationship). None if not this club's."""
    r = (await db.execute(text(
        "select id, club_id, opponent, match_date, attacking_right_first_half, pitch_length_m, pitch_width_m, half_duration_mins, "
        "team_goals, team_points, opponent_goals, opponent_points from matches where id = :m and club_id = :c"),
        {"m": str(match_id), "c": str(club_id)})).mappings().first()
    return _Row(dict(r)) if r else None


async def load_match(db: AsyncSession, match, with_tracks: bool = True) -> MatchInputs:
    """`match` is a match_row() (or anything with the same attributes)."""
    s = (await db.execute(select(MatchGPSSync).where(MatchGPSSync.match_id == match.id))).scalars().first()
    if s is None or not s.periods or s.status in ("pending", "failed"):
        raise NotReady("GPS is not synced to the video for this match")
    sr = (await db.execute(text(
        "select id, first_half_start_ms, halftime_timestamp_ms, second_half_start_ms, full_time_ms, et_first_half_start_ms, et_halftime_ms, "
        "et_second_half_start_ms, et_full_time_ms, video_duration_ms from video_sessions where match_id = :m order by created_at desc limit 1"),
        {"m": match.id})).mappings().first()
    if sr is None:
        raise NotReady("the match has no video session")
    session = _Row(dict(sr))
    quality = s.quality or {}
    tracks: Dict[str, Track] = {}
    if with_tracks:
        for row, t in await ts_service.load_tracks(db, match.id):
            q = quality.get(str(row.player_id)) or {}
            if q.get("in_match") is False:
                continue          # e.g. a morning session elsewhere: never part of a match view
            tracks[str(row.player_id)] = t

    lineup = (await db.execute(text(
        "select l.player_id, l.is_substitute, coalesce(l.jersey_number, p.jersey_number), p.name, l.position_id "
        "from match_lineups l join players p on p.id = l.player_id where l.match_id = :m"), {"m": match.id})).all()
    players = {str(r[0]): {"name": r[3], "jersey": r[2], "position": r[4]} for r in lineup}
    starters = [str(r[0]) for r in lineup if not r[1]]
    bench = [str(r[0]) for r in lineup if r[1]]
    # tracked players missing from the lineup still get a name
    missing = [pid for pid in tracks if pid not in players]
    if missing:
        for r in (await db.execute(text("select id, name, jersey_number from players where id = any(cast(:ids as uuid[]))"), {"ids": missing})).all():
            players[str(r[0])] = {"name": r[1], "jersey": r[2]}

    carries = [Carry(_s(r[0]), r[1], _s(r[2]), _s(r[3]), r[4], r[5], r[6], r[7], r[8], int(r[9]), r[10], r[11]) for r in (await db.execute(text(
        "select id, team, player_id, opposition_player_id, half, start_x, start_y, end_x, end_y, video_timestamp_ms, end_video_ms, ended_by "
        "from ball_carrier_segments where match_id = :m and video_timestamp_ms is not null order by video_timestamp_ms"), {"m": match.id})).all()]
    events = [Event(_s(r[0]), r[1], r[2], r[3], r[4], int(r[5]), r[6], r[7], r[8], r[9], _s(r[10]), _s(r[11]), _s(r[12]), r[13], r[14], r[15]) for r in (await db.execute(text(
        "select id, team, event_type, sub_type, half, video_timestamp_ms, pitch_x, pitch_y, end_x, end_y, player_id, sub_in_player_id, "
        "opposition_player_id, match_minute, match_second, scoring_context->>'source' from video_events "
        "where match_id = :m and video_session_id = :s and video_timestamp_ms is not null order by video_timestamp_ms"),
        {"m": match.id, "s": session.id})).all()]
    for e in events:          # substitutes who came on are named too
        for pid in (e.player_id, e.sub_in_player_id):
            if pid and pid not in players:
                players[pid] = {"name": None, "jersey": None}
    unnamed = [pid for pid, v in players.items() if v["name"] is None]
    if unnamed:
        for r in (await db.execute(text("select id, name, jersey_number from players where id = any(cast(:ids as uuid[]))"), {"ids": unnamed})).all():
            players[str(r[0])] = {"name": r[1], "jersey": r[2]}

    opp_ids = sorted({e.opposition_player_id for e in events if e.opposition_player_id} | {c.opposition_player_id for c in carries if c.opposition_player_id})
    opposition_names = {}
    if opp_ids:
        opposition_names = {str(r[0]): r[1] for r in (await db.execute(text(
            "select id, surname from opposition_players where id = any(cast(:ids as uuid[]))"), {"ids": opp_ids})).all()}
    man_marking = [{"player_id": str(r[0]), "opponent_name": r[1]} for r in (await db.execute(text(
        "select player_id, opponent_player_name from man_marking_assignments where match_id = :m"), {"m": match.id})).all()]

    return MatchInputs(
        match_id=str(match.id), club_id=str(match.club_id), opponent=getattr(match, "opponent", None),
        match_date=(match.match_date.date() if hasattr(match.match_date, "date") else match.match_date).isoformat() if getattr(match, "match_date", None) else None,
        attacking_right_first_half=match.attacking_right_first_half,
        pitch_length_m=float((s.calibration or {}).get("pitch_length_m") or match.pitch_length_m or 145.0),
        pitch_width_m=float((s.calibration or {}).get("pitch_width_m") or match.pitch_width_m or 90.0),
        result={"team_goals": match.team_goals or 0, "team_points": match.team_points or 0,
                "opponent_goals": match.opponent_goals or 0, "opponent_points": match.opponent_points or 0},
        session={"id": str(session.id), "first_half_start_ms": session.first_half_start_ms, "halftime_ms": session.halftime_timestamp_ms,
                 "second_half_start_ms": session.second_half_start_ms, "full_time_ms": session.full_time_ms,
                 "et_first_half_start_ms": session.et_first_half_start_ms, "et_halftime_ms": session.et_halftime_ms,
                 "et_second_half_start_ms": session.et_second_half_start_ms, "et_full_time_ms": session.et_full_time_ms,
                 "duration_ms": session.video_duration_ms},
        sync={"status": s.status, "calibration": s.calibration, "periods": s.periods, "tag_lag": s.tag_lag or {}, "quality": quality,
              "computed_at": s.computed_at.isoformat() if s.computed_at else None,
              "confirmed_at": s.confirmed_at.isoformat() if s.confirmed_at else None},
        tracks=tracks, players=players, starters=starters, bench=bench, carries=carries, events=events,
        opposition_names=opposition_names, man_marking=man_marking,
        half_duration_mins=getattr(match, "half_duration_mins", None),
    )


async def synced_matches(db: AsyncSession, club_id) -> list:
    ids = [r[0] for r in (await db.execute(text(
        "select m.id from matches m join match_gps_sync s on s.match_id = m.id where m.club_id = :c and s.status in ('auto', 'confirmed') "
        "order by m.match_date"), {"c": str(club_id)})).all()]
    return [await match_row(db, i, club_id) for i in ids]
