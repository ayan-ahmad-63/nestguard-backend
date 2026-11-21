from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict

from app.core.deps import require_roles
from app.core.responses import ok
from app.core.serialize import person
from app.modules.students import service

router = APIRouter(prefix="/api/v1/students", tags=["students"])

staff = require_roles("admin", "warden", "security")
managers = require_roles("admin", "warden")


class PersonBody(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str | None = None
    rollNo: str | None = None
    personType: str | None = None
    roomNo: str | None = None
    department: str | None = None
    guardianName: str | None = None
    guardianPhone: str | None = None
    guardianEmail: str | None = None
    guardianContact: dict | None = None
    fingerprintId: str | None = None
    fingerprintTemplate: str | None = None
    template: str | None = None
    consentGiven: bool = False


@router.get("", dependencies=[Depends(staff)])
async def list_students(personType: str | None = None, enrolled: bool | None = None):
    people = await service.list_people(personType, enrolled)
    return ok("Residents retrieved successfully", {"students": people, "count": len(people)})


@router.post("/enroll", dependencies=[Depends(staff)])
async def enroll(body: PersonBody):
    data = body.model_dump()
    doc, created = await service.enroll_person(data, body.fingerprintId, body.template)
    if created:
        msg = f"Successfully enrolled {doc['name']} ({doc['rollNo']}) with ID {doc['fingerprintId']}"
        return ok(msg, {"student": person(doc)}, status=201)
    return ok(f"Updated enrollment for {doc['name']} ({doc['rollNo']})", {"student": person(doc)})


@router.get("/{student_id}", dependencies=[Depends(staff)])
async def get_student(student_id: str):
    return ok("Resident retrieved successfully", {"student": person(await service.get_person(student_id))})


@router.put("/{student_id}", dependencies=[Depends(staff)])
async def update_student(student_id: str, body: PersonBody):
    doc = await service.update_person(student_id, body.model_dump(exclude_unset=True))
    return ok(f"Updated details for {doc['name']}", {"student": person(doc)})


@router.delete("/{student_id}", dependencies=[Depends(managers)])
async def delete_student(student_id: str):
    doc = await service.delete_person(student_id)
    return ok(f"Resident {doc['name']} deleted successfully")
