"""
Edit a move (a chain of carries and passes) after it was tagged, and a data-health check for a video session.

Everything a coach does in the "Edit this move" window goes through here, so a mis-tapped carrier, a stray step or a
missing pass can be fixed in the app instead of in the database. Carriers are stored as `ball_carrier_segments`; each
hand pass is a PASS_HAND video event logged by the passer at the moment the next carrier picked it up, so every edit
keeps the segment and its pass event in step (and the mirrored match event via live_sync).
"""
import logging
from typing import Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.models.ball_carrier_segment import BallCarrierSegment
from app.models.video_event import VideoEvent
from app.models.video_session import VideoSession
from app.models.player import Player
from app.models.opposition import OppositionPlayer
from app.services.video import live_sync

logger = logging.getLogger(__name__)
router = APIRouter()

TERMINAL_ENDS = {"score", "wide", "turnover", "free", "kickout", "short", "saved", "hit_post", "block"}
SCORE_EVENT_TYPES = {"POINT_SCORED", "GOAL_SCORED"}
MAX_STEPS = 20
PASS_LEAD_MS = 3500      # a pass event is logged up to ~3.5s before the next pickup (and up to 0.6s after)
PASS_LAG_MS = 600


# ── helpers ──────────────────────────────────────────────────────────────────────────────────────

