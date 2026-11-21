import base64
import os

import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

SERVICE_KEY = "s" * 40
os.environ.update({
    "JWT_SECRET": "j" * 40,
    "SERVICE_KEY": SERVICE_KEY,
    "TEMPLATE_ENCRYPTION_KEY": "ab" * 32,
    "ENV": "test",
    "BCRYPT_ROUNDS": "4",
})

from app.core import db as database, deps, events  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.core.security import hash_password  # noqa: E402
from app.main import create_app  # noqa: E402
from app.modules.biometric import state  # noqa: E402

SVC = {"X-Service-Key": SERVICE_KEY}


def fake_template(seed: str = "a") -> str:
    """Looks like a real Live20R template: long valid base64."""
    return base64.b64encode((seed * 120).encode()).decode()


async def make_client(modules: str | None = None, **overrides):
    get_settings.cache_clear()
    settings = get_settings()
    if modules or overrides:
        settings = Settings(**{**settings.model_dump(), **({"enabled_modules": modules} if modules else {}), **overrides})
    state.reset()
    deps.reset_rate_limits()
    mongo = AsyncMongoMockClient()
    app = create_app(settings, mongo)
    return app, mongo, settings


@pytest.fixture
async def ctx():
    app, mongo, settings = await make_client()
    async with LifespanManager(app):
        d = database.db()
        for role, email, pw in (("admin", "admin@t.io", "Admin@1234"), ("warden", "warden@t.io", "Warden@1234"),
                                ("security", "sec@t.io", "Sec@1234")):
            await d.admins.insert_one({"name": role.title(), "email": email, "password": hash_password(pw),
                                       "role": role, "isActive": True})
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as client:
            yield client, d
    events.clear()


async def login(client, email="admin@t.io", password="Admin@1234") -> dict:
    r = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['data']['token']}"}


async def enroll(client, headers, name="Ali Khan", roll="21-CS-001", seed="a", person="STUDENT"):
    r = await client.post("/api/v1/students/enroll", headers=headers, json={
        "name": name, "rollNo": roll, "personType": person, "template": fake_template(seed), "consentGiven": True})
    assert r.status_code in (200, 201), r.text
    return r.json()["data"]["student"]
