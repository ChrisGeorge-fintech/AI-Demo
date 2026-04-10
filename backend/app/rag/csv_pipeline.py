"""
CSV pipeline — two-step analytical approach:

  Step 1: Gemini sees schema + value ranges → writes a pandas expression
  Step 2: Backend executes expression safely on full dataset → exact result
  Step 3: Gemini formats exact result → {summary, visuals}

This supports arbitrary analytical questions (filters, percentiles, text search,
multi-condition queries, period comparisons) with exact numbers, without sending
raw rows to Gemini.
"""

import json
import re
import numpy as np
import pandas as pd
from pathlib import Path

from app.core.gemini import generate
from app.core.config import get_settings

_MAX_UNIQUE_CATS = 50     # columns with more unique values are treated as free-text/IDs
_MAX_RESULT_ROWS = 50     # cap rows sent to Step 2 Gemini call

# ── Blocked patterns for safe eval ──────────────────────────────────────────
_BLOCKED = re.compile(
    r"\b(import|exec|eval|open|os|sys|subprocess|__import__|getattr|setattr"
    r"|delattr|vars|globals|locals|compile|breakpoint|input|print|"
    r"__builtins__|__class__|__bases__|__subclasses__|__mro__)\b"
    r"|__[a-z]+__"
)

# ── Whitelisted builtins exposed to eval ────────────────────────────────────
_SAFE_BUILTINS: dict = {
    "len": len, "range": range, "int": int, "float": float,
    "str": str, "list": list, "dict": dict, "tuple": tuple,
    "bool": bool, "abs": abs, "round": round,
    "min": min, "max": max, "sum": sum,
    "sorted": sorted, "enumerate": enumerate, "zip": zip,
    "True": True, "False": False, "None": None,
}


# ── Step 1 prompts ───────────────────────────────────────────────────────────

_STEP1_SYSTEM = (
    "You are a pandas code generator. Given a DataFrame schema and a natural "
    "language question, you write a single safe pandas expression that computes "
    "the exact answer. Respond ONLY with valid JSON — no markdown, no code fences."
)

_STEP1_SCHEMA = """
Respond with this exact JSON:
{
  "explanation": "<one sentence: what this expression computes>",
  "code": "<single Python expression using 'df' that returns a DataFrame, Series, or scalar — or null if the question cannot be answered>"
}

Rules for code:
- Use only 'df', 'pd', and 'np' — no imports, no exec, no open, no os, no sys.
- The expression must be evaluable with eval() in one line.
- For groupby: always end with .reset_index() so the result is a DataFrame.
- For filtering: df[boolean_condition] syntax.
- For top/bottom N: df.nlargest(N, 'col') or df.nsmallest(N, 'col').
- For percentile: df['col'].quantile(0.9).
- For monthly groupby: df.groupby(df['date_col'].dt.to_period('M').astype(str))['num_col'].sum().reset_index().
- For string contains: df[df['col'].str.contains('term', case=False, na=False)].
- Keep the result to at most 50 rows by chaining .head(50) where appropriate.
- If the question cannot be answered from available columns, set code to null.
"""


# ── Step 2 prompts ───────────────────────────────────────────────────────────

_STEP2_SYSTEM = (
    "You are a data analysis assistant. You are given the exact computed result "
    "of a query on a real dataset — all numbers are precise. "
    "Respond ONLY with valid JSON — no markdown, no code fences."
)

