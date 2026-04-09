"""
ChromaDB budget RAG pipeline.

On startup, the budget document is loaded, chunked, and embedded into a
persistent ChromaDB collection. At classification time, relevant budget
rules are retrieved and passed to Gemini for classification.
"""

import os
import re
from pathlib import Path
from typing import Optional

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.core.config import get_settings
from app.core.gemini import embed, generate

_chroma_client: Optional[chromadb.Client] = None
_collection: Optional[chromadb.Collection] = None

COLLECTION_NAME = "budget_rules"
CHUNK_SIZE = 400       # characters per chunk
CHUNK_OVERLAP = 80


def _chunk_text(text: str, size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> list[str]:
    """Split text into overlapping character-level chunks."""
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        chunks.append(text[start:end].strip())
        start += size - overlap
    return [c for c in chunks if c]


def _extract_text_from_path(path: str) -> str:
    """Extract plain text from a .pdf, .txt, or .csv budget file."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Budget document not found: {path}")

    suffix = p.suffix.lower()
    if suffix == ".txt" or suffix == ".csv":
        return p.read_text(encoding="utf-8")

    if suffix == ".pdf":
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(str(p))
            pages = [page.get_text() for page in doc]
            return "\n".join(pages)
        except ImportError:
            raise RuntimeError("PyMuPDF (fitz) is required for PDF extraction. Install pymupdf.")

    raise ValueError(f"Unsupported budget document format: {suffix}")


async def bootstrap_budget_rag() -> None:
    """Load and embed the budget document into ChromaDB. Safe to call on every startup — skips if already populated."""
    global _chroma_client, _collection
    settings = get_settings()

    _chroma_client = chromadb.PersistentClient(
        path="./chroma_db",
        settings=ChromaSettings(anonymized_telemetry=False),
    )

    _collection = _chroma_client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )

    # Skip re-embedding if already populated
    if _collection.count() > 0:
        return

    raw_text = _extract_text_from_path(settings.budget_doc_path)
    chunks = _chunk_text(raw_text)

    for i, chunk in enumerate(chunks):
        vector = await embed(chunk)
        _collection.add(
            ids=[f"chunk_{i}"],
            embeddings=[vector],
            documents=[chunk],
            metadatas=[{"source": settings.budget_doc_path, "chunk_index": i}],
        )


async def retrieve_budget_context(query: str, n_results: int = 4) -> str:
    """Retrieve the most relevant budget rule chunks for a given query."""
    if _collection is None:
        raise RuntimeError("ChromaDB collection not initialised. Call bootstrap_budget_rag() at startup.")

    query_vector = await embed(query)
    results = _collection.query(
        query_embeddings=[query_vector],
        n_results=min(n_results, _collection.count()),
        include=["documents"],
    )
    docs: list[str] = results["documents"][0] if results["documents"] else []
    return "\n\n---\n\n".join(docs)
