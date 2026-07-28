"""
Auth routes — token exchange, user profile, logout, setup, invite codes.

/auth/token proxies the Cognito code→token exchange so the SPA
never needs the token endpoint URL. It also upserts the User record
on first login.

Tokens are stored in httpOnly cookies — never exposed to JavaScript.
"""

import logging
import os
import secrets
import string
from datetime import datetime
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
from app.database import get_db, async_session_maker
from app.models.audit_log import AuditLog
from app.models.club import Club
from app.models.player import Player
from app.models.user import User
from app.models.user_club_membership import UserClubMembership
from app.schemas.user import UserResponse, SetupProfileRequest
from app.schemas.player_portal import SelectPlayerRequest

logger = logging.getLogger(__name__)
router = APIRouter()
limiter = Limiter(key_func=get_remote_address)


async def _write_audit(request: Request, user: User, action: str):
    """Write an audit log entry for auth events (login/logout)."""
    try:
        ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
        if not ip:
            ip = request.client.host if request.client else None
        async with async_session_maker() as db:
            db.add(AuditLog(
                club_id=user.club_id,
                user_id=user.id,
                user_email=user.email,
                user_name=user.name,
                action=action,
                resource_type="auth",
                http_method=request.method,
                endpoint=request.url.path,
                ip_address=ip,
            ))
            await db.commit()
    except Exception as e:
        logger.warning(f"Auth audit log write failed: {e}")


