from app.core import events
from app.core.db import db
from app.core.responses import ApiError
from app.core.serialize import fmt_time, now, oid


def to_api(doc: dict) -> dict:
    return {
        "id": str(doc["_id"]),
        "sev": doc["severity"],
        "time": fmt_time(doc["createdAt"], seconds=False),
        "title": doc["title"],
        "detail": doc.get("detail", ""),
        "gate": doc.get("gate", ""),
        "user": doc.get("user", "Unknown"),
        "acknowledged": doc.get("acknowledged", False),
    }


async def create_alert(title: str, detail: str, severity: str, gate: str, user: str, entry_log_id=None) -> dict:
    doc = {
        "title": title,
        "detail": detail,
        "severity": severity,
        "gate": gate,
        "user": user,  # name only, never CNIC or other personal data
        "acknowledged": False,
        "entryLogRef": entry_log_id,
        "createdAt": now(),
    }
    doc["_id"] = (await db().alerts.insert_one(doc)).inserted_id
    api = to_api(doc)
    await events.publish("alert.created", {"alert": api})
    return api


async def list_alerts(limit: int, unread: bool) -> list[dict]:
    flt = {"acknowledged": False} if unread else {}
    return [to_api(a) async for a in db().alerts.find(flt).sort("createdAt", -1).limit(limit)]


async def acknowledge(alert_id: str) -> None:
    res = await db().alerts.update_one({"_id": oid(alert_id)}, {"$set": {"acknowledged": True}})
    if not res.matched_count:
        raise ApiError(404, "Alert not found")


async def acknowledge_all() -> None:
    await db().alerts.update_many({"acknowledged": False}, {"$set": {"acknowledged": True}})
