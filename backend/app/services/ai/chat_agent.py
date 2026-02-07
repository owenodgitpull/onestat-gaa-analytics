"""
Chat Agent — conversational interface for asking questions about matches and players.

Uses Sonnet with tool loop. Maintains conversation history.
"""

import logging
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
