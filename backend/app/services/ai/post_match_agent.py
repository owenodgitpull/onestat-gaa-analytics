"""
Post-Match Agent — deep analysis after a match is completed.

Functions:
- analyze_match: Tool-loop agent that queries match data then generates analysis
- generate_post_match_report: Orchestrates report generation with caching
- analyze_match_gps: Standalone GPS performance analysis (single-shot)
"""

import json
import logging
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, TOOLS, execute_tool,
    get_match_summary,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)


async def analyze_match(db: AsyncSession, match_id: str, question: str = None) -> str:
    """
    Analyze a specific match with optional question.
    Uses tool calling to gather data then provides analysis.

    Uses RAG for dynamic knowledge base context (tactics, GPS benchmarks, rules).
    """

    # Get knowledge base context via RAG
    try:
        query = question or "post-match tactical analysis scoring turnovers GPS performance"
        kb_context = await RAGService.get_context_for_query(
            db, query, context_type='post_match', max_tokens=3000
        )
    except Exception as e:
        logger.warning(f"RAG context retrieval failed: {e}")
        kb_context = ""

    system_prompt = f"""You are an expert GAA football analyst for Dungloe GAA club.

{GAA_ESSENTIALS}

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
"""

    # Always include tool instruction with the match_id
    tool_instruction = f"First, use get_match_summary and get_match_events tools with match_id '{match_id}' to retrieve all match data."

    if question:
        user_message = f"{tool_instruction}\n\nThen answer this: {question}"
    else:
        user_message = f"{tool_instruction}\n\nProvide a comprehensive analysis including: tactical observations, key moments, player performances, and areas for improvement."

    messages = [{"role": "user", "content": user_message}]

    # Initial call with tools
    logger.info(f"Calling Claude with match_id={match_id}, user_message={user_message[:100]}...")
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=system_prompt,
        tools=TOOLS,
        messages=messages
    )
    logger.info(f"Response stop_reason: {response.stop_reason}")
    logger.info(f"Response content types: {[block.type for block in response.content]}")

    # Process tool calls in a loop
    while response.stop_reason == "tool_use":
        # Find tool use blocks and serialize assistant content properly
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
                    "input": block.input
                })
                tool_result = await execute_tool(block.name, block.input, db)
                logger.info(f"Tool {block.name} returned {len(tool_result)} chars")
                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": block.id,
                    "content": tool_result
                })

        # Continue conversation with tool results
        messages.append({"role": "assistant", "content": assistant_content})
        messages.append({"role": "user", "content": tool_results})

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=system_prompt,
            tools=TOOLS,
            messages=messages
        )

    # Extract final text response
    final_text = ""
    for block in response.content:
        if hasattr(block, "text"):
            final_text += block.text

    return final_text


