import re

from app.core.db import db
from app.core.responses import ApiError
from app.core.security import encrypt_template, is_real_template
from app.core.serialize import initials, now, oid, person

PERSON_TYPES = ("STUDENT", "WORKER", "STAFF")
STAFF_PREFIX = {"adm": "admin", "wrd": "warden", "sec": "security"}


def norm_type(value: str | None) -> str:
    v = (value or "STUDENT").upper()
    return v if v in PERSON_TYPES else "STUDENT"


def _code(name: str) -> str:
    n = (name or "").strip()
    low = n.lower()
    if low in ("admin", "warden", "security"):
        return {"admin": "ADM", "warden": "WRD", "security": "SEC"}[low]
    parts = n.split()
    if not parts:
        return "USR"
    return parts[0][:3].upper() if len(parts) == 1 else (parts[0][0] + parts[-1][0]).upper()


async def next_fingerprint_id(name: str) -> str:
    """FP-<initials>-NN, one past the highest number already used by students or staff."""
    prefix = f"FP-{_code(name)}"
    pattern = re.compile(rf"^{re.escape(prefix)}-(\d+)$")
    highest = 0
    for coll in (db().students, db().admins):
        async for d in coll.find({"fingerprintId": {"$regex": f"^{re.escape(prefix)}-\\d+$"}}, {"fingerprintId": 1}):
            m = pattern.match(d["fingerprintId"])
            if m:
                highest = max(highest, int(m.group(1)))
    return f"{prefix}-{highest + 1:02d}"


def staff_role_for(roll_no: str) -> str | None:
    return STAFF_PREFIX.get((roll_no or "").lower()[:3])


async def purge_fingerprint(fp_id: str, keep_student_id=None, keep_admin_id=None) -> None:
    """A fingerprint id belongs to exactly one person: strip it from everyone else."""
    s_filter = {"fingerprintId": fp_id}
    a_filter = {"fingerprintId": fp_id}
    if keep_student_id:
        s_filter["_id"] = {"$ne": keep_student_id}
    if keep_admin_id:
        a_filter["_id"] = {"$ne": keep_admin_id}
    await db().students.update_many(
        s_filter, {"$unset": {"fingerprintId": "", "fingerprintTemplate": ""}, "$set": {"isEnrolled": False}}
    )
    await db().admins.update_many(a_filter, {"$unset": {"fingerprintId": "", "fingerprintTemplate": ""}})


async def link_staff_account(student: dict) -> dict | None:
    """STAFF people log in with their finger: copy the fingerprint onto the matching admin account."""
    if student.get("personType") != "STAFF":
        return None
    role = staff_role_for(student["rollNo"])
    match = {"$or": [{"name": student["name"]}, *([{"role": role}] if role else [])]}
    admin = await db().admins.find_one(match)
    if not admin:
        return None
    update: dict = {"$set": {}, "$unset": {}}
    if student.get("fingerprintId"):
        update["$set"]["fingerprintId"] = student["fingerprintId"]
    else:
        update["$unset"]["fingerprintId"] = ""
    if student.get("fingerprintTemplate"):
        update["$set"]["fingerprintTemplate"] = student["fingerprintTemplate"]
    update = {k: v for k, v in update.items() if v}
    if update:
        await db().admins.update_one({"_id": admin["_id"]}, update)
    return admin


def _guardian(data: dict, current: dict | None = None) -> dict:
    cur = current or {}
    g = data.get("guardianContact") or {}
    pick = lambda key, alt: data.get(alt) or g.get(key) or cur.get(key, "")  # noqa: E731
    return {"name": pick("name", "guardianName"), "phone": pick("phone", "guardianPhone"), "email": pick("email", "guardianEmail")}


