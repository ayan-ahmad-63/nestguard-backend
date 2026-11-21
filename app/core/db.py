"""MongoDB access. One shared database handle, set at startup (or by tests)."""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from app.core.config import Settings

_db: AsyncIOMotorDatabase | None = None


def init_db(settings: Settings, client=None) -> None:
    global _db
    client = client or AsyncIOMotorClient(settings.mongo_uri, serverSelectionTimeoutMS=5000)
    _db = client[settings.mongo_db]


def db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialised")
    return _db


async def ensure_indexes() -> None:
    d = db()
    await d.admins.create_index("email", unique=True)
    await d.admins.create_index("fingerprintId", unique=True, sparse=True)
    await d.students.create_index("rollNo", unique=True)
    await d.students.create_index("fingerprintId", unique=True, sparse=True)
    await d.gates.create_index("name", unique=True)
    await d.entry_logs.create_index([("timestamp", -1)])
    await d.entry_logs.create_index("eventId", unique=True, sparse=True)
    await d.alerts.create_index([("createdAt", -1)])
