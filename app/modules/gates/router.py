from fastapi import APIRouter, Depends

from app.core.deps import require_roles
from app.core.responses import ok
from app.modules.gates import service

router = APIRouter(prefix="/api/v1/gates", tags=["gates"])


@router.get("", dependencies=[Depends(require_roles("admin", "warden", "security"))])
async def get_gates():
    return ok("Gates fetched", await service.list_gates())
