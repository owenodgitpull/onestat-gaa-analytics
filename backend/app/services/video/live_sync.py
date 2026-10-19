"""
Live write-through of Video Tagging events into match_events.

Every verified VideoEvent is mirrored into a MatchEvent as it is tagged, edited
or deleted, so the match is always up to date (same as Live Recording). The
VideoEvent.match_event_id link lets edits/deletes follow through.

Goes through MatchEventService's score + player-stat helpers so a tagged score
updates the scoreboard and PlayerMatchStats exactly like a live-recorded one
(the old "Save to Match" merge wrote rows directly and skipped both).
"""

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.match_event import MatchEvent
from app.models.video_event import VideoEvent
from app.models.video_session import VideoSession
from app.services import opposition_service
from app.services.match_event_service import MatchEventService
from app.services.video.event_mapper import VideoEventMapper

logger = logging.getLogger(__name__)


def _normalize_foot(scoring_context: Optional[dict]) -> Optional[str]:
    raw = (scoring_context or {}).get("foot")
    if not raw:
        return None
    first = raw[0].upper()
    return first if first in ("L", "R", "F") else None


def _match_event_fields(ve: VideoEvent) -> Optional[dict]:
    """MatchEvent column values for a VideoEvent, or None if it has no
    MatchEvent equivalent."""
    event_type = VideoEventMapper.to_match_event_type(
        ve.event_type,
        scoring_context=ve.scoring_context,
        pitch_zone=ve.pitch_zone,
        team=ve.team,
        description=ve.description,
    )
    if not event_type:
        return None
    event_type, match_team = VideoEventMapper.align_foul(
        ve.event_type, ve.team, event_type, VideoEventMapper.video_team_to_match_team(ve.team)
    )
    return dict(
        event_type=event_type,
        sub_type=ve.sub_type,
        team=match_team,
        minute=ve.match_minute,
        match_clock_s=(ve.match_minute or 0) * 60 + (ve.match_second or 0),
        half=ve.half,
        pitch_x=ve.pitch_x,
        pitch_y=ve.pitch_y,
        end_x=ve.end_x,
        end_y=ve.end_y,
        brought_forward=bool(ve.brought_forward),
        brought_forward_reason=ve.brought_forward_reason,
        advanced_position_x=ve.advanced_position_x,
        advanced_position_y=ve.advanced_position_y,
        kickout_target_player_id=ve.target_player_id,
        player_id=ve.player_id,
        sub_in_player_id=ve.sub_in_player_id,
        assist_player_id=ve.assist_player_id,
        under_pressure=(ve.scoring_context or {}).get("under_pressure"),
        opposition_foot=_normalize_foot(ve.scoring_context),
        opponent_player_name=ve.opponent_player_name,
        opposition_player_id=ve.opposition_player_id,
        opposition_sub_in_player_id=ve.opposition_sub_in_player_id,
        # a Press Trigger keeps its note exactly as live recording writes it - the press chart matches on "Press: ..."
        notes=(
            (ve.description or "") if ve.event_type == "PRESS_TRIGGER"
            # A carrier-change hand pass is the same count-only marker live recording writes ("Pass"), so every list that
            # hides those rows hides these too
            else "Pass" if ve.event_type == "PASS_HAND" and not (ve.description or "").strip()
            else f"[video] {ve.description or ''}".strip()
        ),
    )


async def _remove_stats(db: AsyncSession, me: MatchEvent) -> None:
    if me.player_id:
        await MatchEventService._update_player_stats(db, me, is_delete=True)


async def _substitution_notes(db: AsyncSession, ve: VideoEvent) -> str:
    """"{off} off, {on} on" - the same note Live Recording writes, so a video-tagged substitution reads the same on
    the match result page (not the generic "[video]" marker)."""
    from app.models.opposition import OppositionPlayer
    from app.models.player import Player

    async def _name(model, pid, attr: str) -> str:
        if not pid:
            return "Player"
        row = await db.get(model, pid)
        return (getattr(row, attr, None) or "Player") if row else "Player"

    if ve.team == "team_b":
        off = await _name(OppositionPlayer, ve.opposition_player_id, "surname")
        on = await _name(OppositionPlayer, ve.opposition_sub_in_player_id, "surname")
    else:
        off = await _name(Player, ve.player_id, "name")
        on = await _name(Player, ve.sub_in_player_id, "name")
    return f"{off} off, {on} on"


# Overcarrying / picked-off-ground are logged as the carrier's FOUL (a free is conceded) but are ALSO unforced errors
# (an unpressured mistake). The foul row stays; a linked UNFORCED_ERROR row is mirrored beside it so every unforced-error
# count, chart and agent tool sees them without each one special-casing the sub-type.
FOUL_LIKE_ERROR_SUBTYPES = ("overcarrying", "picked_off_ground")
_SHADOW_PREFIX = "[video-ue:"


def _shadow_marker(ve: VideoEvent) -> str:
    return f"{_SHADOW_PREFIX}{ve.id}]"


