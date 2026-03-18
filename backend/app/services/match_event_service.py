"""
Service layer for MatchEvent operations.

Contains business logic for recording and managing match events.
Automatically updates match scores and player stats.
"""

from typing import List, Optional
from uuid import UUID
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.match import Match
from app.models.match_event import MatchEvent, EventType, Team
from app.models.player_match_stats import PlayerMatchStats
from app.schemas.match_event import MatchEventCreate, MatchEventUpdate


class MatchEventService:
    """Service for match event operations."""
    
    @staticmethod
    async def create_event(db: AsyncSession, event_data: MatchEventCreate) -> MatchEvent:
        """
        Create a new match event.
        
        Automatically:
        - Updates match scores
        - Updates player match stats
        - Detects 2-point zone for points
        
        Args:
            db: Database session
            event_data: Event creation data
            
        Returns:
            Created match event
        """
        # The frontend handles 2-point zone detection via elliptical arc calculation
        # and enables/disables Point vs 2-Pointer buttons accordingly.
        # No backend auto-conversion needed — trust the frontend event_type.
        event_type = event_data.event_type

        # Create event
        event = MatchEvent(
            match_id=event_data.match_id,
            player_id=event_data.player_id,
            assist_player_id=event_data.assist_player_id,
            event_type=event_type,
            team=event_data.team,
            minute=event_data.minute,
            pitch_x=event_data.pitch_x,
            pitch_y=event_data.pitch_y,
            notes=event_data.notes,
            opponent_player_name=getattr(event_data, 'opponent_player_name', None),
            client_event_id=event_data.client_event_id,
        )
        
        db.add(event)
        await db.flush()  # Flush to get event ID before updating stats
        
        # Update match scores
        await MatchEventService._update_match_scores(db, event)
        
        # Update player stats
        if event.player_id:
            await MatchEventService._update_player_stats(db, event, is_delete=False)
        
        await db.commit()
        await db.refresh(event)
        
        return event
    
    @staticmethod
    async def get_event(db: AsyncSession, event_id: UUID) -> Optional[MatchEvent]:
        """Get a match event by ID."""
        result = await db.execute(
            select(MatchEvent).where(MatchEvent.id == event_id)
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_events(
        db: AsyncSession,
        match_id: UUID,
        skip: int = 0,
        limit: int = 100,
        event_type: Optional[EventType] = None,
        team: Optional[Team] = None,
    ) -> tuple[List[MatchEvent], int]:
        """
        List events for a match with filtering and pagination.
        
        Returns:
            Tuple of (events, total_count)
        """
        # Build base query
        conditions = [MatchEvent.match_id == match_id]
        
        if event_type:
            conditions.append(MatchEvent.event_type == event_type)
        if team:
            conditions.append(MatchEvent.team == team)
        
        # Get total count
        from sqlalchemy import func
        count_result = await db.execute(
            select(func.count(MatchEvent.id)).where(and_(*conditions))
        )
        total = count_result.scalar_one()
        
        # Get events
        result = await db.execute(
            select(MatchEvent)
            .where(and_(*conditions))
            .order_by(MatchEvent.created_at.asc())
            .offset(skip)
            .limit(limit)
        )
        events = result.scalars().all()
        
        return list(events), total
    
    @staticmethod
    async def update_event(
        db: AsyncSession,
        event_id: UUID,
        event_data: MatchEventUpdate
    ) -> Optional[MatchEvent]:
        """Update a match event."""
        event = await MatchEventService.get_event(db, event_id)
        if not event:
            return None
        
        # Store old values for stats update
        old_event_type = event.event_type
        old_player_id = event.player_id
        
        # Update fields
        update_data = event_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(event, field, value)
        
        await db.flush()
        
        # Recalculate match scores
        await MatchEventService._recalculate_match_scores(db, event.match_id)
        
        # Update player stats if player changed
        if old_player_id != event.player_id:
            if old_player_id:
                # Remove from old player
                temp_event = MatchEvent(event_type=old_event_type, player_id=old_player_id, match_id=event.match_id)
                await MatchEventService._update_player_stats(db, temp_event, is_delete=True)
            if event.player_id:
                # Add to new player
                await MatchEventService._update_player_stats(db, event, is_delete=False)
        
        await db.commit()
        await db.refresh(event)
        
        return event
    
    @staticmethod
    async def delete_event(db: AsyncSession, event_id: UUID) -> bool:
        """Delete a match event."""
        event = await MatchEventService.get_event(db, event_id)
        if not event:
            return False
        
        # Update player stats (remove this event's contribution)
        if event.player_id:
            await MatchEventService._update_player_stats(db, event, is_delete=True)
        
        # Recalculate match scores
        await MatchEventService._recalculate_match_scores(db, event.match_id)
        
        await db.delete(event)
        await db.commit()
        
        return True
    
    @staticmethod
    async def _update_match_scores(db: AsyncSession, event: MatchEvent):
        """Update match scores based on event."""
        scoring_events = [
            EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
            EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
            EventType.PENALTY_GOAL
        ]
        if event.event_type not in scoring_events:
            return

        # Get match
        result = await db.execute(
            select(Match).where(Match.id == event.match_id)
        )
        match = result.scalar_one_or_none()
        if not match:
            return

        # Update scores
        if event.team == Team.OWN:
            if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                match.team_goals += 1
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                match.team_points += 1  # 45s always count as 1 point
            elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                match.team_points += 2
        else:
            if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                match.opponent_goals += 1
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                match.opponent_points += 1  # 45s always count as 1 point
            elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                match.opponent_points += 2

        await db.flush()

    @staticmethod
    async def _recalculate_match_scores(db: AsyncSession, match_id: UUID):
        """Recalculate match scores from all events."""
        # Get match
        result = await db.execute(
            select(Match).where(Match.id == match_id)
        )
        match = result.scalar_one_or_none()
        if not match:
            return

        # Reset scores
        match.team_goals = 0
        match.team_points = 0
        match.opponent_goals = 0
        match.opponent_points = 0

        # Get all scoring events
        scoring_event_types = [
            EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
            EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
            EventType.PENALTY_GOAL
        ]
        events_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id == match_id,
                    MatchEvent.event_type.in_(scoring_event_types)
                )
            )
        )
        events = events_result.scalars().all()

        # Recalculate
        for event in events:
            if event.team == Team.OWN:
                if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                    match.team_goals += 1
                elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                    match.team_points += 1
                elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                    match.team_points += 2
            else:
                if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                    match.opponent_goals += 1
                elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                    match.opponent_points += 1
                elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                    match.opponent_points += 2
        
        await db.flush()
    
    @staticmethod
    async def _update_player_stats(db: AsyncSession, event: MatchEvent, is_delete: bool = False):
        """
        Update player match stats based on event.
        
        Creates PlayerMatchStats record if it doesn't exist.
        Increments/decrements stat counters based on event type.
        """
        if not event.player_id or event.team != Team.OWN:
            return  # Only track stats for own team players
        
        # Get or create player stats for this match
        result = await db.execute(
            select(PlayerMatchStats).where(
                and_(
                    PlayerMatchStats.match_id == event.match_id,
                    PlayerMatchStats.player_id == event.player_id
                )
            )
        )
        stats = result.scalar_one_or_none()
        
        if not stats:
            if is_delete:
                return  # Nothing to delete
            stats = PlayerMatchStats(
                match_id=event.match_id,
                player_id=event.player_id
            )
            db.add(stats)
            await db.flush()
        
        # Update stats based on event type
        delta = -1 if is_delete else 1
        
        event_stat_mapping = {
            EventType.GOAL: "goals",
            EventType.POINT: "points",
            EventType.TWO_POINT: "two_pointers",
            EventType.WIDE: "wides",
            EventType.SHORT: "shots_short",
            EventType.SAVED: "shots_saved",
            EventType.TURNOVER_LOST: "turnovers_lost",
            EventType.TURNOVER_WON: "turnovers_won",
            EventType.KICKOUT_WON: "kickouts_won",
            EventType.KICKOUT_LOST: "kickouts_lost",
            EventType.BREAKING_BALL_WON: "breaking_balls_won",
            # Detailed kickout types → same stat fields
            EventType.OWN_KICKOUT_WON: "kickouts_won",
            EventType.OPP_KICKOUT_WON: "kickouts_won",
            EventType.OWN_KICKOUT_OPPOSITION_WON: "kickouts_lost",
            EventType.OPP_KICKOUT_OPPOSITION_WON: "kickouts_lost",
            EventType.OWN_KICKOUT_WON_BREAK: "breaking_balls_won",
            EventType.OPP_KICKOUT_WON_BREAK: "breaking_balls_won",
            EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK: "kickouts_lost",
            EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK: "kickouts_lost",
            EventType.YELLOW_CARD: "yellow_cards",
            EventType.RED_CARD: "red_cards",
            EventType.FREE_WON: "frees_won",
            EventType.FREE_CONCEDED: "frees_conceded",
            EventType.BLOCK: "blocks",
            EventType.INTERCEPTION: "interceptions",
        }
        
        stat_field = event_stat_mapping.get(event.event_type)
        if stat_field:
            current_value = getattr(stats, stat_field)
            setattr(stats, stat_field, max(0, current_value + delta))
        
        # Update assists
        if event.assist_player_id and event.event_type in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]:
            assist_result = await db.execute(
                select(PlayerMatchStats).where(
                    and_(
                        PlayerMatchStats.match_id == event.match_id,
                        PlayerMatchStats.player_id == event.assist_player_id
                    )
                )
            )
            assist_stats = assist_result.scalar_one_or_none()
            if not assist_stats:
                assist_stats = PlayerMatchStats(
                    match_id=event.match_id,
                    player_id=event.assist_player_id
                )
                db.add(assist_stats)
                await db.flush()
            
            assist_stats.assists = max(0, assist_stats.assists + delta)
        
        # Recalculate derived metrics
        stats.recalculate_metrics()
        
        await db.flush()

