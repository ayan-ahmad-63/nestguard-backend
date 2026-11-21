"""Gate verification: match result in, access log + live event + alert out.

The Gate PC does the 1:N fingerprint match (Live20R SDK) and reports the matched
fingerprintId (or "UNRECOGNIZED"). This service never opens anything: the gate is
verify-and-log, the guard opens the door by hand.
"""
from datetime import datetime

from app.core import events
from app.core.db import db
from app.core.serialize import fmt_time, now, person
from app.modules.alerts import service as alerts
from app.modules.gates import service as gates

UNRECOGNIZED = "UNRECOGNIZED"
CURFEW_START, CURFEW_END = 22, 6  # hostel curfew 22:00-06:00 (rule-based in Phase-I)


def evaluate_rules(student: dict | None, direction: str, when: datetime) -> tuple[str, float, list[str]]:
    """Deterministic rules the examiners can verify. ML scoring is Phase-II."""
    if not student:
        return "critical", -1.0, ["No biometric match in database"]
    if student.get("personType") != "STUDENT":
        return "safe", 0.0, []
    hour = when.astimezone().hour
    if hour >= CURFEW_START or hour < CURFEW_END:
        if direction == "exit":
            return "critical", -1.0, ["Curfew-hour exit attempt"]
        return "attention", -0.5, ["Late-night entry"]
    return "safe", 0.0, []


def _log_to_api(doc: dict, with_date: bool) -> dict:
    snap = doc["studentSnapshot"]
    ts = doc["timestamp"]
    return {
        "id": str(doc["_id"]),
        "initials": snap["initials"],
        "name": snap["name"],
        "rollNo": snap["rollNo"],
        "gate": doc["gateName"],
        "dir": doc["direction"],
        "method": doc["method"],
        "time": (ts.astimezone().strftime("%d/%m/%Y, %H:%M:%S") if with_date else fmt_time(ts)),
        "status": doc["status"],
        "confidence": doc.get("confidence", 0),
    }


async def process_scan(fingerprint_id: str | None, quality: float = 98, event_id: str | None = None,
                       gate_name: str | None = None, direction: str | None = None) -> dict:
    if event_id and (dup := await db().entry_logs.find_one({"eventId": event_id})):
        return {"log": _log_to_api(dup, False), "student": None, "alert": None, "duplicate": True}

    student = None
    if fingerprint_id and fingerprint_id != UNRECOGNIZED:
        student = await db().students.find_one({"fingerprintId": fingerprint_id.strip()})

    # One reader serves both directions: someone inside is leaving, anyone else is arriving.
    if student:
        direction = "exit" if student.get("status") == "INSIDE" else "entry"
        gate_name = "Main Gate Exit" if direction == "exit" else "Main Gate Entry"
    else:
        direction = direction if direction in ("entry", "exit") else "entry"

    gate = await gates.resolve_gate(gate_name)
    when = now()
    status, score, labels = evaluate_rules(student, direction, when)

    snapshot = (
        {"name": student["name"], "initials": student.get("initials", "ST"), "rollNo": student["rollNo"]}
        if student else {"name": "Unknown Person", "initials": "??", "rollNo": "UNREG"}
    )
    raw = " | ".join(labels) if labels else f"Fingerprint verified — {direction} recorded (quality {quality:g}%)"
    doc = {
        "studentId": student["_id"] if student else None,
        "studentSnapshot": snapshot,
        "gateId": gate["_id"] if gate else None,
        "gateName": gate["name"] if gate else (gate_name or "Main Gate Entry"),
        "direction": direction,
        "method": "Fingerprint" if student else "None",
        "timestamp": when,
        "status": status,
        "anomalyScore": score,
        "confidence": float(quality) if student else 0,
        "raw": raw,
        "createdAt": when,
    }
    if event_id:
        doc["eventId"] = event_id
    doc["_id"] = (await db().entry_logs.insert_one(doc)).inserted_id

    if student:
        new_status = "INSIDE" if direction == "entry" else "OUTSIDE"
        await db().students.update_one({"_id": student["_id"]}, {"$set": {"status": new_status}})
        student = {**student, "status": new_status}

    log = _log_to_api(doc, with_date=False)
    alert = None
    if status != "safe":
        title = "Unauthorised access attempt" if not student else labels[0]
        alert = await alerts.create_alert(
            title, raw, "critical" if status == "critical" else "attention",
            doc["gateName"], snapshot["name"], doc["_id"],
        )
    await events.publish("access.logged", {"log": log, "student": person(student) if student else None})
    return {"log": log, "student": person(student) if student else None, "alert": alert, "duplicate": False}


async def list_logs(page: int, limit: int, gate: str | None, status: str | None) -> tuple[list[dict], int]:
    flt: dict = {}
    if gate:
        flt["gateName"] = {"$regex": gate, "$options": "i"}
    if status:
        flt["status"] = status
    total = await db().entry_logs.count_documents(flt)
    cursor = db().entry_logs.find(flt).sort("timestamp", -1).skip((page - 1) * limit).limit(limit)
    return [_log_to_api(d, with_date=True) async for d in cursor], total
