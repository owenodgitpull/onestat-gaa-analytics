"""
Chat Agent — conversational interface for asking questions about matches and players.

Uses Sonnet with tool loop. Maintains conversation history.
Includes streaming variant for SSE responses.
"""

import json
import logging
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, TOOLS, execute_tool,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def chat_with_analyst(db: AsyncSession, conversation_history: list, user_message: str) -> str:
    """
    Conversational interface for asking questions about matches and players.
    Maintains conversation context.

    Uses RAG for dynamic knowledge base context.
    """

    # Get relevant knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, user_message, context_type='general', max_tokens=3000
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    # Get recent AI insight alerts for proactive reference
    insight_alerts_text = ""
    try:
        from sqlalchemy import select
        from app.models.insight_alert import InsightAlert
        alert_query = (
            select(InsightAlert)
            .where(InsightAlert.is_dismissed == False)
            .order_by(InsightAlert.created_at.desc())
            .limit(10)
        )
        alert_result = await db.execute(alert_query)
        alerts = alert_result.scalars().all()
        if alerts:
            lines = [f"- [{a.category.value}/{a.severity}] {a.title}: {a.message}" for a in alerts]
            insight_alerts_text = "\n## Recent AI Insight Alerts (reference these proactively)\n" + "\n".join(lines)
    except Exception as e:
        logger.warning(f"Insight alerts context failed: {e}")

    system_prompt = f"""You are a GAA analyst assistant for Dungloe GAA club.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_ESSENTIALS}

## Knowledge Base Context (tactics, GPS data, rules, playbooks)
{kb_context}

INSTRUCTIONS:
- Use knowledge base context to reference GPS/fitness data, rules, and tactical documents.
- Cite sources from the knowledge base when relevant (e.g., "According to the GPS report from the Ballyshannon match...").
- Compare current data to benchmarks from the knowledge base.
- Be proactive — surface relevant context without being asked.
- Reference recent AI insight alerts when relevant to the conversation.
{insight_alerts_text}
"""

    # Add new user message
    messages = conversation_history + [{"role": "user", "content": user_message}]

    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=2048,
        system=system_prompt,
        tools=TOOLS,
        messages=messages
    )

    # Process tool calls
    while response.stop_reason == "tool_use":
        tool_results = []
        assistant_content = response.content

        for block in response.content:
            if block.type == "tool_use":
                tool_result = await execute_tool(block.name, block.input, db)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result
                })

        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_results})

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )

    # Extract final text
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    return final_text


async def _build_chat_system_prompt(db: AsyncSession, user_message: str) -> str:
    """Build the system prompt with RAG context and insight alerts (shared by both chat functions)."""
    # Get relevant knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, user_message, context_type='general', max_tokens=3000
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    # Get recent AI insight alerts for proactive reference
    insight_alerts_text = ""
    try:
        from sqlalchemy import select
        from app.models.insight_alert import InsightAlert
        alert_query = (
            select(InsightAlert)
            .where(InsightAlert.is_dismissed == False)
            .order_by(InsightAlert.created_at.desc())
            .limit(10)
        )
        alert_result = await db.execute(alert_query)
        alerts = alert_result.scalars().all()
        if alerts:
            lines = [f"- [{a.category.value}/{a.severity}] {a.title}: {a.message}" for a in alerts]
            insight_alerts_text = "\n## Recent AI Insight Alerts (reference these proactively)\n" + "\n".join(lines)
    except Exception as e:
        logger.warning(f"Insight alerts context failed: {e}")

    return f"""You are a GAA analyst assistant for Dungloe GAA club.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_ESSENTIALS}

## Knowledge Base Context (tactics, GPS data, rules, playbooks)
{kb_context}

INSTRUCTIONS:
- Use knowledge base context to reference GPS/fitness data, rules, and tactical documents.
- Cite sources from the knowledge base when relevant (e.g., "According to the GPS report from the Ballyshannon match...").
- Compare current data to benchmarks from the knowledge base.
- Be proactive — surface relevant context without being asked.
- Reference recent AI insight alerts when relevant to the conversation.
- Format your responses with markdown: use **bold** for key stats, headers (##) for sections, and bullet points for lists.
{insight_alerts_text}
"""


async def chat_with_analyst_stream(
    db: AsyncSession, conversation_history: list, user_message: str
) -> AsyncGenerator[str, None]:
    """
    Streaming variant of chat_with_analyst.

    Yields SSE-formatted lines:
      data: {"type":"thinking","tool":"tool_name"}
      data: {"type":"text","content":"chunk..."}
      data: {"type":"done"}
      data: {"type":"error","message":"..."}
    """
    try:
        system_prompt = await _build_chat_system_prompt(db, user_message)
        messages = conversation_history + [{"role": "user", "content": user_message}]

        # Non-streaming tool loop phase
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )

        while response.stop_reason == "tool_use":
            tool_results = []
            assistant_content = response.content

            for block in response.content:
                if block.type == "tool_use":
                    yield f"data: {json.dumps({'type': 'thinking', 'tool': block.name})}\n\n"
                    tool_result = await execute_tool(block.name, block.input, db)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                system=system_prompt,
                tools=TOOLS,
                messages=messages
            )

        # Extract final text and stream it in chunks
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

        # Chunk the text (~15 chars each) for typing effect
        chunk_size = 15
        for i in range(0, len(final_text), chunk_size):
            chunk = final_text[i:i + chunk_size]
            yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        logger.error(f"Streaming chat failed: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
