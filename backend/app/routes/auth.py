"""
Auth routes — token exchange, user profile, logout, setup.

/auth/token proxies the Cognito code→token exchange so the SPA
never needs the token endpoint URL. It also upserts the User record
on first login.

Tokens are stored in httpOnly cookies — never exposed to JavaScript.
"""

import logging
import os
from typing import Optional
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.dependencies import AuthenticatedUser, get_current_user, require_club, require_role
from app.config import get_settings
from app.database import get_db
from app.models.club import Club
from app.models.player import Player
from app.models.user import User
from app.schemas.user import UserResponse, SetupProfileRequest
from app.schemas.player_portal import InvitePlayerRequest

logger = logging.getLogger(__name__)
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


# ---------- cookie helpers ----------

def _is_production() -> bool:
    return os.getenv("ENVIRONMENT", "").lower() == "production"


def _set_auth_cookies(
    response: Response,
    access_token: str,
    refresh_token: Optional[str],
    expires_in: int,
):
    """Set httpOnly cookies for access and refresh tokens."""
    prod = _is_production()

    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=prod,
        samesite="none" if prod else "lax",
        max_age=expires_in,
        path="/",
    )

    if refresh_token:
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=prod,
            samesite="none" if prod else "lax",
            max_age=30 * 24 * 3600,  # 30 days
            path="/api/v1/auth",  # Only sent to auth endpoints
        )


def _clear_auth_cookies(response: Response):
    """Remove auth cookies."""
    prod = _is_production()

    response.delete_cookie(
        key="access_token",
        path="/",
        httponly=True,
        secure=prod,
        samesite="none" if prod else "lax",
    )
    response.delete_cookie(
        key="refresh_token",
        path="/api/v1/auth",
        httponly=True,
        secure=prod,
        samesite="none" if prod else "lax",
    )


# ---------- request / response schemas ----------

class TokenExchangeRequest(BaseModel):
    code: str
    redirect_uri: str
    code_verifier: str


class CookieAuthResponse(BaseModel):
    """Response for cookie-based auth — tokens are in httpOnly cookies, not the body."""
    user: Optional[UserResponse] = None
    expires_in: int


class LogoutRequest(BaseModel):
    refresh_token: Optional[str] = None


# ---------- endpoints ----------

@router.post("/token", response_model=CookieAuthResponse)
@limiter.limit("5/minute")
async def exchange_token(
    request: Request,
    body: TokenExchangeRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """
    Exchange authorization code for tokens via Cognito token endpoint.

    Tokens are set as httpOnly cookies — the response body only contains
    user info and expiry metadata.
    """
    settings = get_settings()

    token_url = f"{settings.cognito_domain}/oauth2/token"

    payload = {
        "grant_type": "authorization_code",
        "client_id": settings.cognito_app_client_id,
        "code": body.code,
        "redirect_uri": body.redirect_uri,
        "code_verifier": body.code_verifier,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )

    if resp.status_code != 200:
        logger.error(f"Cognito token exchange failed: {resp.status_code} {resp.text}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token exchange failed: {resp.json().get('error', 'unknown')}",
        )

    tokens = resp.json()
    expires_in = tokens.get("expires_in", 3600)

    # Set httpOnly cookies
    _set_auth_cookies(response, tokens["access_token"], tokens.get("refresh_token"), expires_in)

    # Verify and decode the id_token using our JWKS infrastructure
    from app.auth.cognito import verify_cognito_token

    try:
        id_claims = await verify_cognito_token(tokens["id_token"])
    except Exception as e:
        logger.error(f"ID token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="ID token verification failed",
        )
    cognito_sub = id_claims.get("sub", "")
    email = id_claims.get("email", "")
    name = id_claims.get("name") or id_claims.get("cognito:username") or email.split("@")[0]

    # Upsert user
    result = await db.execute(
        select(User).where(User.cognito_sub == cognito_sub)
    )
    user = result.scalar_one_or_none()

    if not user:
        # Check if user was pre-created via invite (has email but no cognito_sub)
        invite_result = await db.execute(
            select(User).where(User.email == email, User.cognito_sub.is_(None))
        )
        user = invite_result.scalar_one_or_none()

        if user:
            # Link the pre-created invite to this Cognito account
            user.cognito_sub = cognito_sub
            if name and user.name != name:
                user.name = name
            await db.commit()
            await db.refresh(user)
            logger.info(f"Linked invited user to cognito_sub: {email}")
        else:
            user = User(
                cognito_sub=cognito_sub,
                email=email,
                name=name,
                role="club_admin",
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)
            logger.info(f"Created new user on token exchange: {email}")
    else:
        # Update email/name if changed in Cognito
        if email and user.email != email:
            user.email = email
        if name and user.name != name:
            user.name = name
        from datetime import datetime
        user.last_login_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)

    user_response = UserResponse.model_validate(user)

    return CookieAuthResponse(
        user=user_response,
        expires_in=expires_in,
    )


