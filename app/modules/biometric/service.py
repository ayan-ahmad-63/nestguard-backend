import secrets

from app.core import events
from app.core.db import db
from app.core.responses import ApiError
from app.core.security import decrypt_template, encrypt_template, is_real_template
from app.core.serialize import initials, now, oid, person
from app.modules.access import service as access
from app.modules.auth import service as auth
from app.modules.biometric import state
from app.modules.students import service as students


async def biometric_cache() -> list[dict]:
    """Decrypted templates for the Gate PC matcher. Service-key callers only."""
    out = []
    async for s in db().students.find({"isEnrolled": True, "fingerprintTemplate": {"$nin": ["", None]}}):
        tpl = decrypt_template(s["fingerprintTemplate"])
        if is_real_template(tpl):
            out.append({"_id": str(s["_id"]), "name": s["name"], "rollNo": s["rollNo"],
                        "personType": s["personType"], "fingerprintId": s["fingerprintId"], "fingerprintTemplate": tpl})
    return out


# ── Arming ──────────────────────────────────────────────────────────────────
async def arm_enroll(data: dict) -> dict:
    if not (data.get("name") or "").strip() or not (data.get("rollNo") or "").strip():
        raise ApiError(400, "Name and Roll No / Staff ID are required to arm biometric scanner")
    if not data.get("consentGiven"):
        raise ApiError(400, "Biometric consent is required before enrolment")
    target = {**data, "name": data["name"].strip(), "rollNo": data["rollNo"].strip().upper()}
    state.enroll.arm(target)
    await events.publish("sensor.armed", {"event": "sensor_armed", "data": {"armed": True, "target": target}})
    return {"armed": True, "target": target}


async def disarm_enroll() -> dict:
    state.enroll.disarm()
    await events.publish("sensor.armed", {"event": "sensor_armed", "data": {"armed": False}})
    return {"armed": False}


async def arm_update(data: dict) -> dict:
    if not data.get("studentId") or not data.get("name"):
        raise ApiError(400, "User ID and Name are required to arm fingerprint update")
    target = {"studentId": data["studentId"].strip(), "name": data["name"].strip(),
              "rollNo": (data.get("rollNo") or "").strip().upper()}
    state.update.arm(target)
    await events.publish("sensor.armed", {"event": "update_fp_armed", "data": {"armed": True, "target": target}})
    return {"armed": True, "target": target}


async def disarm_update() -> dict:
    state.update.disarm()
    await events.publish("sensor.armed", {"event": "update_fp_armed", "data": {"armed": False}})
    return {"armed": False}


async def arm_login(role: str | None) -> dict:
    nonce = secrets.token_urlsafe(24)
    role = role.lower().strip() if role else None
    state.login.arm({"role": role}, nonce=nonce)
    await events.publish("sensor.armed", {"event": "login_sensor_armed", "public": True,
                                          "data": {"armed": True, "role": role}})
    return {"armed": True, "role": role, "nonce": nonce}


async def disarm_login(nonce: str | None, is_service: bool) -> dict:
    if state.login.armed and not is_service and not _nonce_ok(nonce):
        raise ApiError(403, "Invalid login session")
    state.login.disarm()
    await events.publish("sensor.armed", {"event": "login_sensor_armed", "public": True, "data": {"armed": False}})
    return {"armed": False}


def _nonce_ok(nonce: str | None) -> bool:
    expected = state.login.extra.get("nonce") or state.login.last_result and state.login.last_result.get("_nonce")
    return bool(nonce and expected and secrets.compare_digest(nonce, expected))


def login_status(nonce: str | None, is_service: bool) -> dict:
    role = state.login.target["role"] if state.login.armed and state.login.target else None
    if is_service:
        return {"isArmed": state.login.armed, "role": role}
    if not _nonce_ok(nonce):
        raise ApiError(401, "Valid login session required")
    result = state.login.last_result
    state.login.last_result = None  # the session token is handed over exactly once
    if result:
        result = {k: v for k, v in result.items() if k != "_nonce"}
    return {"isArmed": state.login.armed, "role": role, "lastResult": result}


