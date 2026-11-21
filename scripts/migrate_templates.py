"""One-off: encrypt fingerprint templates the old Node backend stored in plaintext.

    python -m scripts.migrate_templates --dry-run
    python -m scripts.migrate_templates

Safe to re-run: values already starting with "enc:v1:" are skipped.
Also drops placeholder templates (e.g. MANUAL_OVERRIDE_..., SIMULATED_...), which can never match a finger.
"""
import asyncio
import sys

from app.core import db as database
from app.core.config import get_settings
from app.core.security import ENC_PREFIX, encrypt_template, is_real_template


async def main(dry: bool) -> None:
    database.init_db(get_settings())
    for coll in ("students", "admins"):
        enc = dropped = 0
        async for doc in database.db()[coll].find({"fingerprintTemplate": {"$nin": ["", None]}}):
            tpl = doc["fingerprintTemplate"]
            if tpl.startswith(ENC_PREFIX):
                continue
            if is_real_template(tpl):
                enc += 1
                if not dry:
                    await database.db()[coll].update_one({"_id": doc["_id"]}, {"$set": {"fingerprintTemplate": encrypt_template(tpl)}})
            else:
                dropped += 1
                if not dry:
                    update = {"$unset": {"fingerprintTemplate": ""}}
                    if coll == "students":
                        update["$set"] = {"isEnrolled": False}
                    await database.db()[coll].update_one({"_id": doc["_id"]}, update)
        print(f"{coll}: encrypted {enc}, dropped placeholders {dropped}{' (dry run)' if dry else ''}")


if __name__ == "__main__":
    asyncio.run(main("--dry-run" in sys.argv))
