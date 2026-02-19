"""
Player Insights Agent — personalized AI insights for the player portal.

Uses Haiku for speed. Single-shot (no tool loop).
Mirrors the training_agent.py pattern.
"""

import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func

from app.services.ai._shared import client
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.services.leaderboard_service import (
    LeaderboardService,
    SCORING_EVENTS,
    SHOT_EVENTS,
)

logger = logging.getLogger(__name__)


async def generate_player_insights(
    db: AsyncSession, player_id: UUID, club_id: UUID
) -> dict:
    """
    Generate 3-5 personalized AI insight bullets for a player.
    Uses Haiku for fast, cheap inference.

    Returns {"insights": [...], "generated_at": str} or {"insights": []} on failure.
    """
    try:
        # --- Gather data ---

        # Completed matches
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
            return {"insights": [], "generated_at": datetime.utcnow().isoformat()}

        match_ids = [m.id for m in matches]
        matches_map = {str(m.id): m for m in matches}

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
            return {"insights": [], "generated_at": datetime.utcnow().isoformat()}

        # Scoring
        goals = sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        points = sum(1 for e in events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        two_ptrs = sum(1 for e in events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        total_score = goals * 3 + points + two_ptrs * 2
        total_shots = sum(1 for e in events if e.event_type in SHOT_EVENTS)
        total_scores = sum(1 for e in events if e.event_type in SCORING_EVENTS)
        accuracy = round(total_scores / total_shots * 100, 1) if total_shots > 0 else None

        # Defence
        turnovers_won = sum(1 for e in events if e.event_type == EventType.TURNOVER_WON)
        turnovers_lost = sum(1 for e in events if e.event_type == EventType.TURNOVER_LOST)
        blocks = sum(1 for e in events if e.event_type == EventType.BLOCK)
        interceptions = sum(1 for e in events if e.event_type == EventType.INTERCEPTION)

        # Recent form (last 3 matches)
        events_by_match: dict[str, list] = {}
        for e in events:
            events_by_match.setdefault(str(e.match_id), []).append(e)
        played_match_ids = set(str(e.match_id) for e in events)
        recent_matches = [m for m in reversed(matches) if str(m.id) in played_match_ids][:3]
        recent_form = []
        for m in recent_matches:
            mid = str(m.id)
            m_events = events_by_match.get(mid, [])
            g = sum(1 for e in m_events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
            p = sum(1 for e in m_events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
            tp = sum(1 for e in m_events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
            val = g * 3 + p + tp * 2
            recent_form.append(f"vs {m.opponent}: {g}-{p+tp} ({val}pts)")

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
        gps_summary = "No GPS data"
        if gps_rows:
            dists = [g.total_distance_m for g in gps_rows if g.total_distance_m]
            sprints = [g.sprint_count for g in gps_rows if g.sprint_count is not None]
            speeds = [g.max_speed_ms for g in gps_rows if g.max_speed_ms]
            avg_dist = round(sum(dists) / len(dists) / 1000, 2) if dists else 0
            avg_sprints = round(sum(sprints) / len(sprints), 1) if sprints else 0
            top_speed = round(max(speeds) * 3.6, 1) if speeds else 0
            gps_summary = f"Avg {avg_dist}km/match, {avg_sprints} sprints/match, top speed {top_speed}km/h ({len(gps_rows)} matches with GPS)"

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

        # Leaderboard positions
        boards = await LeaderboardService.get_all_leaderboards(db, club_id, player_id)
        lb_summary = []
        for b in boards:
            if b["my_rank"] is not None:
                lb_summary.append(f"{b['display_name']}: #{b['my_rank']}/{b['total_players']} ({b['my_value']} {b['unit']})")

        # --- Build prompt ---
        data_text = f"""Player season stats ({matches_played} matches played out of {len(matches)} total):
- Scoring: {goals}G {points}P {two_ptrs}×2pt = {total_score}pts total
- Accuracy: {accuracy}% ({total_scores}/{total_shots} shots)
- Defence: {blocks} blocks, {interceptions} interceptions, {turnovers_won} turnovers won, {turnovers_lost} turnovers lost
- GPS: {gps_summary}
- Attendance: {att_rate}%
- Recent form: {', '.join(recent_form) if recent_form else 'No recent data'}
- Leaderboard positions: {'; '.join(lb_summary) if lb_summary else 'No rankings yet'}"""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            system=(
                "You are a GAA performance analyst giving personalized insights to a player. "
                "Return exactly 3-5 bullet points. Each bullet should be a single sentence with a specific stat. "
                "Highlight strengths, areas for improvement, and comparisons to squad rankings. "
                "Be encouraging but honest. Use concrete numbers. No headers or formatting — just bullet points."
            ),
            messages=[{
                "role": "user",
                "content": f"Generate personalized insights for this player:\n{data_text}"
            }]
        )

        raw = response.content[0].text
        # Parse bullets (handle both "- " and "• " prefixes)
        insights = []
        for line in raw.strip().split("\n"):
            line = line.strip()
            if line.startswith(("- ", "• ", "* ")):
                line = line[2:].strip()
            if line:
                insights.append(line)

        return {
            "insights": insights[:5],
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"Player insights generation failed: {e}")
        return {"insights": [], "generated_at": datetime.utcnow().isoformat()}
