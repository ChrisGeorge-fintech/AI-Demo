"""
Ledger diff service.

Compares two versions of a general ledger CSV and produces:
  1. A structured numeric diff (row counts, column totals, new/removed rows)
  2. A Gemini narrative analysis of the changes
"""

import io
import json
import pandas as pd

from app.core.gemini import generate

_SYSTEM = (
    "You are a senior auditor reviewing changes between two versions of a general ledger. "
    "Be precise, professional, and highlight anything that warrants attention. "
    "Respond ONLY with valid JSON — no markdown, no code fences."
)

_ANALYSIS_SCHEMA = """
Respond with this exact JSON:
{
  "headline": "<one sentence summarising the most significant change>",
  "key_changes": ["<change 1>", "<change 2>", ...],
  "risk_flags": ["<anything unusual or requiring attention>"],
  "narrative": "<3-6 sentence professional narrative of all material changes>"
}
"""


def _load_df(csv_text: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(csv_text), low_memory=False)
    # Auto-parse date-like columns
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


def _numeric_diff(old_df: pd.DataFrame, new_df: pd.DataFrame) -> dict:
    """Compute a structured diff of numeric column totals and row counts."""
    result: dict = {
        "row_count": {"old": len(old_df), "new": len(new_df), "delta": len(new_df) - len(old_df)},
        "column_totals": {},
    }

    old_nums = old_df.select_dtypes(include="number").columns.tolist()
    new_nums = new_df.select_dtypes(include="number").columns.tolist()
    shared_nums = [c for c in new_nums if c in old_nums]

    for col in shared_nums:
        old_val = float(old_df[col].sum())
        new_val = float(new_df[col].sum())
        delta = new_val - old_val
        if old_val != 0:
            pct = round(delta / abs(old_val) * 100, 2)
        else:
            pct = None
        result["column_totals"][col] = {
            "old": round(old_val, 2),
            "new": round(new_val, 2),
            "delta": round(delta, 2),
            "pct_change": pct,
        }

    # Detect new/removed columns
    result["new_columns"] = [c for c in new_df.columns if c not in old_df.columns]
    result["removed_columns"] = [c for c in old_df.columns if c not in new_df.columns]

    # Row-level diff: try to find a plausible key column (ID-like, high-cardinality string)
    key_col = _detect_key_column(new_df, old_df)
    if key_col:
        old_keys = set(old_df[key_col].dropna().astype(str))
        new_keys = set(new_df[key_col].dropna().astype(str))
        added = list(new_keys - old_keys)[:20]
        removed = list(old_keys - new_keys)[:20]
        result["row_diff"] = {
            "key_column": key_col,
            "added_rows": len(new_keys - old_keys),
            "removed_rows": len(old_keys - new_keys),
            "sample_added": added[:5],
            "sample_removed": removed[:5],
        }

    return result


def _detect_key_column(new_df: pd.DataFrame, old_df: pd.DataFrame) -> str | None:
    """
    Find a column that looks like a row identifier:
    high uniqueness ratio in both datasets, string type preferred.
    """
    candidates = []
    for col in new_df.columns:
        if col not in old_df.columns:
            continue
        n_unique = new_df[col].nunique()
        ratio = n_unique / max(len(new_df), 1)
        # Prefer: high cardinality, not purely numeric, looks like an ID
        is_str = new_df[col].dtype == object
        looks_like_id = any(kw in col.lower() for kw in ["id", "ref", "code", "number", "no", "invoice", "account"])
        if ratio > 0.8 or (is_str and looks_like_id):
            candidates.append((col, ratio, looks_like_id))

    if not candidates:
        return None
    # Sort: prefer ID-named string cols, then highest cardinality
    candidates.sort(key=lambda x: (x[2], x[1]), reverse=True)
    return candidates[0][0]


def _format_diff_for_prompt(diff: dict, old_filename: str, new_filename: str) -> str:
    lines = [
        f"Previous version: {old_filename}",
        f"New version: {new_filename}",
        "",
        f"Row count: {diff['row_count']['old']} → {diff['row_count']['new']}"
        f" ({'+' if diff['row_count']['delta'] >= 0 else ''}{diff['row_count']['delta']} rows)",
        "",
    ]

    if diff.get("new_columns"):
        lines.append(f"New columns added: {', '.join(diff['new_columns'])}")
    if diff.get("removed_columns"):
        lines.append(f"Columns removed: {', '.join(diff['removed_columns'])}")

    if diff.get("row_diff"):
        rd = diff["row_diff"]
        lines.append(
            f"Row-level diff (key: {rd['key_column']}): "
            f"{rd['added_rows']} new entries, {rd['removed_rows']} removed entries"
        )
        if rd["sample_added"]:
            lines.append(f"  Sample new: {rd['sample_added']}")
        if rd["sample_removed"]:
            lines.append(f"  Sample removed: {rd['sample_removed']}")

    lines.append("")
    lines.append("Column total changes:")
    for col, vals in diff.get("column_totals", {}).items():
        pct_str = f" ({'+' if vals['pct_change'] and vals['pct_change'] >= 0 else ''}{vals['pct_change']}%)" if vals["pct_change"] is not None else ""
        delta_str = f"+{vals['delta']}" if vals["delta"] >= 0 else str(vals["delta"])
        lines.append(f"  {col}: {vals['old']:,.2f} → {vals['new']:,.2f}  Δ {delta_str}{pct_str}")

    return "\n".join(lines)


async def analyse_ledger_diff(
    old_csv: str,
    new_csv: str,
    old_filename: str,
    new_filename: str,
    client_id: str,
    new_version: int,
) -> dict:
    """
    Full diff pipeline. Returns:
      {
        "diff": <structured numeric diff>,
        "analysis": <Gemini narrative: headline, key_changes, risk_flags, narrative>
      }
    """
    old_df = _load_df(old_csv)
    new_df = _load_df(new_csv)

    diff = _numeric_diff(old_df, new_df)

    diff_text = _format_diff_for_prompt(diff, old_filename, new_filename)

    prompt = (
        f"Client: {client_id}\n"
        f"Ledger version: v{new_version} (submitted now)\n\n"
        f"Computed diff between versions:\n{diff_text}\n\n"
        f"{_ANALYSIS_SCHEMA}"
    )

    raw = await generate(prompt, system_prompt=_SYSTEM)

    import re
    raw = re.sub(r"```(?:json)?", "", raw).strip().rstrip("`").strip()
    analysis = json.loads(raw)

    return {"diff": diff, "analysis": analysis}
