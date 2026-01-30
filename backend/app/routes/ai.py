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
from app.services.ai_service import (
    analyze_match,
    live_match_insight,
    chat_with_analyst,
    generate_post_match_report
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


class PostMatchReportResponse(BaseModel):
    match: dict
    score: dict
    analysis: str
    generated_at: str


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
