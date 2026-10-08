"""
Chat Agent — conversational interface for asking questions about matches and players.

Uses Sonnet with tool loop. Maintains conversation history.
Includes streaming variant for SSE responses.
Supports prompt caching and sliding window with summary for long conversations.
"""

import asyncio
import json
import logging
import time
from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, TOOLS, execute_tool, get_cached_tools,
    get_fixture_context, get_weather_context, get_club_context,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

SLIDING_WINDOW_SIZE = 10

# A conversation was reported hanging forever with no response and nothing
# ever persisted to chat_session_messages — traced to a misspelled opponent
# name ("McCuamhills" for "MacCumhaills") sending Claude into a tool-use loop
# with no exit condition other than Claude itself deciding to stop calling
# tools, which it apparently never did. Two independent caps fix this:
# MAX_TOOL_ITERATIONS bounds the loop itself, and CLAUDE_CALL_TIMEOUT_SECONDS
# bounds each individual API call (the SDK's own default is ~10 minutes,
# far too long for a chat UI where "never hang" was the explicit ask).
# Increased 2026-10-01 to handle complex multi-dimensional queries (e.g.
# "analyze first half vs second half performance across possession chains,
# ball recovery time, and transition speeds for the whole season") which
# legitimately need 10+ tool calls to gather all the data.
MAX_TOOL_ITERATIONS = 15
CLAUDE_CALL_TIMEOUT_SECONDS = 60
FALLBACK_MESSAGE = (
    "I wasn't able to pin that down after checking a few different angles — "
    "could you double-check the spelling (e.g. of a team or player name) or "
    "rephrase the question?"
)

# execute_tool() itself had no timeout at all — only the Claude API calls
# either side of it did. A slow tool (web_search in particular: DDGS falls
# back across several search engines internally with no timeout of its own)
# could silently stall the SSE stream for a minute or more with zero bytes
# sent to the browser, which is long enough to trip a proxy/browser idle-
# connection timeout — the chat UI would show an error while this coroutine
# kept running server-side and only finished (and got persisted) after the
# connection was already gone, hence the "it errors, then the answer shows
# up later after a reload" report. Timing the tool call out and feeding
# Claude a "this tool timed out" result lets the turn finish and stream a
# real answer either way, instead of leaving the request to hang or die.
# Increased to 45s (2026-10-01) for complex queries like get_ball_carrier_data
# and possession chain analysis across full matches.
TOOL_EXECUTION_TIMEOUT_SECONDS = 45

# Per-step timeouts (Claude call, tool call) bound each individual step, but
# nothing bounded the WHOLE turn — a query needing 2-3 tool rounds (common:
# search_players -> get_player_season_stats -> generate_chart, or an
# opposition-briefing-style question that calls web_search more than once)
# could legitimately run past a minute even with every step behaving. That's
# long enough that something between the browser and this server (a proxy,
# the browser's own connection handling, a flaky mobile network) eventually
# gives up and the frontend shows "Failed to get response" or just hangs,
# while this coroutine is still working correctly the whole time. Once
# elapsed time crosses this budget, the loop stops requesting more tool
# calls and forces one last text-only reply summarising whatever's already
# been gathered, so the turn reliably finishes well inside a sane window
# instead of gambling on how long an intermediary will tolerate the stream.
# Increased from 60s to 120s (2026-10-01) to handle complex multi-dimensional
# queries that need to gather data from multiple tools (e.g. stats_by_half +
# ball_carrier_data + ball_recovery_time + turnover_to_shot_time across
# multiple matches for season-wide pattern analysis).
TOTAL_STREAM_BUDGET_SECONDS = 120
WRAPUP_CALL_TIMEOUT_SECONDS = 30
TIMEOUT_FALLBACK_MESSAGE = (
    "I've gathered substantial data, but this complex query needs more time to complete fully. "
    "Here's what I found so far - you can ask follow-up questions to dive deeper into specific aspects."
)


