import hmac
from collections import defaultdict, deque
import time

import jwt
from fastapi import Depends, Request

from app.core.config import get_settings
from app.core.responses import ApiError
from app.core.security import decode_token

STAFF_ROLES = ("admin", "warden", "security")


def _token_from(request: Request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("ng_token")


def current_user(request: Request) -> dict:
    token = _token_from(request)
    if not token:
        raise ApiError(401, "Authentication required")
    try:
        d = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise ApiError(401, "Session expired — please log in again") from None
    except jwt.PyJWTError:
        raise ApiError(401, "Invalid token") from None
    return {k: d.get(k) for k in ("id", "email", "role", "name")}


def require_roles(*roles: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if user["role"] not in roles:
            raise ApiError(403, f"Access denied — requires one of: {', '.join(roles)}")
        return user

    return dep


def has_service_key(request: Request) -> bool:
    key = request.headers.get("x-service-key", "")
    return bool(key) and hmac.compare_digest(key, get_settings().service_key)


def service_only(request: Request) -> dict:
    """The Gate PC bridge authenticates with a shared service key."""
    if not has_service_key(request):
        raise ApiError(401, "Valid service key required")
    return {"role": "service"}


def staff_or_service(request: Request) -> dict:
    """Staff dashboard (JWT) or the Gate PC bridge (service key)."""
    if has_service_key(request):
        return {"role": "service"}
    user = current_user(request)
    if user["role"] not in STAFF_ROLES:
        raise ApiError(403, "Staff access required")
    return user


# ── Minimal in-memory rate limiter (per client IP) ──────────────────────────
_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(request: Request) -> None:
    s = get_settings()
    ip = request.client.host if request.client else "unknown"
    now = time.monotonic()
    q = _hits[ip]
    while q and now - q[0] > s.login_rate_window_s:
        q.popleft()
    if len(q) >= s.login_rate_limit:
        raise ApiError(429, "Too many authentication attempts. Please try again later.")
    q.append(now)


def reset_rate_limits() -> None:
    _hits.clear()
