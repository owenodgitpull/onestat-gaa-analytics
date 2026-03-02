"""
Season Agent — agentic season-level intelligence.

A truly agentic agent with a tool loop that owns all season-level analysis:
- KPI insights for dashboard cards
- Insight alerts after data uploads
- Dashboard chart generation
- Dynamic chart recommendations
- Outlier suggestion charts
- Player-level tasks: season story, insights, challenges
- Training session summaries

Uses the same tools as the Match Agent but with season-specific system prompts.
"""

import re
import json
import logging
from datetime import datetime
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.services.ai._shared import (
    client, GAA_ESSENTIALS, execute_tool,
    get_tools_subset, get_fixture_context,
    STATIC_CHARTS_TEXT, safe_json, get_club_context,
)
from app.services.rag_service import RAGService

logger = logging.getLogger(__name__)

# Tools available to the season agent (dashboard/KPI tasks)
SEASON_TOOLS = [
    "get_team_season_stats",
    "get_player_season_stats",
    "get_scoring_patterns",
    "get_turnover_analysis",
    "get_attendance_data",
    "get_team_gps_summary",
    "get_player_gps_stats",
    "get_match_events",
    "get_match_summary",
    "get_stats_by_half",
    "search_players",
]

# Tools for player-level tasks (season story, insights, challenges)
PLAYER_TOOLS = [
    "search_players",
    "get_player_season_stats",
    "get_player_gps_stats",
    "get_attendance_data",
    "get_match_events",
    "get_match_summary",
    "get_scoring_patterns",
]

# Tools for training session tasks
TRAINING_TOOLS = [
    "get_training_session_gps",
    "get_team_gps_summary",
    "get_attendance_data",
    "search_players",
]

MAX_SEASON_TURNS = 5


