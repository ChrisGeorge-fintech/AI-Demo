import asyncio
import json
import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

import aiosqlite

from app.core.config import get_settings

# Global semaphore — initialised once on startup
_semaphore: Optional[asyncio.Semaphore] = None


def init_semaphore() -> None:
    global _semaphore
    settings = get_settings()
    _semaphore = asyncio.Semaphore(settings.max_concurrent_requests)


def get_semaphore() -> asyncio.Semaphore:
    if _semaphore is None:
        raise RuntimeError("Semaphore not initialised. Call init_semaphore() at startup.")
    return _semaphore


class JobStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


async def create_job(job_type: str) -> str:
    """Insert a new job row and return its ID."""
    job_id = str(uuid.uuid4())
    settings = get_settings()
    async with aiosqlite.connect(settings.database_url) as db:
        await db.execute(
            """
            INSERT INTO jobs (id, type, status, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (job_id, job_type, JobStatus.QUEUED, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()
    return job_id


async def update_job(
    job_id: str,
    status: JobStatus,
    result: Optional[Any] = None,
    error: Optional[str] = None,
) -> None:
    settings = get_settings()
    result_json = json.dumps(result) if result is not None else None
    async with aiosqlite.connect(settings.database_url) as db:
        await db.execute(
            """
            UPDATE jobs
            SET status = ?, result = ?, error = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                status,
                result_json,
                error,
                datetime.now(timezone.utc).isoformat(),
                job_id,
            ),
        )
        await db.commit()


async def get_job(job_id: str) -> Optional[dict]:
    settings = get_settings()
    async with aiosqlite.connect(settings.database_url) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, type, status, result, error, created_at, updated_at FROM jobs WHERE id = ?",
            (job_id,),
        ) as cursor:
            row = await cursor.fetchone()
            if row is None:
                return None
            data = dict(row)
            if data["result"]:
                data["result"] = json.loads(data["result"])
            return data
