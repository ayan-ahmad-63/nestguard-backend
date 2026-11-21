from fastapi import APIRouter, Depends, Query

from app.core.deps import require_roles
from app.core.responses import ok
from app.modules.alerts import service

router = APIRouter(prefix="/api/v1/alerts", tags=["alerts"], dependencies=[Depends(require_roles("admin", "warden", "security"))])


@router.get("")
async def list_alerts(limit: int = Query(50, ge=1, le=500), unread: bool = False):
    return ok("Alerts fetched", await service.list_alerts(limit, unread))


@router.patch("/acknowledge-all")
async def acknowledge_all():
    await service.acknowledge_all()
    return ok("All alerts acknowledged")


@router.patch("/{alert_id}/acknowledge")
async def acknowledge(alert_id: str):
    await service.acknowledge(alert_id)
    return ok("Alert acknowledged", {"id": alert_id, "acknowledged": True})
