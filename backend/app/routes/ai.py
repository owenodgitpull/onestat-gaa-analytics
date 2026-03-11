"""
AI Analysis API Routes.

Provides endpoints for:
- Match analysis (post-match)
- Live match insights
- Conversational analyst chat
- Post-match report generation
"""

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
import json
import logging
from datetime import datetime

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin
from app.services.ai import (
    analyze_match,
    live_match_insight,
    chat_with_analyst,
    chat_with_analyst_stream,
    generate_post_match_report,
    get_dynamic_chart_recommendations,
    generate_agentic_chart,
    generate_dashboard_charts,
    generate_single_chart,
    generate_outlier_suggestions,
    analyze_match_gps,
)
from app.services.ai._shared import client as anthropic_client
from app.models.insight_alert import InsightAlert
from app.models.chat_session import ChatSession, ChatSessionMessage

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
    session_id: Optional[str] = None


class SessionRenameRequest(BaseModel):
    title: str


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


class ChartRecommendationsResponse(BaseModel):
    recommendations: dict
    season_state: dict
    generated_at: str


class AgenticChartRequest(BaseModel):
    request: str  # Natural language chart request


class AgenticChartResponse(BaseModel):
    success: bool
    chart: Optional[dict] = None
    error: Optional[str] = None
    generated_code: Optional[str] = None


class DashboardChartsRequest(BaseModel):
    excluded_chart_ids: List[str] = []
    num_charts: int = 4
    force_refresh: bool = False


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


class OutlierSuggestionsResponse(BaseModel):
    success: bool
    suggestions: List[dict] = []
    error: Optional[str] = None
    generated_at: Optional[str] = None


class GPSAnalysisRequest(BaseModel):
    gps_data: List[dict]
    match_info: Optional[dict] = None


class GPSAnalysisResponse(BaseModel):
    success: bool
    insights: Optional[dict] = None
    error: Optional[str] = None
    generated_at: Optional[str] = None


# =============================================================================
# Chat Session Title Helper
# =============================================================================

async def _generate_session_title(first_message: str) -> str:
    """Use Haiku to generate a 3-6 word title from the first user message."""
    try:
        response = anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=30,
            messages=[{
                "role": "user",
                "content": f"Generate a 3-6 word conversation title for this GAA analyst question. Return ONLY the title, no quotes or punctuation:\n\n{first_message[:200]}"
            }],
        )
        title = response.content[0].text.strip().strip('"').strip("'")
        return title[:200]
    except Exception as e:
        logger.warning(f"Title generation failed: {e}")
        return first_message[:60].strip() + ("..." if len(first_message) > 60 else "")


# =============================================================================
# Chat Session CRUD Endpoints
# =============================================================================

