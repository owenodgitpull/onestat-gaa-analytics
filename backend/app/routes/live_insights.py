"""
Live Insights API Routes.

Provides endpoints for:
- Getting insights for a match
- Triggering insight checks
- Half-time analysis
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Optional
from uuid import UUID
from datetime import datetime
import logging

from app.database import get_db
from app.auth.dependencies import AuthenticatedUser, require_admin, require_admin_or_viewer
from app.services.live_insights_service import LiveInsightsService
from app.models.live_insight import InsightTrigger

logger = logging.getLogger(__name__)

router = APIRouter()


class InsightResponse(BaseModel):
    """Response schema for a single insight."""
    id: UUID
    match_id: UUID
    minute: int
    half: int
    trigger: str
    insight: str
    trigger_context: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class InsightsListResponse(BaseModel):
    """Response schema for list of insights."""
    insights: List[InsightResponse]
    count: int


class TriggerInsightRequest(BaseModel):
    """Request to manually trigger an insight check."""
    minute: int
    half: int = 1


class TriggerInsightResponse(BaseModel):
    """Response after triggering insight check."""
    generated: bool
    insight: Optional[InsightResponse] = None
    message: str


@router.get("/{match_id}", response_model=InsightsListResponse)
async def get_match_insights(
    match_id: UUID,
    limit: int = 20,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get all AI insights for a match.

    Returns insights in reverse chronological order (newest first).
    """
    insights = await LiveInsightsService.get_match_insights(db, match_id, limit)

    return InsightsListResponse(
        insights=[
            InsightResponse(
                id=i.id,
                match_id=i.match_id,
                minute=i.minute,
                half=i.half,
                trigger=i.trigger,
                insight=i.insight,
                trigger_context=i.trigger_context,
                created_at=i.created_at
            )
            for i in insights
        ],
        count=len(insights)
    )


@router.post("/{match_id}/check", response_model=TriggerInsightResponse)
async def trigger_insight_check(
    match_id: UUID,
    request: TriggerInsightRequest,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Manually trigger an insight check for the current match state.

    This is called periodically by the frontend (every 5 minutes)
    and after significant events.
    """
    try:
        insight = await LiveInsightsService.check_and_generate_insight(
            db, match_id, request.minute, request.half
        )

        if insight:
            return TriggerInsightResponse(
                generated=True,
                insight=InsightResponse(
                    id=insight.id,
                    match_id=insight.match_id,
                    minute=insight.minute,
                    half=insight.half,
                    trigger=insight.trigger,
                    insight=insight.insight,
                    trigger_context=insight.trigger_context,
                    created_at=insight.created_at
                ),
                message="New insight generated"
            )
        else:
            return TriggerInsightResponse(
                generated=False,
                insight=None,
                message="No insight needed at this time"
            )

    except Exception as e:
        logger.error(f"Insight check failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{match_id}/half-time", response_model=InsightResponse)
async def trigger_half_time_insight(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger half-time analysis insight.

    Call this when the first half ends.
    """
    try:
        insight = await LiveInsightsService.trigger_half_time_insight(db, match_id)

        return InsightResponse(
            id=insight.id,
            match_id=insight.match_id,
            minute=insight.minute,
            half=insight.half,
            trigger=insight.trigger,
            insight=insight.insight,
            trigger_context=insight.trigger_context,
            created_at=insight.created_at
        )

    except Exception as e:
        logger.error(f"Half-time insight failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{match_id}/latest", response_model=Optional[InsightResponse])
async def get_latest_insight(
    match_id: UUID,
    user: AuthenticatedUser = Depends(require_admin_or_viewer),
    db: AsyncSession = Depends(get_db),
):
    """
    Get the most recent insight for a match.

    Useful for displaying in the match recording UI.
    """
    insights = await LiveInsightsService.get_match_insights(db, match_id, limit=1)

    if insights:
        i = insights[0]
        return InsightResponse(
            id=i.id,
            match_id=i.match_id,
            minute=i.minute,
            half=i.half,
            trigger=i.trigger,
            insight=i.insight,
            trigger_context=i.trigger_context,
            created_at=i.created_at
        )

    return None
