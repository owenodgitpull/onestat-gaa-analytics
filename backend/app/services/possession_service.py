"""
Service layer for Possession Event operations.

Handles time-based possession tracking with automatic duration calculation.
"""

from typing import List, Optional
from uuid import UUID
from datetime import datetime
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.schemas.possession_event import PossessionEventCreate

# If a possession event spans more than this, treat it as an app pause/restart
# and discard the time rather than recording it as real possession
MAX_POSSESSION_SECONDS = 300  # 5 minutes


class PossessionService:
    """Service for managing possession events with duration tracking."""

    @staticmethod
    async def create_possession_event(
        db: AsyncSession,
        event_data: PossessionEventCreate
    ) -> PossessionEvent:
        """
        Create a new possession event.
        
        Automatically:
        - Calculates duration for the PREVIOUS possession event
        - Links possession changes to match timeline
        
        How it works:
        1. Get the most recent possession event for this match
        2. Calculate how long that possession lasted (current_time - previous_time)
        3. Update the previous event's duration_seconds
        4. Create the new possession event (duration starts as null until next event)
        
        Args:
            db: Database session
            event_data: Possession event creation data
            
        Returns:
            Created possession event
        """
        explicit_duration = getattr(event_data, 'duration_seconds', None)

        # Get the most recent possession event for this match
        result = await db.execute(
            select(PossessionEvent)
            .where(PossessionEvent.match_id == event_data.match_id)
            .order_by(PossessionEvent.created_at.desc())
            .limit(1)
        )
        previous_event = result.scalar_one_or_none()

        # Create the new possession event
        # .value ensures the enum string ("own"/"opponent") is stored, not "PossessionTeam.OWN"
        team_value = event_data.team.value if hasattr(event_data.team, 'value') else event_data.team
        new_event = PossessionEvent(
            match_id=event_data.match_id,
            team=team_value,
            minute=event_data.minute,
            pitch_x=event_data.pitch_x,
            pitch_y=event_data.pitch_y,
            # Explicit (video-time) duration is final; otherwise it's set when
            # the next event arrives (live recording's wall-clock chaining).
            duration_seconds=explicit_duration,
            client_event_id=getattr(event_data, 'client_event_id', None),
        )

        db.add(new_event)
        await db.flush()  # Get the new event's timestamp

        # Calculate duration for the previous event
        # Cap at MAX_POSSESSION_SECONDS — any larger gap means the app was
        # paused/restarted overnight and should not count as possession time
        # Skipped for explicit-duration (video) events: wall-clock gaps are
        # meaningless there and would overwrite a correct video-time value.
        # Only an OPEN possession (duration not yet set) takes the gap: if the ball went idle in between
        # (kickout/free outcome pending, clock stopped, half time) it was frozen with its true duration and the
        # idle time must not be added to it afterwards.
        if previous_event and explicit_duration is None and previous_event.duration_seconds is None:
            duration = (new_event.created_at - previous_event.created_at).total_seconds()
            previous_event.duration_seconds = int(min(duration, MAX_POSSESSION_SECONDS))

        await db.commit()
        await db.refresh(new_event)
        
        return new_event

    @staticmethod
    async def bulk_create_possession_events(
        db: AsyncSession,
        match_id,
        team: str,
        minute: int | None,
        waypoints: list[dict],
    ) -> int:
        """
        Bulk-insert possession waypoints (from a drag path, or from the
        periodic ball-position tick that flushes every ~15s).

        Every waypoint in one call gets written to the database within
        milliseconds of the others — a genuine 8-second tick interval or a
        multi-second drag gesture both collapse to a near-zero created_at gap
        by the time they're actually persisted. The old version chained
        duration_seconds between EVERY consecutive waypoint, so nearly all of
        them ended up recording ~0 seconds regardless of team, no matter how
        much real time or motion they actually represented — the entire
        possession-percentage stat was built on top of that.

        Fix: only the boundary matters. The whole batch collectively spans
        one real time window — from whatever the previous event was, up to
        the last waypoint here — so only that single span gets a real
        duration, attributed to the event that came before this batch.
        Every waypoint inside the batch is just path detail with 0 duration
        of its own; the final one stays open (duration_seconds=None) to be
        closed out by whatever comes next. Returns the count of created events.
        """
        # The event whose duration will absorb this whole batch's real elapsed time
        result = await db.execute(
            select(PossessionEvent)
            .where(PossessionEvent.match_id == match_id)
            .order_by(PossessionEvent.created_at.desc())
            .limit(1)
        )
        batch_anchor = result.scalar_one_or_none()

        count = 0
        last_event = None
        for i, wp in enumerate(waypoints):
            is_last = i == len(waypoints) - 1
            new_event = PossessionEvent(
                match_id=match_id,
                team=team,
                minute=minute,
                pitch_x=wp["x"],
                pitch_y=wp["y"],
                duration_seconds=None if is_last else 0,
            )
            db.add(new_event)
            await db.flush()
            last_event = new_event
            count += 1

        if batch_anchor and last_event and batch_anchor.duration_seconds is None:
            duration = (last_event.created_at - batch_anchor.created_at).total_seconds()
            batch_anchor.duration_seconds = int(min(duration, MAX_POSSESSION_SECONDS))

        await db.commit()
        return count

    @staticmethod
    async def create_video_batch(db: AsyncSession, match_id, points: list) -> int:
        """Insert many video-time possession points in ONE transaction.

        Video Tagging measures possession in video time on the client and
        sends explicit durations, so unlike create/bulk there is deliberately
        no "find the latest event" lookup and no wall-clock duration chaining
        (both would corrupt video-time values, and the lookup is a per-request
        query that grows with the match's event count — the same class of
        cost that hurt live recording). One INSERT batch, one commit.
        """
        rows = [
            PossessionEvent(
                match_id=match_id,
                team=p.team.value if hasattr(p.team, 'value') else p.team,
                minute=p.minute,
                pitch_x=p.pitch_x,
                pitch_y=p.pitch_y,
                duration_seconds=p.duration_seconds,
                video_ms=getattr(p, 'video_ms', None),
            )
            for p in points
        ]
        db.add_all(rows)
        await db.commit()
        return len(rows)

    @staticmethod
    async def get_possession_event(
        db: AsyncSession,
        event_id: UUID
    ) -> Optional[PossessionEvent]:
        """Get a possession event by ID."""
        result = await db.execute(
            select(PossessionEvent).where(PossessionEvent.id == event_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_possession_events(
        db: AsyncSession,
        match_id: UUID,
        team: Optional[PossessionTeam] = None,
        limit: int = 1000
    ) -> List[PossessionEvent]:
        """
        List possession events for a match.
        
        Args:
            db: Database session
            match_id: Match to get events for
            team: Optional filter by team
            limit: Max number of events to return
            
        Returns:
            List of possession events ordered by creation time
        """
        conditions = [PossessionEvent.match_id == match_id]
        
        if team:
            conditions.append(PossessionEvent.team == team)
        
        result = await db.execute(
            select(PossessionEvent)
            .where(and_(*conditions))
            .order_by(PossessionEvent.created_at.asc())
            .limit(limit)
        )
        
        return list(result.scalars().all())
    
    @staticmethod
    async def close_open_events(
        db: AsyncSession,
        match_id: UUID,
    ) -> int:
        """
        Close ALL possession events that have duration_seconds = NULL.

        Called at half-time and at match end to ensure no events are left hanging.
        Events that have been open for longer than MAX_POSSESSION_SECONDS are
        assumed to be app-pause artefacts — their duration is set to 0 rather than
        recording an unrealistic block of possession.

        Returns the number of events closed.
        """
        result = await db.execute(
            select(PossessionEvent)
            .where(
                PossessionEvent.match_id == match_id,
                PossessionEvent.duration_seconds.is_(None),
            )
        )
        open_events = result.scalars().all()

        now = datetime.utcnow()
        for event in open_events:
            raw = (now - event.created_at).total_seconds()
            # Discard unrealistically long gaps (app was closed/paused)
            event.duration_seconds = int(raw) if raw <= MAX_POSSESSION_SECONDS else 0

        if open_events:
            await db.commit()

        return len(open_events)

    @staticmethod
    async def finalize_match_possession(
        db: AsyncSession,
        match_id: UUID
    ) -> None:
        """
        Finalize possession tracking when match ends.
        Closes all open events — delegates to close_open_events.
        """
        await PossessionService.close_open_events(db, match_id)
