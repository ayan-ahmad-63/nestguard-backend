import pytest
from asgi_lifespan import LifespanManager
from httpx import ASGITransport, AsyncClient

from app.core.config import Settings
from app.core.security import decrypt_template, encrypt_template
from tests.conftest import make_client


def test_aes_gcm_roundtrip_and_tamper_detection():
    enc = encrypt_template("hello-template")
    assert enc != "hello-template" and decrypt_template(enc) == "hello-template"
    assert encrypt_template("hello-template") != enc  # fresh IV every time
    assert decrypt_template(enc[:-4] + "AAAA") == ""  # modified ciphertext is rejected
    assert decrypt_template("legacy-plaintext") == "legacy-plaintext"


def test_settings_reject_weak_secrets():
    with pytest.raises(ValueError):
        Settings(jwt_secret="short", service_key="s" * 40, template_encryption_key="ab" * 32)
    with pytest.raises(ValueError):
        Settings(jwt_secret="j" * 40, service_key="s" * 40, template_encryption_key="nothex")


async def test_features_are_modules_that_can_be_switched_off():
    app, _, _ = await make_client(modules="auth,gates")
    async with LifespanManager(app):
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.get("/api/v1/health-check")).json()["data"]["modules"] == ["auth", "gates"]
            assert (await c.get("/api/v1/gates")).status_code == 401      # loaded
            assert (await c.get("/api/v1/students")).status_code == 404   # not loaded


async def test_default_gates_are_created_on_startup(ctx):
    from tests.conftest import login
    client, _ = ctx
    gates = (await client.get("/api/v1/gates", headers=await login(client))).json()["data"]
    assert [g["name"] for g in gates] == ["Main Gate Entry", "Main Gate Exit"]
