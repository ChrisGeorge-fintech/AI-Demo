import io
import json
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

from app.core.security import get_current_user
from app.core.gemini import stream
from app.core.queue import get_semaphore, create_job, update_job, JobStatus
from app.services.pdf_extractor import extract_text_from_pdf

router = APIRouter(prefix="/api/chat", tags=["chat"])

_MAX_FILE_BYTES = 10 * 1024 * 1024   # 10 MB per file
_MAX_FILES = 3
_MAX_DOC_CHARS = 60_000               # chars sent to Gemini per file


async def _extract_file_text(file: UploadFile) -> str:
    """Extract plain text from PDF, CSV, or TXT upload."""
    content = await file.read()
    if len(content) > _MAX_FILE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"'{file.filename}' exceeds the 10 MB limit.",
        )
    name = (file.filename or "").lower()
    if name.endswith(".pdf"):
        return extract_text_from_pdf(content)
    # CSV and TXT — decode as UTF-8, replace unreadable bytes
    return content.decode("utf-8", errors="replace")


@router.post("/message")
async def chat_message(
    message: str = Form(...),
    history: str = Form(default="[]"),
    files: List[UploadFile] = File(default=[]),
    _user: str = Depends(get_current_user),
):
    """
    Accepts multipart/form-data.
      - message  : the user's text (required)
      - history  : JSON string — [{"role":"user"|"model","content":"..."}]
      - files    : up to 3 optional files (.pdf / .csv / .txt, max 10 MB each)

    Returns a Server-Sent Events stream.
    Each event:  data: {"chunk": "...", "done": false}
    Final event: data: {"chunk": "",    "done": true}
    """
    # Guard: ignore placeholder UploadFile objects with no actual filename
    real_files = [f for f in files if f.filename]
    if len(real_files) > _MAX_FILES:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {_MAX_FILES} files allowed per message.",
        )

    job_id = await create_job("chat")

    # Parse conversation history
    try:
        history_list: list[dict] = json.loads(history)
    except (json.JSONDecodeError, ValueError):
        history_list = []

    # Build document context block (ephemeral — only for this prompt)
    doc_context = ""
    for file in real_files:
        text = await _extract_file_text(file)
        trimmed = text.strip()[:_MAX_DOC_CHARS]
        if trimmed:
            doc_context += (
                f"\n\n=== Uploaded file: {file.filename} ===\n"
                f"{trimmed}\n"
                f"=== End: {file.filename} ==="
            )

    # Build the full prompt
    history_text = ""
    for turn in history_list[-10:]:   # max 10 turns of context
        role = "User" if turn.get("role") == "user" else "Assistant"
        history_text += f"{role}: {turn.get('content', '')}\n"

    if doc_context:
        prompt = (
            f"The user has provided the following document(s) as context for this message only:"
            f"{doc_context}\n\n"
            f"{history_text}"
            f"User: {message}\nAssistant:"
        )
    else:
        prompt = f"{history_text}User: {message}\nAssistant:"

    async def event_generator():
        semaphore = get_semaphore()
        await update_job(job_id, JobStatus.PROCESSING)
        try:
            async with semaphore:
                full_response = []
                async for chunk in stream(prompt):
                    full_response.append(chunk)
                    payload = json.dumps({"chunk": chunk, "done": False, "job_id": job_id})
                    yield f"data: {payload}\n\n"
                await update_job(job_id, JobStatus.DONE, result={"response": "".join(full_response)})
                yield f"data: {json.dumps({'chunk': '', 'done': True, 'job_id': job_id})}\n\n"
        except Exception as exc:
            await update_job(job_id, JobStatus.FAILED, error=str(exc))
            yield f"data: {json.dumps({'chunk': '', 'done': True, 'error': str(exc), 'job_id': job_id})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
