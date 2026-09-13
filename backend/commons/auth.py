"""
Authentication and security utility module for AutoFiller backend.

Provides token verification and header authentication helpers for internal requests.
"""

import hmac
import os
from pathlib import Path
from typing import Optional
from fastapi import Header, HTTPException, status
from commons.logger import logger
logging = logger(__name__)

ANONYMOUS_FLAG = "AUTOFILLER_ALLOW_ANONYMOUS"
INTERNAL_KEY_ENV = "AUTOFILLER_INTERNAL_KEY"
TOKEN_FILE_ENV = "AUTOFILLER_TOKEN_FILE"

_OPERATOR_IDENTITY = {
    "id": "desktop_user",
    "status": "ACTIVE",
    "role": "OPERATOR",
}


def _token_file_path() -> Path:
    """
    Resolve the on-disk location of the generated internal service token.

    Falls back to the backend working directory so a first run can persist a token.

    Returns:
        Path: Absolute path to the token file.
    """
    configured = os.getenv(TOKEN_FILE_ENV, "").strip() or os.getenv("FORMPILOT_TOKEN_FILE", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()
    
    primary = (Path(__file__).resolve().parent.parent / ".autofiller_token").resolve()
    legacy = (Path(__file__).resolve().parent.parent / ".formpilot_token").resolve()
    if legacy.exists() and not primary.exists():
        return legacy
    return primary


def _load_or_create_internal_key() -> str:
    """
    Load the configured internal key, or generate and persist a random one.

    Prefers an explicit environment secret. When absent, a cryptographically random
    per-install token is created once and stored with owner-only permissions, so no
    predictable default secret is ever used.

    Returns:
        str: Active internal service token.

    Raises:
        None
    """
    configured = os.getenv(INTERNAL_KEY_ENV, "").strip() or os.getenv("FORMPILOT_INTERNAL_KEY", "").strip()
    if configured:
        return configured
    token_path = _token_file_path()
    try:
        if token_path.exists():
            existing = token_path.read_text(encoding="utf-8").strip()
            if existing:
                return existing
    except OSError as error:
        logging.warning(f"Could not read internal token file {token_path}: {error}")

    generated = os.urandom(32).hex()
    try:
        token_path.write_text(generated, encoding="utf-8")
        os.chmod(token_path, 0o600)
        logging.info(f"Generated new per-install internal token at {token_path}")
    except OSError as error:
        logging.warning(f"Could not persist internal token file {token_path}: {error}")
    return generated

def validate_startup_security() -> None:
    """
    Refuse to boot with the legacy anonymous-access flag enabled.

    Prevents a regression where the API would silently serve unauthenticated requests.

    Returns:
        None
    Raises:
        RuntimeError: If anonymous access is explicitly enabled in the environment.
    """
    if os.getenv(ANONYMOUS_FLAG, "false").strip().lower() == "true" or os.getenv("FORMPILOT_ALLOW_ANONYMOUS", "false").strip().lower() == "true":
        raise RuntimeError(
            f"Anonymous access is not permitted. AutoFiller requires an authenticated "
            "internal token on every route. Remove this flag from the environment."
        )
    logging.info("Startup security validation passed: anonymous access is disabled")


def verify_internal_token(token: Optional[str]) -> Optional[dict]:
    """
    Validate an internal desktop bearer token using a constant-time comparison.

    Args:
        token (Optional[str]): Raw Authorization header value, optionally Bearer-prefixed.

    Returns:
        Optional[dict]: Operator identity payload when valid, otherwise None.

    Raises:
        None
    """
    if not token:
        logging.warning("Missing authentication token")
        return None
    supplied = token.replace("Bearer ", "", 1).strip()
    if not supplied:
        logging.warning("Empty authentication token provided")
        return None
    expected = _load_or_create_internal_key()
    if not expected:
        logging.error("No internal key configured; rejecting authentication attempt")
        return None
    if hmac.compare_digest(supplied, expected):
        return dict(_OPERATOR_IDENTITY)

    logging.warning("Invalid authentication token provided")
    return None
async def require_operator(authorization: Optional[str] = Header(None)) -> dict:
    """
    FastAPI dependency enforcing operator authentication on every protected route.

    Routes declare `user: dict = Depends(require_operator)` so the check cannot be
    forgotten, unlike an inline call inside each handler body.

    Args:
        authorization (Optional[str]): Internal bearer token header.

    Returns:
        dict: Authenticated operator identity.

    Raises:
        HTTPException 401: If the bearer token is missing, malformed, or invalid.
    """
    user = verify_internal_token(authorization)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing authorization credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

def decode_auth_token(token: Optional[str]) -> Optional[dict]:
    """
    Validate and decode internal desktop session bearer token.

    Verifies against local service key or environment secret and returns token payload.

    Args:
        token (Optional[str]): Bearer token string from request header.

    Returns:
        Optional[dict]: Decoded token dictionary or None if invalid.

    Raises:
        None
    """
    logging.info("Executing auth.decode_auth_token")
    return verify_internal_token(token)
