"""
FastAPI auth dependencies.

Provides get_current_user and require_role for route protection.
"""

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.cognito import verify_cognito_token
from app.database import get_db
from app.models.user import User

logger = logging.getLogger(__name__)


@dataclass
class AuthenticatedUser:
    cognito_sub: str
    email: str
    club_id: Optional[UUID]
    role: str
    user_id: UUID
    player_id: Optional[UUID] = None


async def get_current_user(
    request: Request,
    authorization: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_db),
) -> AuthenticatedUser:
    """
    Extract and verify access token from httpOnly cookie or Authorization header.

    Priority: Authorization header (for API clients) > httpOnly cookie (for SPA).
    Returns AuthenticatedUser with club_id from our DB.
    """
    token = None

    # Try Authorization header first (for API clients / backward compat)
    if authorization and authorization.startswith("Bearer "):
        token = authorization[7:]

    # Fall back to httpOnly cookie
    if not token:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication — no token in header or cookie",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = await verify_cognito_token(token)
    except JWTError as e:
        logger.warning(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    cognito_sub = claims.get("sub")
    # Access tokens have "username" (which is the sub UUID for email-alias pools),
    # ID tokens have "email". Only trust values that look like real emails.
    raw_email = claims.get("email") or ""
    email = raw_email if "@" in raw_email else ""

    if not cognito_sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    # Look up user by cognito_sub
    result = await db.execute(
        select(User).where(User.cognito_sub == cognito_sub)
    )
    user = result.scalar_one_or_none()

    if not user:
        # Don't auto-create from access tokens alone — user must go through
        # the token exchange flow first (which uses the id_token with real email).
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found. Please log in again.",
        )

    # Update last login
    user.last_login_at = datetime.utcnow()
    if email and user.email != email:
        user.email = email
    await db.commit()

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated",
        )

    # Populate request.state for audit middleware
    request.state.user_id = user.id
    request.state.user_email = user.email
    request.state.user_name = user.name
    request.state.club_id = user.club_id

    return AuthenticatedUser(
        cognito_sub=cognito_sub,
        email=user.email,
        club_id=user.club_id,
        role=user.role,
        user_id=user.id,
        player_id=user.player_id,
    )


def require_role(*allowed_roles: str):
    """Dependency factory: require one of the given roles."""

    async def check(user: AuthenticatedUser = Depends(get_current_user)):
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return check


def require_club(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    """Dependency: ensure the user has a club_id assigned."""
    if not user.club_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No club associated with your account. Complete onboarding first.",
        )
    return user


def require_admin(user: AuthenticatedUser = Depends(get_current_user)) -> AuthenticatedUser:
    """Dependency: require club_admin role + club_id."""
    if not user.club_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No club associated with your account.",
        )
    if user.role != "club_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required.",
        )
    return user
