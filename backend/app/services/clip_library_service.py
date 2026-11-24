"""
Clip library — the shared search over every tagged VideoEvent that has a
video position, presented as a candidate clip. Built for Presentations'
clip-picker (Phase 11) and reused as-is by the AI-driven compilation tool
(Phase 10, create_video_compilation in ai/_shared.py) — one query, one
source of truth for "what counts as a clip," rather than two independent
implementations that could quietly disagree.
"""

from dataclasses import dataclass
from typing import Optional
from uuid import UUID
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.video_event import VideoEvent
from app.models.match import Match
from app.models.player import Player


@dataclass
class ClipMatch:
    video_event_id: UUID
    video_session_id: UUID
    video_timestamp_ms: int
    event_type: str
    player_id: Optional[UUID]
    player_name: Optional[str]
    opponent_player_name: Optional[str]
    match_id: UUID
    opponent: str
    match_date: Optional[str]
    suggested_label: str
    is_two_pointer: bool = False
    source: Optional[str] = None      # FROM_PLAY / FREE / MARK / PENALTY ... (scoring_context.source)


# Names that are not stored event types: a two-pointer is a POINT_SCORED tagged with scoring_context.is_two_pointer
# (there is no TWO_POINT event type, so a search for one found nothing and the agent said there were no two-pointer
# clips although 3 were in the reel); "scores" means points (two-pointers included) and goals.
TWO_POINTER_ALIASES = {"TWO_POINTER", "TWO_POINTERS", "TWO_POINT_SCORED", "TWO_POINT", "2_POINTER", "TWO_POINTER_SCORED"}
SCORE_ALIASES = {"SCORE", "SCORES", "SCORED", "ALL_SCORES"}
# "kickouts won" is four tagged types (ours and theirs, clean and break); "turnovers won" is three
KICKOUT_WON_ALIASES = {"KICKOUT_WON", "KICKOUTS_WON", "KICKOUTS", "WON_KICKOUTS", "KICKOUT_WINS", "KICKOUT"}
KICKOUT_WON_TYPES = ("OWN_KICKOUT_WON", "OWN_KICKOUT_WON_BREAK", "OPP_KICKOUT_WON", "OPP_KICKOUT_WON_BREAK")
TURNOVER_WON_ALIASES = {"TURNOVERS_WON", "TURNOVER_WINS", "WON_TURNOVERS", "TURNOVERS"}
TURNOVER_WON_TYPES = ("TURNOVER_WON", "INTERCEPTION", "TACKLE_WON")


async def search_clips(
    db: AsyncSession,
    club_id,
    player_id: Optional[UUID] = None,
    event_type: Optional[str] = None,
    match_id: Optional[UUID] = None,
    search: Optional[str] = None,
    limit: int = 50,
) -> list[ClipMatch]:
    query = (
        select(VideoEvent, Match.opponent, Match.match_date, Player.name)
        .join(Match, Match.id == VideoEvent.match_id)
        .outerjoin(Player, Player.id == VideoEvent.player_id)
        .where(
            Match.club_id == club_id,
            VideoEvent.video_timestamp_ms.isnot(None),
        )
    )
    if player_id:
        query = query.where(VideoEvent.player_id == player_id)
    et = (event_type or "").strip().upper().replace(" ", "_").replace("-", "_") or None
    if et in TWO_POINTER_ALIASES:
        query = query.where(VideoEvent.event_type == "POINT_SCORED",
                            VideoEvent.scoring_context["is_two_pointer"].as_boolean().is_(True))
    elif et in SCORE_ALIASES:
        query = query.where(VideoEvent.event_type.in_(("POINT_SCORED", "GOAL_SCORED")))
    elif et in KICKOUT_WON_ALIASES:
        query = query.where(VideoEvent.event_type.in_(KICKOUT_WON_TYPES))
    elif et in TURNOVER_WON_ALIASES:
        query = query.where(VideoEvent.event_type.in_(TURNOVER_WON_TYPES))
    elif et:
        query = query.where(VideoEvent.event_type == et)
    if et != "PASS_HAND":
        # hand passes are 2,400+ of the tagged events: noise in a clip picker or a compilation unless asked for by name
        query = query.where(VideoEvent.event_type != "PASS_HAND")
    if match_id:
        query = query.where(VideoEvent.match_id == match_id)
    if search:
        like = f"%{search}%"
        query = query.where(or_(Match.opponent.ilike(like), Player.name.ilike(like)))

    query = query.order_by(Match.match_date.desc(), VideoEvent.video_timestamp_ms.asc()).limit(limit)
    result = await db.execute(query)

    matches = []
    for ve, opponent, match_date, player_name in result.all():
        label_bits = [ve.event_type.replace('_', ' ').title()]
        if player_name:
            label_bits.append(f"— {player_name}")
        elif ve.opponent_player_name:
            label_bits.append(f"— {ve.opponent_player_name} (opp)")
        label_bits.append(f"(v {opponent})")
        matches.append(ClipMatch(
            video_event_id=ve.id,
            video_session_id=ve.video_session_id,
            video_timestamp_ms=ve.video_timestamp_ms,
            event_type=ve.event_type,
            player_id=ve.player_id,
            player_name=player_name,
            opponent_player_name=ve.opponent_player_name,
            match_id=ve.match_id,
            opponent=opponent,
            match_date=match_date.strftime('%d %b %Y') if match_date else None,
            suggested_label=" ".join(label_bits),
            is_two_pointer=bool((ve.scoring_context or {}).get("is_two_pointer")) if isinstance(ve.scoring_context, dict) else False,
            source=(ve.scoring_context or {}).get("source") if isinstance(ve.scoring_context, dict) else None,
        ))
    return matches
