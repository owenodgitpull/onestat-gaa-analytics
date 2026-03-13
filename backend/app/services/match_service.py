"""
Service layer for Match operations.

Contains business logic for match CRUD operations and statistics calculations.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
import logging
import asyncio
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.match import Match, MatchStatus, MatchVenue
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.player_match_stats import PlayerMatchStats
from app.schemas.match import MatchCreate, MatchUpdate

logger = logging.getLogger(__name__)


class MatchService:
    """Service for match-related operations."""
    
    @staticmethod
    async def create_match(db: AsyncSession, match_data: MatchCreate, club_id=None) -> Match:
        """
        Create a new match.

        Args:
            db: Database session
            match_data: Match creation data
            club_id: UUID of the club (for multi-tenancy)

        Returns:
            Created match
        """
        match_kwargs: Dict[str, Any] = dict(
            opponent=match_data.opponent,
            match_date=match_data.match_date,
            venue=match_data.venue,
            notes=match_data.notes,
            status=MatchStatus.SCHEDULED,
            club_id=club_id,
        )
        # Optional fields from the create schema
        if match_data.weather_condition is not None:
            match_kwargs['weather_condition'] = match_data.weather_condition
        if match_data.temperature_celsius is not None:
            match_kwargs['temperature_celsius'] = match_data.temperature_celsius
        if match_data.competition is not None:
            match_kwargs['competition'] = match_data.competition
        if match_data.referee is not None:
            match_kwargs['referee'] = match_data.referee
        if match_data.pitch_condition is not None:
            match_kwargs['pitch_condition'] = match_data.pitch_condition
        if match_data.wind_speed_kmh is not None:
            match_kwargs['wind_speed_kmh'] = match_data.wind_speed_kmh
        if match_data.tactical_notes is not None:
            match_kwargs['tactical_notes'] = match_data.tactical_notes
        # Support client-provided UUID for offline-created matches
        if getattr(match_data, 'id', None):
            match_kwargs['id'] = match_data.id
        match = Match(**match_kwargs)
        
        db.add(match)
        await db.commit()
        await db.refresh(match)
        
        return match
    
    @staticmethod
    async def get_match(db: AsyncSession, match_id: UUID) -> Optional[Match]:
        """Get a match by ID."""
        result = await db.execute(
            select(Match).where(
                and_(Match.id == match_id, Match.is_deleted.is_(False))
            )
        )
        return result.scalar_one_or_none()
    
    @staticmethod
    async def list_matches(
        db: AsyncSession,
        skip: int = 0,
        limit: int = 50,
        status: Optional[MatchStatus] = None,
        venue: Optional[MatchVenue] = None,
        club_id=None,
        sort_asc: bool = False,
    ) -> tuple[List[Match], int]:
        """
        List matches with filtering and pagination.

        Returns:
            Tuple of (matches, total_count)
        """
        # Build base query
        conditions = [Match.is_deleted.is_(False)]
        if club_id:
            conditions.append(Match.club_id == club_id)
        
        if status:
            conditions.append(Match.status == status)
        if venue:
            conditions.append(Match.venue == venue)
        
        # Get total count
        count_result = await db.execute(
            select(func.count(Match.id)).where(and_(*conditions))
        )
        total = count_result.scalar_one()
        
        # Get matches
        order = Match.match_date.asc() if sort_asc else Match.match_date.desc()
        result = await db.execute(
            select(Match)
            .where(and_(*conditions))
            .order_by(order)
            .offset(skip)
            .limit(limit)
        )
        matches = result.scalars().all()
        
        return list(matches), total
    
    @staticmethod
    async def update_match(
        db: AsyncSession,
        match_id: UUID,
        match_data: MatchUpdate
    ) -> Optional[Match]:
        """Update a match."""
        match = await MatchService.get_match(db, match_id)
        if not match:
            return None
        
        # Update fields
        update_data = match_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(match, field, value)
        
        await db.commit()
        await db.refresh(match)
        
        return match
    
    @staticmethod
    async def start_match(
        db: AsyncSession,
        match_id: UUID,
        started_at: Optional[datetime] = None
    ) -> Optional[Match]:
        """Start a match (change status to IN_PROGRESS)."""
        match = await MatchService.get_match(db, match_id)
        if not match:
            return None
        
        match.status = MatchStatus.IN_PROGRESS
        match.started_at = started_at or datetime.utcnow()
        match.current_phase = 'first_half'

        await db.commit()
        await db.refresh(match)

        return match
    
    @staticmethod
    async def update_match_phase(
        db: AsyncSession,
        match_id: UUID,
        phase: str,
        attacking_right_first_half: Optional[bool] = None
    ) -> Optional[Match]:
        """Update match phase for resumable recording."""
        match = await MatchService.get_match(db, match_id)
        if not match:
            return None

        match.current_phase = phase
        if attacking_right_first_half is not None:
            match.attacking_right_first_half = attacking_right_first_half
        if phase == 'second_half' and match.second_half_started_at is None:
            match.second_half_started_at = datetime.utcnow()

        await db.commit()
        await db.refresh(match)

        return match

    @staticmethod
    async def complete_match(
        db: AsyncSession,
        match_id: UUID,
        completed_at: Optional[datetime] = None,
        notes: Optional[str] = None,
        trigger_ai_analysis: bool = True
    ) -> Optional[Match]:
        """
        Complete a match (change status to COMPLETED).

        Optionally triggers AI post-match analysis in the background.
        """
        match = await MatchService.get_match(db, match_id)
        if not match:
            return None

        match.status = MatchStatus.COMPLETED
        match.completed_at = completed_at or datetime.utcnow()
        match.current_phase = None
        if notes:
            match.notes = notes

        await db.commit()
        await db.refresh(match)

        # Trigger AI analysis in background (non-blocking) — only if match has events
        if trigger_ai_analysis:
            event_count_result = await db.execute(
                select(func.count(MatchEvent.id)).where(MatchEvent.match_id == match_id)
            )
            event_count = event_count_result.scalar() or 0
            if event_count > 0:
                asyncio.create_task(
                    MatchService._generate_post_match_analysis(str(match_id))
                )
                logger.info(f"Triggered post-match AI analysis for match {match_id} ({event_count} events)")
            else:
                logger.info(f"Skipped AI analysis for match {match_id} — no events recorded")

        return match

    @staticmethod
    async def _generate_post_match_analysis(match_id: str) -> None:
        """
        Generate AI post-match analysis in background.

        This runs as a background task after match completion.
        """
        try:
            # Import here to avoid circular imports
            from app.database import AsyncSessionLocal
            from app.services.ai import analyze_match

            logger.info(f"Starting post-match AI analysis for match {match_id}")

            async with AsyncSessionLocal() as db:
                # Generate analysis
                analysis = await analyze_match(db, match_id)

                # Store the analysis in the match record
                match = await MatchService.get_match(db, UUID(match_id))
                if match:
                    match.ai_analysis = analysis
                    match.ai_analysis_generated_at = datetime.utcnow()
                    await db.commit()
                    logger.info(f"Saved post-match AI analysis for match {match_id}")

                    # Notify players that the match report is ready
                    try:
                        from app.services.notification_service import NotificationService
                        await NotificationService.notify_match_report(db, UUID(match_id))
                    except Exception as ne:
                        logger.warning(f"Failed to send match report notifications: {ne}")

        except Exception as e:
            logger.error(f"Failed to generate post-match analysis for {match_id}: {e}", exc_info=True)
    
    @staticmethod
    async def delete_match(db: AsyncSession, match_id: UUID) -> bool:
        """Soft delete a match."""
        match = await MatchService.get_match(db, match_id)
        if not match:
            return False
        
        match.is_deleted = True
        await db.commit()
        
        return True
    
    @staticmethod
    async def calculate_match_stats(db: AsyncSession, match_id: UUID) -> Dict[str, Any]:
        """
        Calculate comprehensive match statistics.
        
        Returns dictionary with possession, shots, turnovers, etc.
        """
        # Get all events for this match
        events_result = await db.execute(
            select(MatchEvent).where(MatchEvent.match_id == match_id)
        )
        events = events_result.scalars().all()
        
        # Get all possession events
        possession_result = await db.execute(
            select(PossessionEvent).where(PossessionEvent.match_id == match_id)
        )
        possession_events = possession_result.scalars().all()
        
        # Initialize stats
        stats = {
            "match_id": str(match_id),
            # Possession
            "team_possession_percentage": 0.0,
            "opponent_possession_percentage": 0.0,
            # Shots
            "team_total_shots": 0,
            "team_scores": 0,
            "team_wides": 0,
            "team_accuracy": 0.0,
            "opponent_total_shots": 0,
            "opponent_scores": 0,
            "opponent_wides": 0,
            "opponent_accuracy": 0.0,
            # Turnovers
            "team_turnovers_won": 0,
            "team_turnovers_lost": 0,
            "opponent_turnovers_won": 0,
            "opponent_turnovers_lost": 0,
            # Kickouts
            "team_kickouts_won": 0,
            "team_kickouts_lost": 0,
            "opponent_kickouts_won": 0,
            "opponent_kickouts_lost": 0,
            # Cards
            "team_yellow_cards": 0,
            "team_red_cards": 0,
            "opponent_yellow_cards": 0,
            "opponent_red_cards": 0,
        }
        
        # Calculate possession percentages (time-based, not event-based)
        if possession_events:
            def _is_own_team(p) -> bool:
                """Normalize team comparison — handles both enum objects and raw strings."""
                t = p.team.value if hasattr(p.team, 'value') else str(p.team)
                return t == "own"

            # Sum up duration_seconds for each team
            total_duration = sum(p.duration_seconds or 0 for p in possession_events)

            if total_duration > 0:
                team_duration = sum(
                    p.duration_seconds or 0
                    for p in possession_events
                    if _is_own_team(p)
                )
                stats["team_possession_percentage"] = round((team_duration / total_duration) * 100, 1)
                stats["opponent_possession_percentage"] = round(100 - stats["team_possession_percentage"], 1)
            else:
                # Fallback: if no durations yet, use event count (initial possession)
                total_events = len(possession_events)
                team_events = sum(1 for p in possession_events if _is_own_team(p))
                stats["team_possession_percentage"] = round((team_events / total_events) * 100, 1)
                stats["opponent_possession_percentage"] = round(100 - stats["team_possession_percentage"], 1)
        
        # Calculate event stats
        for event in events:
            team_prefix = "team" if event.team == Team.OWN else "opponent"
            
            # Scoring events (goals, points, 2-pointers from play or frees/45s)
            scoring_events = [
                EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE
            ]
            if event.event_type in scoring_events:
                stats[f"{team_prefix}_total_shots"] += 1
                stats[f"{team_prefix}_scores"] += 1
            # Missed shots (wides from play or frees, missed 45s)
            elif event.event_type in [EventType.WIDE, EventType.WIDE_FREE, EventType.FORTY_FIVE_MISSED]:
                stats[f"{team_prefix}_total_shots"] += 1
                stats[f"{team_prefix}_wides"] += 1
            elif event.event_type in [EventType.SHORT, EventType.SAVED]:
                stats[f"{team_prefix}_total_shots"] += 1
            
            # Turnovers (opposition forced)
            elif event.event_type == EventType.TURNOVER_WON:
                stats[f"{team_prefix}_turnovers_won"] += 1
            elif event.event_type == EventType.TURNOVER_LOST:
                stats[f"{team_prefix}_turnovers_lost"] += 1
            
            # Unforced Errors (own mistakes) - count towards turnovers lost
            elif event.event_type == EventType.UNFORCED_ERROR:
                # Unforced error counts as possession lost
                stats[f"{team_prefix}_turnovers_lost"] += 1
            
            # Kickouts — decode from event type name, NOT from event.team
            # OWN_KICKOUT = our team kicking out, OPP_KICKOUT = Opponent kicking out
            # WON = our team won, OPPOSITION_WON = Opponent won

            # Our team's own kickouts
            elif event.event_type in (
                EventType.OWN_KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
            ):
                stats["team_kickouts_won"] += 1  # Team retained own kickout
            elif event.event_type in (
                EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            ):
                stats["team_kickouts_lost"] += 1  # Team lost own kickout

            # Opponent's own kickouts
            elif event.event_type in (
                EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
            ):
                stats["opponent_kickouts_won"] += 1  # Opponent retained own kickout
            elif event.event_type in (
                EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
            ):
                stats["opponent_kickouts_lost"] += 1  # Opponent lost own kickout (team won it)

            # Legacy types (pre-detailed kickout tracking)
            elif event.event_type in (EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON):
                stats["team_kickouts_won"] += 1
            elif event.event_type in (EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST):
                stats["team_kickouts_lost"] += 1
            
            # Cards
            elif event.event_type == EventType.YELLOW_CARD:
                stats[f"{team_prefix}_yellow_cards"] += 1
            elif event.event_type == EventType.RED_CARD:
                stats[f"{team_prefix}_red_cards"] += 1
        
        # Calculate accuracy
        for team_prefix in ["team", "opponent"]:
            total = stats[f"{team_prefix}_total_shots"]
            if total > 0:
                scores = stats[f"{team_prefix}_scores"]
                stats[f"{team_prefix}_accuracy"] = (scores / total) * 100
        
        return stats

