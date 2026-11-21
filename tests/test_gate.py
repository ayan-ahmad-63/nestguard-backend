from tests.conftest import SVC, enroll, login


async def scan(client, fp, **kw):
    return await client.post("/api/v1/hardware/zkteco", headers=SVC, json={"fingerprintId": fp, "quality": 97, **kw})


async def test_scan_requires_service_key(ctx):
    client, _ = ctx
    assert (await client.post("/api/v1/hardware/zkteco", json={"fingerprintId": "FP-X-01"})).status_code == 401
    bad = await client.post("/api/v1/hardware/zkteco", headers={"X-Service-Key": "x" * 40}, json={})
    assert bad.status_code == 401
    jwt = await client.post("/api/v1/hardware/zkteco", headers=await login(client), json={})
    assert jwt.status_code == 401  # a staff JWT is not a gate credential


async def test_verified_scan_toggles_entry_exit_and_logs(ctx):
    client, d = ctx
    s = await enroll(client, await login(client), "Ali Khan", "R1")
    fp = s["fingerprintId"]
    first = (await scan(client, fp)).json()["data"]
    assert first["log"]["dir"] == "entry" and first["log"]["status"] in ("safe", "attention")
    assert first["log"]["confidence"] == 97
    second = (await scan(client, fp)).json()["data"]
    assert second["log"]["dir"] == "exit" and second["log"]["gate"] == "Main Gate Exit"
    assert await d.entry_logs.count_documents({}) == 2


async def test_unrecognised_finger_is_rejected_with_critical_alert(ctx):
    client, d = ctx
    r = (await scan(client, "UNRECOGNIZED")).json()["data"]
    assert r["student"] is None and r["log"]["status"] == "critical" and r["log"]["name"] == "Unknown Person"
    assert r["alert"]["sev"] == "critical"
    assert await d.alerts.count_documents({}) == 1


async def test_replayed_offline_event_is_deduped(ctx):
    client, d = ctx
    fp = (await enroll(client, await login(client)))["fingerprintId"]
    a = await scan(client, fp, eventId="evt-1")
    b = await scan(client, fp, eventId="evt-1")
    assert a.status_code == 201 and b.status_code == 200 and b.json()["data"]["duplicate"] is True
    assert await d.entry_logs.count_documents({}) == 1


async def test_logs_and_alerts_feed_the_dashboard_shape(ctx):
    client, _ = ctx
    h = await login(client)
    await scan(client, "UNRECOGNIZED")
    logs = (await client.get("/api/v1/entry-logs?limit=50", headers=h)).json()
    assert isinstance(logs["data"], list) and {"id", "initials", "name", "gate", "dir", "time", "status"} <= logs["data"][0].keys()
    assert logs["meta"]["total"] == 1
    alerts = (await client.get("/api/v1/alerts?limit=50", headers=h)).json()["data"]
    assert alerts[0]["acknowledged"] is False
    assert (await client.patch(f"/api/v1/alerts/{alerts[0]['id']}/acknowledge", headers=h)).status_code == 200
    assert (await client.get("/api/v1/alerts?unread=true", headers=h)).json()["data"] == []


async def test_biometric_cache_is_service_only_and_decrypted(ctx):
    client, _ = ctx
    h = await login(client)
    await enroll(client, h, "Ali Khan", "R1", "a")
    assert (await client.get("/api/v1/hardware/zkteco/biometric-cache", headers=h)).status_code == 401
    cache = (await client.get("/api/v1/hardware/zkteco/biometric-cache", headers=SVC)).json()["data"]
    assert cache["count"] == 1 and not cache["students"][0]["fingerprintTemplate"].startswith("enc:")


async def test_simulate_touch_is_disabled_by_default(ctx):
    client, _ = ctx
    assert (await client.post("/api/v1/hardware/zkteco/simulate-touch", json={"fingerprintId": "x"})).status_code == 404