_STEP2_SCHEMA = """
Respond with this exact JSON:
{
  "summary": "<2-4 sentence plain-English answer quoting exact figures from the result>",
  "visuals": [
    {
      "type": "bar" | "line" | "pie" | "table",
      "title": "<visual title>",
      "x_label": "<x-axis label — omit for pie and table>",
      "y_label": "<y-axis label — omit for pie and table>",
      "data": [{"label": "<string>", "value": <number>}, ...],
      "columns": ["<col1>", "<col2>", ...],
      "rows": [["<cell>", ...], ...]
    }
  ]
}

Rules:
- "summary" is required. Quote exact figures from the provided result.
- "visuals": 1 to 5 items — choose the most insightful types.
- Charts (bar/line/pie): populate "data" (max 20 items), omit columns/rows.
- Table: populate "columns" + "rows" (max 20 rows), omit data.
- Include both a chart and a table if both add value.
- Sort chart data by value descending unless chronological order is implied.
- Do NOT invent or round numbers — use exact values from the result.
"""


# ── Helpers ──────────────────────────────────────────────────────────────────

def _load_csv() -> pd.DataFrame:
    settings = get_settings()
    path = Path(settings.csv_data_path)
    if not path.exists():
        raise FileNotFoundError(f"CSV file not found: {path}")
    df = pd.read_csv(path, low_memory=False)
    # Auto-parse date-like object columns — try ISO8601 first, fall back to mixed
    for col in df.select_dtypes(include="object").columns:
        for fmt in ("ISO8601", "mixed"):
            try:
                parsed = pd.to_datetime(df[col], format=fmt, errors="coerce")
                if parsed.notna().mean() > 0.7:
                    df[col] = parsed
                    break
            except Exception:
                continue
    return df


def _build_schema_summary(df: pd.DataFrame) -> str:
    """
    Compact schema description for Step 1 — enough for Gemini to write
    correct column references and understand value ranges.
    """
    # Identify low-cardinality categorical columns for cross-tabulation hints
    cat_cols = [
        c for c in df.columns
        if not pd.api.types.is_numeric_dtype(df[c].dtype)
        and not pd.api.types.is_datetime64_any_dtype(df[c].dtype)
        and df[c].nunique() <= _MAX_UNIQUE_CATS
    ]

    lines = [f"Rows: {len(df):,}   Columns: {len(df.columns)}"]
    for col in df.columns:
        dtype = df[col].dtype
        if pd.api.types.is_numeric_dtype(dtype):
            s = df[col].dropna()
            n_unique = s.nunique()
            if n_unique <= 1:
                # Constant column — summing it is meaningless
                lines.append(
                    f"  {col} [numeric, CONSTANT={s.iloc[0]:.4g} — same on every row, do NOT sum]"
                )
            else:
                lines.append(
                    f"  {col} [numeric]  min={s.min():.4g}  max={s.max():.4g}"
                    f"  mean={s.mean():.4g}  sum={s.sum():.4g}  ({n_unique} distinct values)"
                )
                # For each low-cardinality categorical, show per-category totals
                for cat in cat_cols[:3]:  # limit to 3 groupby hints
                    try:
                        gb = (
                            df.groupby(cat)[col].sum()
                            .sort_values(ascending=False)
                            .head(8)
                            .round(2)
                        )
                        pairs = ", ".join(f"{k}: {v}" for k, v in gb.items())
                        lines.append(f"    grouped by {cat} → {pairs}")
                    except Exception:
                        pass
        elif pd.api.types.is_datetime64_any_dtype(dtype):
            lines.append(f"  {col} [datetime]  {df[col].min().date()} → {df[col].max().date()}")
        else:
            n_unique = df[col].nunique()
            if n_unique <= _MAX_UNIQUE_CATS:
                sample_vals = df[col].value_counts().head(5).index.tolist()
                lines.append(
                    f"  {col} [categorical, {n_unique} unique]"
                    f"  sample: {sample_vals}"
                )
            else:
                lines.append(f"  {col} [text/id, {n_unique} unique values — high cardinality]")
    return "\n".join(lines)