class SeasonAgent:
    """Agentic Season Intelligence — analyses accumulated season data."""

    # -------------------------------------------------------------------------
    # CORE: Agentic season analysis with tool loop
    # -------------------------------------------------------------------------

    @staticmethod
    async def analyze_season(
        db: AsyncSession,
        task: str,
        context: dict,
        club_id: UUID = None,
        model: str = "claude-sonnet-4-20250514",
        max_turns: int = MAX_SEASON_TURNS,
        tool_names: list[str] = None,
    ) -> dict:
        """
        Agentic season analysis with tool loop.

        Args:
            db: Database session
            task: Task type (kpi_insights, insight_alerts, season_story, etc.)
            context: Pre-computed data (KPI cards, outliers, player context, etc.)
            club_id: Club UUID for scoping
            model: Claude model ID (Sonnet for dashboard tasks, Haiku for player tasks)
            max_turns: Maximum tool loop iterations
            tool_names: Tool names to include (defaults to SEASON_TOOLS)
        """
        # Get club context for prompt personalisation
        club_name, club_context_str = await get_club_context(db, club_id)

        # Get fixture context
        fixture_context = await get_fixture_context(db)

        # Get RAG context
        try:
            rag_query = _task_to_rag_query(task)
            kb_context = await RAGService.get_context_for_query(
                db, rag_query, context_type='analytics', max_tokens=2000
            )
        except Exception as e:
            logger.warning(f"RAG context retrieval failed: {e}")
            kb_context = ""

        system_prompt = _build_season_system_prompt(task, kb_context, fixture_context, context, club_name, club_context_str)
        user_message = _build_season_user_message(task, context)
        tools = get_tools_subset(tool_names or SEASON_TOOLS)

        messages = [{"role": "user", "content": user_message}]

        # Initial call
        response = client.messages.create(
            model=model,
            max_tokens=4000,
            system=system_prompt,
            tools=tools,
            messages=messages,
        )

        # Tool loop
        turns = 0
        while response.stop_reason == "tool_use" and turns < max_turns:
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
                    tool_result = await execute_tool(block.name, block.input, db)
                    logger.info(f"Season tool {block.name} returned {len(tool_result)} chars (turn {turns}, task={task})")
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": tool_result,
                    })

            messages.append({"role": "assistant", "content": assistant_content})
            messages.append({"role": "user", "content": tool_results})

            response = client.messages.create(
                model=model,
                max_tokens=4000,
                system=system_prompt,
                tools=tools,
                messages=messages,
            )

        # Extract final text
        final_text = ""
        for block in response.content:
            if hasattr(block, "text"):
                final_text += block.text

        # Parse structured output based on task
        return _parse_season_response(task, final_text)

    # -------------------------------------------------------------------------
    # KPI INSIGHTS wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_kpi_insights(
        db: AsyncSession,
        kpi_data: dict,
        fixture_context: str = "",
    ) -> dict[str, str]:
        """
        Generate dynamic, team-specific insights for each KPI card.
        Wrapper that calls analyze_season(task="kpi_insights").
        """
        try:
            context = {
                "kpi_data": kpi_data,
                "fixture_context": fixture_context,
            }
            result = await SeasonAgent.analyze_season(db, "kpi_insights", context)
            return result.get("insights", {})
        except Exception as e:
            logger.warning(f"KPI insight generation failed: {e}")
            return {}

    # -------------------------------------------------------------------------
    # INSIGHT ALERTS wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_insight_alerts(
        db: AsyncSession,
        source: str,
        session_id=None,
        match_id=None,
    ) -> list[dict]:
        """
        Generate cross-cutting insight alerts after a data upload.
        Wrapper that calls analyze_season(task="insight_alerts").
        """
        from app.models.insight_alert import InsightAlert, AlertCategory, AlertSource
        from app.models.training_performance import TrainingGPSData
        from app.models.attendance import TrainingSession
        from app.models.match import Match
        from app.models.match_event import MatchEvent
        from datetime import timedelta
        from sqlalchemy import func

        # --- Gather context ---
        now = datetime.utcnow()
        four_weeks_ago = now - timedelta(weeks=4)

        # 1. Training context
        training_context = ""
        try:
            gps_query = (
                select(
                    TrainingSession.id,
                    TrainingSession.session_date,
                    func.avg(TrainingGPSData.total_distance).label("avg_distance"),
                    func.avg(TrainingGPSData.sprint_count).label("avg_sprints"),
                    func.avg(TrainingGPSData.max_speed).label("avg_max_speed"),
                    func.avg(TrainingGPSData.high_speed_running).label("avg_hsr"),
                    func.count(TrainingGPSData.id).label("player_count"),
                )
                .join(TrainingSession, TrainingGPSData.session_id == TrainingSession.id)
                .where(TrainingSession.session_date >= four_weeks_ago)
                .group_by(TrainingSession.id, TrainingSession.session_date)
                .order_by(TrainingSession.session_date.desc())
                .limit(12)
            )
            gps_result = await db.execute(gps_query)
            gps_rows = gps_result.all()
            if gps_rows:
                lines = []
                for row in gps_rows:
                    lines.append(
                        f"  {row.session_date}: {row.player_count} players, "
                        f"avg dist={round(row.avg_distance or 0)}m, "
                        f"avg sprints={round(row.avg_sprints or 0)}, "
                        f"avg HSR={round(row.avg_hsr or 0)}m, "
                        f"avg max speed={round(row.avg_max_speed or 0, 1)} km/h"
                    )
                training_context = "Recent training sessions (last 4 weeks):\n" + "\n".join(lines)
        except Exception as e:
            logger.warning(f"Insight context: training GPS fetch failed: {e}")

        # 2. Match context
        match_context = ""
        try:
            matches_query = (
                select(Match)
                .where(Match.status == "completed")
                .order_by(Match.match_date.desc())
                .limit(5)
            )
            matches_result = await db.execute(matches_query)
            recent_matches = matches_result.scalars().all()
            if recent_matches:
                lines = []
                for m in recent_matches:
                    lines.append(
                        f"  {m.match_date} vs {m.opponent}: "
                        f"Team {m.team_goals}-{m.team_points} "
                        f"Opp {m.opponent_goals}-{m.opponent_points}"
                    )
                match_context = "Recent match results:\n" + "\n".join(lines)
        except Exception as e:
            logger.warning(f"Insight context: match fetch failed: {e}")

        # 3. Previous undismissed insights
        previous_insights_text = ""
        try:
            prev_query = (
                select(InsightAlert)
                .where(InsightAlert.is_dismissed == False)
                .order_by(InsightAlert.created_at.desc())
                .limit(10)
            )
            prev_result = await db.execute(prev_query)
            prev_alerts = prev_result.scalars().all()
            if prev_alerts:
                lines = [f"  - [{a.category.value}] {a.title}: {a.message}" for a in prev_alerts]
                previous_insights_text = "Previous undismissed insights (do NOT repeat these):\n" + "\n".join(lines)
        except Exception as e:
            logger.warning(f"Insight context: previous insights fetch failed: {e}")

        # 4. Upload-specific context
        upload_context = ""
        if source == "training_gps" and session_id:
            try:
                sess_q = select(TrainingSession).where(TrainingSession.id == session_id)
                sess_r = await db.execute(sess_q)
                sess = sess_r.scalar_one_or_none()
                gps_q = select(TrainingGPSData).where(TrainingGPSData.session_id == session_id)
                gps_r = await db.execute(gps_q)
                gps_data = gps_r.scalars().all()
                if sess and gps_data:
                    lines = [f"Just uploaded: Training session {sess.session_date}, {len(gps_data)} players"]
                    for g in gps_data[:10]:
                        lines.append(
                            f"  {g.player_name}: dist={g.total_distance}m, sprints={g.sprint_count}, "
                            f"HSR={g.high_speed_running}m, max_speed={g.max_speed} km/h"
                        )
                    upload_context = "\n".join(lines)
            except Exception as e:
                logger.warning(f"Insight context: upload specifics failed: {e}")
        elif source == "match_gps" and match_id:
            try:
                from app.models.match_gps import MatchGPSData
                match_q = select(Match).where(Match.id == match_id)
                match_r = await db.execute(match_q)
                match_obj = match_r.scalar_one_or_none()
                mgps_q = select(MatchGPSData).where(MatchGPSData.match_id == match_id)
                mgps_r = await db.execute(mgps_q)
                mgps_data = mgps_r.scalars().all()
                if match_obj and mgps_data:
                    lines = [f"Just uploaded: Match GPS for {match_obj.opponent} ({match_obj.match_date}), {len(mgps_data)} players"]
                    for g in mgps_data[:10]:
                        lines.append(
                            f"  {g.player_name}: dist={g.total_distance}m, sprints={g.sprint_count}, "
                            f"HSR={g.high_speed_running}m, max_speed={g.max_speed} km/h"
                        )
                    upload_context = "\n".join(lines)
            except Exception as e:
                logger.warning(f"Insight context: match GPS specifics failed: {e}")
        elif source == "video_sync" and match_id:
            try:
                match_q = select(Match).where(Match.id == match_id)
                match_r = await db.execute(match_q)
                match_obj = match_r.scalar_one_or_none()
                if match_obj:
                    event_count_q = select(func.count(MatchEvent.id)).where(MatchEvent.match_id == match_id)
                    event_count_r = await db.execute(event_count_q)
                    event_count = event_count_r.scalar() or 0
                    upload_context = (
                        f"Just synced: Video events for match vs {match_obj.opponent} ({match_obj.match_date}), "
                        f"{event_count} total match events after sync. "
                        f"Score: Team {match_obj.team_goals}-{match_obj.team_points} "
                        f"Opp {match_obj.opponent_goals}-{match_obj.opponent_points}"
                    )
            except Exception as e:
                logger.warning(f"Insight context: video sync specifics failed: {e}")

        # 5. Fixture context
        fixture_context = await get_fixture_context(db)

        context = {
            "training_context": training_context,
            "match_context": match_context,
            "fixture_context": fixture_context,
            "upload_context": upload_context,
            "previous_insights_text": previous_insights_text,
            "source": source,
        }

        try:
            result = await SeasonAgent.analyze_season(db, "insight_alerts", context)
            insights = result.get("alerts", [])

            if not isinstance(insights, list):
                return []

            # Persist to DB
            source_map = {
                "training_gps": AlertSource.TRAINING_GPS,
                "match_gps": AlertSource.MATCH_GPS,
                "video_sync": AlertSource.VIDEO_SYNC,
                "manual": AlertSource.MANUAL,
            }
            source_enum = source_map.get(source, AlertSource.MATCH_GPS)
            created = []
            for ins in insights[:3]:
                try:
                    cat_val = ins.get("category", "tactical")
                    category_enum = AlertCategory(cat_val)
                except ValueError:
                    category_enum = AlertCategory.TACTICAL

                alert = InsightAlert(
                    category=category_enum,
                    source=source_enum,
                    title=ins.get("title", "Insight")[:200],
                    message=ins.get("message", ""),
                    severity=ins.get("severity", "info"),
                    session_id=session_id,
                    match_id=match_id,
                    dashboard=ins.get("dashboard", "both"),
                )
                db.add(alert)
                created.append({
                    "id": str(alert.id),
                    "category": alert.category.value,
                    "title": alert.title,
                    "message": alert.message,
                    "severity": alert.severity,
                    "dashboard": alert.dashboard,
                })

            await db.commit()
            logger.info(f"Generated {len(created)} insight alerts from {source}")
            return created

        except Exception as e:
            logger.error(f"Insight alert generation failed: {e}")
            return []

    # -------------------------------------------------------------------------
    # DASHBOARD CHARTS wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_dashboard_charts(
        db: AsyncSession,
        excluded_chart_ids: list[str] = None,
        num_charts: int = 4,
    ) -> dict:
        """Generate Recharts-compatible chart specs for the dashboard via agentic analysis."""
        from app.services.ai.chart_engine import _get_raw_data_for_charts

        excluded_chart_ids = excluded_chart_ids or []
        raw_data = await _get_raw_data_for_charts(db)

        context = {
            "raw_data": raw_data,
            "excluded_chart_ids": excluded_chart_ids,
            "num_charts": num_charts,
        }

        try:
            result = await SeasonAgent.analyze_season(db, "dashboard_charts", context)
            return {
                "success": True,
                "charts": result.get("charts", []),
                "summary": result.get("summary", ""),
                "generated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Dashboard chart generation failed: {e}")
            return {
                "success": False,
                "error": str(e),
                "charts": [],
            }

    # -------------------------------------------------------------------------
    # SINGLE CHART wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_single_chart(
        db: AsyncSession,
        excluded_chart_ids: list[str] = None,
    ) -> dict:
        """Generate a single replacement chart when one is dismissed."""
        result = await SeasonAgent.generate_dashboard_charts(db, excluded_chart_ids, num_charts=1)

        if result.get("success") and result.get("charts"):
            return {"success": True, "chart": result["charts"][0]}
        else:
            return {"success": False, "error": result.get("error", "Failed to generate chart")}

    # -------------------------------------------------------------------------
    # CHART RECOMMENDATIONS wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def get_dynamic_chart_recommendations(db: AsyncSession) -> dict:
        """Let the Season Agent decide which charts are most relevant."""
        context = {"task_detail": "recommendations"}
        try:
            result = await SeasonAgent.analyze_season(db, "chart_recommendations", context)
            return {
                "recommendations": result,
                "season_state": {},
                "generated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Chart recommendations failed: {e}")
            return {
                "recommendations": {"error": str(e)},
                "season_state": {},
                "generated_at": datetime.now().isoformat(),
            }

    # -------------------------------------------------------------------------
    # OUTLIER SUGGESTIONS wrapper
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_outlier_suggestions(
        db: AsyncSession,
        outliers: list[dict],
        max_suggestions: int = 3,
    ) -> dict:
        """Generate chart specs for detected seasonal outliers."""
        if not outliers:
            return {"success": True, "suggestions": []}

        context = {
            "outliers": outliers[:max_suggestions],
        }
        try:
            result = await SeasonAgent.analyze_season(db, "outlier_suggestions", context)
            suggestions = result.get("suggestions", [])

            for i, s in enumerate(suggestions):
                if i < len(outliers):
                    s["outlier_category"] = outliers[i].get("category", "")
                    s["outlier_description"] = outliers[i].get("description", "")

            return {
                "success": True,
                "suggestions": suggestions,
                "generated_at": datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Outlier suggestion generation failed: {e}")
            return {"success": False, "suggestions": [], "error": str(e)}

    # -------------------------------------------------------------------------
    # SEASON STORY wrapper (absorbed from season_story_agent.py)
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_season_story(db: AsyncSession, player_id: UUID, club_id: UUID) -> dict:
        """
        Generate a 2-3 sentence narrative about the player's season.
        Returns {"story": str | None, "generated_at": str}
        """
        from app.models.player import Player

        try:
            player_result = await db.execute(select(Player).where(Player.id == player_id))
            player = player_result.scalar_one_or_none()
            if not player:
                return {"story": None, "generated_at": datetime.utcnow().isoformat()}

            context = {
                "player_id": str(player_id),
                "player_name": player.name,
                "first_name": player.name.split()[0] if player.name else "This player",
                "club_id": str(club_id),
            }

            result = await SeasonAgent.analyze_season(
                db, "season_story", context,
                club_id=club_id,
                model="claude-haiku-4-5-20251001",
                max_turns=3,
                tool_names=PLAYER_TOOLS,
            )

            story = result.get("text", "").strip() or None
            return {
                "story": story,
                "generated_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Season story generation failed: {e}")
            return {"story": None, "generated_at": datetime.utcnow().isoformat()}

    # -------------------------------------------------------------------------
    # PLAYER INSIGHTS wrapper (absorbed from player_insights_agent.py)
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_player_insights(db: AsyncSession, player_id: UUID, club_id: UUID) -> dict:
        """
        Generate 3-5 personalized AI insight bullets for a player.
        Returns {"insights": [...], "generated_at": str}
        """
        try:
            context = {
                "player_id": str(player_id),
                "club_id": str(club_id),
            }

            result = await SeasonAgent.analyze_season(
                db, "player_insights", context,
                club_id=club_id,
                model="claude-haiku-4-5-20251001",
                max_turns=3,
                tool_names=PLAYER_TOOLS,
            )

            raw = result.get("text", "")
            # Parse bullets (handle both "- " and "• " prefixes)
            insights = []
            for line in raw.strip().split("\n"):
                line = line.strip()
                if line.startswith(("- ", "• ", "* ")):
                    line = line[2:].strip()
                if line:
                    insights.append(line)

            return {
                "insights": insights[:5],
                "generated_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Player insights generation failed: {e}")
            return {"insights": [], "generated_at": datetime.utcnow().isoformat()}

    # -------------------------------------------------------------------------
    # PLAYER CHALLENGES wrapper (absorbed from challenge_agent.py)
    # -------------------------------------------------------------------------

    @staticmethod
    async def generate_player_challenges(db: AsyncSession, player_id: UUID, club_id: UUID) -> list[dict]:
        """
        Generate 2-3 personalized challenges for a player.
        Returns list of dicts with: title, description, category, metric_key, target_value, evaluation_window
        """
        try:
            context = {
                "player_id": str(player_id),
                "club_id": str(club_id),
            }

            result = await SeasonAgent.analyze_season(
                db, "player_challenges", context,
                club_id=club_id,
                model="claude-haiku-4-5-20251001",
                max_turns=3,
                tool_names=PLAYER_TOOLS,
            )

            challenges = result.get("challenges", [])
            if not isinstance(challenges, list) or not challenges:
                return _fallback_challenges()

            # Validate structure
            valid = []
            for c in challenges:
                if all(k in c for k in ("title", "category", "metric_key", "target_value", "evaluation_window")):
                    valid.append({
                        "title": str(c["title"])[:200],
                        "description": str(c.get("description", ""))[:500] or None,
                        "category": str(c["category"])[:20],
                        "metric_key": str(c["metric_key"])[:50],
                        "target_value": float(c["target_value"]),
                        "evaluation_window": int(c["evaluation_window"]),
                    })

            return valid if valid else _fallback_challenges()
        except Exception as e:
            logger.error(f"Challenge generation failed: {e}")
            return _fallback_challenges()

    # -------------------------------------------------------------------------
    # TRAINING SESSION SUMMARY wrapper (absorbed from training_agent.py)
    # -------------------------------------------------------------------------

    @staticmethod
    async def analyze_training_session(db: AsyncSession, session_id: str) -> dict:
        """
        Generate a 1-2 sentence AI summary of a training GPS session.
        Returns {"summary": str, "generated_at": str} or {"summary": None} on failure.
        """
        try:
            context = {
                "session_id": session_id,
            }

            result = await SeasonAgent.analyze_season(
                db, "training_summary", context,
                model="claude-haiku-4-5-20251001",
                max_turns=3,
                tool_names=TRAINING_TOOLS,
            )

            summary = result.get("text", "").strip() or None
            return {
                "summary": summary,
                "generated_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Training session analysis failed: {e}")
            return {"summary": None}


# =============================================================================
# Fallback challenges (static)
# =============================================================================

def _fallback_challenges() -> list[dict]:
    """Static fallback challenges if AI generation fails."""
    return [
        {
            "title": "Score in your next 2 matches",
            "description": "Register at least 1 point from play in each of your next 2 appearances.",
            "category": "scoring",
            "metric_key": "total_score_value",
            "target_value": 2.0,
            "evaluation_window": 2,
        },
        {
            "title": "Win 3 turnovers this week",
            "description": "Force turnovers through pressure and positioning.",
            "category": "defence",
            "metric_key": "turnovers_won",
            "target_value": 3.0,
            "evaluation_window": 3,
        },
    ]


# =============================================================================
# Private helpers — prompt building and response parsing
# =============================================================================

def _task_to_rag_query(task: str) -> str:
    """Map task to RAG retrieval query."""
    queries = {
        "kpi_insights": "GAA season KPI dashboard performance metrics scoring turnovers kickouts",
        "insight_alerts": "GAA performance patterns training match cross-cutting trends workload",
        "dashboard_charts": "GAA analytics dashboard charts scoring turnovers kickouts possession",
        "chart_recommendations": "GAA analytics dashboard performance metrics GPS scoring",
        "outlier_suggestions": "GAA analytics seasonal trends outliers performance spikes",
        "full_review": "GAA season review performance analysis tactical patterns GPS",
        "season_story": "GAA player season performance narrative scoring benchmarks",
        "player_insights": "GAA player performance goals targets scoring benchmarks training",
        "player_challenges": "GAA player performance goals targets scoring benchmarks training",
        "training_summary": "GAA training session GPS performance workload benchmarks",
    }
    return queries.get(task, "GAA football analytics season analysis")


def _build_season_system_prompt(task: str, kb_context: str, fixture_context: str, context: dict, club_name: str = "the team", club_context_str: str = "") -> str:
    """Build the system prompt for the Season Agent based on task type."""

    base = f"""You are an elite GAA performance analyst for {club_name}.
You have tools available to query season data, player stats, scoring patterns, and more.
Use the tools to gather data before providing your analysis.

{GAA_ESSENTIALS}
{club_context_str}

## Knowledge Base Context
{kb_context}

{fixture_context}

## Static Charts Already on Dashboards — DO NOT duplicate these
{STATIC_CHARTS_TEXT}
"""

    if task == "kpi_insights":
        kpi_data = context.get("kpi_data", {})
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
            f"Team: {meta.get('matches_played', 0)} matches played, "
            f"{meta.get('win_rate', 0)}% win rate "
            f"({meta.get('wins', 0)}W-{meta.get('losses', 0)}L-{meta.get('draws', 0)}D)"
        )

        fixture_section = context.get("fixture_context", "")
        if fixture_section:
            fixture_section = f"""
{fixture_section}

- When relevant, link a KPI trend to the upcoming fixture
- Do NOT force a fixture reference into every insight — only where it adds genuine value"""

        base += f"""
## Task: Generate KPI Insights
Generate a SHORT, punchy insight for each KPI card.

## Rules
- Each insight MUST be 1 sentence, max 15 words
- Reference the TREND data — say whether it's improving, declining, or steady
- Use "we/our" voice (you're part of the coaching team)
- Be specific with numbers when the trend data shows a clear change
- Use GAA terminology naturally (kickouts, turnovers, frees, the posts, etc.)
- Vary your tone — don't start every insight the same way
- Use tools to look up additional data if a KPI trend needs context

## Season Context
{meta_str}
{fixture_section}

## KPI Cards
{chr(10).join(cards_summary)}

Return ONLY valid JSON: {{"productivity": "...", "turnover_diff": "...", "kickout_retention": "...", "shot_efficiency": "...", "fouls_per_game": "...", "avg_scored": "...", "avg_conceded": "..."}}
"""

    elif task == "insight_alerts":
        base += f"""
## Task: Generate Cross-Cutting Insight Alerts
Detect patterns that connect training to match performance, multi-week trends, player trajectory changes.

## Rules
1. Focus on CROSS-CUTTING patterns: training→match links, multi-week trends, player trajectory changes
2. Reference SPECIFIC numbers and player names — no vague observations
3. Do NOT narrate what the static charts already show
4. Do NOT repeat previous insights (listed in context below)
5. Return 0 insights if nothing is genuinely noteworthy — quality over quantity
6. Each insight must be actionable for a GAA manager
7. If there's an upcoming fixture, consider preparation relevance
8. Use tools to gather additional data if you see something interesting
9. Return a JSON array of 0-3 insight objects

## Context
{context.get('training_context', '')}
{context.get('match_context', '')}
{context.get('upload_context', '')}
{context.get('previous_insights_text', '')}

Source of this upload: {context.get('source', 'unknown')}

## JSON format for each insight:
{{
    "category": "warning" | "positive" | "tactical" | "workload",
    "title": "Short heading (max 100 chars)",
    "message": "1-3 sentences with specific numbers/names",
    "severity": "info" | "watch" | "action",
    "dashboard": "season" | "training" | "both"
}}

Return ONLY a valid JSON array. If nothing noteworthy, return [].
"""

    elif task == "dashboard_charts":
        raw_data = context.get("raw_data", {})
        num_charts = context.get("num_charts", 4)
        excluded = context.get("excluded_chart_ids", [])

        # Pre-calculate key stats
        matches = raw_data.get("matches", [])
        events = raw_data.get("events", [])

        team_events = [e for e in events if e.get("team") == "own"]
        opp_events = [e for e in events if e.get("team") == "opponent"]

        tm_goals = len([e for e in team_events if e.get("event_type") == "goal"])
        tm_points = len([e for e in team_events if e.get("event_type") == "point"])
        tm_two_pts = len([e for e in team_events if e.get("event_type") == "two_point"])
        opp_goals = len([e for e in opp_events if e.get("event_type") == "goal"])
        opp_points = len([e for e in opp_events if e.get("event_type") == "point"])
        opp_two_pts = len([e for e in opp_events if e.get("event_type") == "two_point"])

        tm_total = tm_goals * 3 + tm_points + tm_two_pts * 2
        opp_total = opp_goals * 3 + opp_points + opp_two_pts * 2

        # Match results
        match_results = []
        for match in matches:
            match_events = [e for e in events if e.get("match_id") == match.get("id")]
            d_goals = len([e for e in match_events if e.get("team") == "own" and e.get("event_type") == "goal"])
            d_pts = len([e for e in match_events if e.get("team") == "own" and e.get("event_type") in ["point", "two_point"]])
            d_2pts = len([e for e in match_events if e.get("team") == "own" and e.get("event_type") == "two_point"])
            o_goals = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") == "goal"])
            o_pts = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") in ["point", "two_point"]])
            o_2pts = len([e for e in match_events if e.get("team") == "opponent" and e.get("event_type") == "two_point"])

            d_score = d_goals * 3 + d_pts + d_2pts
            o_score = o_goals * 3 + o_pts + o_2pts

            result_val = "W" if d_score > o_score else ("L" if d_score < o_score else "D")
            match_results.append({
                "opponent": match.get("opponent"),
                "team_score": f"{d_goals}-{d_pts + d_2pts}",
                "team_total": d_score,
                "opponent_score": f"{o_goals}-{o_pts + o_2pts}",
                "opponent_total": o_score,
                "result": result_val,
            })

        # Top scorers
        player_scores = {}
        for e in team_events:
            if e.get("event_type") in ["goal", "point", "two_point"] and e.get("player"):
                player = e.get("player")
                if player not in player_scores:
                    player_scores[player] = {"goals": 0, "points": 0, "two_pointers": 0, "total_score": 0}
                if e.get("event_type") == "goal":
                    player_scores[player]["goals"] += 1
                    player_scores[player]["total_score"] += 3
                elif e.get("event_type") == "two_point":
                    player_scores[player]["two_pointers"] += 1
                    player_scores[player]["total_score"] += 2
                else:
                    player_scores[player]["points"] += 1
                    player_scores[player]["total_score"] += 1

        turnovers_won = len([e for e in team_events if e.get("event_type") == "turnover_won"])
        turnovers_lost = len([e for e in team_events if e.get("event_type") == "turnover_lost"])

        excluded_str = f"\nDO NOT generate these chart types (user dismissed them): {', '.join(excluded)}" if excluded else ""

        base += f"""
## Task: Generate {num_charts} Dashboard Charts
Generate actual Recharts-compatible chart specifications.

## ACTUAL SEASON DATA (Use these exact numbers!)
### Matches Played: {len(matches)} (completed only)
### Match Results:
{json.dumps(match_results, indent=2)}

### Season Totals:
- Team: {tm_goals} goals, {tm_points} points, {tm_two_pts} two-pointers = {tm_total} total
- Opponents: {opp_goals} goals, {opp_points} points, {opp_two_pts} two-pointers = {opp_total} total

### Turnovers: Won {turnovers_won}, Lost {turnovers_lost}, Net {turnovers_won - turnovers_lost}

## Chart Design — Think Like a GAA Manager
Find PATTERNS not visible from the scoreboard:
1. Temporal Patterns — scoring by 5-minute windows
2. Efficiency Metrics — conversion by zone
3. Phase Analysis — 1st half vs 2nd half
4. Kickout Patterns — own vs opposition
5. Turnover Geography — where do they happen
6. Player Comparisons
7. Match Momentum — cumulative score difference
{excluded_str}

## Response Format
Return a JSON object:
{{
    "charts": [
        {{
            "id": "unique_chart_id",
            "type": "line|bar|pie|scatter|area|composed",
            "title": "Chart Title",
            "insight": "One sentence insight with specific numbers",
            "data": [...],
            "config": {{
                "xKey": "name",
                "dataKeys": ["value1", "value2"],
                "colors": ["#10b981", "#06b6d4"],
                "stacked": false,
                "showLegend": true
            }}
        }}
    ],
    "summary": "Brief explanation"
}}

IMPORTANT:
- Use ACTUAL data, not made-up numbers
- ONLY use colors: #10b981, #06b6d4, #f59e0b, #F97316, #14b8a6. Never red.
- Use GAA terminology
- Use tools to gather additional data if needed for charts
- For pie charts: every data item MUST have a "name" field
- Goals = COUNT of goals (NOT multiplied by 3)
"""

    elif task == "chart_recommendations":
        base += """
## Task: Recommend Charts for Dashboard
Analyze the current season state and recommend which charts would be most valuable.
Use tools to check what data is available.

Return a JSON object:
{
    "recommended_charts": [
        {"chart_type": "chart_id", "priority": 1-10, "reason": "Why valuable"}
    ],
    "insights": "Brief explanation of why these charts were chosen",
    "suggested_new_charts": [
        {"description": "A chart not in the list that would be valuable", "when_relevant": "When this becomes useful"}
    ]
}
"""

    elif task == "outlier_suggestions":
        outliers = context.get("outliers", [])
        base += f"""
## Task: Generate Charts for Seasonal Outliers
You have been given detected outliers. Generate Recharts chart specs for each.

## Outliers
{json.dumps(outliers, indent=2, default=str)}

## Response Format
Return a JSON object:
{{
    "suggestions": [
        {{
            "id": "outlier_<index>",
            "title": "Short chart title",
            "teaser": "One line preview text (under 80 chars)",
            "type": "bar|line|area|pie",
            "insight": "1-2 sentence tactical insight",
            "data": [...],
            "config": {{
                "xKey": "...",
                "dataKeys": ["..."],
                "colors": ["#10b981"],
                "showLegend": true/false,
                "stacked": false
            }}
        }}
    ]
}}

ONLY use colors: #10b981, #06b6d4, #f59e0b, #F97316, #14b8a6. Never red.
Use tools to gather additional data if needed.
"""

    elif task == "season_story":
        first_name = context.get("first_name", "This player")
        player_id = context.get("player_id", "")
        base += f"""
## Task: Generate Season Story for {first_name}
Write exactly 2-3 sentences of flowing prose as a GAA journalist.

## Instructions
1. First use search_players to find the player, then use get_player_season_stats with their UUID to get scoring/defence stats.
2. Use get_player_gps_stats to check for GPS trends.
3. Use get_attendance_data with the player_id to check training attendance.
4. Write a narrative using the player's first name ({first_name}).
5. Be specific with numbers and mention month names where relevant.
6. Highlight their best performances and trajectory.
7. Be encouraging but grounded in data.

Player ID: {player_id}

Return ONLY prose — no bullet points, no headers, no JSON, no quotation marks.
"""

    elif task == "player_insights":
        player_id = context.get("player_id", "")
        base += f"""
## Task: Generate Player Insights
Generate 3-5 personalized insight bullets for a player.

## Instructions
1. Use get_player_season_stats with player_id '{player_id}' to get scoring/defence stats.
2. Use get_player_gps_stats to check GPS performance trends.
3. Use get_attendance_data with the player_id to check training attendance.
4. Each bullet should be a single sentence with a specific stat.
5. Highlight strengths, areas for improvement, and comparisons.
6. Be encouraging but honest. Use concrete numbers.

Player ID: {player_id}

Return ONLY bullet points (each line starting with "- "). No headers, no JSON.
"""

    elif task == "player_challenges":
        player_id = context.get("player_id", "")
        base += f"""
## Task: Generate Player Challenges
Generate 2-3 personalized weekly challenges for a GAA player.

## Instructions
1. Use get_player_season_stats with player_id '{player_id}' to get their current stats.
2. Use get_player_gps_stats to check GPS data.
3. Use get_attendance_data with the player_id to check attendance rate.
4. Base targets on the player's actual averages — make them achievable but stretching.

## GAA Realism Rules
- Challenges are evaluated as CUMULATIVE TOTALS across the evaluation_window, not per-match.
- target_value is the TOTAL across all matches in the window.
- Goals are rare in GAA — most club players average 0-1 goals per match.
- Points from play are more common: a forward might score 0-3 to 0-5 per match.
- Attendance streak challenges should use small windows (3-5 sessions).

Player ID: {player_id}

Return ONLY a valid JSON array of 2-3 challenge objects:
[
    {{
        "title": "short actionable challenge (max 80 chars)",
        "description": "1 sentence of context",
        "category": "scoring|fitness|attendance|defence",
        "metric_key": "goals_from_play|points_from_play|total_score_value|shooting_accuracy|turnovers_won|blocks|total_distance_m|sprint_count|attendance_streak",
        "target_value": <numeric cumulative threshold>,
        "evaluation_window": <2-5 matches/sessions>
    }}
]
"""

    elif task == "training_summary":
        session_id = context.get("session_id", "")
        base += f"""
## Task: Training Session Summary
Generate a 1-2 sentence summary of a training GPS session as an S&C analyst.

## Instructions
1. Use get_training_session_gps with session_id '{session_id}' to get per-player GPS data and recent averages.
2. Compare this session's averages to recent session averages (provided in the tool response).
3. Be specific with numbers. Mention standout performers or concerns if any.
4. If recent averages are available, say things like "distance 15% below recent 4-session average" rather than just bare stats.

Return ONLY 1-2 sentences of prose. No bullet points, no JSON, no headers.
"""

    return base