async def _execute_tool_with_timeout(tool_name: str, tool_input: dict, db: AsyncSession, club_id=None, user_id=None) -> str:
    try:
        return await asyncio.wait_for(
            execute_tool(tool_name, tool_input, db, club_id=club_id, user_id=user_id),
            timeout=TOOL_EXECUTION_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        logger.warning(f"Tool '{tool_name}' timed out after {TOOL_EXECUTION_TIMEOUT_SECONDS}s")
        return json.dumps({
            "error": f"'{tool_name}' timed out — answer using whatever other data is already available "
                     "rather than retrying this same tool call again this turn.",
        })


async def _create_with_timeout(timeout_seconds: int = CLAUDE_CALL_TIMEOUT_SECONDS, **kwargs):
    """client.messages.create, off the event loop, with a hard timeout so a
    stuck call can never hang the chat indefinitely. Callers with a
    research-heavy tool loop (e.g. the opposition briefing, which fans a
    single web_search call out across ~7 search engines and feeds all of it
    back as tool-result context) can pass a longer timeout_seconds — the
    default stays tight for the live chat UI, where "never hang" is the point."""
    return await asyncio.wait_for(
        asyncio.to_thread(client.messages.create, **kwargs),
        timeout=timeout_seconds,
    )


async def chat_with_analyst(db: AsyncSession, conversation_history: list, user_message: str, club_id=None, user_id=None) -> str:
    """
    Conversational interface for asking questions about matches and players.
    Maintains conversation context.

    Uses RAG for dynamic knowledge base context.
    """
    # Get club context for prompt personalisation
    club_name, club_context = await get_club_context(db, club_id)

    # Get relevant knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, user_message, context_type='general', max_tokens=3000, club_id=club_id
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    # Get recent AI insight alerts for proactive reference
    insight_alerts_text = ""
    try:
        from app.models.insight_alert import InsightAlert
        alert_conditions = [InsightAlert.is_dismissed.is_(False)]
        if club_id:
            alert_conditions.append(InsightAlert.club_id == club_id)
        alert_query = (
            select(InsightAlert)
            .where(*alert_conditions)
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

    # Get fixture and weather context
    fixture_context = await get_fixture_context(db, club_id=club_id)
    weather_context = await get_weather_context(db, club_id=club_id)

    system_prompt = f"""You are a GAA analyst assistant for {club_name}.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_ESSENTIALS}
{club_context}

## Knowledge Base Context (tactics, GPS data, rules, playbooks)
{kb_context}

{fixture_context}

{weather_context}

INSTRUCTIONS:
- Use knowledge base context to reference GPS/fitness data, rules, and tactical documents.
- Cite sources from the knowledge base when relevant (e.g., "According to the GPS report from the Ballyshannon match...").
- Compare current data to benchmarks from the knowledge base.
- Be proactive — surface relevant context without being asked.
- Reference recent AI insight alerts when relevant to the conversation.
- You know about upcoming fixtures and opponent form — reference these when the user asks about preparation, training plans, or upcoming games.
- You have weather data from past matches — use this to identify performance patterns in different conditions (e.g., wet weather scoring, windy day kickout strategy).
- When asked about a player's performance or role in a match → call get_ball_carrier_data(match_id) to get their carries, passes, carry zones, and whether their turnovers led to opposition scores. Quote specific numbers.
{insight_alerts_text}
"""

    # Add new user message
    messages = conversation_history + [{"role": "user", "content": user_message}]
    turn_start = time.monotonic()

    response = await _create_with_timeout(
        model="claude-sonnet-5-5",
        max_tokens=2048,
        system=system_prompt,
        tools=TOOLS,
        messages=messages
    )

    # Process tool calls — capped so a model that never settles on a final
    # answer (e.g. repeatedly retrying a misspelled/unmatchable name) can't
    # loop forever.
    iterations = 0
    while response.stop_reason == "tool_use":
        iterations += 1
        if iterations > MAX_TOOL_ITERATIONS:
            logger.warning(f"chat_with_analyst: tool loop exceeded {MAX_TOOL_ITERATIONS} iterations, aborting")
            return FALLBACK_MESSAGE

        tool_results = []
        # Convert content blocks to plain dicts to avoid Pydantic re-serialization issues
        assistant_content = [
            block.model_dump() if hasattr(block, 'model_dump') else block
            for block in response.content
        ]

        budget_exceeded = False
        for block in response.content:
            if block.type == "tool_use":
                if budget_exceeded:
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps({"error": "Skipped — response time budget exceeded this turn."}),
                    })
                    continue
                tool_result = await _execute_tool_with_timeout(block.name, block.input, db, club_id=club_id, user_id=user_id)
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result
                })
                if time.monotonic() - turn_start > TOTAL_STREAM_BUDGET_SECONDS:
                    budget_exceeded = True

        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_results})

        elapsed = time.monotonic() - turn_start
        if budget_exceeded or elapsed > TOTAL_STREAM_BUDGET_SECONDS:
            logger.warning(
                f"chat_with_analyst: time budget exceeded ({elapsed:.0f}s) after tool round "
                f"{iterations} — forcing a text-only wrap-up"
            )
            messages.append({
                "role": "user",
                "content": (
                    "(This is taking a while — give your best answer now using only the "
                    "information already gathered above. Do not call any more tools.)"
                ),
            })
            try:
                response = await _create_with_timeout(
                    timeout_seconds=WRAPUP_CALL_TIMEOUT_SECONDS,
                    model="claude-sonnet-5-5",
                    max_tokens=2048,
                    system=system_prompt,
                    messages=messages,
                )
            except Exception as wrapup_err:
                logger.warning(f"chat_with_analyst: wrap-up call also failed: {wrapup_err}")
                return TIMEOUT_FALLBACK_MESSAGE
            break

        response = await _create_with_timeout(
            model="claude-sonnet-5-5",
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

    return final_text or TIMEOUT_FALLBACK_MESSAGE


async def _build_chat_system_prompt(
    db: AsyncSession,
    user_message: str,
    conversation_summary: Optional[str] = None,
    club_id=None,
) -> list:
    """Build the system prompt with RAG context and insight alerts.

    Returns a list of content blocks (with cache_control on the first block)
    for Anthropic prompt caching.
    """
    # Get club context for prompt personalisation
    club_name, club_context = await get_club_context(db, club_id)

    # Get relevant knowledge base context via RAG
    try:
        kb_context = await RAGService.get_context_for_query(
            db, user_message, context_type='general', max_tokens=3000, club_id=club_id
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    # Get recent AI insight alerts for proactive reference
    insight_alerts_text = ""
    try:
        from app.models.insight_alert import InsightAlert
        alert_conditions = [InsightAlert.is_dismissed.is_(False)]
        if club_id:
            alert_conditions.append(InsightAlert.club_id == club_id)
        alert_query = (
            select(InsightAlert)
            .where(*alert_conditions)
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

    # Get fixture and weather context
    fixture_context = await get_fixture_context(db, club_id=club_id)
    weather_context = await get_weather_context(db, club_id=club_id)

    # Build summary section
    summary_section = ""
    if conversation_summary:
        summary_section = f"\n## Earlier in this conversation\n{conversation_summary}\n"

    prompt_text = f"""You are a GAA analyst assistant for {club_name}.
Answer questions about matches, players, tactics, and performance.
Use the available tools to look up specific data when needed.

{GAA_ESSENTIALS}
{club_context}

## Knowledge Base Context (tactics, GPS data, rules, playbooks)
{kb_context}

{fixture_context}

{weather_context}
{summary_section}
INSTRUCTIONS:
- Use knowledge base context to reference GPS/fitness data, rules, and tactical documents.
- Cite sources from the knowledge base when relevant (e.g., "According to the GPS report from the Ballyshannon match...").
- Compare current data to benchmarks from the knowledge base.
- Be proactive — surface relevant context without being asked.
- Reference recent AI insight alerts when relevant to the conversation.
- You know about upcoming fixtures and opponent form — reference these when the user asks about preparation, training plans, or upcoming games.
- You have weather data from past matches — use this to identify performance patterns in different conditions (e.g., wet weather scoring, windy day kickout strategy).
- Format your responses with markdown: use **bold** for key stats, headers (##) for sections, and bullet points for lists.
- For PATHS, MOVEMENT, SPATIAL patterns, shot LOCATIONS, attacking MOVES, anything on the PITCH → use get_pitch_paths tool. It's instant (no extra AI call) and traces the full possession chain from kickout/turnover to score.
- Do NOT generate a chart for every question. Most questions should be answered with TEXT + data from tools. Only generate a chart when the user explicitly asks for a visual/chart/graph, or when a visual genuinely adds value (e.g. trends over time, comparisons across matches, distributions). Simple factual questions, tactical advice, or summaries do NOT need charts.
- For statistical charts (trends, comparisons, distributions, bar/line/pie) → use generate_chart tool.
- Only use create_data_table when the user specifically asks for a ranking, leaderboard, or table format.
- You can combine text + charts + tables in a single response.
- Do NOT try to describe paths/movement in text — always generate the pitch visual.
- When asked about HOW A PLAYER PERFORMED, their ROLE, BALL CARRYING, DISTRIBUTION, or PASSING in a specific match → call get_ball_carrier_data(match_id) to get carrying stats, passing network, and chain data. Quote specific numbers: e.g. "carried 8 times (primarily midfield-right channel), made 5 passes, received 3 — the main link player in the first half". Use avg_gain_x to describe their style: positive = forward-carrying, negative = recycling/holding.
- When a player had turnovers or negative events → use player_consequences from get_ball_carrier_data to state consequences explicitly: "lost possession 3 times in the defensive left — 2 of those led to opposition scores within 3 minutes". This is a critical insight managers care about — always include it if data is available.
- NEVER describe a player's match performance without first checking get_ball_carrier_data if a match_id is known. Ball carry data is captured for ~80-90% of possessions and is the richest source of player role and contribution data.
{insight_alerts_text}
"""

    return [{"type": "text", "text": prompt_text, "cache_control": {"type": "ephemeral"}}]


async def _maybe_summarize_and_trim(
    db: AsyncSession,
    session_id: str,
    full_messages: list,
) -> tuple[list, Optional[str]]:
    """If >SLIDING_WINDOW_SIZE messages, summarize older ones via Haiku.

    Returns (trimmed_messages, summary_text).
    """
    if len(full_messages) <= SLIDING_WINDOW_SIZE:
        return full_messages, None

    # Check if session already has a fresh summary
    from app.models.chat_session import ChatSession
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()

    # Messages to summarize (older ones) vs keep (recent window)
    older_messages = full_messages[:-SLIDING_WINDOW_SIZE]
    recent_messages = full_messages[-SLIDING_WINDOW_SIZE:]

    # Reuse existing summary if we have one and older messages haven't grown much
    if session and session.conversation_summary:
        return recent_messages, session.conversation_summary

    # Generate summary via Haiku
    try:
        summary_input = "\n".join(
            f"{m.get('role', 'unknown')}: {m.get('content', '')[:300]}"
            for m in older_messages
            if isinstance(m.get('content'), str)
        )

        response = await _create_with_timeout(
            model="claude-haiku-4-5",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": f"Summarize this GAA analyst conversation in 2-3 sentences, preserving key facts discussed (player names, stats, match details):\n\n{summary_input[:3000]}"
            }],
        )
        summary = response.content[0].text.strip()

        # Persist summary on session
        if session:
            session.conversation_summary = summary
            await db.flush()

        return recent_messages, summary

    except Exception as e:
        logger.warning(f"Conversation summary failed: {e}")
        # Fallback: just use the recent window without summary
        return recent_messages, None


async def chat_with_analyst_stream(
    db: AsyncSession,
    conversation_history: list,
    user_message: str,
    session_id: Optional[str] = None,
    club_id=None,
    user_id=None,
    timeout_seconds: int = CLAUDE_CALL_TIMEOUT_SECONDS,
) -> AsyncGenerator[str, None]:
    """
    Streaming variant of chat_with_analyst.

    Yields SSE-formatted lines:
      data: {"type":"thinking","tool":"tool_name"}
      data: {"type":"text","content":"chunk..."}
      data: {"type":"chart","chart":{...}}
      data: {"type":"table","table":{...}}
      data: {"type":"done"}
      data: {"type":"error","message":"..."}
    """
    try:
        # Apply sliding window if we have a session
        conversation_summary = None
        messages_to_use = conversation_history

        if session_id and len(conversation_history) > SLIDING_WINDOW_SIZE:
            messages_to_use, conversation_summary = await _maybe_summarize_and_trim(
                db, session_id, conversation_history
            )

        system_prompt = await _build_chat_system_prompt(
            db, user_message, conversation_summary=conversation_summary, club_id=club_id
        )
        messages = messages_to_use + [{"role": "user", "content": user_message}]

        cached_tools = get_cached_tools()
        turn_start = time.monotonic()

        # Non-streaming tool loop phase
        response = await _create_with_timeout(
            timeout_seconds=timeout_seconds,
            model="claude-sonnet-5-5",
            max_tokens=2048,
            system=system_prompt,
            tools=cached_tools,
            messages=messages
        )

        # Capped for the same reason as chat_with_analyst — without this, a
        # model that never settles on a final answer left the chat hanging
        # with nothing ever yielded and no assistant message ever persisted.
        iterations = 0
        while response.stop_reason == "tool_use":
            iterations += 1
            if iterations > MAX_TOOL_ITERATIONS:
                logger.warning(f"chat_with_analyst_stream: tool loop exceeded {MAX_TOOL_ITERATIONS} iterations (session {session_id})")
                yield f"data: {json.dumps({'type': 'text', 'content': FALLBACK_MESSAGE})}\n\n"
                yield f"data: {json.dumps({'type': 'done'})}\n\n"
                return

            tool_results = []
            # Convert content blocks to plain dicts to avoid Pydantic re-serialization issues
            assistant_content = [
                block.model_dump() if hasattr(block, 'model_dump') else block
                for block in response.content
            ]

            # Checked BEFORE each individual tool call, not just once per round —
            # a single Claude response can pack in a dozen-plus tool_use blocks
            # (seen live: ~18 sequential get_player_season_stats calls for a
            # "team of the season" question), and that alone can blow the whole
            # budget within one round, before the between-rounds check below
            # ever gets a chance to run. Once over budget, stop EXECUTING more
            # tools but still provide a tool_result for every remaining
            # tool_use block — Anthropic's API requires one-to-one correspondence,
            # so skipping the entry entirely would make the next call malformed.
            budget_exceeded = False
            for block in response.content:
                if block.type == "tool_use":
                    if budget_exceeded:
                        tool_results.append({
                            "type": "tool_result",
                            "tool_use_id": block.id,
                            "content": json.dumps({"error": "Skipped — response time budget exceeded this turn."}),
                        })
                        continue

                    yield f"data: {json.dumps({'type': 'thinking', 'tool': block.name})}\n\n"
                    tool_result = await _execute_tool_with_timeout(block.name, block.input, db, club_id=club_id, user_id=user_id)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result
                    })

                    # Emit viz SSE events for chart/table tools
                    if block.name in ("generate_chart", "get_pitch_paths", "display_starting_lineup"):
                        try:
                            parsed = json.loads(tool_result)
                            if parsed.get("success") and parsed.get("chart"):
                                yield f"data: {json.dumps({'type': 'chart', 'chart': parsed['chart']})}\n\n"
                        except (json.JSONDecodeError, TypeError):
                            pass
                    elif block.name == "create_data_table":
                        try:
                            parsed = json.loads(tool_result)
                            yield f"data: {json.dumps({'type': 'table', 'table': parsed})}\n\n"
                        except (json.JSONDecodeError, TypeError):
                            pass

                    if time.monotonic() - turn_start > TOTAL_STREAM_BUDGET_SECONDS:
                        budget_exceeded = True

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            elapsed = time.monotonic() - turn_start
            if budget_exceeded or elapsed > TOTAL_STREAM_BUDGET_SECONDS:
                logger.warning(
                    f"chat_with_analyst_stream: time budget exceeded ({elapsed:.0f}s) after "
                    f"tool round {iterations} — forcing a text-only wrap-up (session {session_id})"
                )
                messages.append({
                    "role": "user",
                    "content": (
                        "(This is taking a while — give your best answer now using only the "
                        "information already gathered above. Do not call any more tools.)"
                    ),
                })
                # The wrap-up call itself can still fail — a context swollen by a
                # dozen-plus tool results can be too much for even a no-tools
                # call to finish inside WRAPUP_CALL_TIMEOUT_SECONDS. That
                # failure used to propagate all the way to the outer except
                # block below with nothing yielded but an empty-message error
                # event — no text, so nothing ever got persisted, and a page
                # reload showed the question with no answer at all. Falling
                # back to a plain apology here guarantees SOMETHING real is
                # always yielded (and therefore saved) for this turn.
                try:
                    response = await _create_with_timeout(
                        timeout_seconds=WRAPUP_CALL_TIMEOUT_SECONDS,
                        model="claude-sonnet-5-5",
                        max_tokens=2048,
                        system=system_prompt,
                        messages=messages,
                    )
                except Exception as wrapup_err:
                    logger.warning(f"chat_with_analyst_stream: wrap-up call also failed: {wrapup_err} (session {session_id})")
                    yield f"data: {json.dumps({'type': 'text', 'content': TIMEOUT_FALLBACK_MESSAGE})}\n\n"
                    yield f"data: {json.dumps({'type': 'done'})}\n\n"
                    return
                break

            response = await _create_with_timeout(
                timeout_seconds=timeout_seconds,
                model="claude-sonnet-5-5",
                max_tokens=2048,
                system=system_prompt,
                tools=cached_tools,
                messages=messages
            )

        # Extract final text and stream it in chunks
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

        if not final_text:
            final_text = TIMEOUT_FALLBACK_MESSAGE

        # Chunk the text (~15 chars each) for typing effect
        chunk_size = 15
        for i in range(0, len(final_text), chunk_size):
            chunk = final_text[i:i + chunk_size]
            yield f"data: {json.dumps({'type': 'text', 'content': chunk})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    except Exception as e:
        logger.error(f"Streaming chat failed: {e}", exc_info=True)
        yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
