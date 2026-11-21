from tests.conftest import SVC, enroll, fake_template, login

HW = "/api/v1/hardware/zkteco"


async def test_enrol_via_sensor_arms_then_saves_on_touch(ctx):
    client, d = ctx
    h = await login(client)
    arm = await client.post(f"{HW}/arm-enroll", headers=h, json={
        "name": "Zahid Khan", "rollNo": "21-cs-9", "consentGiven": True, "guardianContact": {"phone": "0300"}})
    assert arm.status_code == 200
    assert (await client.get(f"{HW}/enroll-status", headers=SVC)).json()["data"]["isArmed"] is True
    touch = await client.post(HW, headers=SVC, json={"fingerprintId": "", "template": fake_template("z")})
    assert touch.status_code == 201 and touch.json()["data"]["slot"] == "FP-ZK-01"
    status = (await client.get(f"{HW}/enroll-status", headers=h)).json()["data"]
    assert status["isArmed"] is False and status["lastResult"]["success"] is True
    doc = await d.students.find_one({"rollNo": "21-CS-9"})
    assert doc["isEnrolled"] and doc["guardianContact"]["phone"] == "0300" and doc["fingerprintTemplate"].startswith("enc:")


async def test_arm_enroll_needs_consent_and_staff_login(ctx):
    client, _ = ctx
    body = {"name": "A B", "rollNo": "R", "consentGiven": False}
    assert (await client.post(f"{HW}/arm-enroll", json=body)).status_code == 401
    assert (await client.post(f"{HW}/arm-enroll", headers=await login(client), json=body)).status_code == 400


async def test_bad_capture_keeps_sensor_armed(ctx):
    client, _ = ctx
    await client.post(f"{HW}/arm-enroll", headers=await login(client),
                      json={"name": "A B", "rollNo": "R", "consentGiven": True})
    bad = await client.post(HW, headers=SVC, json={"template": "short"})
    assert bad.status_code == 422
    assert (await client.get(f"{HW}/enroll-status", headers=SVC)).json()["data"]["isArmed"] is True


async def test_update_fingerprint_replaces_template_and_keeps_id(ctx):
    client, d = ctx
    h = await login(client)
    s = await enroll(client, h, "Ali Khan", "R1", "a")
    await client.post(f"{HW}/arm-update-fp", headers=h, json={"studentId": s["_id"], "name": "Ali Khan", "rollNo": "R1"})
    r = await client.post(HW, headers=SVC, json={"template": fake_template("n")})
    assert r.status_code == 200 and r.json()["data"]["slot"] == s["fingerprintId"]
    cache = (await client.get(f"{HW}/biometric-cache", headers=SVC)).json()["data"]["students"]
    assert cache[0]["fingerprintTemplate"] == fake_template("n")


async def _admin_with_finger(client, d, h, role="admin"):
    s = await enroll(client, h, role.title(), f"{role[:3].upper()}-001", "k", "STAFF")
    return s["fingerprintId"]


async def test_thumb_login_happy_path_hands_token_over_once(ctx):
    client, d = ctx
    fp = await _admin_with_finger(client, d, await login(client))
    arm = (await client.post(f"{HW}/arm-login", json={"role": "admin"})).json()["data"]
    nonce = arm["nonce"]
    assert (await client.get(f"{HW}/login-status")).status_code == 401  # no nonce, no token
    assert (await client.get(f"{HW}/login-status?nonce=wrong")).status_code == 401
    touch = await client.post(HW, headers=SVC, json={"fingerprintId": fp})
    assert touch.status_code == 200
    got = (await client.get(f"{HW}/login-status?nonce={nonce}")).json()["data"]
    assert got["lastResult"]["success"] and got["lastResult"]["user"]["role"] == "admin"
    token = got["lastResult"]["token"]
    assert (await client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})).status_code == 200
    again = (await client.get(f"{HW}/login-status?nonce={nonce}")).json()["data"]
    assert again["lastResult"] is None  # token is not replayable from the status endpoint


async def test_unrecognised_finger_never_logs_anyone_in(ctx):
    client, d = ctx
    await _admin_with_finger(client, d, await login(client))
    nonce = (await client.post(f"{HW}/arm-login", json={})).json()["data"]["nonce"]
    for fp in ("UNRECOGNIZED", "", "FP-ADM-99"):
        r = await client.post(HW, headers=SVC, json={"fingerprintId": fp})
        assert r.status_code == 401
    res = (await client.get(f"{HW}/login-status?nonce={nonce}")).json()["data"]["lastResult"]
    assert res["success"] is False and "token" not in res


async def test_login_role_must_match_the_selected_card(ctx):
    client, d = ctx
    fp = await _admin_with_finger(client, d, await login(client), "admin")
    nonce = (await client.post(f"{HW}/arm-login", json={"role": "warden"})).json()["data"]["nonce"]
    assert (await client.post(HW, headers=SVC, json={"fingerprintId": fp})).status_code == 401
    assert (await client.get(f"{HW}/login-status?nonce={nonce}")).json()["data"]["lastResult"]["success"] is False


async def test_bridge_can_poll_armed_state_with_service_key(ctx):
    client, _ = ctx
    await client.post(f"{HW}/arm-login", json={"role": "security"})
    st = (await client.get(f"{HW}/login-status", headers=SVC)).json()["data"]
    assert st == {"isArmed": True, "role": "security"}  # never includes a token


async def test_disarm_login_needs_the_nonce(ctx):
    client, _ = ctx
    nonce = (await client.post(f"{HW}/arm-login", json={})).json()["data"]["nonce"]
    assert (await client.post(f"{HW}/disarm-login", json={})).status_code == 403
    assert (await client.post(f"{HW}/disarm-login", json={"nonce": nonce})).status_code == 200


async def test_arm_session_expires(ctx):
    import time
    from app.modules.biometric import state
    client, _ = ctx
    await client.post(f"{HW}/arm-login", json={})
    state.login.expires = time.monotonic() - 1
    assert (await client.get(f"{HW}/login-status", headers=SVC)).json()["data"]["isArmed"] is False
