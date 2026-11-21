"""One-shot 'armed' sessions for the single Live20R reader.

The dashboard arms the sensor (enrol / update finger / thumb login), the next
physical touch is routed to that session, and the session clears itself. Sessions
expire after ARM_TIMEOUT_S so a forgotten arm cannot capture a later finger.
"""
import time
from dataclasses import dataclass, field

from app.core.config import get_settings


@dataclass
class ArmSlot:
    target: dict | None = None
    last_result: dict | None = None
    expires: float = 0.0
    extra: dict = field(default_factory=dict)

    def arm(self, target: dict, **extra) -> None:
        self.target, self.last_result, self.extra = target, None, extra
        self.expires = time.monotonic() + get_settings().arm_timeout_s

    def disarm(self) -> None:
        self.target, self.extra, self.expires = None, {}, 0.0

    @property
    def armed(self) -> bool:
        if self.target is not None and time.monotonic() > self.expires:
            self.disarm()
        return self.target is not None

    def finish(self, result: dict) -> None:
        self.last_result = result
        self.disarm()


enroll = ArmSlot()
update = ArmSlot()
login = ArmSlot()


def reset() -> None:
    for slot in (enroll, update, login):
        slot.disarm()
        slot.last_result = None
