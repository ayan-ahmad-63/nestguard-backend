from app.core import events
from app.modules.realtime.hub import STAFF_ROOM, wire_events


class FakeSio:
    def __init__(self):
        self.sent = []

    async def emit(self, event, data=None, room=None, to=None):
        self.sent.append((event, data, room))


async def test_private_events_go_to_staff_room_only():
    events.clear()
    sio = FakeSio()
    wire_events(sio)
    await events.publish("access.logged", {"log": {"id": "1"}, "student": None})
    await events.publish("alert.created", {"alert": {"id": "a"}})
    await events.publish("biometric.enrolled", {"result": {"success": True}})
    assert [(e, r) for e, _, r in sio.sent] == [("scan_event", STAFF_ROOM), ("alert_event", STAFF_ROOM),
                                                ("biometric_enrolled", STAFF_ROOM)]


async def test_public_events_carry_no_personal_data():
    events.clear()
    sio = FakeSio()
    wire_events(sio)
    await events.publish("biometric.updated", {"result": {"success": True, "student": {"name": "Ali"}}})
    await events.publish("sensor.armed", {"event": "login_sensor_armed", "public": True, "data": {"armed": True, "role": None}})
    public = [(e, d) for e, d, r in sio.sent if r is None]
    assert ("biometric_fp_updated", {"success": True}) in public and ("login_sensor_armed", {"armed": True, "role": None}) in public


async def test_a_failing_subscriber_does_not_break_the_scan_path():
    events.clear()

    async def boom(_):
        raise RuntimeError("x")

    events.subscribe("access.logged", boom)
    await events.publish("access.logged", {})  # must not raise


async def test_socketio_handshake_is_served_next_to_the_api(ctx):
    client, _ = ctx
    r = await client.get("/socket.io/?EIO=4&transport=polling")
    assert r.status_code == 200 and '"sid"' in r.text
    assert (await client.get("/api/v1/health-check")).status_code == 200
