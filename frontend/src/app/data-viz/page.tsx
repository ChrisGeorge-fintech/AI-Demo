"use client";

import { useState, FormEvent } from "react";
import Link from "next/link";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

const COLORS = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#db2777", "#65a30d"];

interface ChartData {
  chart_type: "bar" | "line" | "pie";
  title: string;
  x_label?: string;
  y_label?: string;
  data: { label: string; value: number }[];
}

function getToken(): string {
  return document.cookie.split("; ").find((r) => r.startsWith("token="))?.split("=")[1] ?? "";
}

function Chart({ result }: { result: ChartData }) {
  const recharts_data = result.data.map((d) => ({ name: d.label, value: d.value }));

  if (result.chart_type === "pie") {
    return (
      <ResponsiveContainer width="100%" height={380}>
        <PieChart>
          <Pie data={recharts_data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={140} label={({ name, percent }) => `${name} (${(percent * 100).toFixed(1)}%)`}>
            {recharts_data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
          </Pie>
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (result.chart_type === "line") {
    return (
      <ResponsiveContainer width="100%" height={380}>
        <LineChart data={recharts_data} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
          <XAxis dataKey="name" label={{ value: result.x_label, position: "insideBottom", offset: -10 }} tick={{ fontSize: 12 }} />
          <YAxis label={{ value: result.y_label, angle: -90, position: "insideLeft" }} tick={{ fontSize: 12 }} />
          <Tooltip formatter={(v: number) => v.toLocaleString()} />
          <Line type="monotone" dataKey="value" stroke="#2563eb" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={380}>
      <BarChart data={recharts_data} margin={{ top: 5, right: 20, bottom: 20, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" label={{ value: result.x_label, position: "insideBottom", offset: -10 }} tick={{ fontSize: 12 }} />
        <YAxis label={{ value: result.y_label, angle: -90, position: "insideLeft" }} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(v: number) => v.toLocaleString()} />
        <Bar dataKey="value" fill="#2563eb" radius={[4, 4, 0, 0]}>
          {recharts_data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const EXAMPLES = [
  "Show total amount by category as a bar chart",
  "Show expenses by department as a pie chart",
  "Show spending over time as a line chart",
  "Which vendor has the highest total spend?",
];

export default function DataVizPage() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<ChartData | null>(null);
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

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center gap-4">
        <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← Home</Link>
        <h1 className="text-lg font-semibold">Data Visualisation</h1>
        <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Live CSV Feed</span>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full px-6 py-8">
        <form onSubmit={handleSubmit} className="flex gap-3 mb-6">
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
        <div className="flex flex-wrap gap-2 mb-8">
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

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600 mb-6">{error}</div>
        )}

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-12 flex items-center justify-center">
            <div className="text-center text-gray-400">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-sm">Analysing data…</p>
            </div>
          </div>
        )}

        {result && !loading && (
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h2 className="text-base font-semibold mb-4">{result.title}</h2>
            <Chart result={result} />
          </div>
        )}
      </main>
    </div>
  );
}
