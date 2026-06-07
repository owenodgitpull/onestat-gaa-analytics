"""
Live Insights Service for real-time AI analysis during matches.

Triggers AI insights based on:
- Time intervals (every 5 minutes)
- Significant events (goals, scoring runs, cards, etc.)
"""

import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.match import Match
from app.models.match_event import MatchEvent, EventType, Team
from app.models.live_insight import LiveInsight, InsightTrigger
from app.services.ai import live_match_insight

logger = logging.getLogger(__name__)


class LiveInsightsService:
    """Service for managing live match insights."""

    # Significant event types that trigger immediate insights
    SIGNIFICANT_EVENTS = {
        EventType.GOAL: InsightTrigger.GOAL_SCORED,
        EventType.YELLOW_CARD: InsightTrigger.CARD_ISSUED,
        EventType.BLACK_CARD: InsightTrigger.CARD_ISSUED,
        EventType.RED_CARD: InsightTrigger.CARD_ISSUED,
        EventType.SUBSTITUTION: InsightTrigger.SUBSTITUTION,
    }

    @staticmethod
    async def check_and_generate_insight(
        db: AsyncSession,
        match_id: UUID,
        current_minute: int,
        current_half: int,
        new_event: Optional[MatchEvent] = None
    ) -> Optional[LiveInsight]:
        """
        Check if an insight should be generated and create it if so.

        Called after each event is recorded or periodically during match.

        Args:
            db: Database session
            match_id: Match ID
            current_minute: Current match minute
            current_half: Current half (1 or 2)
            new_event: The event that was just recorded (if any)

        Returns:
            LiveInsight if one was generated, None otherwise
        """
        # Check for significant event trigger
        if new_event:
            trigger = await LiveInsightsService._check_event_trigger(
                db, match_id, new_event, current_minute, current_half
            )
            if trigger:
                return trigger

        # Check for pattern-based triggers (scoring run, drought, turnover crisis)
        pattern_trigger = await LiveInsightsService._check_pattern_triggers(
            db, match_id, current_minute, current_half
        )
        if pattern_trigger:
            return pattern_trigger

        # Check for interval trigger (every 5 minutes)
        interval_trigger = await LiveInsightsService._check_interval_trigger(
            db, match_id, current_minute, current_half
        )
        if interval_trigger:
            return interval_trigger

        return None

    @staticmethod
    async def _check_event_trigger(
        db: AsyncSession,
        match_id: UUID,
        event: MatchEvent,
        minute: int,
        half: int
    ) -> Optional[LiveInsight]:
        """Check if event type triggers an insight."""
        trigger_type = LiveInsightsService.SIGNIFICANT_EVENTS.get(event.event_type)

        if not trigger_type:
            return None

        # Don't generate too many insights for rapid events
        recent = await LiveInsightsService._get_recent_insight(db, match_id, minutes_ago=2)
        if recent:
            logger.debug(f"Skipping insight - recent insight exists from {recent.minute}'")
            return None

        # Generate insight
        context = f"{event.event_type.value} at {minute}'"
        return await LiveInsightsService._generate_and_store_insight(
            db, match_id, minute, half, trigger_type, context
        )

    @staticmethod
    async def _check_pattern_triggers(
        db: AsyncSession,
        match_id: UUID,
        minute: int,
        half: int
    ) -> Optional[LiveInsight]:
        """Check for pattern-based triggers."""
        # Get recent events (last 15 minutes)
        events = await LiveInsightsService._get_recent_events(db, match_id, minutes=15)

        if not events:
            return None

        # Check for scoring run (3+ scores without reply)
        scoring_run = await LiveInsightsService._detect_scoring_run(events)
        if scoring_run:
            recent = await LiveInsightsService._get_recent_insight(
                db, match_id, trigger_type=InsightTrigger.SCORING_RUN, minutes_ago=10
            )
            if not recent:
                context = f"{scoring_run['team']} {scoring_run['count']} scores without reply"
                return await LiveInsightsService._generate_and_store_insight(
                    db, match_id, minute, half, InsightTrigger.SCORING_RUN, context
                )

        # Check for scoring drought (10+ minutes without score)
        drought = await LiveInsightsService._detect_scoring_drought(db, match_id, minute)
        if drought:
            recent = await LiveInsightsService._get_recent_insight(
                db, match_id, trigger_type=InsightTrigger.SCORING_DROUGHT, minutes_ago=10
            )
            if not recent:
                context = f"No scores in last {drought} minutes"
                return await LiveInsightsService._generate_and_store_insight(
                    db, match_id, minute, half, InsightTrigger.SCORING_DROUGHT, context
                )

        # Check for turnover crisis (5+ turnovers in 10 mins)
        turnover_crisis = await LiveInsightsService._detect_turnover_crisis(events)
        if turnover_crisis:
            recent = await LiveInsightsService._get_recent_insight(
                db, match_id, trigger_type=InsightTrigger.TURNOVER_CRISIS, minutes_ago=10
            )
            if not recent:
                context = f"Team lost {turnover_crisis} turnovers in last 10 minutes"
                return await LiveInsightsService._generate_and_store_insight(
                    db, match_id, minute, half, InsightTrigger.TURNOVER_CRISIS, context
                )

        return None

    @staticmethod
    async def _check_interval_trigger(
        db: AsyncSession,
        match_id: UUID,
        minute: int,
        half: int
    ) -> Optional[LiveInsight]:
        """Check if 5-minute interval insight is due."""
        # Get last insight for this match
        result = await db.execute(
            select(LiveInsight)
            .where(LiveInsight.match_id == match_id)
            .order_by(desc(LiveInsight.created_at))
            .limit(1)
        )
        last_insight = result.scalar_one_or_none()

        # Generate if no insights yet or 5+ minutes since last
        should_generate = False
        if not last_insight:
            should_generate = minute >= 5
        else:
            minutes_since_last = minute - last_insight.minute
            # Account for half change
            if half > last_insight.half:
                minutes_since_last = minute - 30 + (30 - last_insight.minute)
            should_generate = minutes_since_last >= 5

        if should_generate:
            return await LiveInsightsService._generate_and_store_insight(
                db, match_id, minute, half, InsightTrigger.INTERVAL, f"{minute}' interval check"
            )

        return None

    @staticmethod
    async def _detect_scoring_run(events: List[MatchEvent]) -> Optional[Dict[str, Any]]:
        """Detect if there's a scoring run (3+ scores without reply)."""
        if not events:
            return None

        scoring_types = {EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE}

        # Get scoring events only
        scoring_events = [e for e in events if e.event_type in scoring_types]

        if len(scoring_events) < 3:
            return None

        # Check last 5 scoring events for a run
        recent_scores = scoring_events[-5:]
        team_run = 0
        opponent_run = 0

        for event in reversed(recent_scores):
            if event.team == Team.OWN:
                if opponent_run > 0:
                    break
                team_run += 1
            else:
                if team_run > 0:
                    break
                opponent_run += 1

        if team_run >= 3:
            return {"team": "Own", "count": team_run}
        elif opponent_run >= 3:
            return {"team": "Opposition", "count": opponent_run}

        return None

    @staticmethod
    async def _detect_scoring_drought(
        db: AsyncSession,
        match_id: UUID,
        current_minute: int
    ) -> Optional[int]:
        """Detect if there's a scoring drought (10+ minutes without score for own team)."""
        scoring_types = [EventType.GOAL, EventType.POINT, EventType.TWO_POINT,
                        EventType.POINT_FREE, EventType.TWO_POINT_FREE, EventType.FORTY_FIVE]

        result = await db.execute(
            select(MatchEvent)
            .where(
                and_(
                    MatchEvent.match_id == match_id,
                    MatchEvent.team == Team.OWN,
                    MatchEvent.event_type.in_(scoring_types)
                )
            )
            .order_by(desc(MatchEvent.minute))
            .limit(1)
        )
        last_score = result.scalar_one_or_none()

        if not last_score:
            # No scores yet - check if we're 10+ minutes in
            if current_minute >= 10:
                return current_minute
            return None

        minutes_since_score = current_minute - last_score.minute
        if minutes_since_score >= 10:
            return minutes_since_score

        return None

    @staticmethod
    async def _detect_turnover_crisis(events: List[MatchEvent]) -> Optional[int]:
        """Detect if own team has lost 5+ turnovers recently."""
        turnover_types = {EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR}

        turnovers = [e for e in events
                     if e.event_type in turnover_types and e.team == Team.OWN]

        if len(turnovers) >= 5:
            return len(turnovers)

        return None

    @staticmethod
    async def _get_recent_events(
        db: AsyncSession,
        match_id: UUID,
        minutes: int = 15
    ) -> List[MatchEvent]:
        """Get events from the last N minutes."""
        result = await db.execute(
            select(MatchEvent)
            .where(MatchEvent.match_id == match_id)
            .order_by(desc(MatchEvent.minute))
            .limit(50)  # Get last 50 events max
        )
        return list(result.scalars().all())

    @staticmethod
    async def _get_recent_insight(
        db: AsyncSession,
        match_id: UUID,
        trigger_type: Optional[InsightTrigger] = None,
        minutes_ago: int = 5
    ) -> Optional[LiveInsight]:
        """Check if there's a recent insight of the given type."""
        query = select(LiveInsight).where(
            and_(
                LiveInsight.match_id == match_id,
                LiveInsight.created_at >= datetime.utcnow() - timedelta(minutes=minutes_ago)
            )
        )
        if trigger_type:
            query = query.where(LiveInsight.trigger == trigger_type.value)

        result = await db.execute(query.order_by(desc(LiveInsight.created_at)).limit(1))
        return result.scalar_one_or_none()

    @staticmethod
    async def _generate_and_store_insight(
        db: AsyncSession,
        match_id: UUID,
        minute: int,
        half: int,
        trigger: InsightTrigger,
        context: str
    ) -> LiveInsight:
        """Generate AI insight and store it."""
        try:
            # Get recent events for context
            events = await LiveInsightsService._get_recent_events(db, match_id, minutes=10)
            recent_events = [
                {
                    "minute": e.minute,
                    "type": e.event_type.value if hasattr(e.event_type, 'value') else str(e.event_type),
                    "team": e.team.value if hasattr(e.team, 'value') else str(e.team) if e.team else None
                }
                for e in events[:10]
            ]

            # Generate AI insight
            insight_text = await live_match_insight(db, match_id, recent_events, trigger=trigger.value)

            # Store insight (trigger stored as string value to avoid asyncpg enum caching)
            insight = LiveInsight(
                match_id=match_id,
                minute=minute,
                half=half,
                trigger=trigger.value,
                insight=insight_text,
                trigger_context=context
            )
            db.add(insight)
            await db.commit()
            await db.refresh(insight)

            logger.info(f"Generated {trigger.value} insight at {minute}' for match {match_id}")
            return insight

        except Exception as e:
            logger.error(f"Failed to generate insight: {e}", exc_info=True)
            # Create a fallback insight
            insight = LiveInsight(
                match_id=match_id,
                minute=minute,
                half=half,
                trigger=trigger.value,
                insight=f"[Analysis pending - {context}]",
                trigger_context=context
            )
            db.add(insight)
            await db.commit()
            await db.refresh(insight)
            return insight

    @staticmethod
    async def get_match_insights(
        db: AsyncSession,
        match_id: UUID,
        limit: int = 20
    ) -> List[LiveInsight]:
        """Get all insights for a match."""
        result = await db.execute(
            select(LiveInsight)
            .where(LiveInsight.match_id == match_id)
            .order_by(desc(LiveInsight.created_at))
            .limit(limit)
        )
        return list(result.scalars().all())

    @staticmethod
    async def trigger_half_time_insight(
        db: AsyncSession,
        match_id: UUID
    ) -> LiveInsight:
        """Generate half-time analysis insight."""
        return await LiveInsightsService._generate_and_store_insight(
            db, match_id, 30, 1, InsightTrigger.HALF_TIME, "Half-time analysis"
        )