async def enroll_person(data: dict, fingerprint_id: str | None = None, template: str | None = None) -> tuple[dict, bool]:
    """Create or update a person by roll number. Returns (student_doc, created)."""
    name = (data.get("name") or "").strip()
    roll_no = (data.get("rollNo") or "").strip().upper()
    if not name or not roll_no:
        raise ApiError(400, "Name and Roll No / Worker ID are required")
    if not data.get("consentGiven"):
        raise ApiError(400, "Biometric consent is required before enrolment")

    existing = await db().students.find_one({"rollNo": roll_no})
    fp_id = (fingerprint_id or "").strip() or (existing or {}).get("fingerprintId") or await next_fingerprint_id(name)
    plain = template or ""
    enc = encrypt_template(plain) if plain else (existing or {}).get("fingerprintTemplate", "")
    usable = is_real_template(plain) if plain else bool((existing or {}).get("isEnrolled"))
    stamp = now()

    fields = {
        "name": name,
        "initials": initials(name),
        "personType": norm_type(data.get("personType")),
        "roomNo": data.get("roomNo") or "Unassigned",
        "department": data.get("department") or "General",
        "guardianContact": _guardian(data, (existing or {}).get("guardianContact")),
        "fingerprintId": fp_id,
        "fingerprintTemplate": enc,
        "isEnrolled": usable,
        "consentGiven": True,
        "updatedAt": stamp,
    }
    if existing:
        old_fp = existing.get("fingerprintId")
        if old_fp and old_fp != fp_id:
            await purge_fingerprint(old_fp, keep_student_id=existing["_id"])
        await db().students.update_one({"_id": existing["_id"]}, {"$set": fields})
        doc = {**existing, **fields}
        created = False
    else:
        doc = {**fields, "rollNo": roll_no, "status": "OUTSIDE", "consentTimestamp": stamp, "createdAt": stamp}
        res = await db().students.insert_one(doc)
        doc["_id"] = res.inserted_id
        created = True
    await link_staff_account(doc)
    return doc, created


async def list_people(person_type: str | None, enrolled: bool | None) -> list[dict]:
    flt: dict = {}
    if person_type:
        flt["personType"] = person_type.upper()
    if enrolled is not None:
        flt["isEnrolled"] = enrolled
    return [person(d) async for d in db().students.find(flt).sort("createdAt", -1)]


async def get_person(student_id: str) -> dict:
    doc = await db().students.find_one({"_id": oid(student_id)})
    if not doc:
        raise ApiError(404, "Resident not found")
    return doc


async def update_person(student_id: str, data: dict) -> dict:
    doc = await get_person(student_id)
    set_: dict = {"updatedAt": now()}
    if data.get("name"):
        set_["name"] = data["name"].strip()
        set_["initials"] = initials(data["name"])
    if data.get("rollNo"):
        set_["rollNo"] = data["rollNo"].strip().upper()
    if data.get("personType"):
        set_["personType"] = norm_type(data["personType"])
    for key in ("roomNo", "department"):
        if data.get(key) is not None:
            set_[key] = data[key].strip()
    if any(k in data for k in ("guardianContact", "guardianName", "guardianPhone", "guardianEmail")):
        set_["guardianContact"] = _guardian(data, doc.get("guardianContact"))

    template = data.get("fingerprintTemplate")
    new_fp = (data.get("fingerprintId") or "").strip() or None
    if template and not new_fp:
        new_fp = await next_fingerprint_id(set_.get("name", doc["name"]))
    if new_fp and new_fp != doc.get("fingerprintId"):
        if doc.get("fingerprintId"):
            await purge_fingerprint(doc["fingerprintId"], keep_student_id=doc["_id"])
        set_["fingerprintId"] = new_fp
    if template:
        set_["fingerprintTemplate"] = encrypt_template(template)
        set_["isEnrolled"] = is_real_template(template)

    await db().students.update_one({"_id": doc["_id"]}, {"$set": set_})
    doc = {**doc, **set_}
    await link_staff_account(doc)
    return doc


async def delete_person(student_id: str) -> dict:
    doc = await get_person(student_id)
    await db().students.delete_one({"_id": doc["_id"]})
    if doc.get("fingerprintId"):
        await db().admins.update_many(
            {"fingerprintId": doc["fingerprintId"]}, {"$unset": {"fingerprintId": "", "fingerprintTemplate": ""}}
        )
    return doc
