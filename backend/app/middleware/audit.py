"""
Audit Trail Middleware.

Automatically logs meaningful admin actions (POST/PUT/DELETE) to the audit_logs table.
Skips noisy/irrelevant endpoints (health checks, token refresh, live match recording, etc.).
Audit writes are fire-and-forget (asyncio.create_task) so they never block a response.

Live match recording endpoints are intentionally excluded — high-frequency writes (possession
events, ball carrier segments, individual match events) would saturate the DB connection pool
over a 90-minute match. Only match lifecycle transitions (create, half-time, end) are audited.
"""

import asyncio
import logging
import re
from datetime import datetime
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.database import async_session_maker
from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)

# Endpoints to SKIP — these are either too noisy or not meaningful admin actions.
# Live match recording routes (possession-events, match-events, ball-carrier, formation-snapshots,
# player-movement) are excluded to prevent DB connection pool exhaustion during matches.
SKIP_PATTERNS = [
    r"^/$",                              # Root health check
    r"^/health",                         # Health check
    r"^/api/v1/auth/token",              # Token exchange (logged separately as login)
    r"^/api/v1/auth/refresh",            # Token refresh — not meaningful
    r"^/api/v1/auth/me$",               # Profile check — GET-like
    r"^/api/v1/auth/preview-player",     # Logged separately as "previewed_as_player" (richer detail)
    r"^/api/v1/notifications/subscribe", # Push subscription — internal
    # ---- Live match recording (high-frequency, excluded to protect DB pool) ----
    r"^/api/v1/possession-events",       # Fires every 1-2s during play — NOT audited
    r"^/api/v1/match-events",            # Individual events during recording — NOT audited
    r"^/api/v1/ball-carrier",            # Ball carrier segments — NOT audited
    r"^/api/v1/formation-snapshots",     # Formation snapshots — NOT audited
    r"^/api/v1/player-movement",         # All player movement (path points etc.) — NOT audited
    # ---- AI / read-like POSTs ----
    r"^/api/v1/live-insights",           # Live AI calls during match
    r"^/api/v1/ai/dashboard",            # Dashboard chart generation (POST but read-like)
    r"^/api/v1/ai/kpi",                  # KPI insight generation (POST but read-like)
    r"^/api/v1/ai/outlier",              # Outlier suggestions (POST but read-like)
    r"^/api/v1/ai/insight-alerts",       # Insight alert generation (POST but read-like)
    r"^/api/v1/audit-log",              # Don't audit the audit log itself
]

SKIP_COMPILED = [re.compile(p) for p in SKIP_PATTERNS]

# Map HTTP method + URL patterns to human-readable actions
ACTION_MAP = [
    # Auth
    (r"POST.*/auth/logout", "logout", "auth", None),
    (r"POST.*/auth/setup-profile", "setup_profile", "user", None),
    (r"POST.*/auth/invite-player", "invited_player", "user", None),
    # Matches
    (r"POST.*/matches/?$", "created", "match", None),
    (r"PUT.*/matches/", "updated", "match", None),
    (r"DELETE.*/matches/", "deleted", "match", None),
    # Players
    (r"POST.*/players/?$", "created", "player", None),
    (r"PUT.*/players/", "updated", "player", None),
    (r"DELETE.*/players/", "deleted", "player", None),
    # Training
    (r"POST.*/training/?$", "created", "training_session", None),
    (r"PUT.*/training/", "updated", "training_session", None),
    (r"DELETE.*/training/", "deleted", "training_session", None),
    # Fitness
    (r"POST.*/fitness-tests/upload", "uploaded", "fitness_data", None),
    (r"POST.*/fitness-tests/import", "imported", "fitness_data", None),
    # GPS
    (r"POST.*/match-gps/", "uploaded", "gps_data", None),
    # Video
    (r"POST.*/video/sessions", "created", "video_session", None),
    (r"DELETE.*/video/", "deleted", "video_session", None),
    # AI
    (r"POST.*/ai/analyze", "generated", "ai_analysis", None),
    (r"GET.*/ai/weekly-brief", "viewed", "weekly_brief", None),
    (r"POST.*/ai/chat", "used", "ai_chat", None),
    # Knowledge base
    (r"POST.*/knowledge-base/documents/upload", "uploaded", "knowledge_doc", None),
    (r"DELETE.*/knowledge-base/documents/", "deleted", "knowledge_doc", None),
    (r"POST.*/knowledge-base/seed", "seeded", "knowledge_defaults", None),
    # Settings
    (r"PUT.*/club/profile", "updated", "club_profile", None),
    (r"POST.*/club/logo", "updated", "club_logo", None),
    (r"PUT.*/club-members/.*/role", "changed_role", "club_member", None),
    (r"PUT.*/club-members/.*/deactivate", "deactivated", "club_member", None),
    (r"PUT.*/club-members/.*/reactivate", "reactivated", "club_member", None),
    # Match prep
    (r"POST.*/match-prep/.*/set-pieces", "created", "set_piece", None),
    (r"DELETE.*/match-prep/.*/set-pieces", "deleted", "set_piece", None),
    (r"POST.*/match-prep/.*/markings", "created", "man_marking", None),
    (r"DELETE.*/match-prep/markings/", "deleted", "man_marking", None),
    # Fixtures
    (r"POST.*/fixtures/?$", "created", "fixture", None),
    (r"PUT.*/fixtures/", "updated", "fixture", None),
    (r"DELETE.*/fixtures/", "deleted", "fixture", None),
    # Lineups
    (r"PUT.*/match-lineups/", "updated", "lineup", None),
    # Events
    (r"POST.*/match-events/?$", "created", "match_event", None),
    (r"POST.*/video/events/?$", "created", "video_event", None),
    # Playbook
    (r"POST.*/playbook/push", "pushed", "playbook", None),
    # Organizations / teams
    (r"POST.*/organization/teams", "created", "team", None),
    (r"PUT.*/switch-club", "switched_team", "team", None),
    # Reports / exports
    (r"POST.*/reports/", "exported", "report", None),
]

