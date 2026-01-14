"""
Service layer for Match operations.

Contains business logic for match CRUD operations and statistics calculations.
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.match import Match, MatchStatus, MatchVenue
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.player_match_stats import PlayerMatchStats
from app.schemas.match import MatchCreate, MatchUpdate


class MatchService:
    """Service for match-related operations."""
    
    @staticmethod
    async def create_match(db: AsyncSession, match_data: MatchCreate) -> Match:
        """
        Create a new match.
        
        Args:
            db: Database session
            match_data: Match creation data
            
        Returns:
            Created match
        """
        match = Match(
            opponent=match_data.opponent,
            match_date=match_data.match_date,
            venue=match_data.venue,
            notes=match_data.notes,
            status=MatchStatus.SCHEDULED,
        )
        
        db.add(match)
        await db.commit()
        await db.refresh(match)
        
        return match
    
    @staticmethod
    async def get_match(db: AsyncSession, match_id: UUID) -> Optional[Match]:
        """Get a match by ID."""
        result = await db.execute(
            select(Match).where(
                and_(Match.id == match_id, Match.is_deleted == False)
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
    ) -> tuple[List[Match], int]:
        """
        List matches with filtering and pagination.
        
        Returns:
            Tuple of (matches, total_count)
        """
        # Build base query
        conditions = [Match.is_deleted == False]
        
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
        result = await db.execute(
            select(Match)
            .where(and_(*conditions))
            .order_by(Match.match_date.desc())
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
        
        await db.commit()
        await db.refresh(match)
        
        return match
    
    @staticmethod
    async def complete_match(
        db: AsyncSession,
        match_id: UUID,
        completed_at: Optional[datetime] = None,
        notes: Optional[str] = None
    ) -> Optional[Match]:
        """Complete a match (change status to COMPLETED)."""
        match = await MatchService.get_match(db, match_id)
        if not match:
            return None
        
        match.status = MatchStatus.COMPLETED
        match.completed_at = completed_at or datetime.utcnow()
        if notes:
            match.notes = notes
        
        await db.commit()
        await db.refresh(match)
        
        return match
    
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
            "dungloe_possession_percentage": 0.0,
            "opponent_possession_percentage": 0.0,
            # Shots
            "dungloe_total_shots": 0,
            "dungloe_scores": 0,
            "dungloe_wides": 0,
            "dungloe_accuracy": 0.0,
            "opponent_total_shots": 0,
            "opponent_scores": 0,
            "opponent_wides": 0,
            "opponent_accuracy": 0.0,
            # Turnovers
            "dungloe_turnovers_won": 0,
            "dungloe_turnovers_lost": 0,
            "opponent_turnovers_won": 0,
            "opponent_turnovers_lost": 0,
            # Kickouts
            "dungloe_kickouts_won": 0,
            "dungloe_kickouts_lost": 0,
            "opponent_kickouts_won": 0,
            "opponent_kickouts_lost": 0,
            # Cards
            "dungloe_yellow_cards": 0,
            "dungloe_red_cards": 0,
            "opponent_yellow_cards": 0,
            "opponent_red_cards": 0,
        }
        
        # Calculate possession percentages (time-based, not event-based)
        if possession_events:
            # Sum up duration_seconds for each team
            total_duration = sum(p.duration_seconds or 0 for p in possession_events)
            
            if total_duration > 0:
                dungloe_duration = sum(
                    p.duration_seconds or 0
                    for p in possession_events
                    if p.team == PossessionTeam.DUNGLOE
                )
                stats["dungloe_possession_percentage"] = round((dungloe_duration / total_duration) * 100, 1)
                stats["opponent_possession_percentage"] = round(100 - stats["dungloe_possession_percentage"], 1)
            else:
                # Fallback: if no durations yet, use event count (initial possession)
                total_events = len(possession_events)
                dungloe_events = sum(1 for p in possession_events if p.team == PossessionTeam.DUNGLOE)
                stats["dungloe_possession_percentage"] = round((dungloe_events / total_events) * 100, 1)
                stats["opponent_possession_percentage"] = round(100 - stats["dungloe_possession_percentage"], 1)
        
        # Calculate event stats
        for event in events:
            team_prefix = "dungloe" if event.team == Team.DUNGLOE else "opponent"
            
            # Scoring events
            if event.event_type in [EventType.GOAL, EventType.POINT, EventType.TWO_POINT]:
                stats[f"{team_prefix}_total_shots"] += 1
                stats[f"{team_prefix}_scores"] += 1
            elif event.event_type == EventType.WIDE:
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
            
            # Kickouts
            elif event.event_type == EventType.KICKOUT_WON:
                stats[f"{team_prefix}_kickouts_won"] += 1
            elif event.event_type == EventType.KICKOUT_LOST:
                stats[f"{team_prefix}_kickouts_lost"] += 1
            
            # Cards
            elif event.event_type == EventType.YELLOW_CARD:
                stats[f"{team_prefix}_yellow_cards"] += 1
            elif event.event_type == EventType.RED_CARD:
                stats[f"{team_prefix}_red_cards"] += 1
        
        # Calculate accuracy
        for team_prefix in ["dungloe", "opponent"]:
            total = stats[f"{team_prefix}_total_shots"]
            if total > 0:
                scores = stats[f"{team_prefix}_scores"]
                stats[f"{team_prefix}_accuracy"] = (scores / total) * 100
        
        return stats

