"""Audit Log API — list activity for the current club."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional

from app.database import get_db
from app.models.audit_log import AuditLog
from app.auth.dependencies import AuthenticatedUser, require_role

router = APIRouter()

require_admin = require_role("club_admin")


@router.get("/")
async def list_audit_logs(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=10, le=100),
    action: Optional[str] = Query(None),
    resource_type: Optional[str] = Query(None),
    user_email: Optional[str] = Query(None),
):
    """List audit log entries for the current club, newest first."""
    query = select(AuditLog).where(AuditLog.club_id == user.club_id)

    if action:
        query = query.where(AuditLog.action == action)
    if resource_type:
        query = query.where(AuditLog.resource_type == resource_type)
    if user_email:
        query = query.where(AuditLog.user_email.ilike(f"%{user_email}%"))

    # Count total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    # Fetch page
    query = query.order_by(desc(AuditLog.created_at))
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    logs = result.scalars().all()

    return {
        "logs": [
            {
                "id": str(log.id),
                "user_email": log.user_email,
                "user_name": log.user_name,
                "action": log.action,
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "detail": log.detail,
                "http_method": log.http_method,
                "endpoint": log.endpoint,
                "ip_address": log.ip_address,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ],
        "total": total,
        "page": page,
        "per_page": per_page,
        "total_pages": (total + per_page - 1) // per_page,
    }


@router.get("/summary")
async def audit_summary(
    user: AuthenticatedUser = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Summary stats for the audit log — action counts, active users."""
    base = select(AuditLog).where(AuditLog.club_id == user.club_id)

    # Action counts
    action_result = await db.execute(
        select(AuditLog.action, func.count(AuditLog.id))
        .where(AuditLog.club_id == user.club_id)
        .group_by(AuditLog.action)
        .order_by(desc(func.count(AuditLog.id)))
    )
    action_counts = {row[0]: row[1] for row in action_result.all()}

    # Resource type counts
    resource_result = await db.execute(
        select(AuditLog.resource_type, func.count(AuditLog.id))
        .where(AuditLog.club_id == user.club_id)
        .group_by(AuditLog.resource_type)
        .order_by(desc(func.count(AuditLog.id)))
    )
    resource_counts = {row[0] or "other": row[1] for row in resource_result.all()}

    # Unique users
    user_result = await db.execute(
        select(AuditLog.user_email, AuditLog.user_name, func.count(AuditLog.id))
        .where(AuditLog.club_id == user.club_id)
        .group_by(AuditLog.user_email, AuditLog.user_name)
        .order_by(desc(func.count(AuditLog.id)))
    )
    users = [{"email": row[0], "name": row[1], "actions": row[2]} for row in user_result.all()]

    return {
        "action_counts": action_counts,
        "resource_counts": resource_counts,
        "active_users": users,
    }