def _build_season_user_message(task: str, context: dict) -> str:
    """Build the user message for the Season Agent based on task type."""
    if task == "kpi_insights":
        return "Analyze the KPI cards and generate insights. Use tools to get additional context if any KPI trend is surprising. Return JSON."
    elif task == "insight_alerts":
        return "Analyze the provided data for cross-cutting patterns. Use tools to investigate anything that looks noteworthy. Return your insights as a JSON array."
    elif task == "dashboard_charts":
        num = context.get("num_charts", 4)
        return f"Generate {num} dashboard charts based on the season data. Use tools to get any additional data you need. Return valid JSON only."
    elif task == "chart_recommendations":
        return "Based on the current season data, which charts should be displayed? Use tools to check data availability. Return JSON."
    elif task == "outlier_suggestions":
        return "Generate chart specs for the provided outliers. Use tools to get additional context. Return JSON."
    elif task == "season_story":
        player_id = context.get("player_id", "")
        return f"Write a season story for the player (ID: {player_id}). Use tools to gather their stats first."
    elif task == "player_insights":
        player_id = context.get("player_id", "")
        return f"Generate personalized insights for the player (ID: {player_id}). Use tools to gather their stats first."
    elif task == "player_challenges":
        player_id = context.get("player_id", "")
        return f"Generate personalized challenges for the player (ID: {player_id}). Use tools to gather their stats first. Return JSON array."
    elif task == "training_summary":
        session_id = context.get("session_id", "")
        return f"Summarize this training session (ID: {session_id}). Use get_training_session_gps to fetch the data."
    else:
        return "Provide a comprehensive season review. Use tools to gather all available data."


