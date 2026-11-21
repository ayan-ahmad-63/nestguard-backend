import time

import jwt
import socketio

from app.core import events
from app.core.config import get_settings
from app.core.security import decode_token

STAFF_ROOM = "staff"
BOOT_TIME = int(time.time() * 1000)  # the dashboard re-logs-in if this changes (server restart)


def build_sio() -> socketio.AsyncServer:
    s = get_settings()
    sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=s.origins)

    @sio.event
    async def connect(sid, environ, auth):
        # Anyone may connect (the login screen listens for public events), but only
        # signed-in staff join the room that receives scans, alerts and enrolments.
        token = (auth or {}).get("token") if isinstance(auth, dict) else None
        if token:
            try:
                if decode_token(token).get("role") in ("admin", "warden", "security"):
                    await sio.enter_room(sid, STAFF_ROOM)
            except jwt.PyJWTError:
                pass
        await sio.emit("server_boot", {"serverBootTime": BOOT_TIME}, to=sid)

    return sio


def wire_events(sio: socketio.AsyncServer) -> None:
    """Domain events -> socket events. The only place that knows event names on the wire."""
    def to_staff(domain: str, wire: str, pick=lambda p: p):
        async def handler(payload: dict):
            await sio.emit(wire, pick(payload), room=STAFF_ROOM)
        events.subscribe(domain, handler)

    to_staff("access.logged", "scan_event")
    to_staff("alert.created", "alert_event")
    to_staff("biometric.enrolled", "biometric_enrolled", lambda p: p["result"])

    async def on_updated(payload: dict):
        await sio.emit("biometric_fp_updated", payload["result"], room=STAFF_ROOM)
        await sio.emit("biometric_fp_updated", {"success": True})  # no personal data: lets the login screen refresh

    async def on_armed(payload: dict):
        if payload.get("public"):
            await sio.emit(payload["event"], payload["data"])
        else:
            await sio.emit(payload["event"], payload["data"], room=STAFF_ROOM)

    events.subscribe("biometric.updated", on_updated)
    events.subscribe("sensor.armed", on_armed)
