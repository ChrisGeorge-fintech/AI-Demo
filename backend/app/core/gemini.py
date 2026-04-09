from typing import AsyncIterator, Optional
from google import genai
from google.genai import types

from app.core.config import get_settings

_client: Optional[genai.Client] = None

SYSTEM_PROMPT_ACCOUNTING = (
    "You are an expert accounting and auditing assistant with deep knowledge of "
    "IFRS, GAAP, ISA standards, tax regulations, and financial reporting. "
    "Provide clear, accurate, and professional responses. "
    "When discussing transactions, always consider materiality, going concern, and compliance."
)


def get_client() -> genai.Client:
    global _client
    if _client is None:
        settings = get_settings()
        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


async def generate(
    prompt: str,
    system_prompt: str = SYSTEM_PROMPT_ACCOUNTING,
    model: str = "gemini-2.0-flash",
) -> str:
    """Single-shot generation via the async Gemini API."""
    client = get_client()
    response = await client.aio.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2,
        ),
    )
    return response.text


async def stream(
    prompt: str,
    system_prompt: str = SYSTEM_PROMPT_ACCOUNTING,
    model: str = "gemini-2.0-flash",
) -> AsyncIterator[str]:
    """True async streaming — yields text chunks as they arrive."""
    client = get_client()
    async for chunk in await client.aio.models.generate_content_stream(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            system_instruction=system_prompt,
            temperature=0.2,
        ),
    ):
        if chunk.text:
            yield chunk.text


async def embed(text: str, model: str = "text-embedding-004") -> list[float]:
    """Generate an embedding vector via the async Gemini API."""
    client = get_client()
    result = await client.aio.models.embed_content(
        model=model,
        contents=text,
    )
    return result.embeddings[0].values
