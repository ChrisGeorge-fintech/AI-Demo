"""
Ledger portal API.

POST /api/ledger/submit  — client submits a new general ledger CSV
GET  /api/ledger/history — list all submission versions for a client
"""

import json
from datetime import datetime, timezone

import aiosqlite
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

from app.core.config import get_settings
from app.core.security import get_current_user
from app.core.queue import get_semaphore, create_job, update_job, JobStatus
from app.services.ledger_diff import analyse_ledger_diff
from app.services.email_sender import send_receipt_analysis  # reuse generic send helper

router = APIRouter(prefix="/api/ledger", tags=["ledger"])

_MAX_FILE_BYTES = 20 * 1024 * 1024   # 20 MB


# ── helpers ──────────────────────────────────────────────────────────────────

async def _get_previous(db: aiosqlite.Connection, client_id: str) -> tuple[int, str, str] | None:
    """Return (version, content, filename) of the most recent submission, or None."""
    async with db.execute(
        "SELECT version, content, filename FROM ledger_submissions "
        "WHERE client_id = ? ORDER BY version DESC LIMIT 1",
        (client_id,),
    ) as cur:
        row = await cur.fetchone()
    return row  # type: ignore[return-value]


async def _save_submission(
    db: aiosqlite.Connection,
    client_id: str,
    version: int,
    filename: str,
    content: str,
) -> int:
    cur = await db.execute(
        "INSERT INTO ledger_submissions (client_id, version, filename, content, submitted_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (client_id, version, filename, content, datetime.now(timezone.utc).isoformat()),
    )
    await db.commit()
    return cur.lastrowid  # type: ignore[return-value]


def _build_email_html(
    client_id: str,
    new_version: int,
    filename: str,
    submitted_at: str,
    diff_result: dict,
) -> str:
    diff = diff_result["diff"]
    analysis = diff_result["analysis"]

    rc = diff["row_count"]
    delta_sign = "+" if rc["delta"] >= 0 else ""

    totals_rows = ""
    for col, vals in diff.get("column_totals", {}).items():
        delta_sign2 = "+" if vals["delta"] >= 0 else ""
        pct = f" ({'+' if vals.get('pct_change') and vals['pct_change'] >= 0 else ''}{vals.get('pct_change')}%)" if vals.get("pct_change") is not None else ""
        color = "#16a34a" if vals["delta"] >= 0 else "#dc2626"
        totals_rows += (
            f"<tr>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #f3f4f6'>{col}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:right'>{vals['old']:,.2f}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:right'>{vals['new']:,.2f}</td>"
            f"<td style='padding:6px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:{color};font-weight:600'>"
            f"{delta_sign2}{vals['delta']:,.2f}{pct}</td>"
            f"</tr>"
        )

    key_changes_html = "".join(f"<li style='margin:4px 0'>{c}</li>" for c in analysis.get("key_changes", []))
    risk_flags_html = "".join(
        f"<li style='margin:4px 0;color:#b45309'>{r}</li>" for r in analysis.get("risk_flags", [])
    ) or "<li style='color:#6b7280'>No risk flags identified.</li>"

    row_diff_section = ""
    if diff.get("row_diff"):
        rd = diff["row_diff"]
        row_diff_section = (
            f"<p style='margin:0 0 4px'><strong>Key column:</strong> {rd['key_column']}</p>"
            f"<p style='margin:0 0 4px'><strong>New entries:</strong> {rd['added_rows']}</p>"
            f"<p style='margin:0 0 4px'><strong>Removed entries:</strong> {rd['removed_rows']}</p>"
        )

    return f"""
<!DOCTYPE html>
<html>
<head><meta charset='utf-8'></head>
<body style='font-family:sans-serif;max-width:680px;margin:0 auto;color:#111'>
  <div style='background:#1e40af;padding:24px 32px;border-radius:8px 8px 0 0'>
    <h1 style='color:white;margin:0;font-size:20px'>New Ledger Submission</h1>
    <p style='color:#bfdbfe;margin:4px 0 0;font-size:14px'>AI Accounting &amp; Auditing Portal</p>
  </div>
  <div style='background:white;padding:24px 32px;border:1px solid #e5e7eb;border-top:0;border-radius:0 0 8px 8px'>

    <table style='width:100%;margin-bottom:20px;font-size:14px'>
      <tr><td style='color:#6b7280;padding:3px 0'>Client</td><td style='font-weight:600'>{client_id}</td></tr>
      <tr><td style='color:#6b7280;padding:3px 0'>Version</td><td style='font-weight:600'>v{new_version}</td></tr>
      <tr><td style='color:#6b7280;padding:3px 0'>File</td><td>{filename}</td></tr>
      <tr><td style='color:#6b7280;padding:3px 0'>Submitted</td><td>{submitted_at}</td></tr>
      <tr><td style='color:#6b7280;padding:3px 0'>Rows</td>
          <td>{rc['old']} → {rc['new']} <span style='color:#6b7280'>({delta_sign}{rc['delta']})</span></td></tr>
    </table>

    <div style='background:#eff6ff;border-left:4px solid #3b82f6;padding:12px 16px;margin-bottom:20px;border-radius:4px'>
      <p style='margin:0;font-weight:600;font-size:15px'>{analysis.get("headline", "")}</p>
    </div>

    <h3 style='margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280'>Narrative</h3>
    <p style='margin:0 0 20px;font-size:14px;line-height:1.7'>{analysis.get("narrative", "")}</p>

    <h3 style='margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280'>Key Changes</h3>
    <ul style='margin:0 0 20px;padding-left:20px;font-size:14px'>{key_changes_html}</ul>

    <h3 style='margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#b45309'>Risk Flags</h3>
    <ul style='margin:0 0 20px;padding-left:20px;font-size:14px'>{risk_flags_html}</ul>

    {'<h3 style="margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280">Row-Level Changes</h3>' + row_diff_section + '<div style="margin-bottom:20px"></div>' if diff.get("row_diff") else ''}

    <h3 style='margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280'>Column Totals</h3>
    <table style='width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px'>
      <thead>
        <tr style='background:#f9fafb'>
          <th style='padding:8px 12px;text-align:left;border-bottom:2px solid #e5e7eb'>Column</th>
          <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb'>Previous</th>
          <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb'>New</th>
          <th style='padding:8px 12px;text-align:right;border-bottom:2px solid #e5e7eb'>Change</th>
        </tr>
      </thead>
      <tbody>{totals_rows if totals_rows else "<tr><td colspan='4' style='padding:12px;color:#6b7280'>No shared numeric columns to compare.</td></tr>"}</tbody>
    </table>

    <p style='color:#9ca3af;font-size:12px;margin:0'>
      This analysis was generated automatically. Please review the submission directly before taking action.
    </p>
  </div>
</body>
</html>
"""