@router.get("/chat/sessions")
async def list_chat_sessions(
    limit: int = 50,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """List all chat sessions, newest first."""
    query = (
        select(ChatSession)
        .where(ChatSession.club_id == user.club_id)
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
    )
    result = await db.execute(query)
    sessions = result.scalars().all()

    return [
        {
            "id": str(s.id),
            "title": s.title,
            "message_count": s.message_count,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        }
        for s in sessions
    ]


@router.get("/chat/sessions/{session_id}")
async def get_chat_session(
    session_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Get a full chat session with all messages."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Eagerly load messages
    msg_result = await db.execute(
        select(ChatSessionMessage)
        .where(ChatSessionMessage.session_id == session_id)
        .order_by(ChatSessionMessage.created_at)
    )
    messages = msg_result.scalars().all()

    return {
        "id": str(session.id),
        "title": session.title,
        "messages": [
            {
                "role": m.role,
                "content": m.content,
                "visualizations": m.visualizations,
                "created_at": m.created_at.isoformat() if m.created_at else None,
            }
            for m in messages
        ],
        "created_at": session.created_at.isoformat() if session.created_at else None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }


@router.post("/chat/sessions")
async def create_chat_session(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a new empty chat session."""
    session = ChatSession(club_id=user.club_id)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return {
        "id": str(session.id),
        "title": session.title,
        "message_count": 0,
        "created_at": session.created_at.isoformat(),
        "updated_at": session.updated_at.isoformat(),
    }


@router.delete("/chat/sessions/{session_id}")
async def delete_chat_session(
    session_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session and all its messages."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"success": True, "id": session_id}


@router.patch("/chat/sessions/{session_id}")
async def rename_chat_session(
    session_id: str,
    body: SessionRenameRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Rename a chat session."""
    result = await db.execute(
        select(ChatSession).where(ChatSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.title = body.title[:200]
    session.updated_at = datetime.utcnow()
    await db.commit()
    return {"success": True, "id": session_id, "title": session.title}


# =============================================================================
# Endpoints
# =============================================================================

@router.post("/analyze-match", response_model=AnalysisResponse)
async def analyze_match_endpoint(
    request: MatchAnalysisRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
            request.message,
            club_id=user.club_id
        )
        return ChatResponse(response=response)
    except Exception as e:
        logger.error(f"Chat failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@router.post("/chat/stream")
async def chat_stream_endpoint(
    request: ChatRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Streaming conversational interface using Server-Sent Events.

    Yields SSE events:
      - {"type":"session_created","session_id":"..."} when a new session is auto-created
      - {"type":"session_title","title":"..."} when auto-title is generated
      - {"type":"thinking","tool":"tool_name"} during tool calls
      - {"type":"text","content":"chunk"} for response text
      - {"type":"chart","chart":{...}} for chart visualizations
      - {"type":"table","table":{...}} for data tables
      - {"type":"done"} when complete
      - {"type":"error","message":"..."} on failure
    """
    history = [{"role": m.role, "content": m.content} for m in request.conversation_history]

    async def persisted_stream():
        session_id = request.session_id
        session = None

        # Create or load session
        if session_id:
            result = await db.execute(
                select(ChatSession).where(ChatSession.id == session_id)
            )
            session = result.scalar_one_or_none()

        if not session:
            session = ChatSession(club_id=user.club_id)
            db.add(session)
            await db.flush()
            session_id = str(session.id)
            yield f"data: {json.dumps({'type': 'session_created', 'session_id': session_id})}\n\n"

        # Persist user message immediately (committed so it survives disconnects)
        user_msg = ChatSessionMessage(
            session_id=session.id,
            role="user",
            content=request.message,
        )
        db.add(user_msg)
        session.message_count = (session.message_count or 0) + 1
        session.updated_at = datetime.utcnow()
        await db.commit()

        # Collect assistant response
        accumulated_text = ""
        collected_vizs = []

        try:
            async for event_line in chat_with_analyst_stream(
                db, history, request.message, session_id=session_id, club_id=user.club_id
            ):
                # Parse and collect viz/text from the event
                yield event_line

                if event_line.startswith("data: "):
                    try:
                        payload = json.loads(event_line[6:].strip())
                        if payload.get("type") == "text":
                            accumulated_text += payload.get("content", "")
                        elif payload.get("type") == "chart" and payload.get("chart"):
                            collected_vizs.append({"kind": "chart", "data": payload["chart"]})
                        elif payload.get("type") == "table" and payload.get("table"):
                            collected_vizs.append({"kind": "table", "data": payload["table"]})
                    except (json.JSONDecodeError, TypeError):
                        pass
        except Exception as e:
            logger.error(f"Chat stream error (session {session_id}): {e}", exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        finally:
            # Persist assistant message even on partial responses
            if accumulated_text:
                assistant_msg = ChatSessionMessage(
                    session_id=session.id,
                    role="assistant",
                    content=accumulated_text,
                    visualizations=collected_vizs if collected_vizs else None,
                )
                db.add(assistant_msg)
                session.message_count = (session.message_count or 0) + 1
                session.updated_at = datetime.utcnow()

            # Auto-title on first exchange (message_count <= 2 means first user+assistant pair)
            if session.message_count <= 2 and session.title == "New conversation":
                try:
                    title = await _generate_session_title(request.message)
                    session.title = title
                    yield f"data: {json.dumps({'type': 'session_title', 'title': title})}\n\n"
                except Exception:
                    pass

            await db.commit()

    return StreamingResponse(
        persisted_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/post-match-report/{match_id}", response_model=PostMatchReportResponse)
async def post_match_report_endpoint(
    match_id: str,
    force_regenerate: bool = False,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate a comprehensive post-match report.

    Includes:
    - Match summary
    - Key statistics
    - Player ratings
    - Tactical analysis
    - Training recommendations

    Query params:
    - force_regenerate: If true, regenerate even if cached (e.g. after GPS upload)
    """
    try:
        # Check if match has any events before generating AI report
        from sqlalchemy import func as sql_func
        from app.models.match_event import MatchEvent
        from app.models.match import Match
        event_count_result = await db.execute(
            select(sql_func.count(MatchEvent.id)).where(MatchEvent.match_id == match_id)
        )
        if (event_count_result.scalar() or 0) == 0:
            match_result = await db.execute(select(Match).where(Match.id == match_id))
            match_obj = match_result.scalar_one_or_none()
            return PostMatchReportResponse(
                match={"id": match_id, "opponent": match_obj.opponent if match_obj else "Unknown"},
                score={"team": "0-0", "opponent": "0-0"},
                analysis="",
                insights={},
                generated_at="",
            )

        report = await generate_post_match_report(db, match_id, force_regenerate=force_regenerate)
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
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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


@router.post("/generate-chart", response_model=AgenticChartResponse)
async def generate_chart_endpoint(
    request: AgenticChartRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
        result = await generate_agentic_chart(db, request.request, club_id=user.club_id)
        return AgenticChartResponse(**result)
    except Exception as e:
        logger.error(f"Agentic chart generation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {str(e)}")


@router.post("/dashboard-charts", response_model=DashboardChartsResponse)
async def get_dashboard_charts_endpoint(
    request: DashboardChartsRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
            num_charts=request.num_charts,
            club_id=user.club_id,
            force_refresh=request.force_refresh,
        )
        return DashboardChartsResponse(**result)
    except Exception as e:
        logger.error(f"Dashboard charts failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Chart generation failed: {str(e)}")


@router.post("/generate-replacement-chart", response_model=SingleChartResponse)
async def generate_replacement_chart_endpoint(
    request: SingleChartRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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


@router.get("/outlier-suggestions", response_model=OutlierSuggestionsResponse)
async def get_outlier_suggestions_endpoint(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Detect seasonal outliers and generate AI chart suggestions.

    Scans season data for statistical anomalies (scoring spikes,
    turnover surges, kickout rate shifts) then uses AI to generate
    Recharts chart specs for each outlier. The manager can view
    each suggestion and pin it to the dashboard.
    """
    try:
        from app.services.season_dashboard_service import SeasonDashboardService
        outliers = await SeasonDashboardService.detect_season_outliers(db)
        result = await generate_outlier_suggestions(db, outliers, club_id=user.club_id)
        return OutlierSuggestionsResponse(**result)
    except Exception as e:
        logger.error(f"Outlier suggestions failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Outlier suggestions failed: {str(e)}")


@router.post("/analyze-gps", response_model=GPSAnalysisResponse)
async def analyze_gps_endpoint(
    request: GPSAnalysisRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
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
        # Enrich GPS data with player positions and substitution info
        enriched_gps = list(request.gps_data)

        # Collect player IDs to look up positions
        player_ids = [p.get("player_id") for p in enriched_gps if p.get("player_id")]
        if player_ids:
            from app.models.player import Player
            from app.models.match_event import MatchEvent, EventType

            # Look up positions
            valid_uuids = []
            for pid in player_ids:
                try:
                    valid_uuids.append(UUID(str(pid)))
                except (ValueError, AttributeError):
                    pass

            if valid_uuids:
                pos_result = await db.execute(
                    select(Player.id, Player.position).where(Player.id.in_(valid_uuids))
                )
                pos_lookup = {str(row.id): row.position.value if row.position else None for row in pos_result.all()}

                # Look up substitution events if match_info has match_id
                sub_lookup = {}
                match_id_str = request.match_info.get("match_id") if request.match_info else None
                if match_id_str:
                    try:
                        match_uuid = UUID(str(match_id_str))
                        sub_result = await db.execute(
                            select(MatchEvent).where(
                                MatchEvent.match_id == match_uuid,
                                MatchEvent.event_type == EventType.SUBSTITUTION,
                            )
                        )
                        for ev in sub_result.scalars().all():
                            if ev.player_id and ev.minute:
                                sub_lookup[str(ev.player_id)] = ev.minute
                    except (ValueError, AttributeError):
                        pass

                # Enrich each player dict
                for p in enriched_gps:
                    pid = str(p.get("player_id", ""))
                    if pid in pos_lookup and pos_lookup[pid]:
                        p["position"] = pos_lookup[pid]
                    if pid in sub_lookup:
                        p["subbed_off_minute"] = sub_lookup[pid]

        result = await analyze_match_gps(
            gps_data=enriched_gps,
            match_info=request.match_info
        )
        return GPSAnalysisResponse(**result)
    except Exception as e:
        logger.error(f"GPS analysis failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"GPS analysis failed: {str(e)}")


# =============================================================================
# Insight Alerts Endpoints
# =============================================================================

@router.get("/insight-alerts")
async def get_insight_alerts(
    dashboard: Optional[str] = None,
    include_dismissed: bool = False,
    limit: int = 20,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Get AI-generated insight alerts, optionally filtered by dashboard.
    """
    from sqlalchemy import or_

    query = (
        select(InsightAlert)
        .where(InsightAlert.club_id == user.club_id)
        .order_by(InsightAlert.created_at.desc())
        .limit(limit)
    )

    if not include_dismissed:
        query = query.where(InsightAlert.is_dismissed .is_(False))

    if dashboard:
        query = query.where(
            or_(InsightAlert.dashboard == dashboard, InsightAlert.dashboard == "both")
        )

    result = await db.execute(query)
    alerts = result.scalars().all()

    return [
        {
            "id": str(a.id),
            "category": a.category.value,
            "source": a.source.value,
            "title": a.title,
            "message": a.message,
            "severity": a.severity,
            "session_id": str(a.session_id) if a.session_id else None,
            "match_id": str(a.match_id) if a.match_id else None,
            "dashboard": a.dashboard,
            "is_dismissed": a.is_dismissed,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        }
        for a in alerts
    ]


@router.patch("/insight-alerts/{alert_id}/dismiss")
async def dismiss_insight_alert(
    alert_id: str,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Dismiss an insight alert."""
    from datetime import datetime

    result = await db.execute(
        select(InsightAlert).where(InsightAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    alert.is_dismissed = True
    alert.dismissed_at = datetime.utcnow()
    await db.commit()

    return {"success": True, "id": str(alert.id)}