ACTION_COMPILED = [(re.compile(pattern), action, resource, detail) for pattern, action, resource, detail in ACTION_MAP]


def _should_skip(path: str) -> bool:
    return any(p.search(path) for p in SKIP_COMPILED)


def _classify_action(method: str, path: str):
    """Match the request to a human-readable action + resource type."""
    key = f"{method} {path}"
    for pattern, action, resource, detail in ACTION_COMPILED:
        if pattern.search(key):
            return action, resource
    # Fallback for unmatched mutations
    if method == "POST":
        return "created", None
    if method == "PUT":
        return "updated", None
    if method == "DELETE":
        return "deleted", None
    return None, None


def _extract_resource_id(path: str) -> str | None:
    """Try to extract a UUID from the URL path."""
    uuid_match = re.search(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})", path, re.I)
    return uuid_match.group(1) if uuid_match else None


async def _write_audit_log(
    club_id, user_id, user_email, user_name,
    action, resource_type, resource_id, method, path, ip,
):
    """Fire-and-forget audit write — runs in background after response is returned."""
    try:
        async with async_session_maker() as db:
            log = AuditLog(
                club_id=club_id,
                user_id=user_id,
                user_email=user_email,
                user_name=user_name,
                action=action,
                resource_type=resource_type,
                resource_id=resource_id,
                http_method=method,
                endpoint=path,
                ip_address=ip,
            )
            db.add(log)
            await db.commit()
    except Exception as e:
        logger.warning(f"Audit log write failed: {e}")


class AuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Only audit mutations (POST/PUT/DELETE) — skip GETs
        method = request.method.upper()
        if method not in ("POST", "PUT", "DELETE"):
            return await call_next(request)

        path = request.url.path

        # Skip noisy/internal/high-frequency endpoints
        if _should_skip(path):
            return await call_next(request)

        # Process the request — response is returned to client immediately after this
        response: Response = await call_next(request)

        # Only log successful mutations (2xx/3xx)
        if response.status_code >= 400:
            return response

        # Extract user info from request state (set by auth dependency)
        user_id = getattr(request.state, "user_id", None)
        user_email = getattr(request.state, "user_email", None)
        user_name = getattr(request.state, "user_name", None)
        club_id = getattr(request.state, "club_id", None)

        if not user_id:
            return response  # Unauthenticated — nothing to audit

        # Classify the action
        action, resource_type = _classify_action(method, path)
        if not action:
            return response

        resource_id = _extract_resource_id(path)

        # Get client IP
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if not ip:
            ip = request.client.host if request.client else None

        # Fire-and-forget — response is already returned; audit write cannot block it
        asyncio.create_task(_write_audit_log(
            club_id, user_id, user_email, user_name,
            action, resource_type, resource_id, method, path, ip,
        ))

        return response