# ── Scan webhook from the Gate PC ───────────────────────────────────────────
async def handle_scan(body: dict) -> tuple[dict, int, str]:
    """Route one physical touch. Returns (data, http_status, message)."""
    fp_id = (body.get("fingerprintId") or "").strip()
    template = body.get("template") or ""
    quality = body.get("quality") or 98

    if state.update.armed:
        return await _finish_update(template, quality)
    if state.enroll.armed:
        return await _finish_enroll(template, quality)
    if state.login.armed:
        return await _finish_login(fp_id, quality)
    res = await access.process_scan(fp_id or None, quality, body.get("eventId"), body.get("gateName"), body.get("direction"))
    return res, (200 if res["duplicate"] else 201), f"{res['log']['dir']} scan recorded"


async def _finish_enroll(template: str, quality) -> tuple[dict, int, str]:
    if not is_real_template(template):
        raise ApiError(422, "Fingerprint capture was not usable — please touch the sensor again")
    target = state.enroll.target
    student, _ = await students.enroll_person(target, None, template)
    result = {"success": True, "student": person(student), "slot": student["fingerprintId"],
              "quality": quality, "enrolledAt": now().isoformat()}
    state.enroll.finish(result)
    await events.publish("biometric.enrolled", {"result": result})
    return ({"enrolled": True, "student": person(student), "slot": student["fingerprintId"]}, 201,
            f"Successfully enrolled {student['name']} ({student['fingerprintId']})")


async def _finish_update(template: str, quality) -> tuple[dict, int, str]:
    if not is_real_template(template):
        raise ApiError(422, "Fingerprint capture was not usable — please touch the sensor again")
    t = state.update.target
    student = None
    if t.get("studentId"):
        try:
            student = await db().students.find_one({"_id": oid(t["studentId"])})
        except ApiError:
            student = None
    if not student and t.get("rollNo"):
        student = await db().students.find_one({"rollNo": t["rollNo"]})
    if not student:
        raise ApiError(404, "Resident not found")
    fp_id = student.get("fingerprintId") or await students.next_fingerprint_id(student["name"])
    set_ = {"fingerprintId": fp_id, "fingerprintTemplate": encrypt_template(template),
            "isEnrolled": True, "updatedAt": now()}
    await db().students.update_one({"_id": student["_id"]}, {"$set": set_})
    student = {**student, **set_}
    await students.link_staff_account(student)
    result = {"success": True, "student": person(student), "slot": fp_id, "quality": quality,
              "updatedAt": now().isoformat()}
    state.update.finish(result)
    await events.publish("biometric.updated", {"result": result})
    return ({"updated": True, "student": person(student), "slot": fp_id}, 200,
            f"Fingerprint updated for {student['name']} ({fp_id})")


async def _finish_login(fp_id: str, quality) -> tuple[dict, int, str]:
    nonce = state.login.extra.get("nonce")
    role = (state.login.target or {}).get("role")
    admin = await auth.find_active_staff_by_fingerprint(fp_id) if fp_id and fp_id != "UNRECOGNIZED" else None
    error = None
    if not admin:
        error = "Unrecognized staff fingerprint. Touch with an enrolled staff finger (Admin, Warden or Security)."
    elif role and admin["role"] != role:
        error = f"This fingerprint belongs to a {admin['role']}, not a {role}."
    if error:
        # Stay armed so the person can retry until the session times out.
        state.login.last_result = {"success": False, "error": error, "_nonce": nonce}
        raise ApiError(401, error)
    token, user = auth.issue_session(admin)
    result = {"success": True, "token": token, "user": user, "quality": quality,
              "authenticatedAt": now().isoformat(), "_nonce": nonce}
    state.login.finish(result)
    state.login.extra = {"nonce": nonce}  # keep the nonce readable until the browser collects the result
    return ({"user": user, "token": token}, 200, f"Biometric authentication verified ({admin['name']})")
