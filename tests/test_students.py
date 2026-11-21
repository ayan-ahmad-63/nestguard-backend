from app.core.security import decrypt_template
from tests.conftest import enroll, fake_template, login


async def test_enroll_requires_consent(ctx):
    client, _ = ctx
    r = await client.post("/api/v1/students/enroll", headers=await login(client),
                          json={"name": "A B", "rollNo": "X1", "template": fake_template()})
    assert r.status_code == 400


async def test_template_is_encrypted_at_rest_and_never_returned(ctx):
    client, d = ctx
    h = await login(client)
    s = await enroll(client, h)
    assert "fingerprintTemplate" not in s and s["isEnrolled"] is True and s["fingerprintId"].startswith("FP-AK-")
    stored = (await d.students.find_one({"rollNo": "21-CS-001"}))["fingerprintTemplate"]
    assert stored.startswith("enc:v1:") and fake_template() not in stored
    assert decrypt_template(stored) == fake_template()
    listing = (await client.get("/api/v1/students", headers=h)).json()["data"]
    assert listing["count"] == 1 and "fingerprintTemplate" not in listing["students"][0]


async def test_manual_entry_without_real_template_is_not_enrolled(ctx):
    client, _ = ctx
    r = await client.post("/api/v1/students/enroll", headers=await login(client), json={
        "name": "No Finger", "rollNo": "X9", "template": "MANUAL_OVERRIDE_123", "consentGiven": True})
    assert r.json()["data"]["student"]["isEnrolled"] is False


async def test_fingerprint_ids_increment_and_reenroll_updates(ctx):
    client, _ = ctx
    h = await login(client)
    a = await enroll(client, h, "Ali Khan", "R1", "a")
    b = await enroll(client, h, "Asad Kamal", "R2", "b")
    assert a["fingerprintId"] == "FP-AK-01" and b["fingerprintId"] == "FP-AK-02"
    again = await enroll(client, h, "Ali Khan", "R1", "c")
    assert again["fingerprintId"] == "FP-AK-01"


async def test_security_cannot_delete_but_warden_can(ctx):
    client, _ = ctx
    s = await enroll(client, await login(client), "Bilal", "R3")
    sec = await login(client, "sec@t.io", "Sec@1234")
    assert (await client.delete(f"/api/v1/students/{s['_id']}", headers=sec)).status_code == 403
    war = await login(client, "warden@t.io", "Warden@1234")
    assert (await client.delete(f"/api/v1/students/{s['_id']}", headers=war)).status_code == 200


async def test_staff_enrolment_links_the_admin_account(ctx):
    client, d = ctx
    s = await enroll(client, await login(client), "Warden", "WRD-001", "w", "STAFF")
    assert (await d.admins.find_one({"role": "warden"}))["fingerprintId"] == s["fingerprintId"]
