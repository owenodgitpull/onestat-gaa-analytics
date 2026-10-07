"""
Service layer for MatchEvent operations.

Contains business logic for recording and managing match events.
Automatically updates match scores and player stats.
"""

from typing import List, Optional
from uuid import UUID
from sqlalchemy import select, and_, or_, update
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
            kickout_target_player_id=getattr(event_data, 'kickout_target_player_id', None),
            sub_in_player_id=getattr(event_data, 'sub_in_player_id', None),
            event_type=event_type,
            team=event_data.team,
            minute=event_data.minute,
            pitch_x=event_data.pitch_x,
            pitch_y=event_data.pitch_y,
            end_x=getattr(event_data, 'end_x', None),
            end_y=getattr(event_data, 'end_y', None),
            notes=event_data.notes,
            opponent_player_name=getattr(event_data, 'opponent_player_name', None),
            under_pressure=getattr(event_data, 'under_pressure', None),
            opposition_foot=getattr(event_data, 'opposition_foot', None),
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
        """Get a match event by its server id OR the client_event_id it was created with.

        Live Recording is offline-first: it hands the UI the client-generated id the moment an
        event is queued, and follow-up edits (under pressure, assist, long-ball outcome, brought
        forward...) reference that id — the server's own id only exists once it has synced."""
        result = await db.execute(
            select(MatchEvent).where(
                or_(MatchEvent.id == event_id, MatchEvent.client_event_id == str(event_id))
            )
        )
        return result.scalars().first()
    
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
            .order_by(MatchEvent.minute.asc(), MatchEvent.created_at.asc())
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
        old_team = event.team
        old_assist_player_id = event.assist_player_id

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
                # Remove from old player. team=old_team (and assist_player_id=
                # old_assist_player_id) are required here — _update_player_stats
                # bails out immediately on anything that isn't Team.OWN, and a
                # transient MatchEvent built without an explicit team defaults
                # to None (never Team.OWN), which silently skipped this
                # decrement entirely: reassigning who scored an own-team event
                # (or editing an own-team event's team away, e.g. correcting it
                # to the opposition) added the new attribution but left the old
                # player's — and old assist-giver's — stat rows double-counted
                # forever.
                temp_event = MatchEvent(
                    event_type=old_event_type, player_id=old_player_id, match_id=event.match_id,
                    team=old_team, assist_player_id=old_assist_player_id,
                )
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
        match_id = event.match_id

        # Update player stats (remove this event's contribution) — deltas a
        # separate PlayerMatchStats row directly, not affected by event order.
        if event.player_id:
            await MatchEventService._update_player_stats(db, event, is_delete=True)

        # Delete BEFORE recalculating. _recalculate_match_scores runs its own
        # fresh SELECT over match_events — if that query runs first, it still
        # sees the row we're about to remove and bakes its score contribution
        # into the "recalculated" total, which then survives the delete that
        # follows. Concretely: tag a point, realize the ref brought it back
        # for a free, delete the point and log the free instead — the delete's
        # own recalc still counted the point, then the free's own create adds
        # its point on top, and the scoreboard ends up one score ahead of the
        # event log with nothing left to explain it. Deleting first (session
        # autoflush makes the pending DELETE visible to the next query on this
        # same transaction) means the recalc only ever sees what's really left.
        await db.delete(event)
        await MatchEventService._recalculate_match_scores(db, match_id)
        await db.commit()

        return True
    
    @staticmethod
    async def _update_match_scores(db: AsyncSession, event: MatchEvent):
        """
        Update match scores based on event.

        Uses an atomic `col = col + N` UPDATE rather than read-modify-write on
        a loaded ORM object. Two events on the same match landing close
        together (e.g. the sync engine draining a backlog after a spotty
        connection) can otherwise interleave between the SELECT and the
        commit on this async session, silently dropping one increment while
        the event itself still gets persisted correctly — the scoreboard
        field then permanently disagrees with the event log with no
        corresponding row to explain the gap. Confirmed twice in production
        on the same match. The atomic form can't lose an update that way.
        """
        scoring_events = [
            EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
            EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE,
            EventType.PENALTY_GOAL
        ]
        if event.event_type not in scoring_events:
            return

        if event.team == Team.OWN:
            if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                values = {"team_goals": Match.team_goals + 1}
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                values = {"team_points": Match.team_points + 1}  # 45s always count as 1 point
            elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                values = {"team_points": Match.team_points + 2}
            else:
                return
        else:
            if event.event_type in [EventType.GOAL, EventType.PENALTY_GOAL]:
                values = {"opponent_goals": Match.opponent_goals + 1}
            elif event.event_type in [EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE]:
                values = {"opponent_points": Match.opponent_points + 1}  # 45s always count as 1 point
            elif event.event_type in [EventType.TWO_POINT, EventType.TWO_POINT_FREE]:
                values = {"opponent_points": Match.opponent_points + 2}
            else:
                return

        await db.execute(
            update(Match).where(Match.id == event.match_id).values(**values)
        )
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
            EventType.HIT_POST: "shots_hit_post",
            EventType.TURNOVER_LOST: "turnovers_lost",
            EventType.UNFORCED_ERROR: "turnovers_lost",
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