async def _session_for_club(db: AsyncSession, session_id: UUID, club_id: UUID) -> VideoSession:
    s = (await db.execute(
        select(VideoSession).where(VideoSession.id == session_id, VideoSession.club_id == club_id)
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Video session not found")
    return s


def _team_of_segment(seg: BallCarrierSegment) -> str:
    return "team_a" if seg.team == "own" else "team_b"


async def _name_maps(db: AsyncSession, segs: list) -> tuple[dict, dict]:
    pids = {s.player_id for s in segs if s.player_id}
    oids = {s.opposition_player_id for s in segs if s.opposition_player_id}
    players = {}
    opp = {}
    if pids:
        players = {p.id: p.name for p in (await db.execute(select(Player).where(Player.id.in_(pids)))).scalars().all()}
    if oids:
        opp = {p.id: p.surname for p in (await db.execute(select(OppositionPlayer).where(OppositionPlayer.id.in_(oids)))).scalars().all()}
    return players, opp


async def _linked_pass_event(db: AsyncSession, session_id: UUID, seg: BallCarrierSegment,
                             next_seg: Optional[BallCarrierSegment]) -> Optional[VideoEvent]:
    """The PASS_HAND the passer's carry produced: same team, same player, logged just before the next pickup."""
    if next_seg is None or seg.video_timestamp_ms is None or next_seg.video_timestamp_ms is None:
        return None
    team = _team_of_segment(seg)
    q = select(VideoEvent).where(
        VideoEvent.video_session_id == session_id,
        VideoEvent.event_type == "PASS_HAND",
        VideoEvent.team == team,
        VideoEvent.video_timestamp_ms >= seg.video_timestamp_ms,
        VideoEvent.video_timestamp_ms >= next_seg.video_timestamp_ms - PASS_LEAD_MS,
        VideoEvent.video_timestamp_ms <= next_seg.video_timestamp_ms + PASS_LAG_MS,
    )
    if seg.player_id:
        q = q.where(VideoEvent.player_id == seg.player_id)
    elif seg.opposition_player_id:
        q = q.where(VideoEvent.opposition_player_id == seg.opposition_player_id)
    cands = (await db.execute(q)).scalars().all()
    if not cands:
        return None
    return min(cands, key=lambda e: abs((e.video_timestamp_ms or 0) - next_seg.video_timestamp_ms))


async def _match_segments(db: AsyncSession, match_id: UUID) -> list[BallCarrierSegment]:
    return list((await db.execute(
        select(BallCarrierSegment).where(BallCarrierSegment.match_id == match_id)
        .order_by(BallCarrierSegment.sequence_number.asc(), BallCarrierSegment.video_timestamp_ms.asc())
    )).scalars().all())


def _chain_for(segs: list[BallCarrierSegment], ev: VideoEvent) -> list[BallCarrierSegment]:
    """The carries that make up the move this event belongs to."""
    ts = ev.video_timestamp_ms
    if ts is None:
        return []
    team = "own" if ev.team == "team_a" else "opponent"
    et = ev.event_type or ""
    forward = "KICKOUT" in et or et in ("TURNOVER_WON", "TACKLE_WON", "INTERCEPTION", "BLOCK_SHOT")
    idx = None
    if not forward:
        # a score / wide / turnover lost ends a move: the carry that started at or before it
        for i in range(len(segs) - 1, -1, -1):
            s = segs[i]
            if s.team == team and s.video_timestamp_ms is not None and s.video_timestamp_ms <= ts + 1500:
                idx = i
                break
        if idx is None:
            return []
        chain = [segs[idx]]
        j = idx - 1
        while j >= 0 and len(chain) < MAX_STEPS:
            s = segs[j]
            if s.team != team or (s.ended_by in TERMINAL_ENDS and s.ended_by != "manual"):
                break
            chain.insert(0, s)
            j -= 1
        return chain
    # a kickout / turnover won: the move starts with the first carry after it
    for i, s in enumerate(segs):
        if s.team == team and s.video_timestamp_ms is not None and s.video_timestamp_ms >= ts - 1500 and s.video_timestamp_ms <= ts + 20000:
            idx = i
            break
    if idx is None:
        return []
    chain = [segs[idx]]
    j = idx + 1
    while j < len(segs) and len(chain) < MAX_STEPS:
        prev = chain[-1]
        s = segs[j]
        if s.team != team or (prev.ended_by in TERMINAL_ENDS and prev.ended_by != "manual"):
            break
        chain.append(s)
        j += 1
    return chain


def _step_json(seg: BallCarrierSegment, players: dict, opp: dict, pass_ev: Optional[VideoEvent]) -> dict:
    return {
        "segment_id": str(seg.id),
        "sequence_number": seg.sequence_number,
        "team": _team_of_segment(seg),
        "player_id": str(seg.player_id) if seg.player_id else None,
        "opposition_player_id": str(seg.opposition_player_id) if seg.opposition_player_id else None,
        "name": players.get(seg.player_id) if seg.player_id else opp.get(seg.opposition_player_id),
        "jersey_number": seg.jersey_number,
        "ended_by": seg.ended_by,
        "video_timestamp_ms": seg.video_timestamp_ms,
        "match_clock_s": seg.match_clock_s,
        "start": {"x": seg.start_x, "y": seg.start_y},
        "end": {"x": seg.end_x, "y": seg.end_y},
        "pass_event_id": str(pass_ev.id) if pass_ev else None,
    }


class StepPlayer(BaseModel):
    player_id: Optional[UUID] = None
    opposition_player_id: Optional[UUID] = None
    jersey_number: Optional[int] = None


class InsertStep(StepPlayer):
    after_segment_id: UUID


async def _validate_player(db: AsyncSession, club_id: UUID, body: StepPlayer) -> tuple[Optional[str], Optional[str]]:
    """Exactly one of own / opposition player, and it must belong to this club. Returns (own_name, opposition_name)."""
    if bool(body.player_id) == bool(body.opposition_player_id):
        raise HTTPException(status_code=400, detail="Give exactly one of player_id / opposition_player_id")
    if body.player_id:
        p = (await db.execute(select(Player).where(Player.id == body.player_id, Player.club_id == club_id))).scalar_one_or_none()
        if not p:
            raise HTTPException(status_code=404, detail="Player not found")
        return p.name, None
    o = (await db.execute(select(OppositionPlayer).where(
        OppositionPlayer.id == body.opposition_player_id, OppositionPlayer.club_id == club_id))).scalar_one_or_none()
    if not o:
        raise HTTPException(status_code=404, detail="Opposition player not found")
    return None, o.surname


# ── routes ───────────────────────────────────────────────────────────────────────────────────────

@router.get("/{session_id}/move")
async def get_move(session_id: UUID, event_id: UUID,
                   user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """The chain of carries behind an event (a score, kickout won, turnover), in order."""
    session = await _session_for_club(db, session_id, user.club_id)
    ev = (await db.execute(select(VideoEvent).where(VideoEvent.id == event_id, VideoEvent.video_session_id == session.id))).scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    segs = await _match_segments(db, session.match_id)
    chain = _chain_for(segs, ev)
    players, opp = await _name_maps(db, chain)
    steps = []
    for i, seg in enumerate(chain):
        nxt = chain[i + 1] if i + 1 < len(chain) else None
        pe = await _linked_pass_event(db, session.id, seg, nxt)
        steps.append(_step_json(seg, players, opp, pe))
    return {"event_id": str(ev.id), "event_type": ev.event_type, "team": ev.team,
            "match_minute": ev.match_minute, "match_second": ev.match_second, "steps": steps}


@router.post("/{session_id}/move/step/{segment_id}/player")
async def set_step_player(session_id: UUID, segment_id: UUID, body: StepPlayer,
                          user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Change who carried at this step (and who made the pass that came out of it)."""
    session = await _session_for_club(db, session_id, user.club_id)
    seg = (await db.execute(select(BallCarrierSegment).where(
        BallCarrierSegment.id == segment_id, BallCarrierSegment.match_id == session.match_id))).scalar_one_or_none()
    if not seg:
        raise HTTPException(status_code=404, detail="Step not found")
    own_name, opp_name = await _validate_player(db, user.club_id, body)
    if (seg.team == "own") != bool(body.player_id):
        raise HTTPException(status_code=400, detail="That player is on the other team")

    segs = await _match_segments(db, session.match_id)
    nxt = next((s for i, s in enumerate(segs) if i > 0 and segs[i - 1].id == seg.id), None)
    pe = await _linked_pass_event(db, session.id, seg, nxt)

    seg.player_id = body.player_id
    seg.opposition_player_id = body.opposition_player_id
    if body.jersey_number is not None:
        seg.jersey_number = body.jersey_number
    if pe is not None:
        pe.player_id = body.player_id
        pe.opposition_player_id = body.opposition_player_id
        pe.opponent_player_name = opp_name
        if body.jersey_number is not None:
            pe.jersey_number = body.jersey_number
        await live_sync.write_through(db, pe)
    await db.commit()
    return {"ok": True, "segment_id": str(seg.id), "pass_event_updated": pe is not None}


@router.delete("/{session_id}/move/step/{segment_id}")
async def delete_step(session_id: UUID, segment_id: UUID,
                      user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Remove a step that should not be there (and the pass that came out of it)."""
    session = await _session_for_club(db, session_id, user.club_id)
    segs = await _match_segments(db, session.match_id)
    pos = next((i for i, s in enumerate(segs) if s.id == segment_id), None)
    if pos is None:
        raise HTTPException(status_code=404, detail="Step not found")
    seg = segs[pos]
    nxt = segs[pos + 1] if pos + 1 < len(segs) else None
    pe = await _linked_pass_event(db, session.id, seg, nxt)
    if pe is not None:
        await live_sync.remove(db, pe)
        await db.delete(pe)
    # if this was the last carry of the move, the one before it now ends the move the way this one did
    prev = segs[pos - 1] if pos > 0 else None
    if prev is not None and prev.team == seg.team and seg.ended_by in TERMINAL_ENDS and prev.ended_by == "pass":
        prev.ended_by = seg.ended_by
    await db.delete(seg)
    await db.commit()
    return {"ok": True, "pass_event_removed": pe is not None}


@router.post("/{session_id}/move/step")
async def insert_step(session_id: UUID, body: InsertStep,
                      user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Add a missing carry after an existing one, with the pass it makes to the next carrier."""
    session = await _session_for_club(db, session_id, user.club_id)
    own_name, opp_name = await _validate_player(db, user.club_id, body)
    segs = await _match_segments(db, session.match_id)
    pos = next((i for i, s in enumerate(segs) if s.id == body.after_segment_id), None)
    if pos is None:
        raise HTTPException(status_code=404, detail="Step not found")
    after = segs[pos]
    if (after.team == "own") != bool(body.player_id):
        raise HTTPException(status_code=400, detail="That player is on the other team")
    nxt = segs[pos + 1] if pos + 1 < len(segs) else None

    a_ts = after.video_timestamp_ms or 0
    n_ts = nxt.video_timestamp_ms if (nxt is not None and nxt.video_timestamp_ms is not None) else a_ts + 4000
    new_ts = int((a_ts + n_ts) / 2)
    sx = after.end_x if after.end_x is not None else after.start_x
    sy = after.end_y if after.end_y is not None else after.start_y
    ex = nxt.start_x if (nxt is not None and nxt.start_x is not None) else sx
    ey = nxt.start_y if (nxt is not None and nxt.start_y is not None) else sy

    # make room in the ordering, then add the step
    new_seq = (after.sequence_number or 0) + 1
    await db.execute(text(
        "update ball_carrier_segments set sequence_number = sequence_number + 1 "
        "where match_id=:m and sequence_number >= :s"), {"m": session.match_id, "s": new_seq})
    clock_s = after.match_clock_s
    seg = BallCarrierSegment(
        id=uuid4(), match_id=session.match_id, player_id=body.player_id, opposition_player_id=body.opposition_player_id,
        jersey_number=body.jersey_number, team=after.team, half=after.half, minute=after.minute, match_clock_s=clock_s,
        path_points=[{"x": sx, "y": sy}, {"x": ex, "y": ey}] if sx is not None and ex is not None else [],
        start_x=sx, start_y=sy, end_x=ex, end_y=ey,
        start_time_ms=after.end_time_ms, end_time_ms=(nxt.start_time_ms if nxt is not None else after.end_time_ms),
        ended_by="pass", source="video", video_timestamp_ms=new_ts, sequence_number=new_seq,
    )
    db.add(seg)
    # the pass this carry makes (logged just before the next pickup, like every other hand pass)
    pass_ts = max(new_ts + 1, n_ts - 400)
    pass_ev = VideoEvent(
        video_session_id=session.id, match_id=session.match_id, event_type="PASS_HAND", team=_team_of_segment(after),
        half=after.half or 1, match_minute=after.minute or 0, match_second=0, video_timestamp_ms=pass_ts,
        pitch_x=sx, pitch_y=sy, end_x=ex, end_y=ey,
        player_id=body.player_id, opposition_player_id=body.opposition_player_id,
        opponent_player_name=opp_name, jersey_number=body.jersey_number,
        player_confidence="HIGH", event_confidence="HIGH", source="human_tag", is_verified=True,
    )
    db.add(pass_ev)
    await db.flush()
    await live_sync.write_through(db, pass_ev)
    await db.commit()
    return {"ok": True, "segment_id": str(seg.id), "pass_event_id": str(pass_ev.id)}


@router.get("/{session_id}/health")
async def data_health(session_id: UUID,
                      user: AuthenticatedUser = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    """Things in this session's tagging that look unfinished or inconsistent, each with where to fix it."""
    session = await _session_for_club(db, session_id, user.club_id)
    issues: list[dict] = []

    def add(kind: str, ev: Optional[VideoEvent], message: str, **extra):
        issues.append({
            "kind": kind, "message": message,
            "event_id": str(ev.id) if ev else None,
            "video_timestamp_ms": ev.video_timestamp_ms if ev else extra.pop("video_timestamp_ms", None),
            "match_minute": ev.match_minute if ev else None, "match_second": ev.match_second if ev else None,
            "team": ev.team if ev else None, **extra,
        })

    events = list((await db.execute(
        select(VideoEvent).where(VideoEvent.video_session_id == session.id).order_by(VideoEvent.video_timestamp_ms.asc())
    )).scalars().all())
    segs = await _match_segments(db, session.match_id)

    for ev in events:
        et = ev.event_type or ""
        if "KICKOUT" in et and not ev.player_id and not ev.opposition_player_id and not et.endswith("SIDELINE") and et != "SIDELINE_KICK":
            add("kickout_no_player", ev, "Kickout with no player named")
        if et in SCORE_EVENT_TYPES or et == "FREE_KICK" and (ev.scoring_context or {}).get("scored"):
            src = str((ev.scoring_context or {}).get("source") or "").lower()
            dead_ball = src in ("free", "from_free", "forty_five", "from_45", "from_forty_five", "penalty")
            if not ev.player_id and not ev.opposition_player_id:
                add("score_no_player", ev, "Score with no scorer")
            elif dead_ball:
                pass   # a free / 45 is taken from a standing ball - there is no carry to check
            else:
                chain = _chain_for(segs, ev)
                if not chain:
                    add("score_no_carry", ev, "Score with no carry leading up to it (the move is missing)")
                else:
                    last = chain[-1]
                    scorer_ok = (ev.player_id and last.player_id == ev.player_id) or (
                        ev.opposition_player_id and last.opposition_player_id == ev.opposition_player_id)
                    if not scorer_ok:
                        add("score_carrier_mismatch", ev, "The last carry before this score is a different player to the scorer")
        if et == "FOUL_COMMITTED" and not ev.sub_type:
            add("foul_no_type", ev, "Foul with no type")
        if et in ("OUR_UNFORCED_ERROR", "OPP_UNFORCED_ERROR") and not ev.sub_type:
            add("error_no_type", ev, "Unforced error with no type")
        if et in ("LONG_KICK_PASS", "HIGH_BALL") and not ev.sub_type:
            add("ball_no_outcome", ev, "Kick pass / high ball with no outcome")
        if et == "PASS_HAND" and ev.team == "team_a" and not ev.player_id and (ev.description or "").lower() != "free short pass":
            add("pass_no_player", ev, "Hand pass with no player")

    # stored minute disagreeing with the video position (a stoppage added after the fact, a mis-set half mark)
    from app.services.video.restamp import match_clock
    from app.models.match import Match
    match = (await db.execute(select(Match).where(Match.id == session.match_id))).scalar_one_or_none()
    hdm = (match.half_duration_mins if match else None) or 30
    for ev in events:
        if ev.video_timestamp_ms is None or ev.match_minute is None:
            continue
        _, m, s = match_clock(session, hdm, int(ev.video_timestamp_ms))
        if abs((m * 60 + s) - (ev.match_minute * 60 + (ev.match_second or 0))) > 20:
            add("clock_mismatch", ev, "The match clock on this event does not match its video position")

    issues.sort(key=lambda i: (i.get("video_timestamp_ms") is None, i.get("video_timestamp_ms") or 0))
    return {"count": len(issues), "issues": issues[:200]}
