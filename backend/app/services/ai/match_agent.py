"""
Match Agent — handles all match-level AI analysis.

Two modes:
- Live Mode: Agentic Haiku with 2-turn tool loop for fast sideline insights
- Analysis Mode: Agentic Sonnet with full tool loop for deep post-match analysis

Also contains:
- generate_post_match_report: Orchestrates report generation with caching
- analyze_match_gps: Standalone GPS performance analysis (single-shot)
"""

import json
import logging
import re
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, TOOLS, execute_tool,
    get_match_summary, get_tools_subset, get_club_context,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Tools available to the live agent (fast, minimal subset)
LIVE_TOOLS = ["get_match_events", "get_match_summary", "get_scoring_patterns", "get_stats_by_half", "get_ball_carrier_data", "get_formation_snapshots", "get_tactical_tags"]

MAX_LIVE_TURNS = 2


class MatchAgent:
    """Agentic Match Intelligence — live insights and deep post-match analysis."""

    # -------------------------------------------------------------------------
    # LIVE MODE — Haiku, 2-turn agentic
    # -------------------------------------------------------------------------

    @staticmethod
    async def live_insight(
        db: AsyncSession,
        match_id,
        recent_events: list,
        trigger: str = "interval",
    ) -> str:
        """
        Agentic live match insight.
        Model: Haiku | Max turns: 2 | Tools: LIVE_TOOLS (4 tools)
        """
        # Get current match state
        summary = await get_match_summary(db, match_id)

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

        # Build tactical notes section
        tactical_section = ""
        if tactical_notes:
            tactical_section = f"\n## Manager's Tactical Notes (PRE-MATCH PLAN — reference these when making suggestions)\n{tactical_notes}\n"

        system_prompt = f"""You are a GAA sideline analyst providing LIVE match insights for {club_name}.
CRITICAL: Keep responses to 2-3 SHORT sentences MAXIMUM (under 80 words total). Be punchy and actionable — this displays in a small sidebar widget. No bullet points, no headers, no lists.

{GAA_ESSENTIALS}
{club_context}

## Knowledge Base Context (GPS benchmarks, tactical patterns, rules)
{kb_context}
{tactical_section}
## Current Match
Match ID: {match_id}

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

IMPORTANT: You already have the match summary and recent events above. Respond with your analysis IMMEDIATELY based on this data. Do NOT call tools unless you genuinely need specific data that is missing from the context above. Most of the time, the context is sufficient — just give your tactical read.
"""

        # Use trigger-specific user prompt
        if trigger == "half_time":
            user_prompt = (
                "Give a concise half-time summary: the current scoreline, "
                "which team has the momentum, one thing we did well, "
                "and one key tactical change for the second half."
            )
            max_tokens = 200
        else:
            user_prompt = "Analyze the match state above and give one key tactical observation and one adjustment we should make. Respond directly — do not call any tools."
            max_tokens = 200

        raw_live_tools = get_tools_subset(LIVE_TOOLS)
        # Enable Anthropic prompt caching on system prompt + tools
        cached_system = [{"type": "text", "text": system_prompt, "cache_control": {"type": "ephemeral"}}]
        cached_live_tools = [dict(t) for t in raw_live_tools]
        if cached_live_tools:
            cached_live_tools[-1] = {**cached_live_tools[-1], "cache_control": {"type": "ephemeral"}}

        messages = [{"role": "user", "content": user_prompt}]

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=max_tokens,
            system=cached_system,
            tools=cached_live_tools,
            messages=messages,
        )

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
                    logger.info(f"Live tool {block.name} returned {len(tool_result)} chars")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=max_tokens,
                system=cached_system,
                tools=cached_live_tools,
                messages=messages,
            )

        # Extract final text
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

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
2. ALWAYS call get_match_summary and get_match_events first with the match ID provided.
3. Do NOT ask the user for match IDs or clarification — you already have the match ID.
4. Structure your analysis as: Summary → Key Stats → Top Performers (rated 1-10) → Tactical Analysis → Areas for Improvement → Training Recommendations.
5. Reference knowledge base context: compare to tactical documents, GPS benchmarks, and rules when available.
6. Be specific — cite player names, minutes, and events from the tool results.
7. Be constructive but honest about weaknesses.
7a. NEVER analyse or mention players who did not play in this match. Only discuss players with match events or GPS data in the tool results. Do not speculate about players absent from the data.
7b. SPATIAL ANALYSIS — REQUIRED: The get_match_events tool returns a zone_summary block. You MUST use it to make specific territorial observations in your Tactical Analysis section. For example:
    - Scoring: "X scored Y/Z shots from the inside-45 left channel (N%) — their most productive zone"
    - Shooting wastage: "0 conversions from outside-45 right — avoid speculative shots from there"
    - Turnover battle: "won the midfield center channel convincingly (4 won vs 1 lost) but struggled in the defensive left (0 won, 3 lost — sustained pressure from opposition press)"
    Always name the specific zone (e.g. "inside-45 center", "defensive left channel", "midfield right") not vague references to "certain areas".
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
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
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

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=4096,
                system=cached_system,
                tools=cached_tools,
                messages=messages,
            )

        # Extract final text response
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

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
                "\n- Players with subbed_off_minute were DEFINITELY substituted — state as fact"
                "\n- Use positions for distance expectations: Midfielders 9-12km, Forwards/Defenders 7-10km, GK 2-4km"
                "\n- Only flag outfield full-match players significantly below position benchmarks"
            )

        ball_carry_note = "\n\nIMPORTANT: Do NOT use the get_ball_carrier_data tool — ball carry data has been excluded from this report by the analyst. Do not mention passes, carries, or ball-carrying chains." if exclude_ball_carry else ""

        analysis = await MatchAgent.analyze_match(db, match_id,
            f"""Generate a detailed post-match report including:{ball_carry_note}
            1. Match Summary (2-3 sentences)
            2. Key Statistics
            3. Top Performers (with ratings 1-10)
            4. Tactical Analysis
            5. {"GPS & Physical Performance Analysis" if has_gps_data else "Areas for Improvement"}
            6. {"Areas for Improvement" if has_gps_data else "Training Recommendations"}
            7. {"Training Recommendations" if has_gps_data else ""}
            8. Man of the Match — pick the single best {report_club_name} player considering scoring, workrate{", GPS data," if has_gps_data else ","} and overall impact. Write it as a section header exactly like: **Man of the Match: Player Name** followed by a 1-2 sentence justification.{gps_hint}

            Format your response as structured sections. {"Pay special attention to the GPS data and ensure it is discussed thoroughly." if has_gps_data else ""}"""
        )

        # Parse chart insights from tagged block in response
        chart_insights = MatchAgent._parse_chart_insights(analysis)

        # Strip the <chart_insights> block from the displayed analysis
        clean_analysis = re.sub(r'\s*<chart_insights>[\s\S]*?</chart_insights>\s*', '', analysis).strip()

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

        for p in active_data:
            is_gk = p.get("position", "").lower() == "goalkeeper"
            was_subbed = p.get("subbed_off_minute") is not None
            player_summary = {
                "name": p.get("player_name", "Unknown"),
                "position": p.get("position", "unknown"),
                "subbed_off_minute": p.get("subbed_off_minute"),
                "total_distance_m": p.get("total_distance_m", 0),
                "high_speed_running_m": p.get("high_speed_running_m", 0),
                "sprint_distance_m": p.get("sprint_distance_m", 0),
                "hml_distance_m": p.get("hml_distance_m", 0),
                "max_speed_kmh": round((p.get("max_speed_ms", 0) or 0) * 3.6, 1),
                "sprint_count": p.get("sprint_count", 0),
                "player_load": p.get("player_load", 0),
                "playing_minutes": p.get("playing_minutes", 0),
            }
            if not is_gk and not was_subbed and avg_distance > 0:
                player_summary["distance_vs_avg_pct"] = round(((p.get("total_distance_m", 0) or 0) / avg_distance - 1) * 100, 1)
            if not is_gk and not was_subbed and avg_sprints > 0:
                player_summary["sprints_vs_avg_pct"] = round(((p.get("sprint_count", 0) or 0) / avg_sprints - 1) * 100, 1)
            gps_summary["players"].append(player_summary)

        prompt = f"""Analyze this GPS performance data from a GAA football match and provide CONCISE, ACTIONABLE insights.

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
    }}
}}

ANALYSIS GUIDELINES:
- Players with status "unused_substitute" wore a GPS device on the bench but never played — COMPLETELY IGNORE them in all analysis, alerts, and averages
- NEVER flag the goalkeeper for low distance/activity — GKs typically cover 2-4km which is normal
- Any max_speed_kmh above 38 km/h should be treated as a likely GPS spike/sensor error — do not cite it as a genuine achievement or use it for recovery recommendations
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
            response = client.messages.create(
                model="claude-sonnet-4-20250514",
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

            response = client.messages.create(
                model="claude-sonnet-4-20250514",
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
