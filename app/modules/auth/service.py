from app.core.db import db
from app.core.responses import ApiError
from app.core.security import create_token, verify_password
from app.core.serialize import oid


def public_user(admin: dict) -> dict:
    return {"id": str(admin["_id"]), "email": admin["email"], "role": admin["role"], "name": admin["name"]}


def issue_session(admin: dict) -> tuple[str, dict]:
    user = public_user(admin)
    return create_token(user), user


async def login(email: str, password: str) -> tuple[str, dict]:
    admin = await db().admins.find_one({"email": email.lower().strip(), "isActive": {"$ne": False}})
    # Same message for unknown email and wrong password (no account enumeration).
    if not admin or not verify_password(password, admin["password"]):
        raise ApiError(401, "Invalid email or password")
    return issue_session(admin)


async def get_user(user_id: str) -> dict:
    admin = await db().admins.find_one({"_id": oid(user_id)}, {"password": 0, "fingerprintTemplate": 0})
    if not admin:
        raise ApiError(404, "User not found")
    admin["_id"] = str(admin["_id"])
    return admin


async def find_active_staff_by_fingerprint(fingerprint_id: str) -> dict | None:
    return await db().admins.find_one({"fingerprintId": fingerprint_id.strip(), "isActive": {"$ne": False}})


async def staff_profiles(include_fp_ids: bool) -> list[dict]:
    out = []
    async for a in db().admins.find({"isActive": {"$ne": False}}):
        item = {"name": a["name"], "role": a["role"], "email": a["email"], "hasFingerprint": bool(a.get("fingerprintId"))}
        if include_fp_ids:
            item["fingerprintId"] = a.get("fingerprintId", "")
        out.append(item)
    return out
