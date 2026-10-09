"""
Match Agent — handles all match-level AI analysis.

Two modes:
- Live Mode: Agentic Haiku with 2-turn tool loop for fast sideline insights
- Analysis Mode: Agentic Sonnet with full tool loop for deep post-match analysis

Also contains:
- generate_post_match_report: Orchestrates report generation with caching
- analyze_match_gps: Standalone GPS performance analysis (single-shot)
"""

import asyncio
import json
import logging
import re
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai.live_brief import build_live_brief
from app.services.ai._shared import (
    client, GAA_ESSENTIALS, TOOLS, execute_tool,
    get_match_summary, get_tools_subset, get_club_context,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Tools available to the live agent (fast, minimal subset)
# get_live_match_stats: primary tool — call this FIRST for per-player breakdown + kickout + score
# get_match_events: fallback for event-level detail (e.g. exact kickout destinations by minute)
# get_ball_carrier_data: if ball-carrier tracking was active, shows passing patterns live
# get_formation_snapshots: if formation snapshots were captured
# get_tactical_tags: if tactical tags were logged (high press, formation switch, etc.)
LIVE_TOOLS = ["get_live_match_stats", "get_match_events", "get_ball_carrier_data", "get_formation_snapshots", "get_tactical_tags"]

MAX_LIVE_TURNS = 3
# Live 5-minute insight model. Runs in the background every 5 minutes, so quality matters more than speed.
LIVE_MODEL = "claude-sonnet-5-5"


# Fact-check mode for the live insight:
#   "off"   (production)  — the agent's own words go straight to the user, untouched
#   "audit" (QA / replay) — a second pass reports which claims the data does not support, WITHOUT changing the insight;
#                           used to measure how often the agent drifts from the data while tuning the prompt
LIVE_FACT_CHECK_MODE = "off"

# Details of the most recent audit (the replay tool reads this)
LAST_FACT_CHECK: dict = {}

FACT_CHECK_SYSTEM = """You are a strict fact-checker for a live GAA sideline insight. You are given EVIDENCE (the only source of truth) and an INSIGHT.

For every FACTUAL claim in the insight — scores, counts, percentages, minutes, distances and positions, which player did what, which team, and any claimed
CAUSE ("because", "led to", "feeding") — decide whether the evidence directly supports it. Simple arithmetic from the evidence is supported
(e.g. 0-04 v 1-15 means 14 behind). Treat as UNSUPPORTED: numbers not in the evidence, positions or shape of our defenders/half-backs (we do not track them),
invented players or events, causal claims the evidence does not show, and "nothing changed / trend" claims that the evidence contradicts.
Do NOT flag advice or instructions themselves, or generic framing words. When a claim is borderline, treat it as supported.
Each UNSUPPORTED bullet must be ONLY the exact claim, with no commentary or explanation, and a claim you judged supported must never appear in the list. If after checking nothing is truly unsupported, answer VERDICT: OK.

If everything is supported, reply with exactly: VERDICT: OK

If anything is unsupported, reply in this exact layout:
VERDICT: FIX
UNSUPPORTED:
- the exact claim
- another exact claim
<corrected>
the insight rewritten with the unsupported claims removed or replaced by supported facts from the evidence, keeping the SAME format:
a bold headline paragraph (** **, 22 words max), a blank line, then a detail paragraph (70 words max) ending with one instruction
</corrected>
"""


async def _fact_check_live_insight(insight_text: str, evidence: str):
    """Returns (text_to_use, report). Never raises; on any problem the original insight is used."""
    report = {"ran": False}
    try:
        user = f"EVIDENCE:\n{evidence[:24000]}\n\nINSIGHT:\n{insight_text}"

        def _call():
            return client.messages.create(
                model=LIVE_MODEL, max_tokens=1500, system=FACT_CHECK_SYSTEM,
                messages=[{"role": "user", "content": user}],
            )

        resp = await asyncio.to_thread(_call)
        raw = "".join(getattr(b, "text", "") for b in resp.content).strip()
        ok = "VERDICT: OK" in raw.upper() and "VERDICT: FIX" not in raw.upper()
        unsupported = []
        um = re.search(r"UNSUPPORTED:\s*(.*?)(?:<corrected>|$)", raw, re.DOTALL | re.IGNORECASE)
        if um:
            unsupported = [ln.strip().lstrip("-• ").strip() for ln in um.group(1).splitlines() if ln.strip().startswith(("-", "•"))]
        report = {"ran": True, "ok": ok, "unsupported": unsupported}
        cm = re.search(r"<corrected>\s*(.*?)\s*</corrected>", raw, re.DOTALL | re.IGNORECASE)
        fixed = cm.group(1).strip() if cm else ""
        # Audit only: report what was flagged, never replace the agent's own text
        return insight_text, report
    except Exception as exc:  # the insight must still go out
        logger.warning("live insight fact check failed: %s: %s", type(exc).__name__, exc)
        report["error"] = f"{type(exc).__name__}: {exc}"
        return insight_text, report


class MatchAgent:
    """Agentic Match Intelligence — live insights and deep post-match analysis."""

    # -------------------------------------------------------------------------
    # LIVE MODE — Sonnet 5.5, 2-turn agentic
    # -------------------------------------------------------------------------

    @staticmethod
    async def live_insight(
        db: AsyncSession,
        match_id,
        recent_events: list,
        trigger: str = "interval",
        previous_insights: list = None,
        already_flagged_note: str = "",
        minute: int = None,
    ) -> str:
        """
        Agentic live match insight.
        Model: LIVE_MODEL (Sonnet 5.5) | Max turns: 2 | Tools: LIVE_TOOLS
        get_live_match_stats is always the first tool call — it provides per-player breakdown,
        kickout stats, scoring run detection, and sin-bin risk in human-readable format.
        """
        # Get club context for prompt personalisation
        from uuid import UUID
        from app.models.match import Match
        match_uuid = UUID(match_id) if isinstance(match_id, str) else match_id
        match_q = await db.execute(select(Match.club_id, Match.tactical_notes).where(Match.id == match_uuid))
        match_row = match_q.one_or_none()
        club_id = match_row[0] if match_row else None
        tactical_notes = match_row[1] if match_row else None
        club_name, club_context = await get_club_context(db, club_id)

        # Get knowledge base context via RAG
        try:
            event_types = [e.get('type', '') for e in recent_events[:5]]
            query = f"live match analysis {' '.join(event_types)} fatigue kickout tactics GPS benchmarks"
            kb_context = await RAGService.get_context_for_query(
                db, query, context_type='live_match', max_tokens=1500, club_id=club_id
            )
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")
            kb_context = ""

        # Spatial + pattern + last-five-minutes brief (deterministic, computed from the tagged data)
        live_brief = await build_live_brief(db, match_uuid, minute, club_id)
        brief_section = f"\n## LIVE TACTICAL BRIEF (computed from the tagged data — quote it, do not contradict it)\n{live_brief}\n" if live_brief else ""

        # Build tactical notes section
        tactical_section = ""
        if tactical_notes:
            tactical_section = f"\n## Manager's Tactical Notes (PRE-MATCH PLAN — reference these when making suggestions)\n{tactical_notes}\n"

        # Build recent-insights section so the model doesn't re-raise the same
        # player concern fresh every 5 minutes just because their cumulative
        # stat total is still the worst on the pitch — it needs to know what
        # it already said.
        previous_insights_section = ""
        if previous_insights:
            numbered = "\n".join(f"{i+1}. {text}" for i, text in enumerate(previous_insights))
            previous_insights_section = f"""
## Insights You Already Gave This Match (most recent first)
{numbered}

REPEAT RULE: If the same player/concern above is still the top issue in the current snapshot, do NOT present it again as if it's new. Either:
(a) move on to the next most pressing thing in the snapshot, or
(b) briefly acknowledge it's a repeat — e.g. "Karl again — still needs pulling aside" or "As mentioned, still no change from [player]."
Never repeat the exact same observation worded as a fresh discovery.
"""

        system_prompt = f"""You are a GAA sideline analyst providing LIVE match insights for {club_name}.
OUTPUT FORMAT — this shows in a sideline widget: paragraph 1 is visible, paragraph 2 appears on "Read more".
Paragraph 1 — the HEADLINE, wrapped in ** **: the single most important tactical point right now. 22 words maximum.
Paragraph 2 — two or three short sentences, 70 words maximum: (a) the EVIDENCE, quoting the numbers AND where on the pitch they happen (from the brief); (b) what CHANGED in the last five minutes (or say plainly that nothing changed); (c) ONE specific instruction for the next five minutes.
Separate the two paragraphs with a blank line. No bullet points, no headers, no emojis.

{GAA_ESSENTIALS}
{club_context}

## Knowledge Base Context (GPS benchmarks, tactical patterns, rules)
{kb_context}
{tactical_section}
{previous_insights_section}
{already_flagged_note}
{brief_section}
## Current Match ID
{match_id}

## Recent Events (last 5 logged)
{json.dumps(recent_events, indent=2)}

## GROUNDING — non-negotiable. You report the data; you do not invent.
- Every number, minute, distance, position, player and result you state must be written in the LIVE TACTICAL BRIEF, the per-player snapshot or a tool
  result. If you cannot point to the line it came from, do not write it. A shorter insight that is entirely true beats a fuller one with one false line.
- Before you write, silently list each claim you intend to make and the exact line it comes from; delete any claim without a source.
- We do NOT track where our defenders or half-backs stand, so never claim a line is "too deep", a shape is wrong, or a player is out of position.
- Do not claim a trend ("improved", "got worse", "nothing has changed") unless the brief shows both periods. Compare the last-five-minutes block with the
  match-to-date numbers, or quote an earlier insight you were given. If there is nothing to compare, say nothing about change.
- Do not claim one thing CAUSES another unless the brief's LINKS line shows it (e.g. a score within 2 minutes of our turnover or lost kickout).
  Otherwise state the two facts side by side.
- Check your own arithmetic and the arc: a distance is only "outside the arc" if the brief says it is. Use the exact figures given.
- Name a player only when the snapshot or brief attributes the event to them. Never guess a name.
- Advice must follow from the facts you stated; do not give advice that assumes something you did not observe.
- If there is little data in the window, say that in a few words instead of padding.

## HOW TO THINK LIKE A COACH (in this order)
1. SITUATION — score, time left in the half, momentum (the last-five-minutes block of the brief).
2. PATTERN — WHERE is it happening? Use the brief's spatial lines: where we lose the ball, where they score from, where our kickouts
   go and whether they are kept, where our misses come from. A pattern in a place beats a total.
3. CAUSE — what in the data explains it (kickout length/channel, turnovers lost in our defensive third turning into shots against,
   build-up vs direct scores, transition speed, frees conceded in our defensive third, shot distance).
4. PEOPLE — name specific players from the per-player snapshot only where it adds something.
5. INSTRUCTION — one concrete thing to change in the next five minutes.

What matters tactically in Gaelic football (use it when the data supports it): turnovers lost in our own defensive third are the most
expensive (they become shots against); a kickout strategy that is being picked off in one channel should change channel or length;
two-pointers change shot selection and defensive distance; frees conceded close to our goal give away scores; a fast, direct transition
after winning the ball is how most scores are created; a drop in kickout retention after a score against often means pressing has changed.

If the brief has a PRE-MATCH PLAN (manager's notes, man-marking), measure the game against it: say whether the plan is working, and name the marking job that is or isn't holding when the data shows it.
PRECISION: the brief gives EXACT positions in metres (accurate to about 1-3m). Quote them like a coach reading the pitch graphic —
"a free from 27m out, 8m left of centre" — and say inside or outside the 40m arc when it matters (two-pointer range).
Never replace an exact position with a vague band ("20-40m out in the centre") when the exact line is in the brief.
STEP 1 — Call get_live_match_stats(match_id) for the per-player breakdown, kickout battle and scoring run.
STEP 2 — Read the LIVE TACTICAL BRIEF above (spatial patterns, last five minutes, ball movement) — it is the main source for the WHERE.
STEP 3 — Only call get_match_events / get_ball_carrier_data if you need a detail the brief and snapshot do not give.

TRIGGERS TO WATCH — check the snapshot for these:
- 3+ consecutive own scores → name who scored, note the momentum
- 10+ min scoring drought → name who has been wasting possession (wides/errors)
- Kickout retention < 50% → call it out, suggest a tactical adjustment
- Their kickout win < 35% → note we're winning their restarts, press it
- Any player: 4+ fouls → note it as a discipline watch by name (NOT "one more and he's off" — no such rule exists; it's a referee-discretion flag, nothing more)
- Any player: 2+ unforced errors → name them and the error sub-type (stray_pass, overcarry, etc.)

Reference knowledge base context when relevant to a specific trigger.
"""

        # Use trigger-specific user prompt
        if trigger == "half_time":
            user_prompt = (
                f"Half-time. Call get_live_match_stats('{match_id}') first, then use the LIVE TACTICAL BRIEF. Give the half-time read in the "
                "required format: a bold headline (the one pattern that decided the half), then a short paragraph with the score, "
                "the biggest problem WITH WHERE it happens, one standout positive, and the single key adjustment for the second half."
            )
            max_tokens = 4000
        else:
            user_prompt = (
                f"Call get_live_match_stats('{match_id}') first. Then use the LIVE TACTICAL BRIEF and the snapshot to give ONE specific, "
                "data-driven sideline read in the required format: a bold headline, then the evidence (numbers and WHERE on the pitch), "
                "what changed in the last five minutes, and one instruction for the next five. Cite exact figures from the data only."
            )
            max_tokens = 4000

        raw_live_tools = get_tools_subset(LIVE_TOOLS)
        # Enable Anthropic prompt caching on system prompt + tools
        cached_system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
        cached_live_tools = [dict(t) for t in raw_live_tools]
        if cached_live_tools:
            cached_live_tools[-1] = {**cached_live_tools[-1], "cache_control": {"type": "ephemeral"}}

        messages = [{"role": "user", "content": user_prompt}]

        def _call_api(msgs, no_more_tools=False):
            kwargs = dict(
                model=LIVE_MODEL,
                # The live insight is worth thinking about (it runs in the background every 5 minutes), so it opts in
                # to thinking and gets a max_tokens that leaves room for the thinking AND the ~110-word answer.
                allow_thinking=True,
                max_tokens=max_tokens,
                system=cached_system,
                tools=cached_live_tools,
                messages=msgs,
            )
            if no_more_tools:
                kwargs["tool_choice"] = {"type": "none"}
            return client.messages.create(**kwargs)

        response = await asyncio.to_thread(_call_api, messages)
        evidence_texts: list = []

        # Agentic tool loop — max 2 turns
        turns = 0
        while response.stop_reason == "tool_use" and turns < MAX_LIVE_TURNS:
            turns += 1
            tool_results = []
            assistant_content = []

            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    tool_result = await execute_tool(block.name, block.input, db, club_id=club_id)
                    evidence_texts.append(f"[tool {block.name}]\n{tool_result}")
                    logger.info(f"Live tool {block.name} returned {len(tool_result)} chars")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            response = await asyncio.to_thread(_call_api, messages)

        # The model may still want another tool call when the turn limit is reached — answer those and force it to
        # write the insight now, instead of returning an empty string.
        if response.stop_reason == "tool_use":
            tool_results = []
            assistant_content = []
            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({"type": "tool_use", "id": block.id, "name": block.name, "input": block.input})
                    tool_result = await execute_tool(block.name, block.input, db, club_id=club_id)
                    evidence_texts.append(f"[tool {block.name}]\n{tool_result}")
                    tool_results.append({"type": "tool_result", "tool_use_id": block.id, "content": tool_result})
            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results + [
                {"type": "text", "text": "You have what you need. Write the insight now in the required format (bold headline paragraph, then the detail paragraph). Do not call any more tools."}
            ]})
            response = await asyncio.to_thread(_call_api, messages, True)

        # Extract final text
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

        # Audit pass (QA only): which claims, if any, the data does not support — the insight itself is never changed
        global LAST_FACT_CHECK
        if final_text.strip() and LIVE_FACT_CHECK_MODE == "audit":
            evidence = "\n\n".join(filter(None, [
                f"[tactical brief]\n{live_brief}" if live_brief else "",
                f"[pre-match notes]\n{tactical_notes}" if tactical_notes else "",
                f"[recent events]\n{json.dumps(recent_events)}",
                "\n\n".join(evidence_texts),
            ]))
            _unchanged, LAST_FACT_CHECK = await _fact_check_live_insight(final_text, evidence)
        else:
            LAST_FACT_CHECK = {"ran": False}

        return final_text

    # -------------------------------------------------------------------------
    # ANALYSIS MODE — Sonnet, full agentic (existing behavior)
    # -------------------------------------------------------------------------

    @staticmethod
    async def analyze_match(db: AsyncSession, match_id: str, question: str = None) -> str:
        """
        Analyze a specific match with optional question.
        Uses tool calling to gather data then provides analysis.

        Uses RAG for dynamic knowledge base context (tactics, GPS benchmarks, rules).
        """
        # Get club context for prompt personalisation
        from uuid import UUID as _UUID
        from app.models.match import Match as _Match
        _mid = _UUID(match_id) if isinstance(match_id, str) else match_id
        _mq = await db.execute(select(_Match.club_id).where(_Match.id == _mid))
        _cid = _mq.scalar_one_or_none()
        club_name, club_context = await get_club_context(db, _cid)

        # Get knowledge base context via RAG
        try:
            query = question or "post-match tactical analysis scoring turnovers GPS performance"
            kb_context = await RAGService.get_context_for_query(
                db, query, context_type='post_match', max_tokens=3000, club_id=_cid
            )
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")
            kb_context = ""

        system_prompt = f"""You are an expert GAA football analyst for {club_name}.

{GAA_ESSENTIALS}
{club_context}

## Knowledge Base Context (tactics, GPS benchmarks, rules, playbooks)
{kb_context}

INSTRUCTIONS:
1. You MUST use tools to gather match data BEFORE providing any analysis.
2. ALWAYS call get_match_summary and get_match_events first with the match ID provided. Then call get_ball_carrier_data with the same match ID to retrieve ball carrying, passing network, and possession chain data — this is REQUIRED, not optional.
3. Do NOT ask the user for match IDs or clarification — you already have the match ID.
4. Structure your analysis as: Summary → Key Stats → Top Performers (rated 1-10) → Tactical Analysis → Areas for Improvement → Training Recommendations.
5. Reference knowledge base context: compare to tactical documents, GPS benchmarks, and rules when available.
6. Be specific — cite player names, minutes, and events from the tool results.
7. Be constructive but honest about weaknesses.
7a. NEVER analyse or mention players who did not play in this match. Only discuss players with match events, or players present in get_match_gps's "players" list — that list already excludes unused subs (bench players whose GPS device recorded warm-up/bench activity but who never came on), so GPS data existing is NOT proof a player featured. Do not speculate about players absent from the data. If get_match_gps returns a non-empty "bench_players_not_used" list, you may add ONE short footnote sentence at the very end of the GPS section acknowledging a standout among them (e.g. "Note: [Name] logged strong bench-session output (Xkm) despite not featuring") — but never fold them into Top Performers, stats, or any analysis of the match itself.
7a2. PLAYER-LEVEL DETAIL — REQUIRED: The get_match_summary response includes a "player_breakdown" list — use it to name specific players in your analysis. For each player with unforced_errors > 0, name them AND their error sub-type (e.g. "Gallagher had 2 unforced errors — both stray passes in the midfield third"). For players with turnovers_won >= 2, highlight them by name in Top Performers. For players with fouls_committed >= 4, note it as a discipline watch (referee-discretion flag — GAA has no rule tying a foul tally to a card, so never phrase this as an automatic sin-bin). For players with wides >= 2, name them in shooting analysis. Do NOT describe error/turnover patterns without naming the players responsible.
7b. SPATIAL ANALYSIS — REQUIRED: The get_match_events tool returns a zone_summary block. You MUST use it to make specific territorial observations in your Tactical Analysis section. For example:
    - Scoring: "X scored Y/Z shots from the inside-45 left channel (N%) — their most productive zone"
    - Shooting wastage: "0 conversions from outside-45 right — avoid speculative shots from there"
    - Turnover battle: "won the midfield center channel convincingly (4 won vs 1 lost) but struggled in the defensive left (0 won, 3 lost — sustained pressure from opposition press)"
    Always name the specific zone (e.g. "inside-45 center", "defensive left channel", "midfield right") not vague references to "certain areas".
7c. BALL CARRY & PASSING ANALYSIS — REQUIRED: Use the get_ball_carrier_data tool results as follows:
    - In Top Performers: cite each key player's carry count, passes made/received, and primary carry zones. e.g. "carried 9 times (primarily midfield-right), made 6 passes — the main distributor in the recorded data".
    - In Tactical Analysis: reference chain effectiveness (scoring vs turnover chain ratio), top passing connections, and tempo. If pass_territory_progression is present, its forward/lateral/backward counts are ONLY about passing transitions between carries (read its "note" field) — never state these numbers as "X forward carries" or as a team-wide carry total. To describe forward-carrying as a team pattern, summarise the spread of avg_gain_x across carrier_stats instead (e.g. "most carriers made positive ground, led by X and Y").
    - In player event analysis: use player_consequences data to state consequences explicitly. e.g. "lost possession 3 times in the defensive third — 2 of those turnovers led directly to opposition scores within 3 minutes". Name the zone where each turnover occurred.
    - avg_gain_x_metres > 0 means forward-carrying player; < 0 means backward/recycling role. ALWAYS use avg_gain_x_metres (already converted to real metres) when stating a distance — avg_gain_x is the raw 0-100 pitch-length percentage and reading it out as if it were metres understates real distance by roughly 30%.
    - Carry-based averages (avg_gain_x_metres, carry zones, etc.) are noisy on a handful of carries. Below 4 carries, don't present the average as a settled tendency — name the actual carry count alongside it instead, e.g. "carried twice, gaining ~30m on one of them" rather than "averaged 30m per carry", so a single big carry isn't read as a repeated pattern.
    - Respect the data_confidence tier: if "low" only make individual observations; if "medium" add qualifiers like "from the possessions logged"; if "high" state patterns with confidence.
7d. RESULT CONTEXT — REQUIRED: Always frame individual stats and sub-stats relative to the final scoreline and margin of defeat/victory.
    - In a heavy defeat (losing by 10+ points or 2+ goals), do NOT label individual positive stats (e.g. turnovers won, passes completed) as "excellent" or "dominant" in isolation. Acknowledge the positive but contextualise it honestly — e.g. "Won the turnover battle (+4) but could not convert that pressure into scores" or "Efficient in possession but the scoreboard told a different story".
    - Never describe a score as "crucial" or "vital" if the game was already a lost cause at that moment (score margin ≥ 10 points with ≤ 10 minutes remaining). Use "consolation" or "late" instead.
    - Similarly, in a comfortable win, don't overstate small defensive lapses as alarming — frame them proportionally.
    - Always check the final score from get_match_summary FIRST so every narrative judgement (excellent/poor/crucial/irrelevant) is grounded in the actual result.
7e. POSITION CONTEXT — REQUIRED: Check the "position" field in player_breakdown before judging any player's output, and apply the standard for THAT position, not a generic outfield one.
    - Goalkeepers: NEVER criticise a goalkeeper for lacking scores "from play" or having a low scoring return — that is not their job. If a goalkeeper scored via frees/45s (player_breakdown will show a "scoring_note" of "all from frees/45s — none from open play" on their entry), treat that as a genuine, valued contribution and praise the free-taking, not a shortfall to fix. Never suggest a goalkeeper "work on adding scores from play" or similar.
    - More generally: don't hold a defender to a forward's scoring expectations, or a forward to a defender's tackle-count expectations. Judge each player against what their position is actually asked to do.
8a. NEVER narrate your own process. Do not write things like "Now I have all the data needed, let me compile the report" or "Let me put together the analysis" — go straight into the report content itself, starting with the first section heading. The user only ever sees your final answer, not your intermediate reasoning, so any sentence about what you're about to do is dead weight that must never appear.
8. At the very end of your response, include chart insights as a tagged JSON block:
   <chart_insights>
   {{"possession": "Brief insight about possession and territory patterns", "scoring": "Brief insight about when scoring happened", "shooting": "Brief insight about shot selection and efficiency"}}
   </chart_insights>
   Each insight must be 1-2 sentences using ONLY data from the tools you called for THIS match — never infer or reference previous matches, sequences, or historical context. IMPORTANT: Always use the actual team names (from club_context and the match opponent) — never say "Team" generically.
"""

        # Always include tool instruction with the match_id
        tool_instruction = f"First, use get_match_summary and get_match_events tools with match_id '{match_id}' to retrieve all match data."

        if question:
            user_message = f"{tool_instruction}\n\nThen answer this: {question}"
        else:
            user_message = f"{tool_instruction}\n\nProvide a comprehensive analysis including: tactical observations, key moments, player performances, and areas for improvement."

        messages = [{"role": "user", "content": user_message}]

        # Enable Anthropic prompt caching on system prompt + tools
        cached_system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
        cached_tools = [dict(t) for t in TOOLS]
        if cached_tools:
            cached_tools[-1] = {**cached_tools[-1], "cache_control": {"type": "ephemeral"}}

        # Initial call with tools
        logger.info(f"Calling Claude with match_id={match_id}, user_message={user_message[:100]}...")
        response = await asyncio.to_thread(
            client.messages.create,
            model="claude-sonnet-5-5",
            max_tokens=8192,
            system=cached_system,
            tools=cached_tools,
            messages=messages,
        )
        logger.info(f"Response stop_reason: {response.stop_reason}")
        logger.info(f"Response content types: {[block.type for block in response.content]}")

        # Process tool calls in a loop
        while response.stop_reason == "tool_use":
            tool_results = []
            assistant_content = []

            for block in response.content:
                if block.type == "text":
                    assistant_content.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    assistant_content.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })
                    tool_result = await execute_tool(block.name, block.input, db, club_id=_cid)
                    logger.info(f"Tool {block.name} returned {len(tool_result)} chars")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-sonnet-5-5",
                max_tokens=8192,
                system=cached_system,
                tools=cached_tools,
                messages=messages,
            )

        # Extract final text response
        final_text = "".join(block.text for block in response.content if hasattr(block, "text"))

        # A long, event-heavy report (lots of GPS/ball-carry detail) can hit the
        # output token cap mid-sentence. Rather than silently truncating, ask the
        # model to pick up exactly where it left off, up to a few times.
        continuation_rounds = 0
        while response.stop_reason == "max_tokens" and continuation_rounds < 3:
            logger.warning(f"Post-match report hit max_tokens, requesting continuation (round {continuation_rounds + 1})")
            messages.append({"role": "assistant", "content": final_text})
            messages.append({
                "role": "user",
                "content": "Continue exactly where you left off. Do not repeat any text already written, do not restart the report, and do not add any preamble — just continue the sentence or section that was cut off.",
            })
            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-sonnet-5-5",
                max_tokens=8192,
                system=cached_system,
                tools=cached_tools,
                messages=messages,
            )
            final_text += "".join(block.text for block in response.content if hasattr(block, "text"))
            continuation_rounds += 1

        return final_text

    # -------------------------------------------------------------------------
    # POST-MATCH REPORT — orchestrator that calls analyze_match
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_post_match_report(db: AsyncSession, match_id: str, force_regenerate: bool = False, exclude_ball_carry: bool = False) -> dict:
        """
        Generate a comprehensive post-match report.
        Returns structured data for display including chart-specific insights.

        Analysis is persisted in the database and reused unless:
        - force_regenerate=True (used when GPS data is uploaded)
        - No existing analysis exists
        """
        from uuid import UUID
        from app.models.match import Match

        # Try to get existing cached analysis from the match
        match_uuid = UUID(match_id) if isinstance(match_id, str) else match_id
        match_query = select(Match).where(Match.id == match_uuid)
        result = await db.execute(match_query)
        match = result.scalar_one_or_none()

        if not match:
            raise ValueError(f"Match {match_id} not found")

        # Simple Scoring matches have no ball-carry/passing data (tap-only
        # recording, no continuous drag tracking) — force the existing
        # exclude_ball_carry prompt-injection path regardless of what the
        # caller passed in.
        if match.precise_tracking_enabled is False:
            exclude_ball_carry = True

        # Get club name for personalised prompts
        report_club_name, _ = await get_club_context(db, match.club_id)

        # Get the match summary for metadata (always needed)
        summary_json = await get_match_summary(db, match_id)
        summary = json.loads(summary_json)

        # Check if GPS data exists but isn't in the cached report — auto-regenerate
        from app.models.match_gps import MatchGPSData
        gps_check = await db.execute(
            select(MatchGPSData.id).where(MatchGPSData.match_id == match_uuid).limit(1)
        )
        has_gps_data = gps_check.scalar_one_or_none() is not None
        needs_gps_regen = has_gps_data and not match.gps_analysis_included

        # Check if we can use cached analysis
        if match.ai_analysis and not force_regenerate and not needs_gps_regen:
            logger.info(f"Using cached AI analysis for match {match_id} (version {match.ai_analysis_version})")

            # Use cached chart insights if available, otherwise generate them
            insights = match.chart_insights or await MatchAgent._generate_chart_insights(db, match_id, summary, report_club_name)

            return {
                "match": summary.get("match", {}),
                "score": summary.get("score", {}),
                "analysis": match.ai_analysis,
                "insights": insights,
                "generated_at": match.ai_analysis_generated_at.isoformat() if match.ai_analysis_generated_at else datetime.now().isoformat(),
                "gps_included": match.gps_analysis_included or False,
                "version": match.ai_analysis_version or 1,
            }

        # Generate new analysis — agent discovers GPS data via get_match_gps tool
        logger.info(f"Generating new AI analysis for match {match_id} (force={force_regenerate}, gps_regen={needs_gps_regen})")

        gps_hint = ""
        if has_gps_data:
            gps_hint = (
                "\n\nIMPORTANT: GPS data is available for this match. Use the get_match_gps tool "
                "to retrieve physical performance data and include a detailed GPS & Physical Performance "
                "Analysis section covering: team intensity assessment, individual standout performers, "
                "concerning metrics, recovery recommendations, and how physical output impacted the result."
                "\n\nGPS ANALYSIS RULES:"
                "\n- NEVER flag the goalkeeper for low distance — GKs typically cover 2-4km"
                "\n- Players with subbed_off_minute were DEFINITELY substituted off — state as fact"
                "\n- Players with came_on_as_sub=true started on the bench and only played part of the match — "
                "NEVER compare their total distance/sprints against a full-match position benchmark, and NEVER "
                "call it 'underperformed' just because the raw number is lower. A sub on for 15 minutes covering "
                "2km is not underperforming a 7-10km full-match benchmark, they simply played a fraction of the "
                "match. Use playing_minutes to judge a substitute's output (pace/intensity per minute on pitch), "
                "not the raw total. Confirmed live 2026-09-08: three genuine substitutes were wrongly flagged as "
                "'significantly underperformed distance benchmarks' with a recommendation to review defensive "
                "shape — a real mistake that misread playing time as a physical or tactical problem."
                "\n- Use positions for distance expectations: Midfielders 9-12km, Forwards/Defenders 7-10km, GK 2-4km — "
                "these are FULL-MATCH benchmarks; only apply them to players who played close to the full match, "
                "using playing_minutes to confirm, not just the absence of subbed_off_minute"
                "\n- Only flag outfield full-match players (came_on_as_sub is not true, and playing_minutes is "
                "close to the full match duration) significantly below position benchmarks"
            )

        ball_carry_note = "\n\nIMPORTANT: Do NOT use the get_ball_carrier_data tool — ball carry data has been excluded from this report by the analyst. Do not mention passes, carries, or ball-carrying chains." if exclude_ball_carry else ""

        # Score-swing fact, computed deterministically rather than asked of
        # the model — a report described a match as "held on comfortably in
        # the last 10 minutes" when the real story was an 8-point deficit
        # overcome to win. Reconstructing a minute-by-minute margin from a
        # long raw event list is exactly the kind of arithmetic the model
        # has gotten wrong elsewhere tonight (see the 2-pointer score-string
        # bug), so the swing is computed here in Python and handed over as
        # a ready fact instead of trusted to agentic recall.
        momentum_hint = ""
        try:
            from app.models.match_event import MatchEvent, EventType, Team as EventTeam
            score_value = {
                EventType.GOAL: 3, EventType.PENALTY_GOAL: 3,
                EventType.POINT: 1, EventType.POINT_FREE: 1, EventType.FORTY_FIVE: 1,
                EventType.TWO_POINT: 2, EventType.TWO_POINT_FREE: 2,
            }
            swing_result = await db.execute(
                select(MatchEvent.minute, MatchEvent.half, MatchEvent.team, MatchEvent.event_type)
                .where(MatchEvent.match_id == match_uuid, MatchEvent.event_type.in_(list(score_value.keys())))
                .order_by(MatchEvent.minute)
            )
            half_dur = match.half_duration_mins or 30
            diff = 0
            min_diff = 0
            min_diff_minute = 0
            min_diff_is_first_half = True
            max_diff = 0
            max_diff_minute = 0
            ht_diff = 0  # score diff at the last first-half event — the TRUE half-time gap
            for row in swing_result.all():
                # `half` is frequently unset on older events — fall back to minute
                # vs. half length, same heuristic used elsewhere (expected_points_service,
                # PathsTakenChart) for this exact gap.
                is_first_half = row.half == 1 if row.half is not None else row.minute < half_dur
                value = score_value.get(row.event_type, 0)
                diff += value if row.team == EventTeam.OWN else -value
                if is_first_half:
                    ht_diff = diff
                if diff < min_diff:
                    min_diff, min_diff_minute, min_diff_is_first_half = diff, row.minute, is_first_half
                if diff > max_diff:
                    max_diff, max_diff_minute = diff, row.minute
            final_diff = diff
            # Only worth calling out as a genuine swing if the deficit was
            # real (4+ points) and the team pulled back to at least level —
            # avoids flagging routine early-match noise.
            if min_diff <= -4 and final_diff > min_diff + 3:
                # Deepest deficit and the half-time score can be different moments
                # (a team can be down less at the whistle than they get shortly
                # after the restart) — a report once conflated the two, describing
                # a deficit reached two minutes into the second half as "at the
                # break". State both explicitly so the model can't blur them.
                if min_diff_is_first_half or min_diff == ht_diff:
                    deficit_timing = f"at half-time (minute {min_diff_minute})"
                else:
                    deficit_timing = (
                        f"NOT at half-time — the half-time gap was {abs(ht_diff)} points, and the deficit "
                        f"grew to {abs(min_diff)} points shortly after the restart, at minute {min_diff_minute}"
                    )
                momentum_hint = (
                    f"\n\nMOMENTUM FACT (computed from the raw event log, trust this over any other "
                    f"read of the scoreline): {report_club_name} were down by {abs(min_diff)} points "
                    f"at their deepest point, which occurred {deficit_timing}. The match finished at a "
                    f"margin of {final_diff:+d} points. This was a genuine comeback, not a comfortable "
                    f"lead held onto — the Match Summary and any late-game narrative MUST reflect that "
                    f"{report_club_name} clawed back from {abs(min_diff)} down, not that they controlled "
                    f"the closing stages throughout. Be precise about WHEN the deepest deficit "
                    f"occurred — do not say 'at the break' unless it genuinely was at half-time."
                )
        except Exception as e:
            logger.warning(f"Momentum swing calculation failed for match {match_id}: {e}")

        weather_hint = ""
        notable_weather_values = {"heavy_rain", "light_rain", "windy", "foggy", "cold"}
        # weather_conditions (plural) is the current source of truth — a
        # match can genuinely be both windy and rainy at once. Falls back to
        # the legacy single weather_condition for matches recorded before
        # multi-select existed.
        conditions_list = match.weather_conditions or ([match.weather_condition.value] if match.weather_condition else [])
        notable_conditions = [c for c in conditions_list if c in notable_weather_values]
        if notable_conditions:
            readable = " and ".join(c.replace('_', ' ') for c in notable_conditions)
            weather_hint = f"\n\nWeather was {readable} — worth a brief mention if it plausibly affected the game (kicking, handling, visibility), but don't dwell on it."
        elif match.temperature_celsius is not None and (match.temperature_celsius >= 24 or match.temperature_celsius <= 4):
            weather_hint = f"\n\nTemperature was {match.temperature_celsius}°C ({'hot' if match.temperature_celsius >= 24 else 'cold'}) — worth a brief mention if it plausibly affected conditioning/intensity, but don't dwell on it."

        # Coach's own free-text note (e.g. "wind favoured Termon in the first
        # half") — genuinely useful tactical colour that has no structured
        # field to live in, but explicitly flagged as the coach's own account
        # rather than something computed, so the model doesn't treat it as
        # more authoritative than the actual event log/scoreline.
        notes_hint = ""
        if match.notes and match.notes.strip():
            notes_hint = f"\n\nCOACH'S OWN NOTE about this match (their words, not a computed fact — factor it in as context, don't let it override what the event log/scoreline actually shows): \"{match.notes.strip()}\""

        # Lineup-change facts — computed deterministically (same rationale as
        # momentum_hint above: this is arithmetic/lookup, not something to
        # trust to agentic recall). Flags three things by comparing this
        # match's starting XV — INCLUDING which position_id each player
        # started in, not just whether they started — against every earlier
        # completed match this season for the club:
        #   1. a starter making their first-ever start of the season
        #   2. a starter playing a position CATEGORY they've never started
        #      in before this season (goalkeeper only, for now — e.g. an
        #      outfield player's first start in goals; a full-back's first
        #      week at half-forward isn't the same kind of story and would
        #      just be noise)
        #   3. a player who started every prior match ("ever-present") but
        #      isn't starting today
        # Position category is read from THIS match's own MatchLineup
        # (position_id), never Player.position — that field is a season
        # default and can be plain wrong for a player covering a different
        # role for one game (see get_recent_lineup_history's docstring for
        # the same caveat). The model is asked to name each change and give
        # a one-line verdict in light of the actual result — it is NOT told
        # WHY a player was left out (injury/rest/tactical), since that's
        # not in the data and must never be guessed at.
        lineup_hint = ""
        try:
            from app.models.match_lineup import MatchLineup
            from app.models.match import MatchStatus
            from app.models.player import Player as _Player

            _POSITION_ID_CATEGORY = {
                'gk': 'goalkeeper',
                'fb-left': 'defender', 'fb-center': 'defender', 'fb-right': 'defender',
                'hb-left': 'defender', 'hb-center': 'defender', 'hb-right': 'defender',
                'mf-left': 'midfielder', 'mf-right': 'midfielder',
                'hf-left': 'forward', 'hf-center': 'forward', 'hf-right': 'forward',
                'ff-left': 'forward', 'ff-center': 'forward', 'ff-right': 'forward',
            }

            this_lineup_result = await db.execute(
                select(MatchLineup.player_id, MatchLineup.is_substitute, MatchLineup.position_id)
                .where(MatchLineup.match_id == match_uuid)
            )
            this_lineup_rows = this_lineup_result.all()
            this_starters = {row.player_id: row.position_id for row in this_lineup_rows if not row.is_substitute}

            if this_starters:
                prior_matches_result = await db.execute(
                    select(Match.id).where(
                        Match.club_id == match.club_id,
                        Match.counts_in_stats,
                        Match.id != match_uuid,
                        Match.match_date < match.match_date,
                    )
                )
                prior_match_ids = [row[0] for row in prior_matches_result.all()]

                if prior_match_ids:
                    prior_lineup_result = await db.execute(
                        select(MatchLineup.player_id, MatchLineup.match_id, MatchLineup.is_substitute, MatchLineup.position_id)
                        .where(MatchLineup.match_id.in_(prior_match_ids))
                    )
                    starts_by_player: dict = {}       # player_id -> set of match_ids started
                    categories_by_player: dict = {}   # player_id -> set of position categories started in
                    for row in prior_lineup_result.all():
                        if not row.is_substitute:
                            starts_by_player.setdefault(row.player_id, set()).add(row.match_id)
                            _cat = _POSITION_ID_CATEGORY.get(row.position_id)
                            if _cat:
                                categories_by_player.setdefault(row.player_id, set()).add(_cat)

                    total_prior = len(prior_match_ids)
                    relevant_ids = set(this_starters.keys()) | set(starts_by_player.keys())
                    players_result = await db.execute(
                        select(_Player.id, _Player.name).where(_Player.id.in_(relevant_ids))
                    )
                    player_names = {p.id: p.name for p in players_result.all()}

                    first_starts = []       # true first start of the season, any role
                    first_goals_starts = [] # started before, but never in goal until today
                    for pid, position_id in this_starters.items():
                        if pid not in player_names:
                            continue
                        name = player_names[pid]
                        prior_starts = starts_by_player.get(pid, set())
                        if len(prior_starts) == 0:
                            first_starts.append(name)
                        elif position_id == 'gk' and 'goalkeeper' not in categories_by_player.get(pid, set()):
                            first_goals_starts.append(name)

                    left_out = [
                        (player_names[pid], len(matches)) for pid, matches in starts_by_player.items()
                        if pid not in this_starters and len(matches) == total_prior and pid in player_names
                    ]

                    if first_starts or first_goals_starts or left_out:
                        lines = []
                        if first_starts:
                            lines.append("First start of the season: " + "; ".join(first_starts))
                        if first_goals_starts:
                            lines.append("First start IN GOALS this season (has started before, but never as goalkeeper): " + "; ".join(first_goals_starts))
                        if left_out:
                            lines.append("Ever-present all season until today, not in the starting team: " + "; ".join(
                                f"{name} — started all {n} prior completed matches" for name, n in left_out
                            ))
                        lineup_hint = (
                            "\n\nLINEUP CONTEXT (computed from lineup history, trust this over any other read):\n"
                            + "\n".join(lines)
                            + "\nMention this where it fits naturally (Match Summary or Top Performers) — name the change in one clause, "
                            "then give a one-sentence verdict on whether it looks like it paid off, based on how that player (or whoever "
                            "took their place) actually performed today and the final result. Do not speculate on WHY a player was left "
                            "out or moved position (injury, rest, tactical) — you don't have that information, only the fact and today's evidence."
                        )
        except Exception as e:
            logger.warning(f"Lineup context computation failed for match {match_id}: {e}")

        analysis = await MatchAgent.analyze_match(db, match_id,
            f"""Generate a detailed post-match report including, IN THIS EXACT ORDER — always start with Match Summary, never lead with any other section:{ball_carry_note}
            1. Match Summary (2-3 sentences)
            2. Key Statistics
            3. Top Performers (with ratings 1-10) — include each key player's carries, passes made/received, and primary carry zones from ball carrier data. For players who lost possession, state how many turnovers led to opposition scores and in which zone. Goals/points from get_match_events may include an "assist" field — when present, credit the assisting player by name (e.g. "Bonner's goal, set up by Greene's fisted knockdown").{" GPS IS REQUIRED HERE, NOT OPTIONAL: call get_match_gps and, for every single player written up in this section, work their GPS figures (distance covered, and sprint count or max speed where notable) directly into their own write-up — never leave it for the separate GPS section to cover instead. A player profiled here with no GPS line is a mistake, not a stylistic choice, unless get_match_gps genuinely has no record for them (e.g. they were an unused substitute, which shouldn't be in Top Performers anyway)." if has_gps_data else ""}
            4. Tactical Analysis — include ball carry chain effectiveness, territory progression, and possession tempo from ball carrier data. Mention the most productive passing connection (the pair who linked up most/best) in a sentence or two of prose — e.g. "Sweeney and Bonner linked up well down the right, combining for three scoring chains." Do NOT render passing connections as a table.
            5. {"GPS & Physical Performance Analysis" if has_gps_data else "Ball Carrying & Possession Patterns — detail which players drove play forward (covered the most ground per carry), who recycled possession, and whether scoring chains were direct (≤3 carriers) or buildup (4+ carriers)."}
            6. {"Ball Carrying & Possession Patterns — detail which players drove play forward, who recycled possession, and whether scoring chains were direct or buildup." if has_gps_data else "Areas for Improvement"}
            7. {"Areas for Improvement" if has_gps_data else "Training Recommendations"}
            8. {"Training Recommendations" if has_gps_data else ""}
            9. Man of the Match — pick the single best {report_club_name} player. PRIORITY ORDER, not equal weighting: (1) direct match impact FIRST — scores (goals/points/2-pointers), assists, turnovers won, kickouts won, blocks, interceptions; (2) GPS/physical output (distance, sprints, max speed) is SUPPORTING context only — use it to explain HOW a player delivered their impact, or as a tiebreaker between players with comparable scoreboard impact, never as the primary reason someone gets the nod over a player who scored/assisted/turned the ball over more. A player who ran the most distance but had a quiet scoreboard is not Man of the Match ahead of someone with a goal, points, and multiple assists — that is a real mistake the model has made before (confirmed live 2026-09-08: Dylan Sweeney picked over Conor Greene, who had a goal, two points, and two assists, apparently on distance covered alone). Write it as a section header exactly like: **Man of the Match: Player Name** followed by a 1-2 sentence justification that leads with their scoreboard/turnover impact, physical output mentioned only as supporting colour if at all.{gps_hint}{momentum_hint}{weather_hint}{lineup_hint}{notes_hint}

            POSSESSION LANGUAGE — calibrate to the actual percentage, don't default to strong language:
            - Below 50%: "{report_club_name} had less of the ball" / "lost the possession battle"
            - 50-60%: "{report_club_name} had more of the ball" / "edged the possession battle" — NOT "controlled" or "dominated"
            - Over 60%: "{report_club_name} controlled possession" / "dominated the ball" is fair to say
            Never round up — 59% is "more of the ball", not "controlled".

            PLAIN LANGUAGE FOR BALL-CARRYING DATA — never write a raw field/variable name into the report (e.g. avg_gain_x, carry_count, x_delta). Translate every metric into what a player or supporter would actually say:
            - avg_gain_x_metres / territory gained → "X metres gained per carry" or "drove the ball forward X metres on average". NEVER use the raw avg_gain_x field for a metres figure — it's a 0-100 pitch-length percentage, not metres, and reading it out directly understates real distance by roughly 30%.
            - carry_count → "X carries" / "carried the ball X times"
            - passes made/received → "X passes" (not "pass_count" or similar)
            If you're ever unsure what a tool field means in plain terms, describe the underlying action (who had the ball, how far it went, who it went to) rather than quoting the field name.

            Format your response as structured sections. {"Pay special attention to the GPS data and ensure it is discussed thoroughly." if has_gps_data else ""}"""
        )

        # Parse chart insights from tagged block in response
        chart_insights = MatchAgent._parse_chart_insights(analysis)

        # Strip the <chart_insights> block from the displayed analysis
        clean_analysis = re.sub(r'\s*<chart_insights>[\s\S]*?</chart_insights>\s*', '', analysis).strip()

        # Defensive: strip a leaked "narrating my own process" preamble if the
        # model wrote one anyway despite the system prompt instruction against it
        # (e.g. "Now I have all the data needed. Let me compile the report.").
        narration_pattern = re.compile(
            r'^(now i have|let me (compile|write|put together|draft|now)|'
            r'i(?:\'ve| have) (?:now )?(?:got|gathered|reviewed) (?:all )?(?:the )?(?:data|information)|'
            r'based on (?:the|this) data,? (?:i|let)|'
            r'with (?:all )?(?:the )?data (?:gathered|in hand))',
            re.IGNORECASE,
        )
        first_para, sep, rest = clean_analysis.partition('\n\n')
        if rest and len(first_para) < 300 and narration_pattern.match(first_para.strip()):
            clean_analysis = rest.strip()

        # Persist the analysis to the database
        match.ai_analysis = clean_analysis
        match.ai_analysis_generated_at = datetime.now()
        match.ai_analysis_version = (match.ai_analysis_version or 0) + 1
        match.gps_analysis_included = has_gps_data
        match.chart_insights = chart_insights
        await db.commit()

        logger.info(f"Saved AI analysis for match {match_id} (version {match.ai_analysis_version}, GPS={has_gps_data}, chart_insights={'yes' if chart_insights else 'no'})")

        # Use parsed chart insights, or fallback to separate generation
        insights = chart_insights or await MatchAgent._generate_chart_insights(db, match_id, summary, report_club_name)

        return {
            "match": summary.get("match", {}),
            "score": summary.get("score", {}),
            "analysis": clean_analysis,
            "insights": insights,
            "generated_at": datetime.now().isoformat(),
            "gps_included": has_gps_data,
            "version": match.ai_analysis_version,
        }

    # -------------------------------------------------------------------------
    # GPS ANALYSIS — single-shot utility
    # -------------------------------------------------------------------------

    @staticmethod
    async def analyze_match_gps(gps_data: list[dict], match_info: dict = None) -> dict:
        """
        Analyze GPS data for a match and provide insights on:
        - Player workload and recovery needs
        - Injury risk indicators
        - Team intensity patterns
        - Outliers and concerns

        Returns structured insights in a compact, actionable format.
        """
        if not gps_data:
            return {"success": False, "error": "No GPS data provided"}

        # Prepare GPS summary for the AI
        gps_summary = {"player_count": len(gps_data), "players": []}

        # Exclude unused subs (bench players who wore a device but never came on)
        active_data = [p for p in gps_data if p.get("status") != "unused_substitute"]
        outfield_data = [p for p in active_data if p.get("position", "").lower() != "goalkeeper"]

        total_distance = sum(p.get("total_distance_m", 0) or 0 for p in active_data)
        total_hsr = sum(p.get("high_speed_running_m", 0) or 0 for p in active_data)
        total_sprints = sum(p.get("sprint_count", 0) or 0 for p in active_data)
        total_hmld = sum(p.get("hml_distance_m", 0) or 0 for p in active_data)

        outfield_distance = sum(p.get("total_distance_m", 0) or 0 for p in outfield_data)
        outfield_sprints = sum(p.get("sprint_count", 0) or 0 for p in outfield_data)
        avg_distance = outfield_distance / len(outfield_data) if outfield_data else 0
        avg_hsr = total_hsr / len(outfield_data) if outfield_data else 0
        avg_sprints = outfield_sprints / len(outfield_data) if outfield_data else 0

        gps_summary["team_averages"] = {
            "avg_outfield_distance_m": round(avg_distance, 0),
            "avg_hsr_m": round(avg_hsr, 0),
            "avg_outfield_sprints": round(avg_sprints, 1),
            "total_team_distance_km": round(total_distance / 1000, 1),
            "total_team_hmld_km": round(total_hmld / 1000, 1),
        }

        # Unused subs are excluded from every stat/alert/average above, but the
        # manager still wants a passing acknowledgement if one of them clearly
        # put in real work pre-match — kept as a small, separate, clearly-labeled
        # list so the model can't accidentally fold them into match analysis.
        unused_subs = [p for p in gps_data if p.get("status") == "unused_substitute"]
        if unused_subs:
            gps_summary["bench_players_not_used"] = [
                {
                    "name": p.get("player_name", "Unknown"),
                    "total_distance_m": p.get("total_distance_m", 0),
                }
                for p in sorted(unused_subs, key=lambda p: p.get("total_distance_m", 0) or 0, reverse=True)
            ]

        # Full-match reference — the longest playing_minutes among outfield
        # players who weren't subbed off, as a fallback proxy for "a full
        # match" (match/half duration isn't passed into this endpoint).
        # `came_on_as_sub` (from the frontend's lineup-derived annotation,
        # same signal get_match_gps in _shared.py already uses for the main
        # AI report) is the PRIMARY, more reliable check — confirmed live
        # 2026-09-08 querying prod data: playing_minutes on MatchGPSData
        # rows is frequently null/unpopulated even for a real used
        # substitute, so a playing_minutes-only check silently no-ops and
        # the bug persists. subbed_off_minute alone only catches starters
        # who left EARLY, not players who entered late, so before this a
        # genuine sub's naturally lower total distance still ran through
        # the same vs-average comparison as a full-match player — two
        # genuine substitutes were flagged "Distance X% below average —
        # review for injury or illness" for exactly this reason (the same
        # bug already fixed in generate_post_match_report's GPS ANALYSIS
        # RULES, but this separate single-shot GPS endpoint, feeding the
        # match-result page's GPSInsightsPanel, never got the same fix).
        full_match_minutes = max(
            (p.get("playing_minutes") or 0 for p in outfield_data if p.get("subbed_off_minute") is None),
            default=0,
        )

        for p in active_data:
            is_gk = p.get("position", "").lower() == "goalkeeper"
            was_subbed = p.get("subbed_off_minute") is not None
            came_on_as_sub = p.get("came_on_as_sub") is True
            playing_minutes = p.get("playing_minutes") or 0
            played_close_to_full_match = (
                not came_on_as_sub
                and (full_match_minutes == 0 or playing_minutes >= full_match_minutes * 0.85 or not playing_minutes)
            )
            player_summary = {
                "name": p.get("player_name", "Unknown"),
                "position": p.get("position", "unknown"),
                "subbed_off_minute": p.get("subbed_off_minute"),
                "came_on_as_sub": came_on_as_sub,
                "total_distance_m": p.get("total_distance_m", 0),
                "high_speed_running_m": p.get("high_speed_running_m", 0),
                "sprint_distance_m": p.get("sprint_distance_m", 0),
                "hml_distance_m": p.get("hml_distance_m", 0),
                "max_speed_ms": round(p.get("max_speed_ms", 0) or 0, 2),
                "sprint_count": p.get("sprint_count", 0),
                "player_load": p.get("player_load", 0),
                "playing_minutes": p.get("playing_minutes", 0),
            }
            if not is_gk and not was_subbed and played_close_to_full_match and avg_distance > 0:
                player_summary["distance_vs_avg_pct"] = round(((p.get("total_distance_m", 0) or 0) / avg_distance - 1) * 100, 1)
            if not is_gk and not was_subbed and played_close_to_full_match and avg_sprints > 0:
                player_summary["sprints_vs_avg_pct"] = round(((p.get("sprint_count", 0) or 0) / avg_sprints - 1) * 100, 1)
            gps_summary["players"].append(player_summary)

        prompt = f"""Analyze this GPS performance data from a GAA football match and provide CONCISE, ACTIONABLE insights.

IMPORTANT — playing time context: a player's total_distance_m/sprint_count
naturally scale with how long they were on the pitch, not just their effort
level. came_on_as_sub=true means they started on the bench and only played
part of the match; subbed_off_minute means they left early. Only players who
played close to the full match have a distance_vs_avg_pct/sprints_vs_avg_pct
field — that's the ONLY basis for an "underperformance" or "injury_risk"
alert based on distance/sprints. If a player has no distance_vs_avg_pct
field at all, do NOT flag them for low distance or infer/estimate one from
their raw total — that's expected for a substitute or early-departure
player, not a concern, and never worth an alert.

GPS DATA:
{json.dumps(gps_summary, indent=2)}

MATCH INFO: {json.dumps(match_info) if match_info else 'Not provided'}

Provide your analysis as a JSON object with this EXACT structure:
{{
    "overall_intensity": "championship|good|moderate|low",
    "intensity_summary": "One sentence about team intensity level",

    "alerts": [
        {{
            "type": "recovery|injury_risk|fatigue|overload|underperformance",
            "severity": "high|medium|low",
            "player": "Player Name",
            "message": "Brief actionable message (max 15 words)",
            "metric": "The key metric that triggered this alert"
        }}
    ],

    "patterns": [
        {{
            "insight": "Brief pattern observation (max 20 words)",
            "recommendation": "Brief recommendation (max 15 words)"
        }}
    ],

    "top_performers": [
        {{
            "player": "Name",
            "highlight": "Brief highlight (max 10 words)"
        }}
    ],

    "recovery_recommendations": {{
        "full_recovery_needed": ["Player names who need 72+ hours"],
        "light_session_only": ["Player names who should do light work"],
        "normal_training": ["Player names cleared for normal training"]
    }},

    "unused_sub_footnote": "Optional. Omit this field entirely unless a bench player in bench_players_not_used clearly logged notable work (e.g. warm-up effort). One short sentence max, must make clear this is pre-match/bench activity, NOT match involvement — e.g. 'X logged the most bench-session distance among unused subs (Ykm) in the warm-up.'"
}}

ANALYSIS GUIDELINES:
- Players with status "unused_substitute" (listed separately under bench_players_not_used, if present) never played — they must NEVER appear in alerts, patterns, top_performers, or averages. The only place they may ever be mentioned is the single optional unused_sub_footnote field, and only when their bench-session output is genuinely notable.
- NEVER flag the goalkeeper for low distance/activity — GKs typically cover 2-4km which is normal
- Any max_speed_ms above 10.6 m/s should be treated as a likely GPS spike/sensor error — do not cite it as a genuine achievement or use it for recovery recommendations
- Players with a "subbed_off_minute" were DEFINITELY substituted — state as fact, do NOT say "possible tactical substitution". Evaluate their output relative to minutes played
- Use positions for distance expectations: Midfielders 9-12km, Forwards/Defenders 7-10km, Goalkeeper 2-4km
- Only flag outfield players who played the full match and are significantly below position benchmarks
- Flag outfield players with distance >20% above team average (potential overload)
- Flag outfield players with sprints >30% above average (high intensity, needs recovery)
- Consider max speed - very high values indicate explosive efforts requiring recovery
- Keep all messages SHORT and ACTIONABLE
- Maximum 3 alerts (prioritize most important)
- Maximum 2 patterns
- Maximum 3 top performers

Return ONLY the JSON object, no other text."""

        try:
            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-sonnet-5-5",
                max_tokens=1500,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = response.content[0].text.strip()

            if "```json" in response_text:
                response_text = response_text.split("```json")[1].split("```")[0].strip()
            elif "```" in response_text:
                response_text = response_text.split("```")[1].split("```")[0].strip()

            insights = json.loads(response_text)

            return {
                "success": True,
                "insights": insights,
                "generated_at": datetime.now().isoformat(),
            }

        except json.JSONDecodeError as e:
            logger.error(f"GPS analysis JSON parse error: {e}")
            return {"success": False, "error": f"Failed to parse AI response: {e}"}
        except Exception as e:
            logger.error(f"GPS analysis failed: {e}")
            return {"success": False, "error": str(e)}

    # -------------------------------------------------------------------------
    # CHART INSIGHTS — parse from analysis or generate as fallback
    # -------------------------------------------------------------------------

    @staticmethod
    def _parse_chart_insights(analysis_text: str) -> dict | None:
        """Parse <chart_insights> JSON block from analyze_match response."""
        match = re.search(r'<chart_insights>\s*(\{[\s\S]*?\})\s*</chart_insights>', analysis_text)
        if not match:
            return None
        try:
            insights = json.loads(match.group(1))
            # Validate expected keys
            if isinstance(insights, dict) and any(k in insights for k in ("possession", "scoring", "shooting")):
                return insights
            return None
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Failed to parse chart insights from analysis: {e}")
            return None

    @staticmethod
    async def _generate_chart_insights(db: AsyncSession, match_id: str, summary: dict, club_name: str = "Team") -> dict:
        """Generate short AI insights for each chart type on the match result page."""
        try:
            stats = summary.get("stats", {})
            score = summary.get("score", {})
            opponent = summary.get('match', {}).get('opponent', 'Opponent')

            prompt = f"""Based on this GAA match data, generate 3 short insights (1-2 sentences each) for charts:

Match: {club_name} {score.get('team', '0-00')} vs {opponent} {score.get('opponent', '0-00')}

Stats:
- Possession: {club_name} {stats.get('team_possession_percentage', 50)}% vs {opponent} {stats.get('opponent_possession_percentage', 50)}%
- Shots: {club_name} {stats.get('team_total_shots', 0)} (Accuracy: {stats.get('team_accuracy', 0):.0f}%, Conversion: {stats.get('team_conversion_rate', 0):.0f}%) vs {opponent} {stats.get('opponent_total_shots', 0)}
- Turnovers Won: {club_name} {stats.get('team_turnovers_won', 0)} vs {opponent} {stats.get('opponent_turnovers_won', 0)}

Use the team names ({club_name} and {opponent}) — never say "Team" generically. Each insight should be 1-2 sentences using actual stats.

Respond in this exact JSON format (no markdown):
{{
    "possession": "1-2 sentences about possession and territory patterns using {club_name}/{opponent} names",
    "scoring": "1-2 sentences about scoring patterns using {club_name}/{opponent} names",
    "shooting": "1-2 sentences about shot selection and efficiency using {club_name}/{opponent} names"
}}"""

            response = await asyncio.to_thread(
                client.messages.create,
                model="claude-sonnet-5-5",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )

            text = response.content[0].text.strip()
            if text.startswith("{"):
                return json.loads(text)
            return {}
        except Exception as e:
            logger.warning(f"Failed to generate chart insights: {e}")
            return {}
