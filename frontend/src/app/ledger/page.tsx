"use client";

import { useState, useRef, FormEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface SubmissionHistory {
  version: number;
  filename: string;
  submitted_at: string;
}

interface ColumnTotal {
  old: number;
  new: number;
  delta: number;
  pct_change: number | null;
}

interface RowDiff {
  key_column: string;
  added_rows: number;
  removed_rows: number;
  sample_added: string[];
  sample_removed: string[];
}

interface Diff {
  row_count: { old: number; new: number; delta: number };
  column_totals: Record<string, ColumnTotal>;
  new_columns: string[];
  removed_columns: string[];
  row_diff?: RowDiff;
}

interface Analysis {
  headline: string;
  key_changes: string[];
  risk_flags: string[];
  narrative: string;
}

interface SubmitResult {
  job_id: string;
  client_id: string;
  version: number;
  filename: string;
  is_first_submission: boolean;
  diff?: Diff;
  analysis?: Analysis;
}

function getToken(): string {
  return document.cookie.split("; ").find((r) => r.startsWith("token="))?.split("=")[1] ?? "";
}

function fmt(n: number) {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function LedgerPortalPage() {
  const [clientId, setClientId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [history, setHistory] = useState<SubmissionHistory[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clientId.trim() || !file) return;
    setError("");
    setResult(null);
    setLoading(true);

    try {
      const form = new FormData();
      form.append("client_id", clientId.trim());
      form.append("file", file);

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/ledger/submit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Submission failed");
      setResult(data);
      // Refresh history
      await loadHistory(clientId.trim());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(id: string) {
    if (!id.trim()) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/ledger/history/${encodeURIComponent(id.trim())}`,
        { headers: { Authorization: `Bearer ${getToken()}` } },
      );
      const data = await res.json();
      if (res.ok) setHistory(data.submissions ?? []);
    } catch {
      // non-critical
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">Client Ledger Portal</h1>
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">Versioned</span>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8 space-y-6">

        {/* Upload form */}
        <div className="bg-white border border-gray-200 rounded-2xl p-6">
          <h2 className="font-medium text-gray-800 mb-1">Submit General Ledger</h2>
          <p className="text-xs text-gray-500 mb-5">
            Each submission is saved as a new version. If a previous version exists, a change
            analysis is automatically emailed to staff.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Client ID / Name</label>
              <input
                type="text"
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onBlur={() => clientId.trim() && loadHistory(clientId.trim())}
                placeholder="e.g. Acme Corp or CLIENT-001"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                Use the same ID on every submission to link versions together.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">General Ledger (.csv)</label>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 hover:border-blue-400 rounded-xl p-6 text-center cursor-pointer transition-colors"
              >
                {file ? (
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-sm font-medium text-gray-700">{file.name}</span>
                    <span className="text-xs text-gray-400">({(file.size / 1024).toFixed(1)} KB)</span>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setFile(null); }}
                      className="text-gray-400 hover:text-red-500 ml-2"
                    >×</button>
                  </div>
                ) : (
                  <>
                    <p className="text-sm text-gray-500">Click to browse or drag &amp; drop</p>
                    <p className="text-xs text-gray-400 mt-1">CSV only · max 20 MB</p>
                  </>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <button
              type="submit"
              disabled={loading || !clientId.trim() || !file}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-2.5 rounded-xl text-sm font-medium transition-colors"
            >
              {loading ? "Processing…" : "Submit Ledger"}
            </button>
          </form>
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{error}</div>
        )}

        {loading && (
          <div className="bg-white border border-gray-200 rounded-2xl p-10 flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-gray-400">Saving submission and analysing changes…</p>
          </div>
        )}

        {/* First submission confirmation */}
        {result && result.is_first_submission && (
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5">
            <p className="font-medium text-green-800">First submission recorded — v{result.version}</p>
            <p className="text-sm text-green-700 mt-1">
              <strong>{result.filename}</strong> has been saved for <strong>{result.client_id}</strong>.
              Future submissions will be compared against this version and staff will be notified.
            </p>
          </div>
        )}

        {/* Diff analysis results */}
        {result && !result.is_first_submission && result.analysis && result.diff && (
          <div className="space-y-4">
            {/* Headline */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="text-xs text-blue-600 font-medium uppercase tracking-wide mb-1">
                    {result.client_id} — v{result.version}
                  </p>
                  <p className="font-semibold text-blue-900">{result.analysis.headline}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500">Rows</p>
                  <p className="text-sm font-mono">
                    {result.diff.row_count.old} → {result.diff.row_count.new}
                    <span className={`ml-1 ${result.diff.row_count.delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                      ({result.diff.row_count.delta >= 0 ? "+" : ""}{result.diff.row_count.delta})
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Narrative */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Analysis</h3>
              <div className="prose prose-sm max-w-none text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.analysis.narrative}</ReactMarkdown>
              </div>
            </div>

            {/* Key changes + risk flags */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Key Changes</h3>
                <ul className="space-y-2">
                  {result.analysis.key_changes.map((c, i) => (
                    <li key={i} className="flex gap-2 text-sm text-gray-700">
                      <span className="text-blue-400 mt-0.5">•</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-white border border-amber-200 rounded-2xl p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-600 mb-3">Risk Flags</h3>
                {result.analysis.risk_flags.length > 0 ? (
                  <ul className="space-y-2">
                    {result.analysis.risk_flags.map((r, i) => (
                      <li key={i} className="flex gap-2 text-sm text-amber-800">
                        <span className="text-amber-500 mt-0.5">⚠</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-400">No risk flags identified.</p>
                )}
              </div>
            </div>

            {/* Column totals table */}
            {Object.keys(result.diff.column_totals).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Column Totals</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b text-xs text-gray-500 font-medium uppercase tracking-wide">
                        <th className="px-4 py-3 text-left">Column</th>
                        <th className="px-4 py-3 text-right">Previous</th>
                        <th className="px-4 py-3 text-right">New</th>
                        <th className="px-4 py-3 text-right">Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(result.diff.column_totals).map(([col, vals]) => (
                        <tr key={col} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium">{col}</td>
                          <td className="px-4 py-3 text-right font-mono text-gray-500">{fmt(vals.old)}</td>
                          <td className="px-4 py-3 text-right font-mono">{fmt(vals.new)}</td>
                          <td className={`px-4 py-3 text-right font-mono font-semibold ${vals.delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {vals.delta >= 0 ? "+" : ""}{fmt(vals.delta)}
                            {vals.pct_change !== null && (
                              <span className="ml-1 text-xs font-normal opacity-70">
                                ({vals.pct_change >= 0 ? "+" : ""}{vals.pct_change}%)
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Row diff */}
            {result.diff.row_diff && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
                  Row-Level Changes <span className="font-normal normal-case">(key: <code className="bg-gray-100 px-1 rounded">{result.diff.row_diff.key_column}</code>)</span>
                </h3>
                <div className="flex gap-8 text-sm mb-3">
                  <span className="text-green-600 font-medium">{result.diff.row_diff.added_rows} new entries</span>
                  <span className="text-red-600 font-medium">{result.diff.row_diff.removed_rows} removed entries</span>
                </div>
                {result.diff.row_diff.sample_added.length > 0 && (
                  <p className="text-xs text-gray-500 mb-1">Sample new: {result.diff.row_diff.sample_added.join(", ")}</p>
                )}
                {result.diff.row_diff.sample_removed.length > 0 && (
                  <p className="text-xs text-gray-500">Sample removed: {result.diff.row_diff.sample_removed.join(", ")}</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Submission history */}
        {history !== null && history.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Submission History — {clientId}
              </h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b text-xs text-gray-500 font-medium uppercase tracking-wide">
                  <th className="px-4 py-3 text-left">Version</th>
                  <th className="px-4 py-3 text-left">File</th>
                  <th className="px-4 py-3 text-left">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.version} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">v{h.version}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{h.filename}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{h.submitted_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {historyLoading && (
          <p className="text-xs text-gray-400 text-center">Loading history…</p>
        )}
      </main>
    </div>
  );
}
