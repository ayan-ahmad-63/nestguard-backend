from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr, Field

from app.core.config import get_settings
from app.core.deps import current_user, rate_limit
from app.core.responses import ok
from app.modules.auth import service

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

COOKIE_MAX_AGE = 7 * 24 * 3600


class LoginBody(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


def set_session_cookie(response, token: str) -> None:
    response.set_cookie(
        "ng_token", token, httponly=True, samesite="lax", max_age=COOKIE_MAX_AGE, secure=get_settings().is_prod
    )


@router.post("/login", dependencies=[Depends(rate_limit)])
async def login(body: LoginBody):
    token, user = await service.login(body.email, body.password)
    res = ok("Login successful", {"token": token, "user": user})
    set_session_cookie(res, token)
    return res


@router.get("/me")
async def me(user: dict = Depends(current_user)):
    return ok("User fetched", await service.get_user(user["id"]))


@router.post("/logout")
async def logout():
    res = ok("Logged out successfully")
    res.delete_cookie("ng_token", path="/")
    return res


@router.get("/staff-profiles")
async def staff_profiles(request: Request):
    """Public: the login screen lists staff names/roles. Fingerprint ids only in dev simulate mode."""
    staff = await service.staff_profiles(include_fp_ids=get_settings().simulate_allowed)
    return ok("Staff profiles retrieved", {"staff": staff})
