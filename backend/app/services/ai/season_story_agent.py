"""
Season Story Agent — generates a narrative summary of a player's season.

Uses Haiku for speed. Single-shot (no tool loop).
Returns 2-3 flowing sentences written as a GAA journalist.
"""

import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_

from app.services.ai._shared import client
from app.models.match import Match, MatchStatus
from app.models.match_event import MatchEvent, EventType, Team
from app.models.match_gps import MatchGPSData
from app.models.player import Player
from app.models.attendance import Attendance, AttendanceStatus, TrainingSession
from app.services.leaderboard_service import LeaderboardService, SCORING_EVENTS, SHOT_EVENTS
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def generate_season_story(
    db: AsyncSession, player_id: UUID, club_id: UUID
) -> dict:
    """
    Generate a 2-3 sentence narrative about the player's season.
    Returns {"story": str | None, "generated_at": str}
    """
    try:
        # Get player name
        player_result = await db.execute(
            select(Player).where(Player.id == player_id)
        )
        player = player_result.scalar_one_or_none()
        if not player:
            return {"story": None, "generated_at": datetime.utcnow().isoformat()}

        first_name = player.name.split()[0] if player.name else "This player"

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
            return {"story": None, "generated_at": datetime.utcnow().isoformat()}

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
        played_match_ids = set(str(e.match_id) for e in events)
        matches_played = len(played_match_ids)

        if matches_played == 0:
            return {"story": None, "generated_at": datetime.utcnow().isoformat()}

        # Month-over-month scoring
        events_by_month: dict[str, dict] = {}
        for e in events:
            m = matches_map.get(str(e.match_id))
            if not m or not m.match_date:
                continue
            month_key = m.match_date.strftime("%Y-%m")
            month_name = m.match_date.strftime("%B")
            d = events_by_month.setdefault(month_key, {"name": month_name, "score": 0, "matches": set()})
            d["matches"].add(str(e.match_id))
            if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL):
                d["score"] += 3
            elif e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE):
                d["score"] += 1
            elif e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE):
                d["score"] += 2

        month_summary = []
        for mk in sorted(events_by_month.keys()):
            d = events_by_month[mk]
            month_summary.append(f"{d['name']}: {d['score']}pts in {len(d['matches'])} matches")

        # Season totals
        goals = sum(1 for e in events if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
        points = sum(1 for e in events if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
        two_ptrs = sum(1 for e in events if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
        total_score = goals * 3 + points + two_ptrs * 2
        total_shots = sum(1 for e in events if e.event_type in SHOT_EVENTS)
        total_scores = sum(1 for e in events if e.event_type in SCORING_EVENTS)
        accuracy = round(total_scores / total_shots * 100, 1) if total_shots > 0 else None

        # Defence
        turnovers_won = sum(1 for e in events if e.event_type == EventType.TURNOVER_WON)
        blocks = sum(1 for e in events if e.event_type == EventType.BLOCK)

        # GPS trend: last 3 vs previous 3
        gps_result = await db.execute(
            select(MatchGPSData).where(
                and_(
                    MatchGPSData.match_id.in_(match_ids),
                    MatchGPSData.player_id == player_id,
                )
            )
        )
        gps_rows = gps_result.scalars().all()
        gps_trend = "No GPS data"
        if len(gps_rows) >= 3:
            sorted_gps = sorted(gps_rows, key=lambda g: str(g.match_id))
            recent_3 = sorted_gps[-3:]
            prev_3 = sorted_gps[-6:-3] if len(sorted_gps) >= 6 else sorted_gps[:3]
            recent_avg = sum(g.total_distance_m or 0 for g in recent_3) / 3
            prev_avg = sum(g.total_distance_m or 0 for g in prev_3) / 3
            if prev_avg > 0:
                change = ((recent_avg - prev_avg) / prev_avg) * 100
                gps_trend = f"Distance trend: {'+' if change > 0 else ''}{change:.0f}% (recent 3 avg {recent_avg/1000:.1f}km vs previous {prev_avg/1000:.1f}km)"
            else:
                gps_trend = f"Recent avg distance: {recent_avg/1000:.1f}km"

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

        # Leaderboard ranks
        boards = await LeaderboardService.get_all_leaderboards(db, club_id, player_id)
        lb_highlights = []
        for b in boards:
            if b["my_rank"] is not None and b["my_rank"] <= 3:
                lb_highlights.append(f"#{b['my_rank']} in {b['display_name']}")

        # Recent best match
        events_by_match: dict[str, list] = {}
        for e in events:
            events_by_match.setdefault(str(e.match_id), []).append(e)

        best_score = 0
        best_opponent = None
        for mid, evts in events_by_match.items():
            g = sum(1 for e in evts if e.event_type in (EventType.GOAL, EventType.PENALTY_GOAL))
            p = sum(1 for e in evts if e.event_type in (EventType.POINT, EventType.POINT_FREE, EventType.FORTY_FIVE))
            tp = sum(1 for e in evts if e.event_type in (EventType.TWO_POINT, EventType.TWO_POINT_FREE))
            val = g * 3 + p + tp * 2
            m = matches_map.get(mid)
            if val > best_score and m:
                best_score = val
                best_opponent = m.opponent

        data_text = f"""Player: {first_name} ({matches_played} matches played)
Season total: {goals}G-{points + two_ptrs}P = {total_score}pts, accuracy {accuracy}%
Month-by-month: {'; '.join(month_summary)}
Defence: {blocks} blocks, {turnovers_won} turnovers won
GPS: {gps_trend}
Attendance: {att_rate}%
Leaderboard highlights: {', '.join(lb_highlights) if lb_highlights else 'None in top 3'}
Best match: {best_score}pts vs {best_opponent}"""

        # Get GAA knowledge base context via RAG
        kb_context = ""
        try:
            kb_context = await RAGService.get_context_for_query(
                db, "GAA player season performance narrative scoring benchmarks",
                context_type='general', max_tokens=1500
            )
        except Exception as e:
            logger.warning(f"RAG context fetch failed for season story: {e}")

        system_prompt = (
            "You are a GAA journalist writing a brief season summary for a player's personal stats page. "
            "Write exactly 2-3 sentences of flowing prose. Use the player's first name. "
            "Be specific with numbers and mention month names where relevant. "
            "Highlight their best performances and trajectory. Be encouraging but grounded in data. "
            "No bullet points, no headers, no quotation marks — just prose."
        )
        if kb_context:
            system_prompt += f"\n\nGAA Knowledge Base context:\n{kb_context}"

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": f"Write a season story for this player:\n{data_text}"
            }]
        )

        story = response.content[0].text.strip()
        return {
            "story": story,
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"Season story generation failed: {e}")
        return {"story": None, "generated_at": datetime.utcnow().isoformat()}
