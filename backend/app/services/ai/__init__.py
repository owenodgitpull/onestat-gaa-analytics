"""
AI Service facade — re-exports all public functions for backward compatibility.

Three agentic agents:
- MatchAgent: Live insights (Haiku agentic) + post-match analysis (Sonnet agentic)
- SeasonAgent: Season-level intelligence (Sonnet agentic) — KPI, charts, alerts
- ChatAgent: Conversational analyst (Sonnet agentic)

Consumers can import from `app.services.ai` instead of individual modules.
"""

# Match Agent
from app.services.ai.match_agent import MatchAgent
# Backwards-compatible aliases
analyze_match = MatchAgent.analyze_match
generate_post_match_report = MatchAgent.generate_post_match_report
analyze_match_gps = MatchAgent.analyze_match_gps
live_match_insight = MatchAgent.live_insight

# Season Agent
from app.services.ai.season_agent import SeasonAgent
generate_kpi_insights = SeasonAgent.generate_kpi_insights
generate_insight_alerts = SeasonAgent.generate_insight_alerts
generate_dashboard_charts = SeasonAgent.generate_dashboard_charts
generate_single_chart = SeasonAgent.generate_single_chart
get_dynamic_chart_recommendations = SeasonAgent.get_dynamic_chart_recommendations
generate_outlier_suggestions = SeasonAgent.generate_outlier_suggestions

# Chat Agent — unchanged
from app.services.ai.chat_agent import chat_with_analyst, chat_with_analyst_stream

# Player & training tasks — now on SeasonAgent
generate_season_story = SeasonAgent.generate_season_story
generate_player_insights = SeasonAgent.generate_player_insights
generate_player_challenges = SeasonAgent.generate_player_challenges
analyze_training_session = SeasonAgent.analyze_training_session
generate_weekly_brief = SeasonAgent.generate_weekly_brief

# Shared utilities
from app.services.ai._shared import get_fixture_context, get_weather_context, STATIC_CHARTS

# Video agents
from app.services.ai.video_enrichment_agent import generate_video_match_report, enrich_video_events
from app.services.ai.gemini_video_agent import analyze_video_with_gemini
from app.services.ai.keyframe_video_agent import analyze_batch as keyframe_analyze_batch, deduplicate_events, calculate_possession

# Chart engine utility (for direct codegen chart requests)
from app.services.ai.chart_engine import _execute_chart_codegen as generate_agentic_chart

__all__ = [
    # Match Agent
    "MatchAgent",
    "analyze_match",
    "generate_post_match_report",
    "analyze_match_gps",
    "live_match_insight",
    # Season Agent
    "SeasonAgent",
    "generate_kpi_insights",
    "generate_insight_alerts",
    "generate_dashboard_charts",
    "generate_single_chart",
    "get_dynamic_chart_recommendations",
    "generate_outlier_suggestions",
    # Chat Agent
    "chat_with_analyst",
    "chat_with_analyst_stream",
    # Other agents
    "analyze_training_session",
    "generate_player_insights",
    "generate_player_challenges",
    "generate_season_story",
    "generate_weekly_brief",
    # Shared
    "get_fixture_context",
    "get_weather_context",
    "STATIC_CHARTS",
    # Video
    "generate_video_match_report",
    "enrich_video_events",
    "analyze_video_with_gemini",
    "keyframe_analyze_batch",
    "deduplicate_events",
    "calculate_possession",
    # Chart engine
    "generate_agentic_chart",
]
