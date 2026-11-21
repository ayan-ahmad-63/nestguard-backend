"""Realtime module: owns the Socket.IO server. `main` mounts `sio` when this module is enabled."""
from fastapi import APIRouter

from app.modules.realtime.hub import BOOT_TIME, build_sio, wire_events  # noqa: F401

router = APIRouter()  # no HTTP routes; present so every module has the same entry point
