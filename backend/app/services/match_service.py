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
from sqlalchemy.orm import lazyload
from app.models.match import Match, MatchStatus, MatchVenue, WeatherCondition
from app.models.match_event import MatchEvent, EventType, Team
from app.models.possession_event import PossessionEvent, PossessionTeam
from app.models.player_match_stats import PlayerMatchStats
from app.schemas.match import MatchCreate, MatchUpdate

logger = logging.getLogger(__name__)

# Match.events/.possession_events/.player_stats/.lineup/.gps_data/.video_sessions
# all default to lazy="selectin" (eager). list_matches/get_match never touch
# these relationships directly (routes/matches.py resolves has_gps/has_video/
# has_events via lightweight targeted queries instead — see that file), so
# suppress the eager load here to avoid fetching every event/GPS/lineup row
# for every match just to list/fetch match summaries.
_NO_EAGER_MATCH_RELATIONSHIPS = (
    lazyload(Match.events),
    lazyload(Match.possession_events),
    lazyload(Match.player_stats),
    lazyload(Match.lineup),
    lazyload(Match.gps_data),
    lazyload(Match.video_sessions),
)


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
        if match_data.weather_conditions is not None:
            match_kwargs['weather_conditions'] = [w.value for w in match_data.weather_conditions]
            # weather_condition (singular) auto-synced from the first entry —
            # see the model's own comment for why this stays populated.
            match_kwargs['weather_condition'] = match_data.weather_conditions[0] if match_data.weather_conditions else None
        elif match_data.weather_condition is not None:
            match_kwargs['weather_condition'] = match_data.weather_condition
        if match_data.temperature_celsius is not None:
            match_kwargs['temperature_celsius'] = match_data.temperature_celsius
        if match_data.competition is not None:
            match_kwargs['competition'] = match_data.competition
        if match_data.stage is not None:
            match_kwargs['stage'] = match_data.stage
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
    async def get_match(
        db: AsyncSession, match_id: UUID, club_id: Optional[UUID] = None
    ) -> Optional[Match]:
        """Get a match by ID. Pass club_id to enforce club scoping (required on all HTTP routes)."""
        conditions = [Match.id == match_id, Match.is_deleted.is_(False)]
        if club_id is not None:
            conditions.append(Match.club_id == club_id)
        result = await db.execute(
            select(Match).where(and_(*conditions)).options(*_NO_EAGER_MATCH_RELATIONSHIPS)
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
        upcoming_only: bool = False,
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
        if upcoming_only:
            # "Next fixture" queries need this filtered server-side, not just
            # sorted+limited then filtered client-side — a club can accumulate
            # old "scheduled" fixtures that were never marked completed/cancelled
            # (e.g. imported season fixture lists left unreconciled against the
            # matches actually recorded), and a small limit() can get entirely
            # swallowed by that backlog before a real upcoming match is reached.
            conditions.append(Match.match_date >= datetime.utcnow())
        
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
            .options(*_NO_EAGER_MATCH_RELATIONSHIPS)
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
        match_data: MatchUpdate,
        club_id: Optional[UUID] = None,
    ) -> Optional[Match]:
        """Update a match."""
        match = await MatchService.get_match(db, match_id, club_id=club_id)
        if not match:
            return None
        
        # Update fields
        update_data = match_data.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            if field == 'weather_conditions':
                # This is a JSON column, not a SQLAlchemy Enum column like
                # weather_condition — it's serialized with plain json.dumps,
                # which can't handle raw WeatherCondition enum members
                # (json.dumps(WeatherCondition.WINDY) raises TypeError since
                # the enum isn't a str subclass), so store .value strings.
                value = [w.value for w in value] if value else value
            setattr(match, field, value)

        # weather_condition (singular) auto-synced from weather_conditions[0]
        # whenever the plural field was actually part of this update — see
        # the model's own comment for why the singular field is kept at all.
        # Not just "always resync from whatever's on the row", since a caller
        # updating something unrelated (e.g. just notes) shouldn't silently
        # touch weather_condition based on stale/prior weather_conditions.
        if 'weather_conditions' in update_data:
            match.weather_condition = WeatherCondition(match.weather_conditions[0]) if match.weather_conditions else None

        await db.commit()
        await db.refresh(match)

        return match

    @staticmethod
    async def start_match(
        db: AsyncSession,
        match_id: UUID,
        started_at: Optional[datetime] = None,
        club_id: Optional[UUID] = None,
    ) -> Optional[Match]:
        """Start a match (change status to IN_PROGRESS)."""
        match = await MatchService.get_match(db, match_id, club_id=club_id)
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
        attacking_right_first_half: Optional[bool] = None,
        club_id: Optional[UUID] = None,
    ) -> Optional[Match]:
        """Update match phase for resumable recording."""
        match = await MatchService.get_match(db, match_id, club_id=club_id)
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
        trigger_ai_analysis: bool = True,
        club_id: Optional[UUID] = None,
    ) -> Optional[Match]:
        """
        Complete a match (change status to COMPLETED).

        Optionally triggers AI post-match analysis in the background.
        """
        match = await MatchService.get_match(db, match_id, club_id=club_id)
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
    async def delete_match(db: AsyncSession, match_id: UUID, club_id: Optional[UUID] = None) -> bool:
        """Soft delete a match."""
        match = await MatchService.get_match(db, match_id, club_id=club_id)
        if not match:
            return False
        
        match.is_deleted = True
        await db.commit()
        
        return True
    
    @staticmethod
    async def calculate_match_stats(db: AsyncSession, match_id: UUID, half: int = None) -> Dict[str, Any]:
        """
        Calculate comprehensive match statistics.

        Returns dictionary with possession, shots, turnovers, etc.
        Optionally filter by half (1 or 2).
        """
        from app.models.match import Match as MatchModel
        match_obj_result = await db.execute(select(MatchModel).where(MatchModel.id == match_id))
        match_obj = match_obj_result.scalar_one_or_none()
        half_duration = (match_obj.half_duration_mins if match_obj and match_obj.half_duration_mins else 30)

        # Determine minute range for the requested half
        if half == 1:
            min_minute, max_minute = 0, half_duration
        elif half == 2:
            min_minute, max_minute = half_duration + 1, 9999
        else:
            min_minute, max_minute = 0, 9999

        # Get events for this match (filtered by half if requested)
        events_query = select(MatchEvent).where(MatchEvent.match_id == match_id)
        if half is not None:
            events_query = events_query.where(
                MatchEvent.minute >= min_minute,
                MatchEvent.minute <= max_minute,
            )
        events_result = await db.execute(events_query)
        events = events_result.scalars().all()

        # Get possession events (filtered by half if requested)
        possession_query = select(PossessionEvent).where(PossessionEvent.match_id == match_id)
        if half is not None:
            possession_query = possession_query.where(
                PossessionEvent.minute >= min_minute,
                PossessionEvent.minute <= max_minute,
            )
        possession_result = await db.execute(possession_query)
        possession_events = possession_result.scalars().all()
        
        # Initialize stats
        stats = {
            "match_id": str(match_id),
            # Possession
            "team_possession_percentage": 0.0,
            "opponent_possession_percentage": 0.0,
            "team_possession_count": 0,
            "opponent_possession_count": 0,
            "team_poss_converted_to_shots_pct": 0.0,
            "opponent_poss_converted_to_shots_pct": 0.0,
            # Shots
            "team_total_shots": 0,
            "team_scores": 0,
            "team_wides": 0,
            "team_dropped_short": 0,
            "team_hit_post": 0,
            "team_goal_chances": 0,
            "team_accuracy": 0.0,
            "opponent_total_shots": 0,
            "opponent_scores": 0,
            "opponent_wides": 0,
            "opponent_dropped_short": 0,
            "opponent_hit_post": 0,
            "opponent_goal_chances": 0,
            "opponent_accuracy": 0.0,
            # Turnovers
            "team_turnovers_won": 0,
            "team_turnovers_lost": 0,
            "team_unforced_errors": 0,
            "opponent_turnovers_won": 0,
            "opponent_turnovers_lost": 0,
            "opponent_unforced_errors": 0,
            # Kickouts
            "team_kickouts_won": 0,
            "team_kickouts_lost": 0,
            "opponent_kickouts_won": 0,
            "opponent_kickouts_lost": 0,
            # Fouls
            "team_fouls": 0,
            "opponent_fouls": 0,
            # Cards
            "team_yellow_cards": 0,
            "team_black_cards": 0,
            "team_red_cards": 0,
            "opponent_yellow_cards": 0,
            "opponent_black_cards": 0,
            "opponent_red_cards": 0,
        }
        
        # Calculate possession percentages (time-based, not event-based)
        if possession_events:
            def _is_own_team(p) -> bool:
                """Normalize team comparison — handles both enum objects and raw strings."""
                t = p.team.value if hasattr(p.team, 'value') else str(p.team)
                return t == "own"

            # Possession spell count — consecutive runs of the same team
            # Sort by created_at to get chronological order, then count transitions
            sorted_events = sorted(possession_events, key=lambda p: p.created_at)
            team_spells = opp_spells = 0
            prev_team = None
            for p in sorted_events:
                curr = "own" if _is_own_team(p) else "opponent"
                if curr != prev_team:
                    if curr == "own":
                        team_spells += 1
                    elif curr == "opponent":
                        opp_spells += 1
                    prev_team = curr
            stats["team_possession_count"] = team_spells
            stats["opponent_possession_count"] = opp_spells

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
                # Fallback: if no durations yet, use event count (initial possession).
                # `team_count` here used to reference an undefined name — this branch
                # would raise a NameError any time it was actually reached (all
                # possession_events durations null/zero, e.g. right after the very
                # first tap of a match) instead of returning a sane 0/0.
                total_events = len(possession_events)
                team_events = sum(1 for p in possession_events if _is_own_team(p))
                stats["team_possession_percentage"] = round((team_events / total_events) * 100, 1) if total_events > 0 else 0.0
                stats["opponent_possession_percentage"] = round(100 - stats["team_possession_percentage"], 1)
        
        _GOAL_CHANCE_TYPES = frozenset([
            EventType.GOAL, EventType.PENALTY_GOAL,
            EventType.SAVED, EventType.PENALTY_MISS, EventType.HIT_POST,
        ])

        # Calculate event stats
        for event in events:
            team_prefix = "team" if event.team == Team.OWN else "opponent"

            if event.event_type in _GOAL_CHANCE_TYPES:
                stats[f"{team_prefix}_goal_chances"] += 1

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
            elif event.event_type == EventType.SHORT:
                stats[f"{team_prefix}_total_shots"] += 1
                stats[f"{team_prefix}_dropped_short"] += 1
            elif event.event_type == EventType.SAVED:
                stats[f"{team_prefix}_total_shots"] += 1
            elif event.event_type == EventType.HIT_POST:
                stats[f"{team_prefix}_total_shots"] += 1
                stats[f"{team_prefix}_hit_post"] += 1

            # Turnovers (opposition forced) — interceptions and tackles count as turnovers won
            # Blocks do NOT auto-count — outcome depends on who recovers
            elif event.event_type in (EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON):
                stats[f"{team_prefix}_turnovers_won"] += 1
            elif event.event_type == EventType.TURNOVER_LOST:
                other_prefix = "opponent" if team_prefix == "team" else "team"
                stats[f"{team_prefix}_turnovers_lost"] += 1
                # A turnover lost by one team is automatically a turnover won by the other
                stats[f"{other_prefix}_turnovers_won"] += 1

            # Unforced Errors — a subcategory of turnover lost (own mistake, no pressure)
            elif event.event_type == EventType.UNFORCED_ERROR:
                other_prefix = "opponent" if team_prefix == "team" else "team"
                stats[f"{team_prefix}_turnovers_lost"] += 1
                stats[f"{other_prefix}_turnovers_won"] += 1
                stats[f"{team_prefix}_unforced_errors"] += 1
            
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
                EventType.OWN_KICKOUT_SIDELINE,
            ):
                stats["team_kickouts_lost"] += 1  # Team lost own kickout

            # Opponent's own kickouts
            elif event.event_type in (
                EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
            ):
                stats["opponent_kickouts_won"] += 1  # Opponent retained own kickout
            elif event.event_type in (
                EventType.OPP_KICKOUT_WON, EventType.OPP_KICKOUT_WON_BREAK,
                EventType.OPP_KICKOUT_SIDELINE,
            ):
                stats["opponent_kickouts_lost"] += 1  # Opponent lost own kickout (team won it)

            # Legacy types (pre-detailed kickout tracking)
            elif event.event_type in (EventType.KICKOUT_WON, EventType.BREAKING_BALL_WON):
                stats["team_kickouts_won"] += 1
            elif event.event_type in (EventType.KICKOUT_LOST, EventType.BREAKING_BALL_LOST):
                stats["team_kickouts_lost"] += 1
            
            # Fouls — foul_committed = this team fouled, foul_won = this team was fouled
            elif event.event_type == EventType.FOUL_COMMITTED:
                stats[f"{team_prefix}_fouls"] += 1
            elif event.event_type == EventType.FOUL_WON:
                # The OTHER team fouled — foul_won is recorded for the team that WAS fouled
                other_prefix = "opponent" if team_prefix == "team" else "team"
                stats[f"{other_prefix}_fouls"] += 1

            # Cards
            elif event.event_type == EventType.YELLOW_CARD:
                stats[f"{team_prefix}_yellow_cards"] += 1
            elif event.event_type == EventType.BLACK_CARD:
                stats[f"{team_prefix}_black_cards"] += 1
            elif event.event_type == EventType.RED_CARD:
                stats[f"{team_prefix}_red_cards"] += 1
        
        # Calculate accuracy: scores / (scores + wides)
        # Wides = missed target (wide, wide_free, 45_missed). Saves/shorts excluded
        # — if the keeper stops it or it falls short, that's not inaccuracy.
        # Conversion (scores / total_shots) is calculated on the frontend.
        for team_prefix in ["team", "opponent"]:
            scores = stats[f"{team_prefix}_scores"]
            wides = stats[f"{team_prefix}_wides"]
            on_target_attempts = scores + wides
            if on_target_attempts > 0:
                stats[f"{team_prefix}_accuracy"] = (scores / on_target_attempts) * 100

        # Possession converted to shots: what share of a team's possessions
        # actually produced a shot, vs. breaking down before one was taken.
        for team_prefix in ["team", "opponent"]:
            poss_count = stats[f"{team_prefix}_possession_count"]
            shots = stats[f"{team_prefix}_total_shots"]
            if poss_count > 0:
                stats[f"{team_prefix}_poss_converted_to_shots_pct"] = round((shots / poss_count) * 100, 1)

        # Ball recovery time — avg minutes to win ball back after a loss event
        _BALL_LOSS = frozenset([EventType.TURNOVER_LOST, EventType.UNFORCED_ERROR])
        # "Own" kickout-won variants (OWN_KICKOUT_WON, OPP_KICKOUT_WON, etc.) are
        # only ever tagged team=OWN in this app's event model — when the
        # opposition wins a kickout back, it's tagged with the mirrored
        # _OPPOSITION_WON variants instead. Without those in this set, the
        # opponent side of the per-team filter below could never match a
        # kickout recovery at all, so opponent recovery time was almost
        # always None ("–" on screen) regardless of what actually happened.
        _BALL_RECOVERY = frozenset([
            EventType.TURNOVER_WON, EventType.INTERCEPTION, EventType.TACKLE_WON,
            EventType.OWN_KICKOUT_WON, EventType.OPP_KICKOUT_WON,
            EventType.KICKOUT_WON, EventType.OWN_KICKOUT_WON_BREAK,
            EventType.OPP_KICKOUT_WON_BREAK,
            EventType.OWN_KICKOUT_OPPOSITION_WON, EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.OPP_KICKOUT_OPPOSITION_WON, EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,
            EventType.GOAL, EventType.POINT, EventType.POINT_FREE,
            EventType.TWO_POINT, EventType.TWO_POINT_FREE,
            EventType.FORTY_FIVE, EventType.PENALTY_GOAL,
        ])

        def _calc_recovery(evts, team):
            timed = sorted(
                [e for e in evts if e.minute is not None and e.team == team],
                key=lambda e: e.minute,
            )
            gaps = []
            loss_min = None
            for e in timed:
                if e.event_type in _BALL_LOSS:
                    loss_min = e.minute
                elif loss_min is not None and e.event_type in _BALL_RECOVERY:
                    diff = e.minute - loss_min
                    if 0 < diff <= 10:
                        gaps.append(diff)
                    loss_min = None
            return round(sum(gaps) / len(gaps), 1) if gaps else None

        stats["team_ball_recovery_avg_min"] = _calc_recovery(events, Team.OWN)
        stats["opponent_ball_recovery_avg_min"] = _calc_recovery(events, Team.OPPONENT)

        return stats

