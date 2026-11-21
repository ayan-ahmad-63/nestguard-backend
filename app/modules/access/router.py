from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from app.core.deps import require_roles, service_only
from app.core.responses import ok
from app.modules.access import service

router = APIRouter(prefix="/api/v1/entry-logs", tags=["access"])


class ScanBody(BaseModel):
    fingerprintId: str | None = None
    quality: float = 98
    eventId: str | None = None  # lets the Gate PC replay its offline queue without duplicates
    gateName: str | None = None
    direction: str | None = None


@router.get("", dependencies=[Depends(require_roles("admin", "warden", "security"))])
async def get_logs(page: int = Query(1, ge=1), limit: int = Query(50, ge=1, le=500),
                   gate: str | None = None, status: str | None = None):
    logs, total = await service.list_logs(page, limit, gate, status)
    return ok("Logs fetched", logs, {"total": total, "page": page, "limit": limit})


@router.post("/scan", dependencies=[Depends(service_only)])
async def post_scan(body: ScanBody):
    res = await service.process_scan(body.fingerprintId, body.quality, body.eventId, body.gateName, body.direction)
    return ok("Scan processed", res, status=200 if res["duplicate"] else 201)