@router.post("/refresh", response_model=CookieAuthResponse)
@limiter.limit("10/minute")
async def refresh_tokens(
    request: Request,
    response: Response,
):
    """Refresh access token using refresh_token cookie via Cognito."""
    # Read refresh token from cookie
    rt = request.cookies.get("refresh_token")

    if not rt:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No refresh token available",
        )

    settings = get_settings()
    token_url = f"{settings.cognito_domain}/oauth2/token"

    payload = {
        "grant_type": "refresh_token",
        "client_id": settings.cognito_app_client_id,
        "refresh_token": rt,
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            token_url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15,
        )

    if resp.status_code != 200:
        logger.error(f"Cognito token refresh failed: {resp.status_code} {resp.text}")
        _clear_auth_cookies(response)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token refresh failed",
        )

    tokens = resp.json()
    expires_in = tokens.get("expires_in", 3600)

    # Set new cookies (Cognito refresh doesn't always return a new refresh_token)
    _set_auth_cookies(
        response,
        tokens["access_token"],
        tokens.get("refresh_token"),  # May be None — existing cookie persists
        expires_in,
    )

    return CookieAuthResponse(
        expires_in=expires_in,
    )


@router.get("/me", response_model=UserResponse)
async def get_me(
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Return the current authenticated user's profile."""
    result = await db.execute(
        select(User).where(User.id == user.user_id)
    )
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user


@router.post("/logout")
async def logout(
    request: Request,
    response: Response,
):
    """
    Revoke refresh token via Cognito and clear httpOnly cookies.
    """
    rt = request.cookies.get("refresh_token")

    if rt:
        settings = get_settings()
        revoke_url = f"{settings.cognito_domain}/oauth2/revoke"

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                revoke_url,
                data={
                    "token": rt,
                    "client_id": settings.cognito_app_client_id,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=10,
            )

        if resp.status_code != 200:
            logger.warning(f"Token revocation failed: {resp.status_code}")

    _clear_auth_cookies(response)
    return {"success": True}


@router.post("/setup-profile", response_model=UserResponse)
async def setup_profile(
    body: SetupProfileRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Set the user's club_id after onboarding.

    Only allowed if the user has no club yet (first-time setup).
    """
    # Only allow if user doesn't already have a club
    if user.club_id:
        raise HTTPException(status_code=400, detail="Club already assigned. Contact admin to change.")

    # Verify club exists
    result = await db.execute(
        select(Club).where(Club.id == body.club_id, Club.is_active == True)
    )
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")

    # Update user
    result = await db.execute(
        select(User).where(User.id == user.user_id)
    )
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    db_user.club_id = body.club_id
    if body.name:
        db_user.name = body.name

    await db.commit()
    await db.refresh(db_user)
    return db_user


@router.post("/invite-player", response_model=UserResponse)
@limiter.limit("10/minute")
async def invite_player(
    request: Request,
    body: InvitePlayerRequest,
    user: AuthenticatedUser = Depends(require_role("club_admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Admin invites a player to the app by linking email → player_id.

    Creates or updates a User record with role="player" and the given player_id.
    The player can then log in via Cognito with that email.
    """
    if not user.club_id:
        raise HTTPException(status_code=403, detail="No club associated")

    # Verify player belongs to admin's club
    result = await db.execute(
        select(Player).where(
            Player.id == body.player_id,
            Player.club_id == user.club_id,
        )
    )
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found in your club")

    # Check if a user with this email already exists
    result = await db.execute(
        select(User).where(User.email == body.email)
    )
    existing_user = result.scalar_one_or_none()

    if existing_user:
        # Prevent hijacking users from other clubs
        if existing_user.club_id and existing_user.club_id != user.club_id:
            raise HTTPException(status_code=409, detail="This email is already registered with another club")
        # Update existing user to link player
        existing_user.player_id = body.player_id
        existing_user.role = "player"
        existing_user.club_id = user.club_id
        await db.commit()
        await db.refresh(existing_user)
        return existing_user
    else:
        # Create a new user record (will be matched on Cognito login via email)
        new_user = User(
            cognito_sub=None,  # Will be filled on first login
            email=body.email,
            name=player.name,
            club_id=user.club_id,
            role="player",
            player_id=body.player_id,
        )
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)
        return new_user
