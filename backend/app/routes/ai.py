"""
AI Analysis API Routes.

Provides endpoints for:
- Match analysis (post-match)
- Live match insights
- Conversational analyst chat
- Post-match report generation
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import Optional, List
import logging

from app.database import get_db
from app.services.ai import (
    analyze_match,
    live_match_insight,
    chat_with_analyst,
    generate_post_match_report,
    get_dynamic_chart_recommendations,
    get_chart_analysis,
    generate_agentic_chart,
    generate_custom_insight,
    generate_dashboard_charts,
    generate_single_chart,
    analyze_match_gps,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class MatchAnalysisRequest(BaseModel):
    match_id: str
    question: Optional[str] = None


class LiveInsightRequest(BaseModel):
    match_id: str
    recent_events: List[dict]


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    conversation_history: List[ChatMessage] = []
    message: str


class AnalysisResponse(BaseModel):
    analysis: str
    match_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str


class ChartInsights(BaseModel):
    possession: Optional[str] = None
    scoring: Optional[str] = None
    shooting: Optional[str] = None


class PostMatchReportResponse(BaseModel):
    match: dict
    score: dict
    analysis: str
    insights: Optional[ChartInsights] = None
    generated_at: str
    gps_included: Optional[bool] = False
    version: Optional[int] = 1


class ChartAnalysisRequest(BaseModel):
    chart_type: str
    chart_data: dict


class ChartRecommendationsResponse(BaseModel):
    recommendations: dict
    season_state: dict
    generated_at: str


class ChartAnalysisResponse(BaseModel):
    analysis: str
    chart_type: str


class AgenticChartRequest(BaseModel):
    request: str  # Natural language chart request


class AgenticChartResponse(BaseModel):
    success: bool
    chart: Optional[dict] = None
    error: Optional[str] = None
    generated_code: Optional[str] = None


class CustomInsightRequest(BaseModel):
    question: str


class CustomInsightResponse(BaseModel):
    question: str
    chart_suggestion: str
    chart: dict


class DashboardChartsRequest(BaseModel):
    excluded_chart_ids: List[str] = []
    num_charts: int = 4


class ChartSpec(BaseModel):
    id: str
    type: str
    title: str
    insight: str
    data: List[dict]
    config: dict


class DashboardChartsResponse(BaseModel):
    success: bool
    charts: List[dict]
    summary: Optional[str] = None
    error: Optional[str] = None
    generated_at: Optional[str] = None


class SingleChartRequest(BaseModel):
    excluded_chart_ids: List[str] = []


class SingleChartResponse(BaseModel):
    success: bool
    chart: Optional[dict] = None
    error: Optional[str] = None


class GPSAnalysisRequest(BaseModel):
    gps_data: List[dict]
    match_info: Optional[dict] = None


class GPSAnalysisResponse(BaseModel):
    success: bool
    insights: Optional[dict] = None
    error: Optional[str] = None
    generated_at: Optional[str] = None


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/analyze-match", response_model=AnalysisResponse)
async def analyze_match_endpoint(
    request: MatchAnalysisRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze a completed match.

    Provides comprehensive tactical analysis using Claude AI.
    Can optionally answer specific questions about the match.
    """
    try:
        analysis = await analyze_match(
            db,
            request.match_id,
            request.question
        )
        return AnalysisResponse(
            analysis=analysis,
            match_id=request.match_id
        )
    except Exception as e:
        logger.error(f"Match analysis failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/live-insight", response_model=AnalysisResponse)