def _parse_season_response(task: str, response_text: str) -> dict:
    """Parse the Season Agent's response based on task type."""
    if task == "kpi_insights":
        # Extract JSON object
        try:
            raw = response_text.strip()
            if raw.startswith("```"):
                raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
                if raw.endswith("```"):
                    raw = raw[:-3]
                raw = raw.strip()
            # Try direct parse first
            try:
                return {"insights": json.loads(raw)}
            except json.JSONDecodeError:
                pass
            # Fallback: extract JSON object from within agent text
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                parsed = json.loads(json_match.group())
                if isinstance(parsed, dict):
                    return {"insights": parsed}
            return {"insights": {}}
        except Exception as e:
            logger.warning(f"KPI insights parse failed: {e}")
            return {"insights": {}}

    elif task == "insight_alerts":
        # Extract JSON array
        try:
            json_match = re.search(r'\[[\s\S]*\]', response_text)
            if json_match:
                alerts = json.loads(json_match.group())
                return {"alerts": alerts if isinstance(alerts, list) else []}
            return {"alerts": []}
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Insight alerts parse failed: {e}")
            return {"alerts": []}

    elif task in ("dashboard_charts", "chart_recommendations", "outlier_suggestions"):
        # Extract JSON object
        try:
            json_match = re.search(r'\{[\s\S]*\}', response_text)
            if json_match:
                return json.loads(json_match.group())
            return {}
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Season response parse failed for {task}: {e}")
            return {}

    elif task == "player_challenges":
        # Extract JSON array of challenge objects
        try:
            json_match = re.search(r'\[[\s\S]*\]', response_text)
            if json_match:
                challenges = json.loads(json_match.group())
                return {"challenges": challenges if isinstance(challenges, list) else []}
            return {"challenges": []}
        except (json.JSONDecodeError, Exception) as e:
            logger.warning(f"Player challenges parse failed: {e}")
            return {"challenges": []}

    # season_story, player_insights, training_summary — return raw text
    return {"text": response_text}
