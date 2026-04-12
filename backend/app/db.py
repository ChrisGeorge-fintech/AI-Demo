import aiosqlite
from app.core.config import get_settings
from app.core.security import hash_password


CREATE_USERS_TABLE = """
CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT    NOT NULL UNIQUE,
    password TEXT    NOT NULL,
    created_at TEXT  NOT NULL DEFAULT (datetime('now'))
)
"""

CREATE_JOBS_TABLE = """
CREATE TABLE IF NOT EXISTS jobs (
    id         TEXT    PRIMARY KEY,
    type       TEXT    NOT NULL,
    status     TEXT    NOT NULL DEFAULT 'queued',
    result     TEXT,
    error      TEXT,
    created_at TEXT    NOT NULL,
    updated_at TEXT
)
"""

CREATE_LEDGER_TABLE = """
CREATE TABLE IF NOT EXISTS ledger_submissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id   TEXT    NOT NULL,
    version     INTEGER NOT NULL,
    filename    TEXT,
    content     TEXT    NOT NULL,
    submitted_at TEXT   NOT NULL DEFAULT (datetime('now'))
)
"""


async def init_db() -> None:
    """Create tables and seed the default admin user if it doesn't exist."""
    settings = get_settings()
    async with aiosqlite.connect(settings.database_url) as db:
        await db.execute(CREATE_USERS_TABLE)
        await db.execute(CREATE_JOBS_TABLE)
        await db.execute(CREATE_LEDGER_TABLE)
        await db.commit()

        # Seed a default admin account — credentials come from env vars or fallback defaults
        # In production, set ADMIN_USERNAME and ADMIN_PASSWORD env vars before first run
        import os
        admin_user = os.getenv("ADMIN_USERNAME", "admin")
        admin_pass = os.getenv("ADMIN_PASSWORD", "changeme123")

        async with db.execute(
            "SELECT id FROM users WHERE username = ?", (admin_user,)
        ) as cursor:
            existing = await cursor.fetchone()

        if not existing:
            await db.execute(
                "INSERT INTO users (username, password) VALUES (?, ?)",
                (admin_user, hash_password(admin_pass)),
            )
            await db.commit()