async def live_insight_endpoint(
    request: LiveInsightRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Get real-time tactical insight during a match.

    Optimized for speed - returns concise, actionable advice.
    Call every 5 minutes or after significant events.
    """
    try:
        insight = await live_match_insight(
            db,
            request.match_id,
            request.recent_events
        )
        return AnalysisResponse(
            analysis=insight,
            match_id=request.match_id
        )
    except Exception as e:
        logger.error(f"Live insight failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Insight generation failed: {str(e)}")


@router.post("/chat", response_model=ChatResponse)
async def chat_endpoint(
    request: ChatRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Conversational interface for the AI analyst.

    Maintains conversation context for follow-up questions.
    Can query match data, player stats, and provide tactical advice.
    """
    try:
        # Convert ChatMessage models to dicts
        history = [{"role": m.role, "content": m.content} for m in request.conversation_history]

        response = await chat_with_analyst(
            db,
            history,
            request.message
        )
        return ChatResponse(response=response)
    except Exception as e:
        logger.error(f"Chat failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@router.get("/post-match-report/{match_id}", response_model=PostMatchReportResponse)
async def post_match_report_endpoint(
    match_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a comprehensive post-match report.

    Includes:
    - Match summary
    - Key statistics
    - Player ratings
    - Tactical analysis
    - Training recommendations
    """
    try:
        report = await generate_post_match_report(db, match_id)
        return PostMatchReportResponse(**report)
    except Exception as e:
        logger.error(f"Report generation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(e)}")


@router.get("/health")
async def ai_health_check():
    """
    Check if AI service is properly configured.
    """
    import os
    api_key = os.getenv("ANTHROPIC_API_KEY")

    if not api_key:
        return {
            "status": "unconfigured",
            "message": "ANTHROPIC_API_KEY not set"
        }

    return {
        "status": "ready",
        "message": "AI service configured",
        "model": "claude-sonnet-4-20250514"
    }


@router.get("/chart-recommendations", response_model=ChartRecommendationsResponse)
async def get_chart_recommendations_endpoint(
    db: AsyncSession = Depends(get_db)
):
    """
    Get AI-powered chart recommendations for the dashboard.

    The LLM analyzes the current season state and recommends which
    charts would be most valuable to display. Charts evolve dynamically
    as more match data accumulates throughout the season.

    Early season: Basic stats, individual match breakdowns
    Mid season: Trends, comparisons, patterns emerge
    Late season: Comprehensive analysis, opponent patterns

    The LLM uses the knowledge base proactively to inform recommendations,
    including GPS data, tactical guides, and historical performance.
    """
    try:
        recommendations = await get_dynamic_chart_recommendations(db)
        return ChartRecommendationsResponse(**recommendations)
    except Exception as e:
        logger.error(f"Chart recommendations failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Recommendations failed: {str(e)}")


@router.post("/chart-analysis", response_model=ChartAnalysisResponse)
async def analyze_chart_endpoint(
    request: ChartAnalysisRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Get AI-generated analysis for a specific chart.

    Provides contextual insights about what the chart data means,
    using knowledge base context proactively (GPS benchmarks,
    historical performance, tactical principles).
    """
    try:
        analysis = await get_chart_analysis(
            db,
            request.chart_type,
            request.chart_data
        )
        return ChartAnalysisResponse(
            analysis=analysis,
            chart_type=request.chart_type
        )
    except Exception as e:
        logger.error(f"Chart analysis failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/generate-chart", response_model=AgenticChartResponse)
async def generate_chart_endpoint(
    request: AgenticChartRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Agentic chart generation using LLM-generated code.

    The LLM analyzes your request, writes Python code to transform
    the match data, and returns a Recharts-compatible chart specification.

    Example requests:
    - "Show scoring trends across all matches"
    - "Where do we lose the ball most often?"
    - "Compare first half vs second half scoring"
    - "Top scorers efficiency chart"
    """
    try:
        result = await generate_agentic_chart(db, request.request)
        return AgenticChartResponse(**result)
    except Exception as e:
        logger.error(f"Agentic chart generation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {str(e)}")


@router.post("/custom-insight", response_model=CustomInsightResponse)
async def custom_insight_endpoint(
    request: CustomInsightRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a custom visualization based on a natural language question.

    The AI determines the best chart type to answer your question,
    then generates the chart with insights.

    Example questions:
    - "Where should we focus our training on shooting?"
    - "Which players perform best under pressure?"
    - "How do we compare home vs away?"
    """
    try:
        result = await generate_custom_insight(db, request.question)
        return CustomInsightResponse(**result)
    except Exception as e:
        logger.error(f"Custom insight failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Insight generation failed: {str(e)}")


@router.post("/dashboard-charts", response_model=DashboardChartsResponse)
async def get_dashboard_charts_endpoint(
    request: DashboardChartsRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate actual Recharts-compatible chart specifications for the dashboard.

    The AI analyzes match data and generates real chart specs (not just recommendations).
    Each chart includes:
    - Actual data points
    - Recharts configuration
    - AI-generated insight

    Use excluded_chart_ids to avoid regenerating dismissed charts.
    """
    try:
        result = await generate_dashboard_charts(
            db,
            excluded_chart_ids=request.excluded_chart_ids,
            num_charts=request.num_charts
        )
        return DashboardChartsResponse(**result)
    except Exception as e:
        logger.error(f"Dashboard charts failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {str(e)}")


@router.post("/generate-replacement-chart", response_model=SingleChartResponse)
async def generate_replacement_chart_endpoint(
    request: SingleChartRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Generate a single replacement chart when one is dismissed.

    More efficient than regenerating all charts.
    Pass the IDs of dismissed charts to avoid regenerating them.
    """
    try:
        result = await generate_single_chart(
            db,
            excluded_chart_ids=request.excluded_chart_ids
        )
        return SingleChartResponse(**result)
    except Exception as e:
        logger.error(f"Replacement chart failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {str(e)}")


@router.post("/analyze-gps", response_model=GPSAnalysisResponse)
async def analyze_gps_endpoint(
    request: GPSAnalysisRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Analyze GPS data for a match and provide insights.

    Returns:
    - Overall intensity assessment
    - Player-specific alerts (recovery needs, injury risks)
    - Team patterns and trends
    - Recovery recommendations

    The AI analyzes workload distribution, identifies outliers,
    and flags players who may need extended recovery or are at risk.
    """
    try:
        result = await analyze_match_gps(
            gps_data=request.gps_data,
            match_info=request.match_info
        )
        return GPSAnalysisResponse(**result)
    except Exception as e:
        logger.error(f"GPS analysis failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"GPS analysis failed: {str(e)}")
