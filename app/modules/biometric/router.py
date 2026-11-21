from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, ConfigDict

from app.core.config import get_settings
from app.core.deps import has_service_key, rate_limit, require_roles, service_only, staff_or_service
from app.core.responses import ApiError, ok
from app.modules.biometric import service, state
from app.modules.students import service as students

router = APIRouter(prefix="/api/v1/hardware/zkteco", tags=["biometric"])
staff = require_roles("admin", "warden", "security")


class ArmEnrollBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str = ""
    rollNo: str = ""
    personType: str = "STUDENT"
    roomNo: str = "Unassigned"
    department: str = "General"
    guardianContact: dict | None = None
    consentGiven: bool = False


class ArmUpdateBody(BaseModel):
    studentId: str = ""
    name: str = ""
    rollNo: str = ""


class ArmLoginBody(BaseModel):
    role: str | None = None


class DisarmLoginBody(BaseModel):
    nonce: str | None = None


class ScanBody(BaseModel):
    model_config = ConfigDict(extra="ignore")
    fingerprintId: str | None = None
    template: str | None = None
    quality: float = 98
    role: str | None = None
    gateName: str | None = None
    direction: str | None = None
    eventId: str | None = None


# ── Enrolment (dashboard arms, Gate PC reports the touch) ───────────────────
@router.post("/arm-enroll", dependencies=[Depends(staff)])
async def arm_enroll(body: ArmEnrollBody):
    return ok("Sensor armed for physical finger touch", await service.arm_enroll(body.model_dump()))


@router.post("/disarm-enroll", dependencies=[Depends(staff_or_service)])
async def disarm_enroll():
    return ok("Sensor disarmed", await service.disarm_enroll())


@router.get("/enroll-status", dependencies=[Depends(staff_or_service)])
async def enroll_status():
    return ok("Enrollment status", {"isArmed": state.enroll.armed, "target": state.enroll.target,
                                    "lastResult": state.enroll.last_result})


@router.post("/arm-update-fp", dependencies=[Depends(staff)])
async def arm_update_fp(body: ArmUpdateBody):
    return ok("Sensor armed for fingerprint update", await service.arm_update(body.model_dump()))


@router.post("/disarm-update-fp", dependencies=[Depends(staff_or_service)])
async def disarm_update_fp():
    return ok("Sensor disarmed", await service.disarm_update())


@router.get("/update-fp-status", dependencies=[Depends(staff_or_service)])
async def update_fp_status():
    return ok("Update status", {"isArmed": state.update.armed, "target": state.update.target,
                                "lastResult": state.update.last_result})


@router.get("/next-fp-slot", dependencies=[Depends(staff)])
async def next_fp_slot(name: str = Query(..., min_length=1)):
    slot = await students.next_fingerprint_id(name)
    return ok("Next fingerprint slot", {"slot": slot, "fingerprintId": slot})


# ── Thumb login (public screen, protected by a one-time session nonce) ──────
@router.post("/arm-login", dependencies=[Depends(rate_limit)])
async def arm_login(body: ArmLoginBody):
    return ok("Sensor armed for physical thumb scan login", await service.arm_login(body.role))


@router.post("/disarm-login")
async def disarm_login(request: Request, body: DisarmLoginBody | None = None):
    res = await service.disarm_login(body.nonce if body else None, has_service_key(request))
    return ok("Login sensor disarmed", res)


@router.get("/login-status")
async def login_status(request: Request, nonce: str | None = None):
    return ok("Thumb login status", service.login_status(nonce, has_service_key(request)))


# ── Gate PC only ────────────────────────────────────────────────────────────
@router.get("/biometric-cache", dependencies=[Depends(service_only)])
async def biometric_cache():
    people = await service.biometric_cache()
    return ok("Biometric cache retrieved", {"students": people, "count": len(people)})


@router.post("", dependencies=[Depends(service_only)])
async def scan(body: ScanBody):
    data, status, message = await service.handle_scan(body.model_dump())
    return ok(message, data, status=status)


@router.post("/simulate-touch")
async def simulate_touch(body: ScanBody):
    """Development only: pretend the reader matched `fingerprintId`. 404 everywhere else."""
    if not get_settings().simulate_allowed:
        raise ApiError(404, "Not found")
    data, status, message = await service.handle_scan(body.model_dump())
    return ok(message, data, status=status)