def _looks_like_uuid(value: str) -> bool:
    """Check if a string looks like a UUID (8-4-4-4-12 hex pattern)."""
    import re
    return bool(re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', value, re.I))


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
    invite_code: Optional[str] = None


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
        # Clear any stale cookies so the client doesn't get stuck in a login loop
        _clear_auth_cookies(response)
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

    # Extract name from token — prefer explicit "name" claim (requires profile scope).
    # cognito:username is often the sub UUID, so only use it if it looks like a real name.
    raw_name = id_claims.get("name") or ""
    if not raw_name:
        candidate = id_claims.get("cognito:username") or ""
        # Only use cognito:username if it doesn't look like a UUID
        if candidate and not _looks_like_uuid(candidate):
            raw_name = candidate
    if not raw_name and email:
        raw_name = email.split("@")[0]
    token_name = raw_name or ""

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
            # Only overwrite name if token has a real name and DB name looks like a UUID
            if token_name and (not user.name or _looks_like_uuid(user.name)):
                user.name = token_name
            # Ensure membership row exists
            if user.club_id:
                existing_m = await db.execute(
                    select(UserClubMembership).where(
                        UserClubMembership.user_id == user.id,
                        UserClubMembership.club_id == user.club_id,
                    )
                )
                if not existing_m.scalar_one_or_none():
                    db.add(UserClubMembership(
                        user_id=user.id, club_id=user.club_id,
                        role=user.role, player_id=user.player_id,
                    ))
            await db.commit()
            await db.refresh(user)
            logger.info(f"Linked invited user to cognito_sub: {email}")
        else:
            # If invite_code provided, look up the club and assign player role
            invite_club_id = None
            if body.invite_code:
                club_result = await db.execute(
                    select(Club).where(
                        Club.invite_code == body.invite_code,
                        Club.is_active .is_(True),
                    )
                )
                invite_club = club_result.scalar_one_or_none()
                if invite_club:
                    invite_club_id = invite_club.id

            user = User(
                cognito_sub=cognito_sub,
                email=email,
                name=token_name or email.split("@")[0] or "User",
                role="player" if invite_club_id else "club_admin",
                club_id=invite_club_id,
            )
            db.add(user)
            await db.flush()  # Get user.id before creating membership
            # Create membership row if joining via invite
            if invite_club_id:
                db.add(UserClubMembership(
                    user_id=user.id, club_id=invite_club_id,
                    role="player",
                ))
            await db.commit()
            await db.refresh(user)
            logger.info(f"Created new user on token exchange: {email} (invite_code={'yes' if invite_club_id else 'no'})")
    else:
        # Update email if changed in Cognito
        if email and user.email != email:
            user.email = email
        # Only update name if token has a real name AND the DB name is a UUID placeholder
        if token_name and _looks_like_uuid(user.name):
            user.name = token_name
        from datetime import datetime
        user.last_login_at = datetime.utcnow()
        await db.commit()
        await db.refresh(user)

    user_response = UserResponse.model_validate(user)
    if user.club_id:
        club_result = await db.execute(select(Club.onboarding_completed).where(Club.id == user.club_id))
        onboarding_done = club_result.scalar_one_or_none()
        user_response.onboarding_completed = bool(onboarding_done)
    else:
        user_response.onboarding_completed = False

    await _write_audit(request, user, "log_in")

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

    response = UserResponse.model_validate(db_user)
    if db_user.club_id:
        club_result = await db.execute(select(Club).where(Club.id == db_user.club_id))
        club = club_result.scalar_one_or_none()
        if club:
            response.onboarding_completed = bool(club.onboarding_completed)
            response.subscription_tier = club.subscription_tier
            if club.subscription_tier:
                # Paid plan — use their purchased tier
                response.on_paid_plan = True
                response.effective_tier = club.subscription_tier  # 'club' | 'pro' | 'elite'
            elif club.trial_ends_at is None:
                # Grandfathered club (no trial set) — full access
                response.on_paid_plan = True
                response.effective_tier = 'elite'
            else:
                now = datetime.utcnow()
                delta = club.trial_ends_at - now
                remaining = max(0, delta.days)
                response.trial_ends_at = club.trial_ends_at
                response.trial_days_remaining = remaining
                response.trial_expired = now >= club.trial_ends_at
                if now < club.trial_ends_at:
                    # Active trial — full access so they can evaluate everything
                    response.effective_tier = 'elite'
                else:
                    # Expired trial — locked (no effective_tier)
                    response.effective_tier = None
    else:
        response.onboarding_completed = False
    return response


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

    # Audit: try to identify the user from the access token cookie before clearing
    access_token = request.cookies.get("access_token")
    if access_token:
        try:
            from app.auth.cognito import verify_cognito_token
            claims = await verify_cognito_token(access_token)
            cognito_sub = claims.get("sub")
            if cognito_sub:
                async with async_session_maker() as audit_db:
                    result = await audit_db.execute(
                        select(User).where(User.cognito_sub == cognito_sub)
                    )
                    logout_user = result.scalar_one_or_none()
                    if logout_user:
                        await _write_audit(request, logout_user, "log_out")
        except Exception:
            pass  # Don't block logout if audit fails

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

    Only allowed if the user has no club yet, or if re-confirming the same club
    (e.g. page refresh during onboarding).
    """
    # Allow re-call with same club (onboarding resume), block switching clubs
    if user.club_id and user.club_id != body.club_id:
        raise HTTPException(status_code=400, detail="Club already assigned. Contact admin to change.")

    # Verify club exists
    result = await db.execute(
        select(Club).where(Club.id == body.club_id, Club.is_active .is_(True))
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

    # Ensure membership row exists
    existing_m = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == db_user.id,
            UserClubMembership.club_id == body.club_id,
        )
    )
    if not existing_m.scalar_one_or_none():
        db.add(UserClubMembership(
            user_id=db_user.id, club_id=body.club_id,
            role=db_user.role,
        ))

    await db.commit()
    await db.refresh(db_user)
    return db_user


def _generate_invite_code() -> str:
    """Generate a random 8-character alphanumeric invite code (uppercase)."""
    alphabet = string.ascii_uppercase + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(8))


@router.post("/invite-code/generate")
@limiter.limit("10/minute")
async def generate_invite_code(
    request: Request,
    user: AuthenticatedUser = Depends(require_role("club_admin")),
    db: AsyncSession = Depends(get_db),
):
    """
    Generate (or regenerate) a shareable invite code for the admin's club.
    Old code is replaced — previous links become invalid.
    """
    if not user.club_id:
        raise HTTPException(status_code=403, detail="No club associated")

    result = await db.execute(
        select(Club).where(Club.id == user.club_id)
    )
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")

    # Generate a unique code (retry on collision)
    for _ in range(5):
        code = _generate_invite_code()
        existing = await db.execute(
            select(Club).where(Club.invite_code == code)
        )
        if not existing.scalar_one_or_none():
            break
    else:
        raise HTTPException(status_code=500, detail="Could not generate unique code")

    club.invite_code = code
    await db.commit()

    return {"invite_code": code}


@router.get("/invite-code")
async def get_invite_code(
    user: AuthenticatedUser = Depends(require_role("club_admin")),
    db: AsyncSession = Depends(get_db),
):
    """Get the current invite code for the admin's club, generating one if none exists."""
    if not user.club_id:
        raise HTTPException(status_code=403, detail="No club associated")

    result = await db.execute(select(Club).where(Club.id == user.club_id))
    club = result.scalar_one_or_none()
    if not club:
        raise HTTPException(status_code=404, detail="Club not found")

    if not club.invite_code:
        # Auto-generate on first access
        for _ in range(5):
            code = _generate_invite_code()
            existing = await db.execute(select(Club).where(Club.invite_code == code))
            if not existing.scalar_one_or_none():
                break
        else:
            raise HTTPException(status_code=500, detail="Could not generate unique code")
        club.invite_code = code
        await db.commit()

    return {"invite_code": club.invite_code}


@router.get("/invite-code/{code}/verify")
async def verify_invite_code(
    code: str,
    db: AsyncSession = Depends(get_db),
):
    """
    Public endpoint — verify an invite code and return club info.
    Used by the /join/:code landing page.
    """
    result = await db.execute(
        select(Club).where(
            Club.invite_code == code.upper(),
            Club.is_active .is_(True),
        )
    )
    club = result.scalar_one_or_none()

    if not club:
        return {"valid": False, "club_name": None, "logo_url": None}

    return {
        "valid": True,
        "club_name": club.name,
        "logo_url": club.logo_url,
    }


@router.get("/roster")
async def get_roster(
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Return the player roster for the user's club with claimed status.
    Used by /select-player page. Requires auth but NOT require_club
    (player just joined via invite code and has club_id set).
    """
    if not user.club_id:
        raise HTTPException(status_code=403, detail="No club associated")

    # Get all players in the club
    result = await db.execute(
        select(Player).where(
            Player.club_id == user.club_id,
            Player.active .is_(True),
        )
    )
    players = result.scalars().all()

    # Get all user→player links for this club
    claimed_result = await db.execute(
        select(User.player_id).where(
            User.club_id == user.club_id,
            User.player_id.isnot(None),
        )
    )
    claimed_ids = {row[0] for row in claimed_result.all()}

    roster = []
    for p in players:
        roster.append({
            "id": str(p.id),
            "name": p.name,
            "jersey_number": p.jersey_number,
            "position": p.position,
            "is_claimed": p.id in claimed_ids,
        })

    # Sort by jersey number (None last), then name
    roster.sort(key=lambda x: (x["jersey_number"] is None, x["jersey_number"] or 0, x["name"]))

    return {"players": roster}


@router.post("/select-player", response_model=UserResponse)
async def select_player(
    body: SelectPlayerRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Player selects their name from the roster, linking player_id to user.
    409 if already claimed by another user.
    """
    if not user.club_id:
        raise HTTPException(status_code=403, detail="No club associated")

    # Verify player belongs to user's club
    result = await db.execute(
        select(Player).where(
            Player.id == body.player_id,
            Player.club_id == user.club_id,
        )
    )
    player = result.scalar_one_or_none()
    if not player:
        raise HTTPException(status_code=404, detail="Player not found in your club")

    # Check if already claimed by another user
    claimed_result = await db.execute(
        select(User).where(
            User.player_id == body.player_id,
            User.id != user.user_id,
        )
    )
    if claimed_result.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="This player has already been claimed by another account")

    # Link player to user
    result = await db.execute(
        select(User).where(User.id == user.user_id)
    )
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")

    db_user.player_id = body.player_id

    # Sync player_id to membership
    mem_result = await db.execute(
        select(UserClubMembership).where(
            UserClubMembership.user_id == db_user.id,
            UserClubMembership.club_id == db_user.club_id,
        )
    )
    membership = mem_result.scalar_one_or_none()
    if membership:
        membership.player_id = body.player_id

    await db.commit()
    await db.refresh(db_user)
    return db_user
