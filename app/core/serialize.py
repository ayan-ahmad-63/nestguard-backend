"""Shared helpers for turning Mongo documents into the JSON the dashboard expects."""
from datetime import datetime, timezone

from bson import ObjectId

from app.core.responses import ApiError


def oid(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        raise ApiError(404, "Not found")
    return ObjectId(value)


def now() -> datetime:
    return datetime.now(timezone.utc)


def initials(name: str | None) -> str:
    parts = (name or "").split()
    if not parts:
        return "??"
    if len(parts) == 1:
        return parts[0][:2].upper()
    return (parts[0][0] + parts[-1][0]).upper()


def fmt_time(ts: datetime, seconds: bool = True) -> str:
    local = ts.astimezone() if ts.tzinfo else ts
    return local.strftime("%H:%M:%S" if seconds else "%H:%M")


def person(doc: dict) -> dict:
    """Student/worker/staff document -> API shape. Never includes the template."""
    out = {k: v for k, v in doc.items() if k != "fingerprintTemplate"}
    out["_id"] = str(out["_id"])
    return out
