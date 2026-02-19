"""
Challenge Agent — generates personalized weekly challenges for players.

Uses Haiku for speed. Single-shot (no tool loop).
Mirrors the player_insights_agent.py data-gathering pattern.
"""

import json
import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.services.ai._shared import client
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.services.leaderboard_service import SCORING_EVENTS, SHOT_EVENTS
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def generate_player_challenges(
    db: AsyncSession, player_id: UUID, club_id: UUID
) -> list[dict]:
    """
    Generate 2-3 personalized challenges for a player.
    Returns list of dicts with: title, description, category, metric_key, target_value, evaluation_window
    """
    try:
        # --- Gather data (same pattern as player_insights_agent) ---
        match_result = await db.execute(
            select(Match).where(
                and_(
                    Match.club_id == club_id,
                    Match.status == MatchStatus.COMPLETED,
                    Match.is_deleted == False,
                )
            ).order_by(Match.match_date.asc())
        )
        matches = match_result.scalars().all()
        if not matches:
            return _fallback_challenges()

        match_ids = [m.id for m in matches]

        # Player events
        ev_result = await db.execute(
            select(MatchEvent).where(
                and_(
                    MatchEvent.match_id.in_(match_ids),
                    MatchEvent.team == Team.OWN,
                    MatchEvent.player_id == player_id,
                )
            )
        )
        events = ev_result.scalars().all()
        matches_played = len(set(str(e.match_id) for e in events))

        if matches_played == 0:
            return _fallback_challenges()

        # Scoring
        goals = sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        points = sum(1 for e in events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        two_ptrs = sum(1 for e in events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        total_shots = sum(1 for e in events if e.event_type in SHOT_EVENTS)
        total_scores = sum(1 for e in events if e.event_type in SCORING_EVENTS)
        accuracy = round(total_scores / total_shots * 100, 1) if total_shots > 0 else None

        # Defence
        turnovers_won = sum(1 for e in events if e.event_type == EventType.TURNOVER_WON)
        turnovers_lost = sum(1 for e in events if e.event_type == EventType.TURNOVER_LOST)
        blocks = sum(1 for e in events if e.event_type == EventType.BLOCK)

        # GPS averages
        gps_result = await db.execute(
            select(MatchGPSData).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.player_id == player_id,
                )
            )
        )
        gps_rows = gps_result.scalars().all()
        avg_dist = None
        avg_sprints = None
        if gps_rows:
            dists = [g.total_distance_m for g in gps_rows if g.total_distance_m]
            sprints = [g.sprint_count for g in gps_rows if g.sprint_count is not None]
            if dists:
                avg_dist = round(sum(dists) / len(dists))
            if sprints:
                avg_sprints = round(sum(sprints) / len(sprints), 1)

        # Attendance
        sessions_result = await db.execute(
            select(TrainingSession.id).where(TrainingSession.club_id == club_id)
        )
        session_ids = [r[0] for r in sessions_result.all()]
        att_rate = None
        if session_ids:
            att_result = await db.execute(
                select(Attendance).where(
                    and_(
                        Attendance.session_id.in_(session_ids),
                        Attendance.player_id == player_id,
                    )
                )
            )
            records = att_result.scalars().all()
            total_att = len(records)
            present = sum(1 for r in records if r.status in (AttendanceStatus.PRESENT, AttendanceStatus.LATE))
            att_rate = round(present / total_att * 100, 1) if total_att > 0 else None

        # Per-match averages
        goals_per = round(goals / matches_played, 2)
        pts_per = round(points / matches_played, 2)
        to_won_per = round(turnovers_won / matches_played, 2)
        blocks_per = round(blocks / matches_played, 2)

        data_text = f"""Player stats ({matches_played} matches):
- Scoring: {goals}G, {points}P, {two_ptrs}×2pt ({goals_per} goals/match, {pts_per} pts/match)
- Accuracy: {accuracy}% ({total_scores}/{total_shots} shots)
- Defence: {blocks} blocks ({blocks_per}/match), {turnovers_won} TO won ({to_won_per}/match), {turnovers_lost} TO lost
- GPS: avg distance {avg_dist}m, avg sprints {avg_sprints}
- Attendance: {att_rate}%"""

        # Get GAA knowledge base context via RAG
        kb_context = ""
        try:
            kb_context = await RAGService.get_context_for_query(
                db, "GAA player performance goals targets scoring benchmarks training",
                context_type='general', max_tokens=1500
            )
        except Exception as e:
            logger.warning(f"RAG context fetch failed for challenges: {e}")

        system_prompt = (
            "You generate weekly performance challenges for GAA (Gaelic football) players. "
            "You understand that in GAA, goals are rare and valuable — most club players average "
            "0-1 goals per match. Points (from play and frees) are far more common. "
            "A typical forward might score 0-3 to 0-5 per match; a defender might score 0-1 at most.\n\n"
        )
        if kb_context:
            system_prompt += f"GAA Knowledge Base context:\n{kb_context}\n\n"
        system_prompt += (
            "IMPORTANT REALISM RULES:\n"
            "- Challenges are evaluated as CUMULATIVE TOTALS across the evaluation_window, not per-match.\n"
            "- target_value is the TOTAL across all matches in the window, not a per-match rate.\n"
            "- A goal challenge should be 'Score a goal in your next 3 matches' (target=1 over 3), "
            "NOT 'Score 2 goals per match'.\n"
            "- For points: if a player averages 2pts/match, a good challenge is 8pts over next 3 matches.\n"
            "- For turnovers: if they average 1/match, a good challenge is 4 over next 3.\n"
            "- Attendance streak challenges should use small windows (3-5 sessions).\n\n"
            "Return ONLY a JSON array of 2-3 challenge objects. Each object must have:\n"
            '- "title": short actionable challenge (max 80 chars)\n'
            '- "description": 1 sentence of context\n'
            '- "category": one of "scoring", "fitness", "attendance", "defence"\n'
            '- "metric_key": one of "goals_from_play", "points_from_play", "total_score_value", '
            '"shooting_accuracy", "turnovers_won", "blocks", "total_distance_m", '
            '"sprint_count", "attendance_streak"\n'
            '- "target_value": numeric CUMULATIVE threshold across the window (realistic for GAA)\n'
            '- "evaluation_window": number of matches/sessions to evaluate over (2-5)\n\n'
            "Base targets on the player's actual averages. Mix categories. No markdown, just JSON."
        )

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=500,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Generate challenges for this player:\n{data_text}"
            }]
        )

        raw = response.content[0].text.strip()
        # Extract JSON array from response
        start = raw.find('[')
        end = raw.rfind(']') + 1
        if start == -1 or end == 0:
            logger.warning("Challenge agent returned no JSON array, using fallback")
            return _fallback_challenges()

        challenges = json.loads(raw[start:end])

        # Validate structure
        valid = []
        for c in challenges:
            if all(k in c for k in ("title", "category", "metric_key", "target_value", "evaluation_window")):
                valid.append({
                    "title": str(c["title"])[:200],
                    "description": str(c.get("description", ""))[:500] or None,
                    "category": str(c["category"])[:20],
                    "metric_key": str(c["metric_key"])[:50],
                    "target_value": float(c["target_value"]),
                    "evaluation_window": int(c["evaluation_window"]),
                })

        return valid if valid else _fallback_challenges()

    except Exception as e:
        logger.error(f"Challenge generation failed: {e}")
        return _fallback_challenges()


def _fallback_challenges() -> list[dict]:
    """Static fallback challenges if AI generation fails."""
    return [
        {
            "title": "Score in your next 2 matches",
            "description": "Register at least 1 point from play in each of your next 2 appearances.",
            "category": "scoring",
            "metric_key": "total_score_value",
            "target_value": 2.0,
            "evaluation_window": 2,
        },
        {
            "title": "Win 3 turnovers this week",
            "description": "Force turnovers through pressure and positioning.",
            "category": "defence",
            "metric_key": "turnovers_won",
            "target_value": 3.0,
            "evaluation_window": 3,
        },
    ]
