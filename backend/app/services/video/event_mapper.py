"""
Bidirectional mapper between VideoEvent types (37 universal) and MatchEvent.EventType (40 existing).

Used to sync verified video events back into the MatchEvent table for existing
analytics compatibility. Handles two-pointer logic: VideoEvent uses zone-based
detection, MatchEvent uses coordinate-based detection.
"""

from typing import Optional, Tuple
from app.models.match_event import EventType, Team
from app.models.video_event import TWO_POINTER_ZONES


class VideoEventMapper:
    """Maps between VideoEvent string types and MatchEvent EventType enum."""

    # VideoEvent type → MatchEvent EventType
    # Some mappings are context-dependent (scoring events depend on is_two_pointer)
    _TO_MATCH_EVENT = {
        # Scoring — context-dependent, handled in to_match_event_type()
        "GOAL_SCORED": EventType.GOAL,
        "WIDE": EventType.WIDE,
        "SHORT": EventType.SHORT,

        # Turnovers
        "TURNOVER_WON": EventType.TURNOVER_WON,
        "TURNOVER_LOST": EventType.TURNOVER_LOST,

        # Defensive
        "BLOCK_SHOT": EventType.BLOCK,
        "BLOCK_PASS": EventType.BLOCK,
        "INTERCEPTION": EventType.INTERCEPTION,

        # Cards
        "YELLOW_CARD": EventType.YELLOW_CARD,
        "RED_CARD": EventType.RED_CARD,
        "BLACK_CARD": EventType.BLACK_CARD,

        # Frees — context-dependent, handled in to_match_event_type()
        "FORTY_FIVE": EventType.FORTY_FIVE,

        # Substitutions
        "SUB_ON": EventType.SUBSTITUTION,
        "SUB_OFF": EventType.SUBSTITUTION,

        # Fouls
        "FREE_KICK": EventType.FREE_WON,

        # Unforced error
        "SPOIL": EventType.OTHER,
        "HOOK": EventType.OTHER,
        # Quick pass log (hand pass, and long kick pass) — no dedicated
        # MatchEvent equivalent, kept as OTHER so "Save to Match" doesn't
        # silently drop them like every other genuinely-unmapped type does.
        "PASS_HAND": EventType.OTHER,
        "PASS_KICK": EventType.OTHER,
        # Open-play sideline ball possession decision — distinct from
        # SIDELINE_KICK (a kickout restart going straight out), no direct
        # MatchEvent equivalent, kept for possession-flip bookkeeping only.
        "SIDELINE_BALL": EventType.OTHER,

        # Kickouts — granular types map directly
        "OWN_KICKOUT_WON": EventType.OWN_KICKOUT_WON,
        "OWN_KICKOUT_OPPOSITION_WON": EventType.OWN_KICKOUT_OPPOSITION_WON,
        "OWN_KICKOUT_WON_BREAK": EventType.OWN_KICKOUT_WON_BREAK,
        "OWN_KICKOUT_OPPOSITION_WON_BREAK": EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK,
        "OPP_KICKOUT_WON": EventType.OPP_KICKOUT_WON,
        "OPP_KICKOUT_OPPOSITION_WON": EventType.OPP_KICKOUT_OPPOSITION_WON,
        "OPP_KICKOUT_WON_BREAK": EventType.OPP_KICKOUT_WON_BREAK,
        "OPP_KICKOUT_OPPOSITION_WON_BREAK": EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK,

        # Unforced errors
        "OUR_UNFORCED_ERROR": EventType.UNFORCED_ERROR,
        "OPP_UNFORCED_ERROR": EventType.UNFORCED_ERROR,
    }

    # MatchEvent EventType → VideoEvent type (reverse mapping)
    _FROM_MATCH_EVENT = {
        EventType.GOAL: "GOAL_SCORED",
        EventType.POINT: "POINT_SCORED",
        EventType.TWO_POINT: "POINT_SCORED",  # + is_two_pointer=true
        EventType.WIDE: "WIDE",
        EventType.SHORT: "SHORT",
        EventType.SAVED: "GOAL_CHANCE",
        EventType.TURNOVER_WON: "TURNOVER_WON",
        EventType.TURNOVER_LOST: "TURNOVER_LOST",
        EventType.UNFORCED_ERROR: "TURNOVER_LOST",
        EventType.YELLOW_CARD: "YELLOW_CARD",
        EventType.RED_CARD: "RED_CARD",
        EventType.BLACK_CARD: "BLACK_CARD",
        EventType.FREE_WON: "FREE_KICK",
        EventType.FREE_CONCEDED: "FREE_KICK",
        EventType.FOUL_COMMITTED: "FREE_KICK",
        EventType.FOUL_WON: "FREE_KICK",
        EventType.POINT_FREE: "FREE_KICK",  # + scoring_context
        EventType.TWO_POINT_FREE: "FREE_KICK",  # + scoring_context + is_two_pointer
        EventType.WIDE_FREE: "FREE_KICK",  # + scoring_context
        EventType.FORTY_FIVE: "FORTY_FIVE",
        EventType.FORTY_FIVE_MISSED: "FORTY_FIVE",
        EventType.PENALTY_GOAL: "PENALTY",
        EventType.PENALTY_MISS: "PENALTY",
        EventType.BLOCK: "BLOCK_SHOT",
        EventType.INTERCEPTION: "INTERCEPTION",
        EventType.SUBSTITUTION: "SUB_ON",
        EventType.OTHER: "WATER_BREAK",

        # Kickouts (legacy simplified)
        EventType.KICKOUT_WON: "KICKOUT_SHORT",
        EventType.KICKOUT_LOST: "KICKOUT_LONG",
        # Kickouts (granular — map to granular video types)
        EventType.OWN_KICKOUT_WON: "OWN_KICKOUT_WON",
        EventType.OWN_KICKOUT_OPPOSITION_WON: "OWN_KICKOUT_OPPOSITION_WON",
        EventType.OWN_KICKOUT_WON_BREAK: "OWN_KICKOUT_WON_BREAK",
        EventType.OWN_KICKOUT_OPPOSITION_WON_BREAK: "OWN_KICKOUT_OPPOSITION_WON_BREAK",
        EventType.OPP_KICKOUT_WON: "OPP_KICKOUT_WON",
        EventType.OPP_KICKOUT_OPPOSITION_WON: "OPP_KICKOUT_OPPOSITION_WON",
        EventType.OPP_KICKOUT_WON_BREAK: "OPP_KICKOUT_WON_BREAK",
        EventType.OPP_KICKOUT_OPPOSITION_WON_BREAK: "OPP_KICKOUT_OPPOSITION_WON_BREAK",
        EventType.BREAKING_BALL_WON: "BALL_WON",
        EventType.BREAKING_BALL_LOST: "TURNOVER_LOST",
    }

    @classmethod
    def to_match_event_type(
        cls,
        video_event_type: str,
        scoring_context: Optional[dict] = None,
        pitch_zone: Optional[str] = None,
    ) -> Optional[EventType]:
        """
        Map a VideoEvent type to a MatchEvent EventType.

        Scoring events are context-dependent:
        - POINT_SCORED + is_two_pointer → TWO_POINT
        - POINT_SCORED + source=FROM_FREE + is_two_pointer → TWO_POINT_FREE
        - POINT_SCORED + source=FROM_FREE → POINT_FREE
        - POINT_SCORED → POINT
        - PENALTY + scored → PENALTY_GOAL
        - PENALTY + missed → PENALTY_MISS
        """
        ctx = scoring_context or {}
        is_two_pointer = ctx.get("is_two_pointer", False)

        # If zone provided but is_two_pointer not set, derive from zone
        if not is_two_pointer and pitch_zone:
            is_two_pointer = pitch_zone in TWO_POINTER_ZONES

        if video_event_type == "POINT_SCORED":
            source = ctx.get("source", "")
            if source == "FROM_FREE":
                return EventType.TWO_POINT_FREE if is_two_pointer else EventType.POINT_FREE
            return EventType.TWO_POINT if is_two_pointer else EventType.POINT

        if video_event_type == "FREE_KICK":
            # Free kick that resulted in a score
            if ctx.get("scored"):
                return EventType.TWO_POINT_FREE if is_two_pointer else EventType.POINT_FREE
            if ctx.get("wide"):
                return EventType.WIDE_FREE
            return EventType.FREE_WON

        if video_event_type == "FORTY_FIVE":
            if ctx.get("scored"):
                return EventType.FORTY_FIVE
            return EventType.FORTY_FIVE_MISSED

        if video_event_type == "PENALTY":
            if ctx.get("scored"):
                return EventType.PENALTY_GOAL
            return EventType.PENALTY_MISS

        return cls._TO_MATCH_EVENT.get(video_event_type)

    @classmethod
    def to_video_event_type(
        cls,
        match_event_type: EventType,
    ) -> Tuple[str, Optional[dict]]:
        """
        Map a MatchEvent EventType to a VideoEvent type + scoring_context.

        Returns:
            (video_event_type, scoring_context) tuple.
            scoring_context is None for non-scoring events.
        """
        video_type = cls._FROM_MATCH_EVENT.get(match_event_type, "WATER_BREAK")

        scoring_context = None
        if match_event_type == EventType.TWO_POINT:
            scoring_context = {"is_two_pointer": True}
        elif match_event_type == EventType.POINT_FREE:
            scoring_context = {"source": "FROM_FREE"}
            video_type = "POINT_SCORED"
        elif match_event_type == EventType.TWO_POINT_FREE:
            scoring_context = {"source": "FROM_FREE", "is_two_pointer": True}
            video_type = "POINT_SCORED"
        elif match_event_type == EventType.WIDE_FREE:
            scoring_context = {"wide": True, "source": "FROM_FREE"}
        elif match_event_type == EventType.PENALTY_GOAL:
            scoring_context = {"scored": True}
        elif match_event_type == EventType.PENALTY_MISS:
            scoring_context = {"scored": False}
        elif match_event_type == EventType.FORTY_FIVE:
            scoring_context = {"scored": True}
        elif match_event_type == EventType.FORTY_FIVE_MISSED:
            scoring_context = {"scored": False}

        return video_type, scoring_context

    @classmethod
    def video_team_to_match_team(cls, video_team: str) -> Team:
        """Map video team string to MatchEvent Team enum. team_a = our own
        team by convention (see VideoEvent model comments) — a plain 1:1
        mapping, nothing context-dependent.

        This used to take an `is_own_team` flag that every call site derived
        as `(video_team == "team_a")` — i.e. always true when video_team is
        "team_a" and always false otherwise, making the two branches below
        it collapse to: team_a -> OWN either way, but team_b -> OWN in BOTH
        branches too (self-canceling logic bug). Every synced opponent event
        was being recorded as our own team's event. Confirmed by hand-tracing
        both branches against the only call pattern actually used.
        """
        return Team.OWN if video_team == "team_a" else Team.OPPONENT
