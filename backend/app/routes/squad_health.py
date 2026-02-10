"""
Squad Health API routes.

Provides endpoints for:
- Getting squad-wide health summary
- Viewing individual player health alerts
- Acknowledging/dismissing alerts
- Triggering manual analysis
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from typing import Optional
from uuid import UUID
from datetime import datetime

from app.database import get_db
from app.models.player_health import PlayerHealthAlert, AlertSeverity
from app.services.workload_analysis_service import WorkloadAnalysisService

import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/ai-summary")
async def get_squad_health_ai_summary(db: AsyncSession = Depends(get_db)):
    """
    Get a 1-2 sentence AI-generated summary of squad health status.
    Uses Haiku for fast, cheap inference.
    """
    try:
        summary = await WorkloadAnalysisService.get_squad_health_summary(db)

        # Count players by status
        status_counts = {}
        for pw in summary.get("player_workloads", []):
            status = pw.get("status", "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1

        total_players = sum(status_counts.values())
        total_alerts = summary.get("total_alerts", 0)
        critical_count = summary.get("critical_count", 0)
        high_count = summary.get("high_count", 0)

        data_text = (
            f"Squad health: {total_players} players tracked.\n"
            f"Status breakdown: {', '.join(f'{v} {k}' for k, v in status_counts.items())}.\n"
            f"Active alerts: {total_alerts} total, {critical_count} critical, {high_count} high."
        )

        from app.services.ai._shared import client

        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            system="You are a GAA strength & conditioning analyst for Dungloe GAA. "
                   "Give a 1-2 sentence squad health summary. Be specific with numbers. "
                   "Highlight any concerns or positive trends.",
            messages=[{
                "role": "user",
                "content": f"Summarize this squad health status:\n{data_text}"
            }]
        )

        return {
            "summary": response.content[0].text,
            "generated_at": datetime.utcnow().isoformat(),
        }

    except Exception as e:
        logger.error(f"Squad health AI summary failed: {e}")
        return {"summary": None, "generated_at": None}


@router.get("/summary")
async def get_squad_health_summary(db: AsyncSession = Depends(get_db)):
    """
    Get squad-wide health summary for dashboard.

    Returns:
        - Active alerts grouped by severity
        - Player workload statuses
        - Overall squad health metrics
    """
    summary = await WorkloadAnalysisService.get_squad_health_summary(db)
    return summary


@router.get("/alerts")
async def get_all_alerts(
    severity: Optional[str] = None,
    active_only: bool = True,
    db: AsyncSession = Depends(get_db)
):
    """Get all health alerts, optionally filtered by severity."""
    query = select(PlayerHealthAlert)

    if active_only:
        query = query.where(PlayerHealthAlert.is_active == True)

    if severity:
        try:
            sev_enum = AlertSeverity(severity)
            query = query.where(PlayerHealthAlert.severity == sev_enum)
        except ValueError:
            raise HTTPException(400, f"Invalid severity: {severity}")

    query = query.order_by(
        PlayerHealthAlert.severity.desc(),
        PlayerHealthAlert.created_at.desc()
    )

    result = await db.execute(query)
    alerts = result.scalars().all()

    return [
        {
            "id": str(alert.id),
            "player_id": str(alert.player_id),
            "player_name": alert.player.name if alert.player else "Unknown",
            "alert_type": alert.alert_type.value,
            "severity": alert.severity.value,
            "title": alert.title,
            "message": alert.message,
            "recommendation": alert.recommendation,
            "is_active": alert.is_active,
            "is_acknowledged": alert.is_acknowledged,
            "created_at": alert.created_at.isoformat(),
            "expires_at": alert.expires_at.isoformat() if alert.expires_at else None
        }
        for alert in alerts
    ]


@router.get("/player/{player_id}")
async def get_player_health(
    player_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Get health alerts and workload for a specific player."""
    # Get active alerts
    result = await db.execute(
        select(PlayerHealthAlert)
        .where(
            and_(
                PlayerHealthAlert.player_id == player_id,
                PlayerHealthAlert.is_active == True
            )
        )
        .order_by(PlayerHealthAlert.severity.desc())
    )
    alerts = result.scalars().all()

    # Trigger fresh analysis
    fresh_alerts = await WorkloadAnalysisService.trigger_analysis_for_player(
        db, player_id, "manual_check"
    )

    return {
        "player_id": str(player_id),
        "active_alerts": [
            {
                "id": str(alert.id),
                "alert_type": alert.alert_type.value,
                "severity": alert.severity.value,
                "title": alert.title,
                "message": alert.message,
                "recommendation": alert.recommendation,
                "created_at": alert.created_at.isoformat()
            }
            for alert in alerts
        ],
        "new_alerts_generated": len(fresh_alerts)
    }


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: UUID,
    acknowledged_by: str = "coach",
    db: AsyncSession = Depends(get_db)
):
    """Acknowledge a health alert."""
    result = await db.execute(
        select(PlayerHealthAlert).where(PlayerHealthAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(404, "Alert not found")

    alert.is_acknowledged = True
    alert.acknowledged_at = datetime.utcnow()
    alert.acknowledged_by = acknowledged_by
    await db.commit()

    return {"status": "acknowledged", "alert_id": str(alert_id)}


@router.post("/alerts/{alert_id}/dismiss")
async def dismiss_alert(
    alert_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Dismiss/deactivate a health alert."""
    result = await db.execute(
        select(PlayerHealthAlert).where(PlayerHealthAlert.id == alert_id)
    )
    alert = result.scalar_one_or_none()

    if not alert:
        raise HTTPException(404, "Alert not found")

    alert.is_active = False
    await db.commit()

    return {"status": "dismissed", "alert_id": str(alert_id)}


@router.post("/analyze/player/{player_id}")
async def trigger_player_analysis(
    player_id: UUID,
    db: AsyncSession = Depends(get_db)
):
    """Manually trigger workload analysis for a player."""
    alerts = await WorkloadAnalysisService.trigger_analysis_for_player(
        db, player_id, "manual_trigger"
    )

    return {
        "player_id": str(player_id),
        "alerts_generated": len(alerts),
        "alerts": [
            {
                "id": str(alert.id),
                "type": alert.alert_type.value,
                "severity": alert.severity.value,
                "title": alert.title
            }
            for alert in alerts
        ]
    }


@router.post("/analyze/squad")
async def trigger_squad_analysis(db: AsyncSession = Depends(get_db)):
    """Manually trigger workload analysis for all players."""
    results = await WorkloadAnalysisService.trigger_analysis_for_all_players(
        db, "manual_squad_trigger"
    )

    total_alerts = sum(len(alerts) for alerts in results.values())

    return {
        "players_analyzed": len(results),
        "total_alerts_generated": total_alerts,
        "player_alerts": {
            player_id: [
                {"type": alert.alert_type.value, "severity": alert.severity.value}
                for alert in alerts
            ]
            for player_id, alerts in results.items()
        }
    }
