"""
Video Enrichment Agent — generates tactical reports from tagged video events.

Uses Sonnet for quality. Single-shot (no tool loop).
Two functions:
- generate_video_match_report: Full tactical report from verified events
- enrich_video_events: Suggest missing events, flag inconsistencies
"""

import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import client, get_club_context
from app.models.video_session import VideoSession
from app.models.video_event import VideoEvent, TWO_POINTER_ZONES, SCORING_EVENT_TYPES
from app.models.match import Match
from app.models.player import Player

logger = logging.getLogger(__name__)


def _build_events_summary(events: list[VideoEvent]) -> str:
    """Build a structured text summary of video events for the LLM."""
    lines = []
    team_a_score = {"goals": 0, "points": 0, "two_pointers": 0}
    team_b_score = {"goals": 0, "points": 0, "two_pointers": 0}

    for e in events:
        player_name = e.player.name if e.player else f"#{e.jersey_number}" if e.jersey_number else "Unknown"
        time_str = f"{e.match_minute}:{e.match_second:02d}"
        zone_str = f" [{e.pitch_zone}]" if e.pitch_zone else ""
        two_pt = ""

        # Track scores
        if e.event_type == "GOAL_SCORED":
            if e.team == "team_a":
                team_a_score["goals"] += 1
            else:
                team_b_score["goals"] += 1
        elif e.event_type in ("POINT_SCORED", "FREE_KICK", "FORTY_FIVE") and e.scoring_context:
            is_two_pt = e.scoring_context.get("is_two_pointer", False)
            scored = e.scoring_context.get("scored", True) if e.event_type != "POINT_SCORED" else True
            if scored:
                score = team_a_score if e.team == "team_a" else team_b_score
                if is_two_pt:
                    score["two_pointers"] += 1
                    two_pt = " (2pt)"
                score["points"] += 2 if is_two_pt else 1

        desc = f"  {e.half}H {time_str} | {e.team} | {e.event_type}{two_pt} | {player_name}{zone_str}"
        if e.description:
            desc += f" — {e.description}"
        lines.append(desc)

    # Score summary
    a_total = team_a_score["goals"] * 3 + team_a_score["points"]
    b_total = team_b_score["goals"] * 3 + team_b_score["points"]
    score_line = (
        f"Score: Team A {team_a_score['goals']}-{team_a_score['points']:02d} ({a_total}) "
        f"vs Team B {team_b_score['goals']}-{team_b_score['points']:02d} ({b_total})"
    )
    two_pt_line = (
        f"Two-pointers: Team A={team_a_score['two_pointers']}, Team B={team_b_score['two_pointers']}"
    )

    # Event type distribution
    type_counts = {}
    for e in events:
        type_counts[e.event_type] = type_counts.get(e.event_type, 0) + 1
    dist_line = "Event distribution: " + ", ".join(f"{k}={v}" for k, v in sorted(type_counts.items()))

    return f"""{score_line}
{two_pt_line}
{dist_line}
Total events: {len(events)}

Events timeline:
{chr(10).join(lines)}"""


async def generate_video_match_report(db: AsyncSession, session_id: UUID) -> str:
    """
    Generate a tactical report from video-tagged events.

    Uses Sonnet for quality analysis. Single-shot.
    Returns the report text, or an error message on failure.
    """
    try:
        # Load session with events
        result = await db.execute(
            select(VideoSession).where(VideoSession.id == session_id)
        )
        session = result.scalar_one_or_none()
        if not session:
            return "Error: Video session not found"

        # Load match info
        match_result = await db.execute(
            select(Match).where(Match.id == session.match_id)
        )
        match = match_result.scalar_one_or_none()

        # Get events ordered by time
        events_result = await db.execute(
            select(VideoEvent)
            .where(VideoEvent.video_session_id == session_id)
            .order_by(VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
        )
        events = events_result.scalars().all()

        if not events:
            return "No events to analyze."

        events_summary = _build_events_summary(events)
        club_name, _ = await get_club_context(db, match.club_id if match else None)
        match_context = ""
        if match:
            match_context = f"Match: {club_name} vs {match.opponent}, {match.match_date.strftime('%d %b %Y')}, Venue: {match.venue.value if match.venue else 'unknown'}"

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=2000,
            system=f"""You are a GAA tactical analyst for {club_name}. Analyze match events tagged from video.

Write a structured tactical report covering:
1. **Score Summary** — final score with GAA notation (G-PP), two-pointer breakdown
2. **Scoring Efficiency** — conversion rate (scores/shots), two-pointer accuracy
3. **Possession Analysis** — estimate possession % from event frequency, territory
4. **Kickout Analysis** — own and opposition kickout outcomes
5. **Key Players** — standout performers based on event involvement
6. **Defensive Performance** — tackles, blocks, interceptions, turnovers won
7. **Tactical Observations** — patterns in attack/defense, zones of dominance
8. **Areas for Improvement** — specific actionable items

Two-pointers are points scored from outside the 40m arc (zones DEF_*, MID_*, HF_*).
Be specific with numbers. Use GAA terminology.""",
            messages=[{
                "role": "user",
                "content": f"{match_context}\nVideo: {session.title} (Half {session.half or 'full'})\n\n{events_summary}"
            }]
        )

        report = response.content[0].text
        logger.info(f"Generated video match report for session {session_id}")
        return report

    except Exception as e:
        logger.error(f"Video match report generation failed: {e}")
        return f"Error generating report: {str(e)}"


async def enrich_video_events(db: AsyncSession, session_id: UUID) -> dict:
    """
    Analyze tagged events and suggest improvements.

    Uses Sonnet. Returns suggestions for missing events and inconsistencies.
    """
    try:
        events_result = await db.execute(
            select(VideoEvent)
            .where(VideoEvent.video_session_id == session_id)
            .order_by(VideoEvent.match_minute.asc(), VideoEvent.match_second.asc())
        )
        events = events_result.scalars().all()

        if not events:
            return {"suggestions": [], "message": "No events to analyze"}

        events_summary = _build_events_summary(events)

        response = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=1500,
            system="""You are a GAA match analyst reviewing tagged events from video analysis.
Identify potential issues:
1. Missing kickouts after scores (every score should be followed by a kickout)
2. Score progression inconsistencies
3. Time gaps that might indicate missed events
4. Possession chains that don't have clear outcomes
5. Two-pointer flags that don't match the pitch zone

Return a JSON array of suggestions:
[{"type": "missing_event", "after_minute": 15, "description": "Expected kickout after point scored at 15:00"},
 {"type": "inconsistency", "minute": 23, "description": "Two-pointer flagged but zone is FWD_CENTRE (inside 40m)"},
 {"type": "gap", "from_minute": 30, "to_minute": 35, "description": "5-minute gap with no events"}]

Return ONLY the JSON array, no other text.""",
            messages=[{
                "role": "user",
                "content": f"Review these tagged events for issues:\n\n{events_summary}"
            }]
        )

        import json
        text = response.content[0].text.strip()
        # Handle potential markdown code blocks
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        suggestions = json.loads(text)

        return {"suggestions": suggestions, "message": f"Found {len(suggestions)} suggestions"}

    except Exception as e:
        logger.error(f"Video event enrichment failed: {e}")
        return {"suggestions": [], "message": f"Error: {str(e)}"}
