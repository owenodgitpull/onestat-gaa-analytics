"""
Live Match Agent — fast, concise tactical insights.

Uses Haiku for speed. Single-shot (no tool loop).
Handles: live match insights, KPI card insights.
"""

import json
import logging
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai._shared import client, GAA_ESSENTIALS, get_match_summary
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def live_match_insight(db: AsyncSession, match_id, recent_events: list) -> str:
    """
    Provide real-time tactical insight during a match.
    Optimized for speed using Haiku model.

    Uses RAG for GPS benchmarks, tactical patterns, and rule context.
    """

    # Get current match state
    summary = await get_match_summary(db, match_id)

    # Get knowledge base context via RAG
    try:
        event_types = [e.get('type', '') for e in recent_events[:5]]
        query = f"live match analysis {' '.join(event_types)} fatigue kickout tactics GPS benchmarks"
        kb_context = await RAGService.get_context_for_query(
            db, query, context_type='live_match', max_tokens=1500
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    system_prompt = f"""You are a GAA sideline analyst providing LIVE match insights for Dungloe GAA.
CRITICAL: Keep responses to 2-3 SHORT sentences MAXIMUM (under 80 words total). Be punchy and actionable — this displays in a small sidebar widget. No bullet points, no headers, no lists.

{GAA_ESSENTIALS}

## Knowledge Base Context (GPS benchmarks, tactical patterns, rules)
{kb_context}

Current match state:
{summary}

Recent events (last 5):
{json.dumps(recent_events, indent=2)}

DETECTION TRIGGERS — flag these patterns when you see them:
- Scoring run: 3+ consecutive scores without opposition reply
- Scoring drought: 10+ minutes without a score
- Kickout dominance shift: winning/losing 3+ consecutive kickouts
- Turnover crisis: 5+ turnovers in last 10 minutes
- Fatigue indicators: compare to GPS benchmarks from the knowledge base context

When a trigger fires, explain what's happening AND suggest one specific tactical adjustment.
Reference knowledge base context (GPS benchmarks, tactical principles) when available.
"""

    response = client.messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=150,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": "What's the current tactical situation and one key adjustment we should make?"
        }]
    )

    return response.content[0].text


async def generate_kpi_insights(kpi_data: dict) -> dict[str, str]:
    """
    Generate dynamic, team-specific insights for each KPI card.

    Takes the full KPI payload (cards with values, colors, trends) and returns
    a dict mapping card key → 1-sentence contextual insight.

    Uses Haiku for speed — called once per dashboard load.
    """
    try:
        cards_summary = []
        for card in kpi_data.get("cards", []):
            trend = card.get("trend", {})
            entry = (
                f"- {card['label']} ({card['key']}): {card['value']} "
                f"(format: {card['format']}, status: {card['color']})"
            )
            if trend:
                entry += (
                    f" | Recent ({trend.get('window', '?')} matches): {trend.get('recent', '?')}, "
                    f"Season avg: {trend.get('season', '?')}, "
                    f"Direction: {trend.get('direction', '?')}, "
                    f"Change: {trend.get('change_pct', '?')}%"
                )
            cards_summary.append(entry)

        meta = kpi_data.get("metadata", {})
        meta_str = (
            f"Dungloe: {meta.get('matches_played', 0)} matches played, "
            f"{meta.get('win_rate', 0)}% win rate "
            f"({meta.get('wins', 0)}W-{meta.get('losses', 0)}L-{meta.get('draws', 0)}D)"
        )

        system_prompt = f"""You are a GAA analyst for Dungloe GAA. Generate a SHORT, punchy insight for each KPI card shown on the season dashboard.

{GAA_ESSENTIALS}

## Rules
- Each insight MUST be 1 sentence, max 15 words
- Reference the TREND data — say whether it's improving, declining, or steady
- Use "we/our" voice (you're part of the coaching team)
- Be specific with numbers when the trend data shows a clear change
- If a KPI is green, be positive but not complacent. If red, be direct about the concern.
- Use GAA terminology naturally (kickouts, turnovers, frees, the posts, etc.)
- Vary your tone — don't start every insight the same way

## Examples of good insights
- "Our kickout game is flying — up 12% over the last 3 matches"
- "Discipline slipping, we're giving away 3 more frees per game recently"
- "Converting well from play but set-piece accuracy needs work"
- "Winning the turnover battle comfortably, +8 ahead on the season"

## Season Context
{meta_str}

## KPI Cards
{chr(10).join(cards_summary)}

Return ONLY valid JSON: {{"productivity": "...", "turnover_diff": "...", "kickout_retention": "...", "shot_efficiency": "...", "fouls_per_game": "...", "avg_scored": "...", "avg_conceded": "..."}}"""

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=system_prompt,
            messages=[{
                "role": "user",
                "content": "Generate the 7 KPI insights as JSON."
            }]
        )

        raw = response.content[0].text.strip()
        # Strip markdown code fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
            if raw.endswith("```"):
                raw = raw[:-3]
            raw = raw.strip()

        return json.loads(raw)

    except Exception as e:
        logger.warning(f"KPI insight generation failed: {e}")
        return {}