def _safe_eval(code: str, df: pd.DataFrame) -> tuple:
    """
    Evaluate a pandas expression in a restricted namespace.
    Returns (result, error_string). error_string is empty on success.
    """
    if _BLOCKED.search(code):
        match = _BLOCKED.search(code)
        return None, f"Blocked unsafe pattern: '{match.group()}'"

    try:
        result = eval(
            code,
            {"__builtins__": _SAFE_BUILTINS, "pd": pd, "np": np},
            {"df": df},
        )
        return result, ""
    except Exception as exc:
        return None, str(exc)


def _result_to_text(result) -> str:
    """Serialise an eval result to plain text for the Step 2 prompt."""
    if isinstance(result, pd.DataFrame):
        return result.head(_MAX_RESULT_ROWS).round(4).to_csv(index=False)
    if isinstance(result, pd.Series):
        return result.head(_MAX_RESULT_ROWS).reset_index().round(4).to_csv(index=False)
    # scalar (int, float, numpy scalar, etc.)
    if isinstance(result, (np.integer, np.floating)):
        return str(result.item())
    return str(result)


def _parse_json(raw: str) -> dict:
    cleaned = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    return json.loads(cleaned)


# ── Main entry point ─────────────────────────────────────────────────────────

async def answer_data_question(question: str) -> dict:
    """
    Two-step pipeline:
      Step 1 → Gemini generates pandas expression from schema
      Step 2 → pandas executes it → Gemini formats exact result into visuals
    """
    df = _load_csv()
    schema = _build_schema_summary(df)

    # ── Step 1: generate pandas expression ──────────────────────────────────
    step1_prompt = (
        f"DataFrame schema:\n{schema}\n\n"
        f"Question: {question}\n\n"
        f"{_STEP1_SCHEMA}"
    )
    step1_raw = await generate(step1_prompt, system_prompt=_STEP1_SYSTEM)

    try:
        step1 = _parse_json(step1_raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Step 1 JSON parse error: {exc}\nRaw: {step1_raw[:300]}") from exc

    code = step1.get("code")
    result_text: str

    if not code:
        # Gemini signalled the question can't be answered from this data
        result_text = f"No specific query could be formed. Schema:\n{schema}"
    else:
        result, error = _safe_eval(code, df)

        if error:
            # ── Retry once: send error back to Gemini to fix ────────────────
            retry_prompt = (
                f"The following pandas expression raised an error:\n"
                f"Code: {code}\n"
                f"Error: {error}\n\n"
                f"DataFrame schema:\n{schema}\n\n"
                f"Please write a corrected expression for: {question}\n\n"
                f"{_STEP1_SCHEMA}"
            )
            retry_raw = await generate(retry_prompt, system_prompt=_STEP1_SYSTEM)
            try:
                step1_retry = _parse_json(retry_raw)
                code = step1_retry.get("code")
                if code:
                    result, error = _safe_eval(code, df)
            except Exception:
                pass  # fall through to schema fallback

        if not error and result is not None:
            result_text = _result_to_text(result)
        else:
            # Final fallback: send schema-level summaries so something renders
            result_text = f"Could not execute query (error: {error}).\nSchema:\n{schema}"

    # ── Step 2: format exact result into {summary, visuals} ─────────────────
    step2_prompt = (
        f"Original question: {question}\n\n"
        f"Computed result (exact values from full dataset):\n{result_text}\n\n"
        f"{_STEP2_SCHEMA}"
    )
    step2_raw = await generate(step2_prompt, system_prompt=_STEP2_SYSTEM)

    try:
        final = _parse_json(step2_raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"Step 2 JSON parse error: {exc}\nRaw: {step2_raw[:300]}") from exc

    if "summary" not in final:
        raise ValueError("Missing 'summary' in Step 2 response")
    if "visuals" not in final or not isinstance(final["visuals"], list):
        raise ValueError("Missing 'visuals' in Step 2 response")

    for v in final["visuals"][:5]:
        if v.get("data"):
            v["data"] = v["data"][:20]
        if v.get("rows"):
            v["rows"] = v["rows"][:20]
    final["visuals"] = final["visuals"][:5]

    return final