def _wants_shadow(ve: VideoEvent) -> bool:
    return bool(ve.is_verified and ve.event_type == "FOUL_COMMITTED" and (ve.sub_type or "") in FOUL_LIKE_ERROR_SUBTYPES)


async def _find_shadow(db: AsyncSession, ve: VideoEvent) -> Optional[MatchEvent]:
    from sqlalchemy import select

    res = await db.execute(
        select(MatchEvent).where(MatchEvent.match_id == ve.match_id, MatchEvent.notes == _shadow_marker(ve))
    )
    return res.scalars().first()


async def _drop_shadow(db: AsyncSession, ve: VideoEvent) -> None:
    shadow = await _find_shadow(db, ve)
    if shadow is None:
        return
    await _remove_stats(db, shadow)
    await db.delete(shadow)
    await db.flush()


async def _sync_shadow(db: AsyncSession, ve: VideoEvent) -> None:
    from app.models.match_event import EventType

    if not _wants_shadow(ve):
        await _drop_shadow(db, ve)
        return
    fields = _match_event_fields(ve)
    if fields is None:
        return
    fields["event_type"] = EventType.UNFORCED_ERROR
    fields["team"] = VideoEventMapper.video_team_to_match_team(ve.team)
    fields["notes"] = _shadow_marker(ve)
    shadow = await _find_shadow(db, ve)
    if shadow is None:
        shadow = MatchEvent(match_id=ve.match_id, **fields)
        db.add(shadow)
        await db.flush()
        if shadow.player_id:
            await MatchEventService._update_player_stats(db, shadow, is_delete=False)
        return
    await _remove_stats(db, MatchEvent(
        match_id=shadow.match_id, event_type=shadow.event_type, team=shadow.team,
        player_id=shadow.player_id, assist_player_id=shadow.assist_player_id,
    ))
    for key, value in fields.items():
        setattr(shadow, key, value)
    await db.flush()
    if shadow.player_id:
        await MatchEventService._update_player_stats(db, shadow, is_delete=False)


async def write_through(db: AsyncSession, ve: VideoEvent) -> None:
    """Create/update the MatchEvent mirroring `ve` (plus the linked unforced-error row for overcarrying /
    picked-off-ground). No-op for unverified events (AI drafts wait until verified). Caller commits."""
    if not ve.is_verified:
        return
    await _write_main(db, ve)
    await _sync_shadow(db, ve)


async def _write_main(db: AsyncSession, ve: VideoEvent) -> None:

    fields = _match_event_fields(ve)
    if fields is None:
        await remove(db, ve)
        return
    if ve.event_type == "SUB_ON":
        fields["notes"] = await _substitution_notes(db, ve)

    existing = await db.get(MatchEvent, ve.match_event_id) if ve.match_event_id else None

    if existing is None:
        me = MatchEvent(match_id=ve.match_id, **fields)
        db.add(me)
        await db.flush()
        ve.match_event_id = me.id
        await MatchEventService._update_match_scores(db, me)
        if me.player_id:
            await MatchEventService._update_player_stats(db, me, is_delete=False)
        await opposition_service.apply_substitution_event(db, me)
        return

    # Edit: back out the old contribution, apply new values, re-add.
    old = MatchEvent(
        match_id=existing.match_id, event_type=existing.event_type, team=existing.team,
        player_id=existing.player_id, assist_player_id=existing.assist_player_id,
    )
    await _remove_stats(db, old)
    for key, value in fields.items():
        setattr(existing, key, value)
    await db.flush()
    await MatchEventService._recalculate_match_scores(db, existing.match_id)
    if existing.player_id:
        await MatchEventService._update_player_stats(db, existing, is_delete=False)


async def remove(db: AsyncSession, ve: VideoEvent, recalc: bool = True) -> None:
    """Delete the MatchEvent mirroring `ve` (if any). Caller commits.

    `recalc=False` skips the per-event scoreboard recalculation — bulk callers
    (reset, undo-to-point) remove many events and call `recalc_scores` once at
    the end instead of re-reading every scoring event after each delete."""
    await _drop_shadow(db, ve)
    if not ve.match_event_id:
        return
    me = await db.get(MatchEvent, ve.match_event_id)
    ve.match_event_id = None
    if me is None:
        return
    match_id = me.match_id
    await _remove_stats(db, me)
    await opposition_service.undo_substitution_event(db, me)
    await db.delete(me)
    await db.flush()
    if recalc:
        await MatchEventService._recalculate_match_scores(db, match_id)


async def recalc_scores(db: AsyncSession, match_id) -> None:
    await MatchEventService._recalculate_match_scores(db, match_id)


async def mark_in_progress(db: AsyncSession, session: VideoSession) -> None:
    """Hide the match from season stats while it is being tagged. Skipped once
    the session has been finished so later small edits don't re-hide it."""
    if session.status == "completed":
        return
    match = await db.get(Match, session.match_id)
    if match is not None and not match.video_tagging_in_progress:
        match.video_tagging_in_progress = True


async def mark_finished(db: AsyncSession, match_id) -> None:
    match = await db.get(Match, match_id)
    if match is not None and match.video_tagging_in_progress:
        match.video_tagging_in_progress = False
