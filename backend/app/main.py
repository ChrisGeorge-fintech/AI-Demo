"""
FastAPI application entry point.
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.db import init_db
from app.core.queue import init_semaphore
from app.rag.budget_rag import bootstrap_budget_rag
from app.api import auth, jobs, chat, data_viz, receipts, transactions, ledger
from app.core.config import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await init_db()
    init_semaphore()
    try:
        await bootstrap_budget_rag()
    except Exception as exc:  # noqa: BLE001
        import logging
        logging.getLogger("ai_demo").warning(
            "Budget RAG bootstrap skipped (check GEMINI_API_KEY / budget doc): %s", exc
        )
    yield
    # Shutdown — nothing to clean up for now


settings = get_settings()

app = FastAPI(
    title="AI Accounting & Auditing Portal — API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(jobs.router)
app.include_router(chat.router)
app.include_router(data_viz.router)
app.include_router(receipts.router)
app.include_router(transactions.router)
app.include_router(ledger.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
