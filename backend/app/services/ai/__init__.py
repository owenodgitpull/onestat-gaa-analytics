"""
AI Service facade — re-exports all public functions for backward compatibility.

Consumers can import from `app.services.ai` instead of individual modules.
"""

from app.services.ai.post_match_agent import (
    analyze_match,
    generate_post_match_report,
    analyze_match_gps,
)
from app.services.ai.live_match_agent import live_match_insight
from app.services.ai.chat_agent import chat_with_analyst
from app.services.ai.training_agent import analyze_training_session
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
    "chat_with_analyst",
    "analyze_training_session",
    "get_dynamic_chart_recommendations",
    "get_chart_analysis",
    "generate_agentic_chart",
    "generate_custom_insight",
    "generate_dashboard_charts",
    "generate_single_chart",
    "generate_outlier_suggestions",
]