async def generate_post_match_report(db: AsyncSession, match_id: str, force_regenerate: bool = False) -> dict:
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

        # Generate chart insights (these are quick and can be regenerated)
        insights = await _generate_chart_insights(db, match_id, summary)

        return {
            "match": summary.get("match", {}),
            "score": summary.get("score", {}),
            "analysis": match.ai_analysis,
            "insights": insights,
            "generated_at": match.ai_analysis_generated_at.isoformat() if match.ai_analysis_generated_at else datetime.now().isoformat(),
            "gps_included": match.gps_analysis_included or False,
            "version": match.ai_analysis_version or 1
        }

    # Generate new analysis
    logger.info(f"Generating new AI analysis for match {match_id} (force={force_regenerate}, gps_regen={needs_gps_regen})")

    # Fetch full GPS data with player names (eager join to avoid async lazy-load)
    from app.models import Player
    gps_query = (
        select(MatchGPSData, Player.name)
        .join(Player, MatchGPSData.player_id == Player.id, isouter=True)
        .where(MatchGPSData.match_id == match_uuid)
    )
    gps_result = await db.execute(gps_query)
    gps_rows = gps_result.all()
    has_gps = len(gps_rows) > 0

    # Build prompt with GPS context if available
    gps_context = ""
    if has_gps:
        # Calculate team totals and averages
        total_distance = sum(g.total_distance_m or 0 for g, _ in gps_rows)
        total_hsr = sum(g.high_speed_running_m or 0 for g, _ in gps_rows)
        total_sprints = sum(g.sprint_count or 0 for g, _ in gps_rows)
        total_hmld = sum(g.hml_distance_m or 0 for g, _ in gps_rows)
        avg_distance = total_distance / len(gps_rows) if gps_rows else 0
        avg_sprints = total_sprints / len(gps_rows) if gps_rows else 0

        # Build detailed player GPS data
        gps_player_details = []
        for g, player_name in gps_rows:
            player_name = player_name or "Unknown"
            distance_km = (g.total_distance_m or 0) / 1000
            hsr_m = g.high_speed_running_m or 0
            sprints = g.sprint_count or 0
            max_speed_kmh = (g.max_speed_ms or 0) * 3.6
            hmld = g.hml_distance_m or 0
            player_load = g.player_load or 0

            # Flag outliers
            outlier_note = ""
            if g.total_distance_m and avg_distance > 0:
                diff_pct = ((g.total_distance_m - avg_distance) / avg_distance) * 100
                if diff_pct > 20:
                    outlier_note = " [HIGH WORKLOAD]"
                elif diff_pct < -20:
                    outlier_note = " [LOW OUTPUT]"

            gps_player_details.append(
                f"  - {player_name}: {distance_km:.1f}km total, {hsr_m:.0f}m HSR, {hmld:.0f}m HMLD, "
                f"{sprints} sprints, {max_speed_kmh:.1f}km/h max speed, load: {player_load:.0f}{outlier_note}"
            )

        gps_context = f"""

GPS PERFORMANCE DATA (STATSports):
TEAM TOTALS:
  - Total Distance: {total_distance/1000:.1f}km across {len(gps_rows)} players
  - Total High Speed Running: {total_hsr/1000:.1f}km
  - Total High Metabolic Load Distance: {total_hmld/1000:.1f}km
  - Total Sprints: {total_sprints}
  - Average Distance per Player: {avg_distance/1000:.1f}km
  - Average Sprints per Player: {avg_sprints:.0f}

INDIVIDUAL PLAYER GPS:
{chr(10).join(gps_player_details)}

IMPORTANT: Include a dedicated GPS/Physical Performance section in your analysis that covers:
- Team physical output assessment (was the overall intensity championship-level?)
- Individual standout performers (highest distance, most sprints, highest speed)
- Any players showing concerning metrics (very high or very low output relative to team)
- Recovery recommendations based on workload
- How physical output may have impacted the match result"""

    analysis = await analyze_match(db, match_id,
        f"""Generate a detailed post-match report including:
        1. Match Summary (2-3 sentences)
        2. Key Statistics
        3. Top Performers (with ratings 1-10)
        4. Tactical Analysis
        5. {"GPS & Physical Performance Analysis" if has_gps else "Areas for Improvement"}
        6. {"Areas for Improvement" if has_gps else "Training Recommendations"}
        7. {"Training Recommendations" if has_gps else ""}{gps_context}

        Format your response as structured sections. {"Pay special attention to the GPS data and ensure it is discussed thoroughly." if has_gps else ""}"""
    )

    # Persist the analysis to the database
    match.ai_analysis = analysis
    match.ai_analysis_generated_at = datetime.now()
    match.ai_analysis_version = (match.ai_analysis_version or 0) + 1
    match.gps_analysis_included = has_gps
    await db.commit()

    logger.info(f"Saved AI analysis for match {match_id} (version {match.ai_analysis_version}, GPS={has_gps})")

    # Generate chart-specific insights
    insights = await _generate_chart_insights(db, match_id, summary)

    return {
        "match": summary.get("match", {}),
        "score": summary.get("score", {}),
        "analysis": analysis,
        "insights": insights,
        "generated_at": datetime.now().isoformat(),
        "gps_included": has_gps,
        "version": match.ai_analysis_version
    }