# ── routes ───────────────────────────────────────────────────────────────────

@router.post("/submit")
async def submit_ledger(
    client_id: str = Form(...),
    file: UploadFile = File(...),
    _user: str = Depends(get_current_user),
):
    """
    Upload a new version of a client's general ledger.
    - Stores the file in SQLite.
    - If a previous version exists, computes a diff and emails staff.
    - Returns the new version number and, if applicable, the diff analysis.
    """
    settings = get_settings()

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are accepted.")

    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="File exceeds the 20 MB limit.")

    csv_text = raw.decode("utf-8", errors="replace")
    job_id = await create_job("ledger")
    await update_job(job_id, JobStatus.PROCESSING)

    try:
        async with aiosqlite.connect(settings.database_url) as db:
            prev = await _get_previous(db, client_id)
            new_version = (prev[0] + 1) if prev else 1
            await _save_submission(db, client_id, new_version, file.filename, csv_text)

        response: dict = {
            "job_id": job_id,
            "client_id": client_id,
            "version": new_version,
            "filename": file.filename,
            "is_first_submission": prev is None,
        }

        if prev is None:
            # First submission — no diff to compute
            await update_job(job_id, JobStatus.DONE, result=response)
            return response

        # Run diff + Gemini analysis
        semaphore = get_semaphore()
        async with semaphore:
            diff_result = await analyse_ledger_diff(
                old_csv=prev[1],
                new_csv=csv_text,
                old_filename=prev[2] or f"v{prev[0]}",
                new_filename=file.filename,
                client_id=client_id,
                new_version=new_version,
            )

        # Email staff if configured
        if settings.staff_email and settings.resend_api_key:
            submitted_at = datetime.now(timezone.utc).strftime("%d %b %Y %H:%M UTC")
            html = _build_email_html(client_id, new_version, file.filename, submitted_at, diff_result)
            subject = f"New Ledger Submission — {client_id} v{new_version}"
            await run_in_threadpool(send_receipt_analysis, settings.staff_email, subject, html)

        response["diff"] = diff_result["diff"]
        response["analysis"] = diff_result["analysis"]
        await update_job(job_id, JobStatus.DONE, result=response)
        return response

    except Exception as exc:
        await update_job(job_id, JobStatus.FAILED, error=str(exc))
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/history/{client_id}")
async def ledger_history(
    client_id: str,
    _user: str = Depends(get_current_user),
):
    """Return a list of all submission metadata for a client (no file content)."""
    settings = get_settings()
    async with aiosqlite.connect(settings.database_url) as db:
        async with db.execute(
            "SELECT version, filename, submitted_at FROM ledger_submissions "
            "WHERE client_id = ? ORDER BY version DESC",
            (client_id,),
        ) as cur:
            rows = await cur.fetchall()

    return {
        "client_id": client_id,
        "submissions": [
            {"version": r[0], "filename": r[1], "submitted_at": r[2]}
            for r in rows
        ],
    }
