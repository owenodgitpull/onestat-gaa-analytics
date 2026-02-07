"""
Live Match Agent — fast, concise tactical insights during a live match.

Uses Haiku for speed. Single-shot (no tool loop).
"""

import json
import logging
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai._shared import client, GAA_ESSENTIALS, get_match_summary
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def live_match_insight(db: AsyncSession, match_id: str, recent_events: list) -> str:
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
Keep responses to 2-3 sentences max. Be actionable, not descriptive.

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
        model="claude-3-5-haiku-20241022",
        max_tokens=300,
        system=system_prompt,
        messages=[{
            "role": "user",
            "content": "What's the current tactical situation and one key adjustment we should make?"
        }]
    )

    return response.content[0].text
