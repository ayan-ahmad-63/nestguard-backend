from app.core.db import db
from app.core.serialize import now

DEFAULT_GATES = [
    {"name": "Main Gate Entry", "location": "Main Entrance"},
    {"name": "Main Gate Exit", "location": "Main Entrance"},
]


async def ensure_default_gates() -> None:
    if await db().gates.count_documents({}) == 0:
        stamp = now()
        await db().gates.insert_many(
            [{**g, "status": "safe", "isActive": True, "createdAt": stamp, "updatedAt": stamp} for g in DEFAULT_GATES]
        )


async def list_gates() -> list[dict]:
    return [
        {"id": str(g["_id"]), "name": g["name"], "location": g.get("location", ""), "status": g.get("status", "safe")}
        async for g in db().gates.find({}).sort("name", 1)
    ]


async def resolve_gate(name: str | None = None) -> dict | None:
    """Gate by name, else the main entry gate, else any gate."""
    for candidate in (name, "Main Gate Entry"):
        if candidate and (g := await db().gates.find_one({"name": candidate})):
            return g
    return await db().gates.find_one({})
