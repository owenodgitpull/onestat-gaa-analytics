"""
AWS Cognito JWT verification.

Fetches JWKS from Cognito, caches keys, and verifies access tokens.
"""

import time
import logging
import httpx
from jose import jwt, JWTError, jwk
from jose.utils import base64url_decode
from app.config import get_settings

logger = logging.getLogger(__name__)

# Cache JWKS keys in module-level dict
_jwks_cache: dict = {"keys": [], "fetched_at": 0.0}
_CACHE_TTL = 3600  # 1 hour


async def _fetch_jwks() -> list[dict]:
    """Fetch JWKS from Cognito and cache."""
    settings = get_settings()
    url = settings.cognito_jwks_url
    logger.info(f"Fetching JWKS from {url}")
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
        keys = resp.json()["keys"]
        _jwks_cache["keys"] = keys
        _jwks_cache["fetched_at"] = time.time()
        return keys


async def _get_jwks() -> list[dict]:
    """Get JWKS keys, fetching if cache is stale."""
    if time.time() - _jwks_cache["fetched_at"] > _CACHE_TTL or not _jwks_cache["keys"]:
        return await _fetch_jwks()
    return _jwks_cache["keys"]


async def verify_cognito_token(token: str) -> dict:
    """
    Verify a Cognito access token.

    1. Decode header to get kid
    2. Find matching key in JWKS
    3. Verify signature, expiry, issuer, token_use, client_id

    Returns decoded claims dict on success.
    Raises JWTError on any verification failure.
    """
    settings = get_settings()

    # Decode header without verification to get kid
    try:
        unverified_header = jwt.get_unverified_header(token)
    except JWTError:
        raise JWTError("Unable to decode token header")

    kid = unverified_header.get("kid")
    if not kid:
        raise JWTError("Token header missing kid")

    # Find matching key
    keys = await _get_jwks()
    rsa_key = None
    for key in keys:
        if key["kid"] == kid:
            rsa_key = key
            break

    if not rsa_key:
        # Key not found — try refreshing cache once
        keys = await _fetch_jwks()
        for key in keys:
            if key["kid"] == kid:
                rsa_key = key
                break

    if not rsa_key:
        raise JWTError("Unable to find matching key in JWKS")

    # Verify and decode
    claims = jwt.decode(
        token,
        rsa_key,
        algorithms=["RS256"],
        audience=settings.cognito_app_client_id,
        issuer=settings.cognito_issuer,
        options={"verify_at_hash": False},
    )

    # Verify token_use
    token_use = claims.get("token_use")
    if token_use not in ("access", "id"):
        raise JWTError("Invalid token_use")

    # For access tokens, aud is absent — verify client_id instead
    if token_use == "access":
        if claims.get("client_id") != settings.cognito_app_client_id:
            raise JWTError("Access token client_id does not match app client")

    return claims
