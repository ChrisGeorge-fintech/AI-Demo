import json
import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.security import get_current_user
from app.core.queue import get_semaphore, create_job, update_job, JobStatus
from app.core.gemini import generate
from app.rag.budget_rag import retrieve_budget_context

router = APIRouter(prefix="/api/transactions", tags=["transactions"])

_SYSTEM = (
    "You are an accounting compliance officer. "
    "Given budget rules and a list of transactions, you classify each transaction. "
    "Respond ONLY with valid JSON — no markdown, no code fences."
)

_CLASSIFY_PROMPT = """
Budget rules:
{budget_context}

Transactions to classify:
{transactions}

For each transaction return a JSON array where each item has:
{{
  "transaction": "<original transaction description>",
  "amount": <number>,
  "budget_code": "<code e.g. OPS-001 or UNKNOWN>",
  "budget_line": "<budget line name or UNKNOWN>",
  "meets_requirements": true | false,
  "reason": "<one sentence explanation>"
}}
Return ONLY the JSON array, nothing else.
"""


class Transaction(BaseModel):
    description: str
    amount: float


class ClassifyRequest(BaseModel):
    transactions: list[Transaction]


@router.post("/classify")
async def classify_transactions(
    body: ClassifyRequest,
    _user: str = Depends(get_current_user),
):
    if not body.transactions:
        raise HTTPException(status_code=400, detail="No transactions provided")

    job_id = await create_job("transactions")
    semaphore = get_semaphore()

    await update_job(job_id, JobStatus.PROCESSING)
    try:
        # Build a combined query for budget context retrieval
        combined_query = " ".join(t.description for t in body.transactions[:5])
        budget_context = await retrieve_budget_context(combined_query, n_results=6)

        tx_text = "\n".join(
            f"{i + 1}. {t.description} — Amount: {t.amount}"
            for i, t in enumerate(body.transactions)
        )

        prompt = _CLASSIFY_PROMPT.format(
            budget_context=budget_context,
            transactions=tx_text,
        )

        async with semaphore:
            raw = await generate(prompt, system_prompt=_SYSTEM)

        raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
        classifications = json.loads(raw)

        await update_job(job_id, JobStatus.DONE, result={"classifications": classifications})
        return {"job_id": job_id, "classifications": classifications}
    except Exception as exc:
        await update_job(job_id, JobStatus.FAILED, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc
