"""
Tenant isolation: every endpoint that touches data by id MUST prove the data belongs to the caller's club.

A logged-in user must never be able to read, change, delete or trigger work on another club's data, even if
they somehow know an id. Use these helpers at the TOP of any endpoint that takes an id (or a body field holding
one) before doing anything else. They all answer 404 for "doesn't exist" AND "belongs to another club" so an id
can't even be probed for existence.

    from app.auth.tenancy import assert_match_in_club
    await assert_match_in_club(db, match_id, user.club_id)

The guard test (tests/test_tenant_guard.py) fails if an endpoint taking an id never mentions the club.
"""
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _uuid(value: Any):
    if isinstance(value, UUID):
        return value
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


def _not_found():
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")


async def _exists(db: AsyncSession, stmt) -> None:
    if (await db.execute(stmt.limit(1))).first() is None:
        raise _not_found()


# ── match-owned ──────────────────────────────────────────────────────────────

async def assert_match_in_club(db: AsyncSession, match_id: Any, club_id) -> None:
    from app.models.match import Match
    await _exists(db, select(Match.id).where(Match.id == _uuid(match_id), Match.club_id == club_id))


async def _assert_child_of_club_match(db: AsyncSession, model, row_id: Any, club_id) -> None:
    """`model` has an `id` and a `match_id`; the row's match must belong to the club."""
    from app.models.match import Match
    await _exists(
        db,
        select(model.id).join(Match, Match.id == model.match_id).where(
            model.id == _uuid(row_id), Match.club_id == club_id
        ),
    )


async def assert_event_in_club(db, event_id, club_id) -> None:
    from app.models.match_event import MatchEvent
    await _assert_child_of_club_match(db, MatchEvent, event_id, club_id)


async def assert_possession_event_in_club(db, event_id, club_id) -> None:
    from app.models.possession_event import PossessionEvent
    await _assert_child_of_club_match(db, PossessionEvent, event_id, club_id)


async def assert_segment_in_club(db, segment_id, club_id) -> None:
    from app.models.ball_carrier_segment import BallCarrierSegment
    await _assert_child_of_club_match(db, BallCarrierSegment, segment_id, club_id)


async def assert_snapshot_in_club(db, snapshot_id, club_id) -> None:
    from app.models.formation_snapshot import FormationSnapshot
    await _assert_child_of_club_match(db, FormationSnapshot, snapshot_id, club_id)


async def assert_tag_in_club(db, tag_id, club_id) -> None:
    from app.models.tactical_tag import TacticalTag
    await _assert_child_of_club_match(db, TacticalTag, tag_id, club_id)


async def assert_tactical_snapshot_in_club(db, snapshot_id, club_id) -> None:
    from app.models.tactical_snapshot import TacticalAnalysisSnapshot
    await _assert_child_of_club_match(db, TacticalAnalysisSnapshot, snapshot_id, club_id)


# ── club-owned directly ──────────────────────────────────────────────────────

async def assert_player_in_club(db, player_id, club_id) -> None:
    from app.models.player import Player
    await _exists(db, select(Player.id).where(Player.id == _uuid(player_id), Player.club_id == club_id))


async def assert_training_session_in_club(db, session_id, club_id) -> None:
    from app.models.attendance import TrainingSession
    await _exists(db, select(TrainingSession.id).where(TrainingSession.id == _uuid(session_id), TrainingSession.club_id == club_id))


async def assert_video_session_in_club(db, session_id, club_id) -> None:
    from app.models.video_session import VideoSession
    await _exists(db, select(VideoSession.id).where(VideoSession.id == _uuid(session_id), VideoSession.club_id == club_id))
