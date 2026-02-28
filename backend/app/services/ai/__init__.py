"""
AI Service facade — re-exports all public functions for backward compatibility.

Consumers can import from `app.services.ai` instead of individual modules.
"""

from app.services.ai.post_match_agent import (
    analyze_match,
    generate_post_match_report,
    analyze_match_gps,
)
from app.services.ai.live_match_agent import live_match_insight, generate_kpi_insights
from app.services.ai.chat_agent import chat_with_analyst, chat_with_analyst_stream
from app.services.ai.training_agent import analyze_training_session
from app.services.ai.player_insights_agent import generate_player_insights
from app.services.ai.challenge_agent import generate_player_challenges
from app.services.ai.season_story_agent import generate_season_story
from app.services.ai._shared import generate_insight_alerts, STATIC_CHARTS
from app.services.ai.video_enrichment_agent import generate_video_match_report, enrich_video_events
from app.services.ai.gemini_video_agent import analyze_video_with_gemini
from app.services.ai.keyframe_video_agent import analyze_batch as keyframe_analyze_batch, deduplicate_events, calculate_possession
from app.services.ai.chart_engine import (
    get_dynamic_chart_recommendations,
    get_chart_analysis,
    generate_agentic_chart,
    generate_custom_insight,
    generate_dashboard_charts,
    generate_single_chart,
    generate_outlier_suggestions,
)

__all__ = [
    "analyze_match",
    "generate_post_match_report",
    "analyze_match_gps",
    "live_match_insight",
    "generate_kpi_insights",
    "chat_with_analyst",
    "chat_with_analyst_stream",
    "analyze_training_session",
    "get_dynamic_chart_recommendations",
    "get_chart_analysis",
    "generate_agentic_chart",
    "generate_custom_insight",
    "generate_dashboard_charts",
    "generate_single_chart",
    "generate_outlier_suggestions",
    "generate_insight_alerts",
    "generate_player_insights",
    "generate_player_challenges",
    "generate_season_story",
    "STATIC_CHARTS",
    "generate_video_match_report",
    "enrich_video_events",
    "analyze_video_with_gemini",
    "keyframe_analyze_batch",
    "deduplicate_events",
    "calculate_possession",
]
