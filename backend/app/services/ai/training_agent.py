"""
Training Agent — lightweight AI summary after training GPS uploads.

Uses Haiku for speed. Single-shot (no tool loop).
Mirrors the live_match_agent.py pattern.
"""

import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import client
from app.models.training_performance import TrainingGPSData
from app.models.player import Player

logger = logging.getLogger(__name__)


async def analyze_training_session(db: AsyncSession, session_id: str) -> dict:
    """
    Generate a 1-2 sentence AI summary of a training GPS session.
    Uses Haiku for fast, cheap inference.

    Returns {"summary": str, "generated_at": str} or {"summary": None} on failure.
    """
    try:
        from uuid import UUID
        sid = UUID(session_id)

        # Get GPS data for the session joined with player names
        result = await db.execute(
            select(TrainingGPSData, Player.name)
            .join(Player, TrainingGPSData.player_id == Player.id)
            .where(TrainingGPSData.session_id == sid)
        )
        rows = result.all()

        if not rows:
            return {"summary": None}

        # Compute aggregates
        distances = [r[0].total_distance_m for r in rows if r[0].total_distance_m]
        hsrs = [r[0].high_speed_running_m for r in rows if r[0].high_speed_running_m]
        sprints = [r[0].sprint_count for r in rows if r[0].sprint_count]
        dsls = [r[0].dynamic_stress_load for r in rows if r[0].dynamic_stress_load]

        n = len(rows)
        avg_dist = round(sum(distances) / len(distances)) if distances else 0
        avg_hsr = round(sum(hsrs) / len(hsrs)) if hsrs else 0
        avg_sprints = round(sum(sprints) / len(sprints)) if sprints else 0
        avg_dsl = round(sum(dsls) / len(dsls)) if dsls else 0

        # Find top performers by distance
        sorted_by_dist = sorted(rows, key=lambda r: r[0].total_distance_m or 0, reverse=True)
        top_performers = [
            f"{r[1]}: {round(r[0].total_distance_m or 0)}m"
            for r in sorted_by_dist[:3]
        ]

        data_summary = f"""Training session GPS data ({n} players):
- Avg distance: {avg_dist}m
- Avg HSR: {avg_hsr}m
- Avg sprints: {avg_sprints}
- Avg DSL: {avg_dsl}
- Top performers (distance): {', '.join(top_performers)}"""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system="You are a GAA strength & conditioning analyst for Dungloe GAA. "
                   "Give a 1-2 sentence training session summary. Be specific with numbers. "
                   "Mention standout performers or concerns if any.",
            messages=[{
                "role": "user",
                "content": f"Summarize this training session:\n{data_summary}"
            }]
        )

        summary = response.content[0].text
        return {
            "summary": summary,
            "generated_at": datetime.utcnow().isoformat()
        }

    except Exception as e:
        logger.error(f"Training session analysis failed: {e}")
        return {"summary": None}
