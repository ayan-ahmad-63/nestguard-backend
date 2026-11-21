from tests.conftest import login


async def test_login_ok_sets_cookie_and_hides_password(ctx):
    client, _ = ctx
    r = await client.post("/api/v1/auth/login", json={"email": "admin@t.io", "password": "Admin@1234"})
    body = r.json()
    assert r.status_code == 200 and body["success"] is True
    assert body["data"]["user"]["role"] == "admin" and "password" not in body["data"]["user"]
    assert "ng_token" in r.headers["set-cookie"] and "httponly" in r.headers["set-cookie"].lower()


async def test_wrong_password_and_unknown_email_are_indistinguishable(ctx):
    client, _ = ctx
    a = await client.post("/api/v1/auth/login", json={"email": "admin@t.io", "password": "nope"})
    b = await client.post("/api/v1/auth/login", json={"email": "ghost@t.io", "password": "nope"})
    assert a.status_code == b.status_code == 401 and a.json()["message"] == b.json()["message"]


async def test_login_is_rate_limited(ctx):
    client, _ = ctx
    codes = [(await client.post("/api/v1/auth/login", json={"email": "admin@t.io", "password": "x"})).status_code
             for _ in range(32)]
    assert codes[-1] == 429


async def test_me_requires_token(ctx):
    client, _ = ctx
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    me = await client.get("/api/v1/auth/me", headers=await login(client))
    assert me.json()["data"]["email"] == "admin@t.io" and "password" not in me.json()["data"]


async def test_protected_routes_reject_anonymous(ctx):
    client, _ = ctx
    for path in ("/api/v1/students", "/api/v1/entry-logs", "/api/v1/alerts", "/api/v1/gates"):
        assert (await client.get(path)).status_code == 401, path


async def test_staff_profiles_never_exposes_fingerprint_ids_outside_dev(ctx):
    client, d = ctx
    await d.admins.update_one({"role": "admin"}, {"$set": {"fingerprintId": "FP-ADM-01"}})
    staff = (await client.get("/api/v1/auth/staff-profiles")).json()["data"]["staff"]
    assert all("fingerprintId" not in s for s in staff) and any(s["hasFingerprint"] for s in staff)
