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
from app.models.player import Player
from app.models.live_insight import LiveInsight, InsightTrigger
from app.services.ai import live_match_insight

logger = logging.getLogger(__name__)

# Concern types the sideline agent is allowed to name a specific own-team
# player for, with the count at which they become worth mentioning at all —
# matches the thresholds already stated in MatchAgent's live-insight TRIGGERS
# section ("Any player: 2+ fouls", "2+ unforced errors"). turnovers_lost has
# no separate stated threshold there — 2 is the same bar as the others.
CONCERN_THRESHOLDS = {
    "turnovers_lost": 2,
    "unforced_errors": 2,
    "fouls": 2,
}
CONCERN_EVENT_TYPES = {
    "turnovers_lost": {EventType.TURNOVER_LOST},
    "unforced_errors": {EventType.UNFORCED_ERROR},
    "fouls": {EventType.FOUL_COMMITTED},
}


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
    async def _compute_concern_snapshot(db: AsyncSession, match_id: UUID) -> Dict[str, Dict[str, Any]]:
        """Current match-wide count of each tracked concern, per own-team
        player who has player_id set. Full-match totals, not a rolling
        window — a concern is worth re-raising once it has genuinely grown,
        regardless of which half that growth happened in."""
        all_concern_types = {t for types in CONCERN_EVENT_TYPES.values() for t in types}
        result = await db.execute(
            select(MatchEvent.player_id, MatchEvent.event_type)
            .where(
                MatchEvent.match_id == match_id,
                MatchEvent.team == Team.OWN,
                MatchEvent.player_id.isnot(None),
                MatchEvent.event_type.in_(list(all_concern_types)),
            )
        )
        rows = result.all()
        if not rows:
            return {}

        player_ids = {pid for pid, _ in rows}
        player_result = await db.execute(select(Player).where(Player.id.in_(player_ids)))
        names = {p.id: p.name for p in player_result.scalars().all()}

        snapshot: Dict[str, Dict[str, Any]] = {}
        for pid, event_type in rows:
            key = str(pid)
            if key not in snapshot:
                snapshot[key] = {"player_id": key, "player_name": names.get(pid, "Unknown"),
                                  "turnovers_lost": 0, "unforced_errors": 0, "fouls": 0}
            for concern, types in CONCERN_EVENT_TYPES.items():
                if event_type in types:
                    snapshot[key][concern] += 1
        return snapshot

    @staticmethod
    async def _build_already_flagged_note(db: AsyncSession, match_id: UUID, snapshot: Dict[str, Dict[str, Any]]) -> str:
        """
        Cross-references the current concern snapshot against every prior
        insight's flagged_concerns for this match. Returns a hard-instruction
        prompt block listing player+concern combos that are still at the same
        count as when they were last raised — the model is told not to
        re-mention these unless the count has since moved.

        Deliberately does NOT try to enumerate what IS fair game — anything
        not on this exclusion list is implicitly free to raise, so the
        existing TRIGGERS section keeps working unchanged for everything else.
        """
        history_result = await db.execute(
            select(LiveInsight.flagged_concerns)
            .where(LiveInsight.match_id == match_id, LiveInsight.flagged_concerns.isnot(None))
        )
        # Last-flagged count per (player_id, concern) — later rows (higher
        # created_at) would win on a tie, but since a concern only ever
        # increases, the max already gives the correct "last known" value.
        last_flagged: Dict[tuple, int] = {}
        for (rows,) in history_result.all():
            for entry in (rows or []):
                k = (entry.get("player_id"), entry.get("concern"))
                last_flagged[k] = max(last_flagged.get(k, 0), entry.get("count", 0))

        if not last_flagged:
            return ""

        excluded = []
        for player_key, counts in snapshot.items():
            for concern, threshold in CONCERN_THRESHOLDS.items():
                count = counts.get(concern, 0)
                if count < threshold:
                    continue
                prior = last_flagged.get((player_key, concern))
                if prior is not None and count <= prior:
                    excluded.append(f"{counts['player_name']} ({concern.replace('_', ' ')}, still {count})")

        if not excluded:
            return ""

        return (
            "\n## ALREADY FLAGGED — DO NOT MENTION AGAIN UNLESS THE COUNT HAS RISEN\n"
            f"{'; '.join(excluded)}.\n"
            "These were already raised to the sideline and nothing has changed since — repeating them "
            "as if new wastes the manager's attention. If the snapshot has nothing else notable, say so "
            "briefly rather than repeating one of the above.\n"
        )

    @staticmethod
    def _mark_flagged_concerns(insight_text: str, snapshot: Dict[str, Dict[str, Any]]) -> list:
        """After generation, records which concern(s) actually got named in
        the output text (simple case-insensitive name match) so the NEXT
        check can tell whether that exact count has already been surfaced."""
        flagged = []
        lowered = insight_text.lower()
        for counts in snapshot.values():
            name = counts["player_name"]
            if not name or name == "Unknown":
                continue
            surname = name.split()[-1].lower()
            if surname not in lowered and name.lower() not in lowered:
                continue
            for concern, threshold in CONCERN_THRESHOLDS.items():
                count = counts.get(concern, 0)
                if count >= threshold:
                    flagged.append({
                        "player_id": counts["player_id"],
                        "player_name": name,
                        "concern": concern,
                        "count": count,
                    })
        return flagged

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

            # Fetch the last couple of real (non-fallback) insights so the model
            # knows what it already told the sideline and doesn't re-raise the
            # same player/concern as if it were a fresh discovery every interval
            prior_result = await db.execute(
                select(LiveInsight.insight)
                .where(LiveInsight.match_id == match_id)
                .order_by(desc(LiveInsight.created_at))
                .limit(2)
            )
            previous_insights = [
                text for (text,) in prior_result.all()
                if text and not text.startswith("[Analysis pending")
            ]

            # Deterministic repeat-suppression: compute current per-player
            # concern counts and cross-reference against every prior
            # insight's flagged_concerns, so a concern already raised at the
            # same count doesn't get re-raised as if it were new (previously
            # relied entirely on the LLM inferring this from free-text
            # history — unreliable enough that a player's early turnovers
            # kept getting flagged fresh every interval with no change).
            concern_snapshot = await LiveInsightsService._compute_concern_snapshot(db, match_id)
            already_flagged_note = await LiveInsightsService._build_already_flagged_note(db, match_id, concern_snapshot)

            # Generate AI insight
            insight_text = await live_match_insight(
                db, match_id, recent_events, trigger=trigger.value,
                previous_insights=previous_insights,
                already_flagged_note=already_flagged_note,
            )

            flagged_concerns = LiveInsightsService._mark_flagged_concerns(insight_text, concern_snapshot)

            # Store insight (trigger stored as string value to avoid asyncpg enum caching)
            insight = LiveInsight(
                match_id=match_id,
                minute=minute,
                half=half,
                trigger=trigger.value,
                insight=insight_text,
                trigger_context=context,
                flagged_concerns=flagged_concerns or None,
            )
            db.add(insight)
            await db.commit()
            await db.refresh(insight)

            logger.info(f"Generated {trigger.value} insight at {minute}' for match {match_id}")
            return insight

        except Exception as e:
            logger.error(f"Failed to generate insight for match {match_id} trigger={trigger.value}: {type(e).__name__}: {e}", exc_info=True)
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
