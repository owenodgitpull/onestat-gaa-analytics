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
            duration_seconds=None,  # Will be set when next event is created
            client_event_id=getattr(event_data, 'client_event_id', None),
        )
        
        db.add(new_event)
        await db.flush()  # Get the new event's timestamp
        
        # Calculate duration for the previous event
        if previous_event:
            duration = (new_event.created_at - previous_event.created_at).total_seconds()
            previous_event.duration_seconds = int(duration)
        
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
        Bulk-insert possession waypoints from a drag path.

        Processes sequentially to maintain duration-chaining with the
        previous event.  Returns the count of created events.
        """
        # Get the most recent event for duration chaining
        result = await db.execute(
            select(PossessionEvent)
            .where(PossessionEvent.match_id == match_id)
            .order_by(PossessionEvent.created_at.desc())
            .limit(1)
        )
        previous_event = result.scalar_one_or_none()

        count = 0
        for wp in waypoints:
            new_event = PossessionEvent(
                match_id=match_id,
                team=team,
                minute=minute,
                pitch_x=wp["x"],
                pitch_y=wp["y"],
                duration_seconds=None,
            )
            db.add(new_event)
            await db.flush()

            if previous_event:
                duration = (new_event.created_at - previous_event.created_at).total_seconds()
                previous_event.duration_seconds = int(duration)

            previous_event = new_event
            count += 1

        await db.commit()
        return count

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
    async def finalize_match_possession(
        db: AsyncSession,
        match_id: UUID
    ) -> None:
        """
        Finalize possession tracking when match ends.
        
        Sets the duration for the last possession event based on match end time.
        Call this when completing a match.
        
        Args:
            db: Database session
            match_id: Match that's being completed
        """
        # Get the last possession event
        result = await db.execute(
            select(PossessionEvent)
            .where(PossessionEvent.match_id == match_id)
            .order_by(PossessionEvent.created_at.desc())
            .limit(1)
        )
        last_event = result.scalar_one_or_none()
        
        if last_event and last_event.duration_seconds is None:
            # Set duration to time since creation (until now)
            duration = (datetime.utcnow() - last_event.created_at).total_seconds()
            last_event.duration_seconds = int(duration)
            await db.commit()
