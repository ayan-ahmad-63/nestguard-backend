"""Tiny in-process event bus. Modules publish facts; other modules subscribe.

Event names used in Phase-I:
  access.logged        {log, student}
  alert.created        {alert}
  biometric.enrolled   {result}
  biometric.updated    {result}
  biometric.login      {nonce, result}
  sensor.armed         {kind, armed, ...}
"""
import logging
from collections import defaultdict
from collections.abc import Awaitable, Callable

log = logging.getLogger("nestguard.events")
Handler = Callable[[dict], Awaitable[None]]
_subs: dict[str, list[Handler]] = defaultdict(list)


def subscribe(event: str, handler: Handler) -> None:
    _subs[event].append(handler)


def clear() -> None:
    _subs.clear()


async def publish(event: str, payload: dict) -> None:
    for handler in _subs.get(event, []):
        try:
            await handler(payload)
        except Exception:  # a broken subscriber must never break the scan path
            log.exception("handler failed for %s", event)
