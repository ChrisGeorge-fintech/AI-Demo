"""
CSV pipeline: translates a natural language question into a pandas operation,
executes it safely, and returns structured chart data.
"""

import json
import re
import pandas as pd
from pathlib import Path

from app.core.gemini import generate
from app.core.config import get_settings

# System prompt specific to the data pipeline — no accounting persona needed here
_SYSTEM = (
    "You are a data analysis assistant. Given a CSV schema and a natural language question, "
    "you respond ONLY with a valid JSON object describing a chart. "
    "Never include markdown, code fences, or any text outside the JSON."
)

_RESPONSE_SCHEMA = """
Respond with this exact JSON structure:
{
  "chart_type": "bar" | "line" | "pie",
  "title": "<chart title>",
  "x_label": "<x axis label or category label>",
  "y_label": "<y axis label or value label>",
  "data": [
    {"label": "<string>", "value": <number>},
    ...
  ]
}
Rules:
- "data" must have at most 20 items.
- All values must be numbers (not strings).
- Sort by value descending unless the question implies chronological order.
- For pie charts, the top categories by total are preferred.
"""


def _load_csv() -> pd.DataFrame:
    settings = get_settings()
    path = Path(settings.csv_data_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV file not found: {path}")
    return pd.read_csv(path)


def _csv_context(df: pd.DataFrame) -> str:
    """Build a compact context string: column info + first 5 rows."""
    col_info = ", ".join(f"{c} ({df[c].dtype})" for c in df.columns)
    sample = df.head(5).to_csv(index=False)
    return (
        f"Columns: {col_info}\n"
        f"Row count: {len(df)}\n"
        f"Sample rows:\n{sample}"
    )


async def answer_data_question(question: str) -> dict:
    """
    Returns a dict with keys: chart_type, title, x_label, y_label, data[]
    """
    df = _load_csv()
    context = _csv_context(df)

    prompt = (
        f"CSV context:\n{context}\n\n"
        f"Question: {question}\n\n"
        f"{_RESPONSE_SCHEMA}"
    )

    raw = await generate(prompt, system_prompt=_SYSTEM)

    # Strip any accidental markdown fences
    raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Gemini returned invalid JSON: {exc}\nRaw: {raw[:300]}") from exc

    # Validate required keys
    for key in ("chart_type", "title", "data"):
        if key not in result:
            raise ValueError(f"Missing key '{key}' in Gemini response")

    # Clamp data to 20 items
    result["data"] = result["data"][:20]
    return result