async def _generate_chart_insights(db: AsyncSession, match_id: str, summary: dict) -> dict:
    """
    Generate short AI insights for each chart type on the match result page.
    """
    try:
        # Get match stats for context
        stats = summary.get("stats", {})
        score = summary.get("score", {})

        prompt = f"""Based on this GAA match data, generate 3 short insights (1-2 sentences each) for charts:

Match: Dungloe {score.get('dungloe', '0-00')} vs {summary.get('match', {}).get('opponent', 'Opponent')} {score.get('opponent', '0-00')}

Stats:
- Possession: Dungloe {stats.get('dungloe_possession_percentage', 50)}% vs Opponent {stats.get('opponent_possession_percentage', 50)}%
- Shots: Dungloe {stats.get('dungloe_total_shots', 0)} (Accuracy: {stats.get('dungloe_accuracy', 0):.0f}%) vs Opponent {stats.get('opponent_total_shots', 0)}
- Turnovers Won: Dungloe {stats.get('dungloe_turnovers_won', 0)} vs Opponent {stats.get('opponent_turnovers_won', 0)}

Respond in this exact JSON format (no markdown):
{{
    "possession": "Brief insight about possession and territory patterns",
    "scoring": "Brief insight about when scoring happened during the match",
    "shooting": "Brief insight about shot selection and efficiency"
}}"""

        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        text = response.content[0].text.strip()
        # Parse JSON
        if text.startswith("{"):
            return json.loads(text)
        return {}
    except Exception as e:
        logger.warning(f"Failed to generate chart insights: {e}")
        return {}


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
        return {
            "success": False,
            "error": "No GPS data provided"
        }

    # Prepare GPS summary for the AI
    gps_summary = {
        "player_count": len(gps_data),
        "players": []
    }

    # Calculate team averages for context
    total_distance = sum(p.get("total_distance_m", 0) or 0 for p in gps_data)
    total_hsr = sum(p.get("high_speed_running_m", 0) or 0 for p in gps_data)
    total_sprints = sum(p.get("sprint_count", 0) or 0 for p in gps_data)
    total_hmld = sum(p.get("hml_distance_m", 0) or 0 for p in gps_data)

    avg_distance = total_distance / len(gps_data) if gps_data else 0
    avg_hsr = total_hsr / len(gps_data) if gps_data else 0
    avg_sprints = total_sprints / len(gps_data) if gps_data else 0

    gps_summary["team_averages"] = {
        "avg_distance_m": round(avg_distance, 0),
        "avg_hsr_m": round(avg_hsr, 0),
        "avg_sprints": round(avg_sprints, 1),
        "total_team_distance_km": round(total_distance / 1000, 1),
        "total_team_hmld_km": round(total_hmld / 1000, 1)
    }

    for p in gps_data:
        player_summary = {
            "name": p.get("player_name", "Unknown"),
            "total_distance_m": p.get("total_distance_m", 0),
            "high_speed_running_m": p.get("high_speed_running_m", 0),
            "sprint_distance_m": p.get("sprint_distance_m", 0),
            "hml_distance_m": p.get("hml_distance_m", 0),
            "max_speed_kmh": round((p.get("max_speed_ms", 0) or 0) * 3.6, 1),
            "sprint_count": p.get("sprint_count", 0),
            "player_load": p.get("player_load", 0),
            "playing_minutes": p.get("playing_minutes", 0),
            # Calculate deviation from average
            "distance_vs_avg_pct": round(((p.get("total_distance_m", 0) or 0) / avg_distance - 1) * 100, 1) if avg_distance > 0 else 0,
            "sprints_vs_avg_pct": round(((p.get("sprint_count", 0) or 0) / avg_sprints - 1) * 100, 1) if avg_sprints > 0 else 0
        }
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
- Flag players with distance >20% above team average (potential overload)
- Flag players with sprints >30% above average (high intensity, needs recovery)
- Flag players with very low output relative to playing time (potential injury/fitness issue)
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
            messages=[{"role": "user", "content": prompt}]
        )

        response_text = response.content[0].text.strip()

        # Extract JSON from response
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        insights = json.loads(response_text)

        return {
            "success": True,
            "insights": insights,
            "generated_at": datetime.now().isoformat()
        }

    except json.JSONDecodeError as e:
        logger.error(f"GPS analysis JSON parse error: {e}")
        return {
            "success": False,
            "error": f"Failed to parse AI response: {e}"
        }
    except Exception as e:
        logger.error(f"GPS analysis failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }
