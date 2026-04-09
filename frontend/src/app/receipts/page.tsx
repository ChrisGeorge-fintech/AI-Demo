"use client";

import { useState, useRef, DragEvent, FormEvent } from "react";
import Link from "next/link";

type JobStatus = "idle" | "queued" | "processing" | "done" | "failed";

interface JobResult {
  email_sent_to?: string;
  analysis?: {
    summary?: string;
    grand_total?: number;
    receipts?: {
      vendor: string;
      date: string;
      total: number;
      currency: string;
      items: { description: string; quantity: number | null; unit_price: number | null; total: number }[];
    }[];
  };
}

function getToken(): string {
  return document.cookie.split("; ").find((r) => r.startsWith("token="))?.split("=")[1] ?? "";
}

export default function ReceiptsPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [email, setEmail] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<JobResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    const pdfs = Array.from(incoming).filter((f) => f.type === "application/pdf");
    setFiles((prev) => [...prev, ...pdfs]);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  }

  async function pollJob(id: string) {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/jobs/${id}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
        });
        const data = await res.json();
        if (data.status === "done") {
          clearInterval(interval);
          setStatus("done");
          setResult(data.result);
        } else if (data.status === "failed") {
          clearInterval(interval);
          setStatus("failed");
          setError(data.error || "Processing failed");
        } else {
          setStatus(data.status);
        }
      } catch {
        clearInterval(interval);
        setStatus("failed");
        setError("Lost connection to server");
      }
    }, 2500);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (files.length === 0 || !email) return;
    setError("");
    setStatus("queued");

    const form = new FormData();
    files.forEach((f) => form.append("files", f));
    form.append("email", email);

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/receipts/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Upload failed");
      setJobId(data.job_id);
      pollJob(data.job_id);
    } catch (err: unknown) {
      setStatus("failed");
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  const statusLabel: Record<JobStatus, string> = {
    idle: "",
    queued: "Queued — waiting for a processing slot…",
    processing: "Processing receipts…",
    done: "Done",
    failed: "Failed",
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">Receipt Scanner</h1>
        <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">PDF + OCR</span>
      </header>

      <main className="flex-1 max-w-2xl mx-auto w-full px-6 py-8">
        {status === "idle" || status === "failed" ? (
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Drop zone */}
            <div
              onDrop={onDrop}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-colors ${dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 bg-white"}`}
            >
              <input ref={inputRef} type="file" accept=".pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              <p className="text-gray-500 text-sm">Drag & drop PDF receipts here, or <span className="text-blue-600 font-medium">browse</span></p>
              <p className="text-xs text-gray-400 mt-1">Multiple files supported</p>
            </div>

            {files.length > 0 && (
              <ul className="space-y-2">
                {files.map((f, i) => (
                  <li key={i} className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm">
                    <span className="text-gray-700 truncate">{f.name}</span>
                    <button type="button" onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 ml-3 text-xs">Remove</button>
                  </li>
                ))}
              </ul>
            )}

            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="email">Send analysis to email</label>
              <input
                id="email" type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="yourname@example.com"
                className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2">{error}</p>}

            <button
              type="submit"
              disabled={files.length === 0 || !email}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-xl font-medium text-sm transition-colors"
            >
              Upload & Analyse
            </button>
          </form>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center space-y-4">
            {status !== "done" && (
              <div className="w-10 h-10 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            )}
            {status === "done" && <div className="text-4xl">✓</div>}

            <p className="font-medium text-gray-700">{statusLabel[status]}</p>

            {status === "done" && result && (
              <div className="text-left mt-4 space-y-4">
                <p className="text-sm text-gray-500">{result.analysis?.summary}</p>
                <p className="text-sm"><span className="font-medium">Sent to:</span> {result.email_sent_to}</p>
                {result.analysis?.receipts?.map((r, i) => (
                  <div key={i} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 text-sm font-medium">{r.vendor} — {r.date}</div>
                    <table className="w-full text-xs">
                      <thead><tr className="border-b"><th className="px-4 py-2 text-left">Item</th><th className="px-4 py-2 text-right">Total</th></tr></thead>
                      <tbody>
                        {r.items.map((item, j) => (
                          <tr key={j} className="border-b last:border-0">
                            <td className="px-4 py-2">{item.description}</td>
                            <td className="px-4 py-2 text-right">{item.total} {r.currency}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr><td className="px-4 py-2 font-medium">Total</td><td className="px-4 py-2 text-right font-medium">{r.total} {r.currency}</td></tr></tfoot>
                    </table>
                  </div>
                ))}
              </div>
            )}

            {status === "done" && (
              <button onClick={() => { setStatus("idle"); setFiles([]); setResult(null); setError(""); }}
                className="mt-4 text-sm text-blue-600 hover:underline">
                Upload more receipts
              </button>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
