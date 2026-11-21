"""App factory. Features are modules; ENABLED_MODULES decides which ones load."""
import importlib
import logging
from contextlib import asynccontextmanager

import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient

from app.core import db as database
from app.core import events
from app.core.config import Settings, get_settings
from app.core.responses import ok, register_handlers

log = logging.getLogger("nestguard")


def create_app(settings: Settings | None = None, mongo_client: AsyncIOMotorClient | None = None):
    """Returns an ASGI app (FastAPI + Socket.IO). `mongo_client` is for tests."""
    s = settings or get_settings()
    events.clear()
    mods = [importlib.import_module(f"app.modules.{name}") for name in s.modules]

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        database.init_db(s, mongo_client)
        if mongo_client is None:
            await database.ensure_indexes()
        for m in mods:
            if hasattr(m, "startup"):
                await m.startup()
        log.info("NestGuard API ready — modules: %s", ", ".join(s.modules))
        yield

    api = FastAPI(title="NestGuard API", version="1.0.0", lifespan=lifespan)
    api.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"])
    register_handlers(api)

    @api.get("/api/v1/health-check")
    async def health(deep: bool = False):
        # ?deep=1 also pings MongoDB, so keep-alive checks keep Atlas active and catch DB outages.
        if deep:
            try:
                await database.db().command("ping")
            except Exception:
                return JSONResponse(status_code=503, content={"success": False, "statusCode": 503,
                                                              "message": "Database unreachable", "data": None})
        return ok("NestGuard API is running", {"modules": s.modules})

    sio = None
    for m in mods:
        api.include_router(m.router)
        if hasattr(m, "build_sio"):
            sio = m.build_sio()
            m.wire_events(sio)

    return socketio.ASGIApp(sio, other_asgi_app=api, socketio_path="socket.io") if sio else api
