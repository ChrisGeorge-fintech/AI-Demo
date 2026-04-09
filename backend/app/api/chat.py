import json
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.core.security import get_current_user
from app.core.gemini import stream
from app.core.queue import get_semaphore, create_job, update_job, JobStatus

router = APIRouter(prefix="/api/chat", tags=["chat"])


class ChatRequest(BaseModel):
    message: str
    history: list[dict] = []   # [{"role": "user"|"model", "content": "..."}]


@router.post("/message")
async def chat_message(
    body: ChatRequest,
    _user: str = Depends(get_current_user),
):
    """
    Returns a Server-Sent Events stream.
    Each event is: data: {"chunk": "...", "done": false}
    Final event:   data: {"chunk": "", "done": true}
    """
    job_id = await create_job("chat")

    # Build a single prompt that includes prior history for context
    history_text = ""
    for turn in body.history[-10:]:   # max 10 turns of context
        role = "User" if turn.get("role") == "user" else "Assistant"
        history_text += f"{role}: {turn.get('content', '')}\n"

    prompt = f"{history_text}User: {body.message}\nAssistant:"

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
