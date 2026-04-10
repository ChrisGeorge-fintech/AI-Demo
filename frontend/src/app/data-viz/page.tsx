"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

// ── Types ──────────────────────────────────────────────────────────────────

interface ChartVisual {
  type: "bar" | "line" | "pie";
  title: string;
  x_label?: string;
  y_label?: string;
  data: { label: string; value: number }[];
}

interface TableVisual {
  type: "table";
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

type Visual = ChartVisual | TableVisual;

interface AnalysisResult {
  summary: string;
  visuals: Visual[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getToken(): string {
  return document.cookie.split("; ").find((r) => r.startsWith("token="))?.split("=")[1] ?? "";
}

// ── Visual components ──────────────────────────────────────────────────────

function ChartCard({ v }: { v: ChartVisual }) {
  const chartData = v.data.map((d) => ({ name: d.label, value: d.value }));

  const tooltipFormatter = (val: number) =>
    val >= 1000 ? val.toLocaleString(undefined, { minimumFractionDigits: 0 }) : val;

  if (v.type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <PieChart>
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={110}
            label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}
            labelLine={false}
          >
            {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(val: number) => tooltipFormatter(val)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (v.type === "line") {
    return (
      <ResponsiveContainer width="100%" height={320}>
        <LineChart data={chartData} margin={{ top: 5, right: 24, bottom: 28, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" tick={{ fontSize: 11 }} label={v.x_label ? { value: v.x_label, position: "insideBottom", offset: -16, fontSize: 11 } : undefined} />
          <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} label={v.y_label ? { value: v.y_label, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
          <Tooltip formatter={(val: number) => tooltipFormatter(val)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line type="monotone" dataKey="value" stroke={COLORS[0]} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name={v.y_label || "Value"} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  // bar (default)
  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 5, right: 24, bottom: 28, left: 16 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 11 }} label={v.x_label ? { value: v.x_label, position: "insideBottom", offset: -16, fontSize: 11 } : undefined} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} label={v.y_label ? { value: v.y_label, angle: -90, position: "insideLeft", fontSize: 11 } : undefined} />
        <Tooltip formatter={(val: number) => tooltipFormatter(val)} cursor={{ fill: "#f0f4ff" }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="value" radius={[4, 4, 0, 0]} name={v.y_label || "Value"}>
          {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TableCard({ v }: { v: TableVisual }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b text-xs text-gray-500 font-medium uppercase tracking-wide">
            {v.columns.map((col, i) => (
              <th key={i} className="px-3 py-2 text-left whitespace-nowrap">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {v.rows.map((row, ri) => (
            <tr key={ri} className="border-b last:border-0 hover:bg-gray-50">
              {row.map((cell, ci) => (
                <td key={ci} className={`px-3 py-2 ${typeof cell === "number" ? "text-right font-mono tabular-nums" : ""}`}>
                  {typeof cell === "number" ? cell.toLocaleString() : cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VisualCard({ visual, index }: { visual: Visual; index: number }) {
  const typeLabel: Record<string, string> = { bar: "Bar", line: "Line", pie: "Pie", table: "Table" };
  const typeBadgeColor: Record<string, string> = {
    bar: "bg-blue-50 text-blue-700",
    line: "bg-purple-50 text-purple-700",
    pie: "bg-amber-50 text-amber-700",
    table: "bg-gray-100 text-gray-600",
  };

  return (
    <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
        <h3 className="font-medium text-gray-800 text-sm">{visual.title}</h3>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${typeBadgeColor[visual.type]}`}>
          {typeLabel[visual.type]}
        </span>
      </div>
      <div className="p-4">
        {visual.type === "table" ? (
          <TableCard v={visual as TableVisual} />
        ) : (
          <ChartCard v={visual as ChartVisual} />
        )}
      </div>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

const EXAMPLES = [
  "Show total amount by category",
  "Break down expenses by department",
  "Show spending over time",
  "Which vendor has the highest total spend?",
  "Compare categories by number of transactions and total value",
];

export default function DataVizPage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;
    setError("");
    setResult(null);
    setLoading(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/data/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Query failed");
      setResult(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }

  // Choose grid layout based on visual count
  const vizCount = result?.visuals?.length ?? 0;
  const gridClass = vizCount === 1 ? "grid grid-cols-1" : "grid grid-cols-1 lg:grid-cols-2 gap-4";

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">Data Visualisation</h1>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Live CSV Feed</span>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 space-y-6">
        {/* Search bar */}
        <form onSubmit={handleSubmit} className="flex gap-3">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about the financial data…"
            disabled={loading}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors"
          >
            {loading ? "Analysing…" : "Analyse"}
          </button>
        </form>

        {/* Example prompts */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setQuestion(ex)}
              className="text-xs border border-gray-300 rounded-full px-3 py-1 hover:border-blue-400 hover:text-blue-600 transition-colors bg-white"
            >
              {ex}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{error}</div>
        )}

        {/* Loading */}
        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Analysing data…</p>
            </div>
          </div>
        )}

        {/* Results */}
        {result && !loading && (
          <div className="space-y-4">
            {/* Summary text */}
            <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Analysis</span>
              </div>
              <div className="prose prose-sm prose-gray max-w-none
                prose-p:my-1 prose-p:leading-relaxed
                prose-strong:font-semibold prose-strong:text-gray-900
                prose-ul:my-1 prose-ul:pl-5 prose-li:my-0.5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.summary}</ReactMarkdown>
              </div>
            </div>

            {/* Visuals grid */}
            <div className={gridClass}>
              {result.visuals.map((v, i) => (
                <div key={i} className={
                  // Odd-count layouts: last item spans both columns
                  vizCount % 2 !== 0 && i === vizCount - 1 ? "lg:col-span-2" : ""
                }>
                  <VisualCard visual={v} index={i} />
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
