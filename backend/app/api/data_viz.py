from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import get_current_user
from app.core.queue import get_semaphore, create_job, update_job, JobStatus
from app.rag.csv_pipeline import answer_data_question

router = APIRouter(prefix="/api/data", tags=["data-viz"])


class DataQueryRequest(BaseModel):
    question: str


@router.post("/query")
async def data_query(
    body: DataQueryRequest,
    _user: str = Depends(get_current_user),
):
    job_id = await create_job("data_viz")
    semaphore = get_semaphore()

    await update_job(job_id, JobStatus.PROCESSING)
    try:
        async with semaphore:
            result = await answer_data_question(body.question)
        await update_job(job_id, JobStatus.DONE, result=result)
        return {"job_id": job_id, **result}
    except Exception as exc:
        await update_job(job_id, JobStatus.FAILED, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
