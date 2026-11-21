"""Create the three staff accounts and the default gates.

    python -m scripts.seed                       # prompts nothing; reads ADMIN_PASSWORD etc. from env
    ADMIN_PASSWORD=... WARDEN_PASSWORD=... SECURITY_PASSWORD=... python -m scripts.seed

Passwords are never hard-coded. In ENV=development, missing ones fall back to
Admin@1234 / Warden@1234 / Security@1234 so the demo accounts keep working.
"""
import asyncio
import os
import sys

from app.core import db as database
from app.core.config import get_settings
from app.core.security import hash_password
from app.core.serialize import now
from app.modules.gates.service import ensure_default_gates

ACCOUNTS = [("Admin", "admin", "admin@nestguard.in", "ADMIN_PASSWORD", "Admin@1234"),
            ("Warden", "warden", "warden@nestguard.in", "WARDEN_PASSWORD", "Warden@1234"),
            ("Security", "security", "security@nestguard.in", "SECURITY_PASSWORD", "Security@1234")]


async def main() -> None:
    s = get_settings()
    database.init_db(s)
    await database.ensure_indexes()
    for name, role, email, env_name, dev_default in ACCOUNTS:
        password = os.environ.get(env_name) or (dev_default if s.env == "development" else None)
        if not password:
            sys.exit(f"Set {env_name} (no default outside development)")
        if await database.db().admins.find_one({"email": email}):
            print(f"= {email} already exists")
            continue
        await database.db().admins.insert_one({"name": name, "email": email, "password": hash_password(password),
                                               "role": role, "isActive": True, "createdAt": now()})
        print(f"+ {email} ({role})")
    await ensure_default_gates()
    print("Gates ready.")


if __name__ == "__main__":
    asyncio.run(main())
